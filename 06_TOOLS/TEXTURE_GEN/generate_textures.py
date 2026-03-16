#!/usr/bin/env python3
"""
ExoMaps — EWoCS Planet Texture Generator
==========================================
Standalone tool that generates square regional planet surface textures
for EWoCS classification types using the Leonardo AI API (Lucid Origin model).

NOT part of the main runtime — run separately to pre-generate textures.
Textures are saved to 02_CLIENTS/02_DESKTOP/public/textures/planets/

Usage:
    python generate_textures.py                    # Generate ALL textures
    python generate_textures.py --ids aerosol_ammonian surface_gaian_earth
    python generate_textures.py --category aerosol # Just gas giant clouds
    python generate_textures.py --list             # List all prompt IDs
    python generate_textures.py --export-prompts   # Export prompts to JSON
    python generate_textures.py --dry-run          # Show what would be generated
    python generate_textures.py --budget            # Show estimated cost

Environment:
    LEONARDO_AI_API_KEY — required (from .env in project root)
"""

import argparse
import json
import os
import sys
import time
from dataclasses import asdict
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

# Load .env from project root
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
load_dotenv(PROJECT_ROOT / ".env")

from prompt_catalog_v2 import (
    ALL_PROMPTS_V2 as ALL_PROMPTS,
    TexturePrompt,
    get_prompt_by_id,
    list_all_ids,
    export_prompts_json,
    list_new_only,
    list_by_role,
)

# ═══════════════════════════════════════════════════════════
#  CONFIGURATION
# ═══════════════════════════════════════════════════════════

OUTPUT_DIR = PROJECT_ROOT / "02_CLIENTS" / "02_DESKTOP" / "public" / "textures" / "planets"
LOG_DIR = Path(__file__).parent / "logs"
GENERATION_LOG = LOG_DIR / "generation_log.json"

# Leonardo API settings
LEONARDO_MODEL_ID = "7b592283-e8a7-4c5a-9ba6-d18c31f258b9"  # Lucid Origin
LEONARDO_PRESET = "DYNAMIC"
RENDER_WIDTH = 1200   # square regional texture tile
RENDER_HEIGHT = 1200  # square regional texture tile
POLL_INTERVAL = 5     # seconds between status checks
MAX_POLL_TIME = 300   # max seconds to wait

# Budget tracking
ESTIMATED_COST_PER_IMAGE = 0.02  # USD estimate per generation (Lucid Origin is cheap)


def get_api_key() -> str:
    """Get Leonardo AI API key from environment."""
    key = os.environ.get("LEONARDO_AI_API_KEY")
    if not key:
        print("ERROR: LEONARDO_AI_API_KEY not set. Check your .env file.")
        print(f"  Expected .env at: {PROJECT_ROOT / '.env'}")
        sys.exit(1)
    return key


def ensure_dirs():
    """Create output directories."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)


def load_generation_log() -> dict:
    """Load the generation log (tracks what's been generated)."""
    if GENERATION_LOG.exists():
        with open(GENERATION_LOG) as f:
            return json.load(f)
    return {"generated": {}, "total_cost_usd": 0.0, "total_images": 0}


def save_generation_log(log: dict):
    """Save the generation log."""
    with open(GENERATION_LOG, "w") as f:
        json.dump(log, f, indent=2)


def generate_image_leonardo(prompt: TexturePrompt, api_key: str) -> str | None:
    """
    Generate a regional planet surface texture using Leonardo AI (Lucid Origin).
    Simple pipeline: generate 1200×1200 square tile → download.
    Returns the local file path if successful, None on failure.
    """
    import requests

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    # Use per-prompt dimensions (fall back to globals)
    raw_w = prompt.width if prompt.width else RENDER_WIDTH
    raw_h = prompt.height if prompt.height else RENDER_HEIGHT
    # Clamp dimensions to API limits (32–1536, multiples of 8)
    w = min(max(raw_w, 32), 1536)
    h = min(max(raw_h, 32), 1536)
    w = (w // 8) * 8
    h = (h // 8) * 8

    payload = {
        "prompt": prompt.prompt,
        "negative_prompt": prompt.negative,
        "modelId": LEONARDO_MODEL_ID,
        "width": w,
        "height": h,
        "num_images": 1,
        "presetStyle": prompt.style,
        "contrastRatio": 0.5,
    }

    print(f"  [1/2] Generating {w}×{h} texture...")
    print(f"  Prompt: {prompt.prompt[:100]}...")

    try:
        resp = requests.post(
            "https://cloud.leonardo.ai/api/rest/v1/generations",
            headers=headers,
            json=payload,
            timeout=30,
        )
        resp.raise_for_status()
        gen_data = resp.json()
        gen_id = gen_data["sdGenerationJob"]["generationId"]
        print(f"  Generation ID: {gen_id}")
    except Exception as e:
        print(f"  ERROR creating generation: {e}")
        if hasattr(e, 'response') and e.response is not None:
            print(f"  Response: {e.response.text[:500]}")
        return None

    # ── Poll until generation completes ──
    image_url = None
    elapsed = 0
    while elapsed < MAX_POLL_TIME:
        time.sleep(POLL_INTERVAL)
        elapsed += POLL_INTERVAL

        try:
            status_resp = requests.get(
                f"https://cloud.leonardo.ai/api/rest/v1/generations/{gen_id}",
                headers=headers,
                timeout=15,
            )
            status_resp.raise_for_status()
            status_data = status_resp.json()

            gen_info = status_data.get("generations_by_pk", {})
            status = gen_info.get("status", "UNKNOWN")

            if status == "COMPLETE":
                images = gen_info.get("generated_images", [])
                if images:
                    image_url = images[0].get("url")
                    print(f"  ✓ Generation complete!")
                    break
                else:
                    print(f"  ERROR: Generation complete but no images returned")
                    return None

            elif status == "FAILED":
                print(f"  ERROR: Generation failed")
                return None

            else:
                print(f"  Generating... {status} ({elapsed}s)")

        except Exception as e:
            print(f"  WARNING: Poll error: {e}")

    if not image_url:
        print(f"  ERROR: Timed out waiting for generation after {MAX_POLL_TIME}s")
        return None

    # ── Download ──
    print(f"  [2/2] Downloading texture...")
    return download_image(image_url, prompt.ewocs_id, api_key)


def download_image(url: str, ewocs_id: str, api_key: str) -> str | None:
    """Download generated image and save as texture file."""
    import requests

    try:
        resp = requests.get(url, timeout=60)
        resp.raise_for_status()

        filename = f"{ewocs_id}.png"
        filepath = OUTPUT_DIR / filename

        with open(filepath, "wb") as f:
            f.write(resp.content)

        size_kb = len(resp.content) / 1024
        print(f"  ✓ Saved: {filepath} ({size_kb:.0f} KB)")
        return str(filepath)

    except Exception as e:
        print(f"  ERROR downloading image: {e}")
        return None


def generate_batch(prompts: list[TexturePrompt], api_key: str, skip_existing: bool = True):
    """Generate textures for a batch of prompts."""
    log = load_generation_log()
    total = len(prompts)
    generated = 0
    skipped = 0
    failed = 0

    print(f"\n{'='*60}")
    print(f"  ExoMaps EWoCS Texture Generator")
    print(f"  Generating {total} textures")
    print(f"  Output: {OUTPUT_DIR}")
    print(f"{'='*60}\n")

    for i, prompt in enumerate(prompts, 1):
        print(f"\n[{i}/{total}] {prompt.ewocs_id} — {prompt.label}")

        # Skip if already generated
        if skip_existing and prompt.ewocs_id in log["generated"]:
            filepath = log["generated"][prompt.ewocs_id].get("filepath", "")
            if filepath and Path(filepath).exists():
                print(f"  ⏭ Already generated, skipping")
                skipped += 1
                continue

        # Generate
        filepath = generate_image_leonardo(prompt, api_key)

        if filepath:
            # Track actual rendered resolution (post-clamp)
            actual_w = min(max(prompt.width if prompt.width else RENDER_WIDTH, 32), 1536)
            actual_h = min(max(prompt.height if prompt.height else RENDER_HEIGHT, 32), 1536)
            actual_w = (actual_w // 8) * 8
            actual_h = (actual_h // 8) * 8
            log["generated"][prompt.ewocs_id] = {
                "filepath": filepath,
                "prompt": prompt.prompt,
                "negative": prompt.negative,
                "label": prompt.label,
                "category": prompt.category,
                "resolution": f"{actual_w}x{actual_h}",
                "requested_resolution": f"{prompt.width}x{prompt.height}",
                "generated_at": datetime.now().isoformat(),
            }
            log["total_cost_usd"] += ESTIMATED_COST_PER_IMAGE
            log["total_images"] += 1
            generated += 1
            save_generation_log(log)
        else:
            failed += 1

        # Rate limit (be nice to the API)
        if i < total:
            print("  Waiting 3s (rate limit)...")
            time.sleep(3)

    print(f"\n{'='*60}")
    print(f"  COMPLETE")
    print(f"  Generated: {generated}")
    print(f"  Skipped:   {skipped}")
    print(f"  Failed:    {failed}")
    print(f"  Total cost: ~${log['total_cost_usd']:.2f} USD")
    print(f"  Log: {GENERATION_LOG}")
    print(f"{'='*60}\n")


def main():
    parser = argparse.ArgumentParser(
        description="ExoMaps EWoCS Planet Texture Generator (Leonardo AI)"
    )
    parser.add_argument("--ids", nargs="+", help="Generate specific prompt IDs")
    parser.add_argument("--category", help="Category to generate (e.g. cratered, volcanic, desert, all)")
    parser.add_argument("--role", choices=["base", "stamp", "cloud", "liquid", "transition"],
                        help="Generate only prompts with this role")
    parser.add_argument("--new-only", action="store_true",
                        help="Generate only new v2 prompts (skip v1 re-tagged)")
    parser.add_argument("--list", action="store_true", help="List all prompt IDs")
    parser.add_argument("--export-prompts", action="store_true",
                        help="Export all prompts to JSON")
    parser.add_argument("--dry-run", action="store_true",
                        help="Show what would be generated without calling API")
    parser.add_argument("--budget", action="store_true",
                        help="Show estimated cost breakdown")
    parser.add_argument("--force", action="store_true",
                        help="Regenerate even if textures already exist")
    parser.add_argument("--status", action="store_true",
                        help="Show generation status")

    args = parser.parse_args()

    ensure_dirs()

    if args.list:
        print("Available prompt IDs:")
        print("-" * 50)
        for prompt in ALL_PROMPTS:
            status = "✓" if (OUTPUT_DIR / f"{prompt.ewocs_id}.png").exists() else "○"
            print(f"  {status} [{prompt.category:8s}] {prompt.ewocs_id}")
        print(f"\nTotal: {len(ALL_PROMPTS)} prompts")
        return

    if args.export_prompts:
        out = str(LOG_DIR / "prompts_catalog.json")
        export_prompts_json(out)
        return

    if args.budget:
        log = load_generation_log()
        remaining = len(ALL_PROMPTS) - len(log.get("generated", {}))
        print(f"Budget Estimate:")
        print(f"  Total prompts:     {len(ALL_PROMPTS)}")
        print(f"  Already generated: {len(log.get('generated', {}))}")
        print(f"  Remaining:         {remaining}")
        print(f"  Est. cost/image:   ~${ESTIMATED_COST_PER_IMAGE:.3f}")
        print(f"  Est. remaining:    ~${remaining * ESTIMATED_COST_PER_IMAGE:.2f}")
        print(f"  Total spent:       ~${log.get('total_cost_usd', 0):.2f}")
        return

    if args.status:
        log = load_generation_log()
        gen = log.get("generated", {})
        print(f"Generation Status:")
        print(f"  Total generated: {len(gen)}")
        print(f"  Total cost:      ~${log.get('total_cost_usd', 0):.2f}")
        if gen:
            print(f"\n  Generated textures:")
            for eid, info in sorted(gen.items()):
                exists = "✓" if Path(info.get("filepath", "")).exists() else "✗"
                print(f"    {exists} {eid} — {info.get('label', '?')}")
        return

    # Select prompts
    if args.ids:
        prompts = []
        for eid in args.ids:
            p = get_prompt_by_id(eid)
            if p:
                prompts.append(p)
            else:
                print(f"WARNING: Unknown ID '{eid}'")
    elif args.new_only:
        prompts = list_new_only()
    elif args.role:
        prompts = list_by_role(args.role)
    elif args.category and args.category != "all":
        prompts = [p for p in ALL_PROMPTS if p.category == args.category]
    else:
        prompts = ALL_PROMPTS

    if not prompts:
        print("No prompts to generate.")
        return

    if args.dry_run:
        print(f"DRY RUN — would generate {len(prompts)} textures:\n")
        for prompt in prompts:
            exists = "EXISTS" if (OUTPUT_DIR / f"{prompt.ewocs_id}.png").exists() else "NEW"
            print(f"  [{exists:6s}] {prompt.ewocs_id}")
            print(f"           {prompt.prompt[:80]}...")
            print()
        est = len(prompts) * ESTIMATED_COST_PER_IMAGE
        print(f"Estimated cost: ~${est:.2f}")
        return

    # Generate!
    api_key = get_api_key()
    generate_batch(prompts, api_key, skip_existing=not args.force)


if __name__ == "__main__":
    main()
