#!/usr/bin/env python3
"""
generate_maps.py — Derive heightmaps and normal maps from surface textures.

For each .png in the texture directory, generates:
  {id}_height.png  — greyscale heightmap (from luminance + edge detection)
  {id}_normal.png  — tangent-space normal map (from heightmap Sobel)

Works entirely offline using PIL + numpy + scipy.
"""

import os
import sys
import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

# ── Paths ──────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent
TEXTURE_DIR = PROJECT_ROOT / "02_CLIENTS" / "02_DESKTOP" / "public" / "textures" / "planets"


def rgb_to_heightmap(img: Image.Image, strength: float = 1.0) -> Image.Image:
    """
    Convert an RGB surface texture to a heightmap using luminance + detail.

    Strategy:
      1. Convert to greyscale (luminance)
      2. Apply edge-detection to extract crack/ridge detail
      3. Blend luminance (base terrain) with inverted edges (detail crevices)
      4. Normalize to full [0,255] range
    """
    arr = np.array(img.convert("RGB"), dtype=np.float64)
    
    # Perceptual luminance
    lum = 0.299 * arr[:, :, 0] + 0.587 * arr[:, :, 1] + 0.114 * arr[:, :, 2]
    
    # Edge detail (Sobel magnitude)
    sx = ndimage.sobel(lum, axis=1)
    sy = ndimage.sobel(lum, axis=0)
    edges = np.hypot(sx, sy)
    
    # Normalize each
    lum_n = (lum - lum.min()) / (lum.max() - lum.min() + 1e-8)
    edges_n = (edges - edges.min()) / (edges.max() - edges.min() + 1e-8)
    
    # Combine: luminance as base height, edges add detail
    combined = lum_n * 0.75 + (1.0 - edges_n) * 0.25 * strength
    
    # Apply slight gaussian to smooth noise
    combined = ndimage.gaussian_filter(combined, sigma=0.8)
    
    # Normalize to [0, 255]
    combined = (combined - combined.min()) / (combined.max() - combined.min() + 1e-8)
    combined = (combined * 255).clip(0, 255).astype(np.uint8)
    
    return Image.fromarray(combined, mode="L")


def heightmap_to_normal(height_img: Image.Image, strength: float = 2.0) -> Image.Image:
    """
    Convert a greyscale heightmap to a tangent-space normal map.

    Uses Sobel operators in X and Y, then constructs RGB normals:
      R = dx ([-1..1] → [0..255])
      G = dy ([-1..1] → [0..255])
      B = z  (pointing outward, [0..255])
    """
    h = np.array(height_img, dtype=np.float64) / 255.0
    
    # Compute gradients with Sobel
    dx = ndimage.sobel(h, axis=1) * strength
    dy = -ndimage.sobel(h, axis=0) * strength  # flip Y for OpenGL convention
    
    # Z component (normalized)
    dz = np.ones_like(h)
    
    # Normalize the normal vectors
    mag = np.sqrt(dx**2 + dy**2 + dz**2)
    nx = dx / mag
    ny = dy / mag
    nz = dz / mag
    
    # Map [-1,1] to [0,255]
    r = ((nx * 0.5 + 0.5) * 255).clip(0, 255).astype(np.uint8)
    g = ((ny * 0.5 + 0.5) * 255).clip(0, 255).astype(np.uint8)
    b = ((nz * 0.5 + 0.5) * 255).clip(0, 255).astype(np.uint8)
    
    normal = np.stack([r, g, b], axis=-1)
    return Image.fromarray(normal, mode="RGB")


def process_texture(src_path: Path, force: bool = False, height_strength: float = 1.0, normal_strength: float = 2.0) -> tuple[bool, bool]:
    """Process a single texture file. Returns (height_created, normal_created)."""
    stem = src_path.stem
    
    # Skip if this IS a derived map
    if stem.endswith("_height") or stem.endswith("_normal"):
        return False, False
    
    height_path = src_path.parent / f"{stem}_height.png"
    normal_path = src_path.parent / f"{stem}_normal.png"
    
    h_exists = height_path.exists()
    n_exists = normal_path.exists()
    
    if h_exists and n_exists and not force:
        return False, False
    
    img = Image.open(src_path).convert("RGB")
    
    h_created = False
    n_created = False
    
    if not h_exists or force:
        height = rgb_to_heightmap(img, strength=height_strength)
        height.save(height_path, optimize=True)
        h_created = True
    else:
        height = Image.open(height_path).convert("L")
    
    if not n_exists or force:
        normal = heightmap_to_normal(height, strength=normal_strength)
        normal.save(normal_path, optimize=True)
        n_created = True
    
    return h_created, n_created


def main():
    parser = argparse.ArgumentParser(description="Generate heightmaps and normal maps from surface textures")
    parser.add_argument("--force", action="store_true", help="Regenerate even if maps exist")
    parser.add_argument("--height-strength", type=float, default=1.0, help="Heightmap detail strength")
    parser.add_argument("--normal-strength", type=float, default=2.5, help="Normal map strength")
    parser.add_argument("--ids", nargs="+", help="Only process these texture IDs")
    args = parser.parse_args()
    
    if not TEXTURE_DIR.exists():
        print(f"ERROR: Texture directory not found: {TEXTURE_DIR}")
        sys.exit(1)
    
    # Find all source textures (exclude derived maps)
    sources = sorted([
        p for p in TEXTURE_DIR.glob("*.png")
        if not p.stem.endswith("_height") and not p.stem.endswith("_normal")
    ])
    
    if args.ids:
        id_set = set(args.ids)
        sources = [p for p in sources if p.stem in id_set]
    
    print(f"\n{'='*60}")
    print(f"  ExoMaps Heightmap/Normal Generator")
    print(f"  Processing {len(sources)} textures")
    print(f"  Output: {TEXTURE_DIR}")
    print(f"  Height strength: {args.height_strength}")
    print(f"  Normal strength: {args.normal_strength}")
    print(f"{'='*60}\n")
    
    total_h = 0
    total_n = 0
    
    for i, src in enumerate(sources, 1):
        stem = src.stem
        print(f"[{i}/{len(sources)}] {stem}...", end=" ", flush=True)
        
        h, n = process_texture(
            src, 
            force=args.force,
            height_strength=args.height_strength,
            normal_strength=args.normal_strength,
        )
        
        if h or n:
            parts = []
            if h: parts.append("height")
            if n: parts.append("normal")
            print(f"✓ {'+'.join(parts)}")
            total_h += int(h)
            total_n += int(n)
        else:
            print("(exists, skipped)")
    
    print(f"\n{'='*60}")
    print(f"  COMPLETE")
    print(f"  Heightmaps generated: {total_h}")
    print(f"  Normal maps generated: {total_n}")
    print(f"  Skipped: {len(sources) - max(total_h, total_n)}")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
