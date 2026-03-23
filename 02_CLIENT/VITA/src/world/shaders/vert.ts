/**
 * vert.ts — World vertex shader.
 *
 * Handles terrain displacement for solid worlds.
 * Extracted from planetShaders.ts VERT.
 */

export const VERT = /* glsl */`
uniform float uDisplacement;
uniform float uSeedV;
uniform float uNoiseScaleV;
uniform float uIsGasV;
uniform float uOceanLevelV;
uniform float uCraterDensityV;
uniform float uMountainHeightV;
uniform float uValleyDepthV;
uniform float uVolcanismV;
uniform float uTerrainAgeV;
uniform float uTectonicsV;
uniform float uIceCapsV;      // ice cap extent 0-1 (for glacier displacement)
uniform float uIsIceWorldV;   // 1.0 = ice-dominated world (full-globe glacier)

varying vec3 vObjPos;
varying vec3 vNormal;
varying vec3 vViewDir;
varying float vFresnel;

/* -- Inline noise for vertex displacement -- */
float vHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x);
  f = f*f*f*(f*(f*6.0-15.0)+10.0); // quintic — matches FRAG for consistent terrain
  return mix(
    mix(mix(vHash(i), vHash(i+vec3(1,0,0)), f.x),
        mix(vHash(i+vec3(0,1,0)), vHash(i+vec3(1,1,0)), f.x), f.y),
    mix(mix(vHash(i+vec3(0,0,1)), vHash(i+vec3(1,0,1)), f.x),
        mix(vHash(i+vec3(0,1,1)), vHash(i+vec3(1,1,1)), f.x), f.y), f.z);
}
float vFbm(vec3 p) {
  float f = 0.0, amp = 0.5;
  for (int i = 0; i < 5; i++) { f += amp * vNoise(p); p *= 2.03; amp *= 0.48; }
  return f;
}
float vWarpedFbm(vec3 p) {
  vec3 q = vec3(vFbm(p), vFbm(p + vec3(5.2,1.3,2.8)), vFbm(p + vec3(1.7,9.2,3.4)));
  return vFbm(p + q * 1.5);
}
/* Ridged noise for mountains */
float vRidged(vec3 p) {
  float f = 0.0, amp = 0.5;
  for (int i = 0; i < 4; i++) {
    float n = 1.0 - abs(vNoise(p) * 2.0 - 1.0);
    f += n * n * amp; p *= 2.1; amp *= 0.45;
  }
  return f;
}

float vertexHeight(vec3 pos) {
  float h = vWarpedFbm(pos * uNoiseScaleV + uSeedV);
  // Mountains
  if (uMountainHeightV > 0.01) {
    h += vRidged(pos * 3.5 + uSeedV * 0.7) * uMountainHeightV * 0.35;
  }
  // Valleys (carve)
  if (uValleyDepthV > 0.01) {
    float v = abs(vNoise(pos * 4.0 + uSeedV * 1.3) * 2.0 - 1.0);
    v = pow(v, 0.3);
    h -= (1.0 - v) * uValleyDepthV * 0.20;
  }
  // Volcanism (peaks)
  if (uVolcanismV > 0.01) {
    float vp = 1.0 - smoothstep(0.0, 0.25, length(fract(pos * 2.5 + uSeedV) - 0.5));
    h += vp * uVolcanismV * 0.18;
  }

  // ── CRATER DISPLACEMENT — same Voronoi field as fragment shader ───────
  // Uses identical scale/seed offsets so vertex bowls line up with the
  // fragment shader's shading, normals, and color treatment.
  if (uCraterDensityV > 0.01) {
    vec3 vcp = pos * uNoiseScaleV * 2.5 + uSeedV + 333.0;
    vec3 vci = floor(vcp);
    vec3 vcf = fract(vcp);
    float vF1 = 99.0;
    // 3×3×3 neighbor search — matches frag shader exactly
    for (int cx = -1; cx <= 1; cx++)
    for (int cy = -1; cy <= 1; cy++)
    for (int cz = -1; cz <= 1; cz++) {
      vec3 g = vec3(float(cx), float(cy), float(cz));
      vec3 o = fract(sin(vec3(
        dot(vci+g, vec3(127.1, 311.7,  74.7)),
        dot(vci+g, vec3(269.5, 183.3, 246.1)),
        dot(vci+g, vec3(113.5, 271.9, 124.6))
      )) * 43758.5453) * 0.5 + 0.25;
      float d = length(g + o - vcf);
      if (d < vF1) vF1 = d;
    }
    // Per-cell size hash — same formula as fragment (eci = vci here)
    float vCszH = fract(sin(dot(vci, vec3(71.3, 23.9, 157.7))) * 43758.5);
    float vCsz  = mix(0.14, 0.28, vCszH);

    // Bowl: smooth depression, deepest at cell center
    h -= (1.0 - smoothstep(0.0, vCsz, vF1)) * uCraterDensityV * 0.44;
    // Raised rim ring: sharp ejecta berm just outside crater edge
    float vRim = smoothstep(vCsz * 0.85, vCsz, vF1)
               * (1.0 - smoothstep(vCsz, vCsz * 1.20, vF1));
    h += vRim * uCraterDensityV * 0.18;
    // Central peak: rebound uplift in larger craters (cszH > 0.55)
    h += (1.0 - smoothstep(0.0, vCsz * 0.16, vF1))
       * step(0.55, vCszH) * uCraterDensityV * 0.13;
  }

  return h;
}

void main() {
  vObjPos = position;
  vec3 displaced = position;
  if (uIsGasV < 0.5 && uDisplacement > 0.001) {
    vec3 dir = normalize(position);
    float h = vertexHeight(dir);
    // Clamp to ocean floor (no displacement below ocean level)
    float terrain = max(h, uOceanLevelV);
    float disp = (terrain - 0.5) * uDisplacement;

    // Items 20-22: latitude-based glacier vertex displacement REMOVED.
    // Was creating a hard geometric flat-top ring on every cold world.
    // Ice zone height is now handled entirely in terrainHeight() via _gIsPolar.

    displaced = position + dir * disp;
  }
  // World-space normal so lighting matches world-space uSunDir & vViewDir
  vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
  vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
  vViewDir = normalize(cameraPosition - worldPos.xyz);
  vFresnel = 1.0 - max(dot(vNormal, vViewDir), 0.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`;
