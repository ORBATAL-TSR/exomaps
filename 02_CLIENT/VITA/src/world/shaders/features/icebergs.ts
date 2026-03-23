/**
 * icebergs.ts — GLSL feature: procedural Worley-cell icebergs.
 *
 * Self-contained GLSL function that renders icebergs in polar ocean zones.
 * Imported by icecaps.ts (icebergs are driven by the same ice cap parameters).
 * Can also be imported standalone for ocean-world iceberg effects.
 *
 * Reads uniforms directly from the parent shader:
 *   uTime, uSeed, uIceCaps, uIcebergDensity
 *
 * Call site: inside the isOcean branch, after sea-ice fringe.
 *   applyIcebergs(color, pos, N, L, H, bumpN, depth01, absLat, NdotL);
 */
export const ICEBERGS_GLSL = /* glsl */`
// ── Icebergs ──────────────────────────────────────────────────────────────
// Sparse Worley-cell icebergs near the polar ocean margin.
// Each cell is hash-activated (~30% at max density), has an irregular
// noise-jagged outline, above/below-waterline color split, specular top face,
// translucent turquoise underwater face, and melt slush ring.
// Cells drift slowly equatorward over time (calved glacier flow).
//
// Performance gate: entire block skips at absLat < 0.45 or deep ocean.
void applyIcebergs(inout vec3 color,
                   vec3 pos, vec3 N, vec3 L, vec3 H,
                   vec3 bumpN, float depth01, float isPolar, float NdotL) {
  if(uIcebergDensity < 0.01) return;
  if(isPolar < 0.05 || depth01 >= 0.85) return;

  // Density mask: driven by zone proximity, suppressed in deep water
  float bergZone = isPolar
                 * (1.0 - depth01 * 1.4)
                 * uIcebergDensity;
  bergZone = clamp(bergZone, 0.0, 1.0);
  if(bergZone < 0.005) return;

  // Slow equatorward drift — icebergs calve and float toward equator
  float bergDrift = uTime * 0.003;
  float driftSign = sign(pos.y);
  vec3 bpos   = pos * 20.0 + vec3(0.0, -driftSign * bergDrift, 0.0);
  vec3 bCell  = floor(bpos);
  vec3 bFract = fract(bpos);

  // Nearest Worley cell center (3×3×3 search)
  float bDist    = 99.0;
  vec3  bNearest = bCell;
  for(int bx = -1; bx <= 1; bx++)
  for(int by = -1; by <= 1; by++)
  for(int bz = -1; bz <= 1; bz++) {
    vec3 bg   = vec3(float(bx), float(by), float(bz));
    vec3 bOff = fract(sin(vec3(
      dot(bCell+bg, vec3(127.1, 311.7,  74.7)),
      dot(bCell+bg, vec3(269.5, 183.3, 246.1)),
      dot(bCell+bg, vec3(113.5, 271.9, 124.6))
    )) * 43758.5453) * 0.5 + 0.25;
    float bd = length(bg + bOff - bFract);
    if(bd < bDist) { bDist = bd; bNearest = bCell + bg; }
  }

  // Per-cell deterministic hashes
  float bH1 = fract(sin(dot(bNearest, vec3(127.1, 311.7,  74.7))) * 43758.5453);
  float bH2 = fract(sin(dot(bNearest, vec3(269.5, 183.3, 246.1))) * 43758.5453);
  float bH3 = fract(sin(dot(bNearest, vec3(113.5, 271.9, 124.6))) * 43758.5453);

  // Sparse activation gate: * 0.55 so density=0.40 activates ~22% of cells
  if(step(1.0 - uIcebergDensity * 0.55, bH1) < 0.5) return;

  float bSize = bH2 * 0.28 + 0.10;  // cell-space radius: 0.10–0.38

  // Jagged outline via noise warp on bDist
  bDist += (noise3D(bpos * 5.0 + uSeed + bNearest * 0.3) * 2.0 - 1.0) * 0.055;
  float bergShape = smoothstep(bSize, bSize * 0.45, bDist);
  if(bergShape < 0.005) return;

  // Above/below waterline: random draft per berg (25–60% submerged)
  float waterline = bH3 * 0.35 + 0.25;
  float aboveW    = smoothstep(waterline - 0.06, waterline + 0.04, bFract.y);

  // Above-water face: bright glacial white, sun-shaded, specular glint
  vec3 bergTop = mix(vec3(0.82, 0.90, 0.96), vec3(0.95, 0.98, 1.00), NdotL);
  bergTop += vec3(1.0, 0.98, 0.95) * pow(max(dot(bumpN, H), 0.0), 55.0) * 0.35;
  bergTop  = mix(bergTop * 0.62 + vec3(0.02, 0.06, 0.18), bergTop,
                 smoothstep(-0.1, 0.3, dot(N, L)));

  // Underwater face: translucent turquoise (compressed ice with internal scatter)
  vec3 bergUW  = vec3(0.08, 0.46, 0.72) * mix(0.30, 0.65, depth01 * 1.8);
  bergUW      += vec3(0.02, 0.14, 0.38) * max(dot(N, L), 0.0) * 0.28;

  vec3 bergCol = mix(bergUW, bergTop, aboveW);

  // Melt slush ring: pale disturbed water surrounding each berg
  float slush = smoothstep(bSize * 1.7, bSize * 1.0, bDist)
              * (1.0 - smoothstep(bSize * 0.85, bSize * 1.0, bDist));
  color = mix(color, color * 0.88 + vec3(0.06, 0.14, 0.22), slush * bergZone * 0.32);

  // Composite berg over ocean surface
  color = mix(color, bergCol, bergShape * bergZone * 0.92);
}
`;
