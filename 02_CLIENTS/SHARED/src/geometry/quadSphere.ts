/**
 * QuadSphere — Adaptive LOD sphere geometry built from a subdivided cube.
 *
 * Instead of the usual UV-sphere (which concentrates vertices at poles and
 * creates degenerate triangles), the QuadSphere starts with a cube whose
 * 6 faces are each recursively subdivided in a quadtree, then projected
 * onto the unit sphere. This gives:
 *
 *   - Near-uniform triangle sizes across the whole surface
 *   - Clean UV mapping per face (no pole singularity)
 *   - Natural LOD: subdivide faces near the camera, collapse distant ones
 *   - Easy displacement mapping: vertices slide along their normal (radial)
 *
 * Architecture:
 *   - 6 cube faces × quadtree depth → triangles
 *   - Each face stores its own BufferGeometry for independent LOD
 *   - Shared displacement/normal/albedo texture array (one layer per face)
 *
 * References:
 *   - Clasen & Hege 2006 "Terrain Rendering using Spherical Clipmaps"
 *   - Hybrid quadtree sphere as used in Outerra, Pioneer Space Sim
 *
 * @module geometry/quadSphere
 */

import * as THREE from 'three';

/* ── Cube face definitions ─────────────────────────── */

/** The 6 faces of the base cube, each with origin + two tangent axes. */
export const CUBE_FACES = [
  { name: '+X', origin: [ 1, -1, -1], right: [0, 0,  2], up: [0,  2, 0] },
  { name: '-X', origin: [-1, -1,  1], right: [0, 0, -2], up: [0,  2, 0] },
  { name: '+Y', origin: [-1,  1, -1], right: [2, 0,  0], up: [0,  0, 2] },
  { name: '-Y', origin: [-1, -1,  1], right: [2, 0,  0], up: [0,  0,-2] },
  { name: '+Z', origin: [-1, -1,  1], right: [2, 0,  0], up: [0,  2, 0] },
  { name: '-Z', origin: [ 1, -1, -1], right: [-2,0,  0], up: [0,  2, 0] },
] as const;

/* ── Types ─────────────────────────────────────────── */

export interface QuadSphereOptions {
  /** Subdivision depth per face. 0 = 2 tris, 6 = 8192 tris per face. Max 8. */
  subdivisions: number;
  /** Planet radius in scene units (default 1). */
  radius: number;
  /** Whether to compute tangent vectors for normal mapping. */
  computeTangents: boolean;
  /** Per-vertex displacement function: (position: Vec3, normal: Vec3) → height */
  displacementFn?: (x: number, y: number, z: number) => number;
  /** Displacement amplitude (multiplied by displacementFn result). */
  displacementScale: number;
}

const DEFAULT_OPTIONS: QuadSphereOptions = {
  subdivisions: 5,
  radius: 1,
  computeTangents: true,
  displacementScale: 0.0,
};

/* ── QuadSphere Face Builder ───────────────────────── */

/**
 * Build a single face of the QuadSphere as a BufferGeometry.
 *
 * @param faceIndex 0-5 for +X,-X,+Y,-Y,+Z,-Z
 * @param options   Subdivision depth, radius, displacement
 */
export function buildQuadFace(
  faceIndex: number,
  options: Partial<QuadSphereOptions> = {},
): THREE.BufferGeometry {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const face = CUBE_FACES[faceIndex];
  const gridSize = (1 << opts.subdivisions) + 1; // e.g. depth 5 → 33×33 grid
  const totalVerts = gridSize * gridSize;
  const totalQuads = (gridSize - 1) * (gridSize - 1);
  const totalTris = totalQuads * 2;

  // Allocate buffers
  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);
  const indices = new Uint32Array(totalTris * 3);

  // Optional: tangent frame for normal mapping
  const tangents = opts.computeTangents ? new Float32Array(totalVerts * 4) : null;

  // Build vertex grid
  const origin = face.origin;
  const right = face.right;
  const up = face.up;
  const v3 = new THREE.Vector3();
  const t3 = new THREE.Vector3();

  for (let row = 0; row < gridSize; row++) {
    const v = row / (gridSize - 1);
    for (let col = 0; col < gridSize; col++) {
      const u = col / (gridSize - 1);
      const idx = row * gridSize + col;

      // Point on cube face
      const cx = origin[0] + right[0] * u + up[0] * v;
      const cy = origin[1] + right[1] * u + up[1] * v;
      const cz = origin[2] + right[2] * u + up[2] * v;

      // Project to sphere (normalize)
      v3.set(cx, cy, cz).normalize();

      // Normal is just the normalized direction on a unit sphere
      const nx = v3.x;
      const ny = v3.y;
      const nz = v3.z;

      // Apply displacement along normal
      let displacement = 0;
      if (opts.displacementFn && opts.displacementScale > 0) {
        displacement = opts.displacementFn(nx, ny, nz) * opts.displacementScale;
      }

      const r = opts.radius + displacement;
      positions[idx * 3    ] = nx * r;
      positions[idx * 3 + 1] = ny * r;
      positions[idx * 3 + 2] = nz * r;

      normals[idx * 3    ] = nx;
      normals[idx * 3 + 1] = ny;
      normals[idx * 3 + 2] = nz;

      // UV: face-local coordinates
      uvs[idx * 2    ] = u;
      uvs[idx * 2 + 1] = v;

      // Tangent: derivative of position w.r.t. u (along face 'right' axis)
      if (tangents) {
        const du = 0.001;
        const cx2 = origin[0] + right[0] * (u + du) + up[0] * v;
        const cy2 = origin[1] + right[1] * (u + du) + up[1] * v;
        const cz2 = origin[2] + right[2] * (u + du) + up[2] * v;
        t3.set(cx2, cy2, cz2).normalize();
        t3.sub(v3.clone().normalize()).normalize();
        tangents[idx * 4    ] = t3.x;
        tangents[idx * 4 + 1] = t3.y;
        tangents[idx * 4 + 2] = t3.z;
        tangents[idx * 4 + 3] = 1.0; // handedness
      }
    }
  }

  // Build triangle indices
  let triIdx = 0;
  for (let row = 0; row < gridSize - 1; row++) {
    for (let col = 0; col < gridSize - 1; col++) {
      const a = row * gridSize + col;
      const b = a + 1;
      const c = a + gridSize;
      const d = c + 1;

      // Two triangles per quad, consistent winding
      indices[triIdx++] = a;
      indices[triIdx++] = c;
      indices[triIdx++] = b;

      indices[triIdx++] = b;
      indices[triIdx++] = c;
      indices[triIdx++] = d;
    }
  }

  // Assemble geometry
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));

  if (tangents) {
    geo.setAttribute('tangent', new THREE.BufferAttribute(tangents, 4));
  }

  return geo;
}

/**
 * Build a complete QuadSphere — 6 faces merged into one BufferGeometry.
 *
 * For simple planet rendering where a single draw call is preferred
 * over per-face LOD management.
 */
export function buildQuadSphere(
  options: Partial<QuadSphereOptions> = {},
): THREE.BufferGeometry {
  const faces: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    faces.push(buildQuadFace(i, options));
  }

  // Merge all 6 face geometries
  const merged = mergeBufferGeometries(faces);

  // Clean up individual faces
  faces.forEach(f => f.dispose());

  return merged;
}

/**
 * Merge multiple BufferGeometries into one (custom implementation to
 * avoid dependency on deprecated THREE.BufferGeometryUtils).
 */
function mergeBufferGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let totalVerts = 0;
  let totalIndices = 0;
  const hasTangents = geos[0].getAttribute('tangent') != null;

  for (const g of geos) {
    totalVerts += g.getAttribute('position').count;
    totalIndices += g.index!.count;
  }

  const pos = new Float32Array(totalVerts * 3);
  const norm = new Float32Array(totalVerts * 3);
  const uv = new Float32Array(totalVerts * 2);
  const tan = hasTangents ? new Float32Array(totalVerts * 4) : null;
  const idx = new Uint32Array(totalIndices);
  // Per-vertex face ID (0-5) for cubemap texture sampling
  const faceId = new Float32Array(totalVerts);

  let vOffset = 0;
  let iOffset = 0;

  for (let fi = 0; fi < geos.length; fi++) {
    const g = geos[fi];
    const gPos = g.getAttribute('position') as THREE.BufferAttribute;
    const gNorm = g.getAttribute('normal') as THREE.BufferAttribute;
    const gUv = g.getAttribute('uv') as THREE.BufferAttribute;
    const gTan = hasTangents ? g.getAttribute('tangent') as THREE.BufferAttribute : null;
    const gIdx = g.index!;

    const vc = gPos.count;

    // Copy attributes
    pos.set(gPos.array as Float32Array, vOffset * 3);
    norm.set(gNorm.array as Float32Array, vOffset * 3);
    uv.set(gUv.array as Float32Array, vOffset * 2);
    if (tan && gTan) {
      tan.set(gTan.array as Float32Array, vOffset * 4);
    }

    // Fill face ID
    for (let i = 0; i < vc; i++) {
      faceId[vOffset + i] = fi;
    }

    // Copy indices with offset
    const gIdxArr = gIdx.array as Uint32Array;
    for (let i = 0; i < gIdxArr.length; i++) {
      idx[iOffset + i] = gIdxArr[i] + vOffset;
    }

    vOffset += vc;
    iOffset += gIdxArr.length;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  merged.setAttribute('aFaceId', new THREE.BufferAttribute(faceId, 1));
  if (tan) {
    merged.setAttribute('tangent', new THREE.BufferAttribute(tan, 4));
  }
  merged.setIndex(new THREE.BufferAttribute(idx, 1));

  return merged;
}

/* ── Adaptive LOD QuadTree (for future camera-aware subdivision) ── */

export interface QuadNode {
  faceIndex: number;
  depth: number;
  /** Normalized [0,1] bounds within the face */
  u0: number; v0: number;
  u1: number; v1: number;
  children: QuadNode[] | null;
}

/**
 * Build a quadtree for a face, splitting nodes that are close to the camera.
 *
 * @param faceIndex     Cube face 0-5
 * @param cameraPos     Camera position in world space
 * @param planetCenter  Planet center in world space
 * @param planetRadius  Planet radius
 * @param maxDepth      Maximum quadtree depth (default 8)
 * @param splitDistance  Distance threshold multiplier for splitting (default 2.0)
 */
export function buildAdaptiveQuadTree(
  faceIndex: number,
  cameraPos: THREE.Vector3,
  planetCenter: THREE.Vector3,
  planetRadius: number,
  maxDepth: number = 8,
  splitDistance: number = 2.0,
): QuadNode {
  const root: QuadNode = {
    faceIndex,
    depth: 0,
    u0: 0, v0: 0,
    u1: 1, v1: 1,
    children: null,
  };

  const face = CUBE_FACES[faceIndex];
  const center = new THREE.Vector3();

  function subdivide(node: QuadNode) {
    if (node.depth >= maxDepth) return;

    // Compute center of this quad on the sphere
    const midU = (node.u0 + node.u1) * 0.5;
    const midV = (node.v0 + node.v1) * 0.5;

    const cx = face.origin[0] + face.right[0] * midU + face.up[0] * midV;
    const cy = face.origin[1] + face.right[1] * midU + face.up[1] * midV;
    const cz = face.origin[2] + face.right[2] * midU + face.up[2] * midV;

    center.set(cx, cy, cz).normalize().multiplyScalar(planetRadius).add(planetCenter);

    // Angular size of this quad (approximation)
    const quadSize = planetRadius / (1 << node.depth);
    const distToCamera = center.distanceTo(cameraPos);

    // Split if close enough relative to quad size
    if (distToCamera < quadSize * splitDistance) {
      node.children = [
        { faceIndex, depth: node.depth + 1, u0: node.u0, v0: node.v0, u1: midU, v1: midV, children: null },
        { faceIndex, depth: node.depth + 1, u0: midU,   v0: node.v0, u1: node.u1, v1: midV, children: null },
        { faceIndex, depth: node.depth + 1, u0: node.u0, v0: midV,   u1: midU, v1: node.v1, children: null },
        { faceIndex, depth: node.depth + 1, u0: midU,   v0: midV,   u1: node.u1, v1: node.v1, children: null },
      ];
      node.children.forEach(subdivide);
    }
  }

  subdivide(root);
  return root;
}

/**
 * Count total leaf nodes (visible quads) in a quadtree.
 */
export function countLeaves(node: QuadNode): number {
  if (!node.children) return 1;
  return node.children.reduce((sum, c) => sum + countLeaves(c), 0);
}
