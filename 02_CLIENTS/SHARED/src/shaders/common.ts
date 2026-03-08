/**
 * Shared GLSL functions used across star and planet shaders.
 *
 * These are injected as a preamble by platform-specific shader loaders.
 * Written in GLSL 300 es compatible syntax.
 */

export const commonGLSL = /* glsl */ `
// ── Hash-based noise (no external dependencies) ────────

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float hash3(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  v += 0.5 * noise(p);
  v += 0.25 * noise(p * 2.0 + 13.7);
  return v / 0.75;
}

// ── Blackbody Teff → saturated sRGB ────────────────────
// Dramatically boosted compared to physical for visual impact.

vec3 teffToColor(float teff) {
  float t = clamp((teff - 2000.0) / 38000.0, 0.0, 1.0);

  float r = mix(1.0, 0.55, smoothstep(0.0, 0.45, t));
  float g = mix(0.35, 0.95, smoothstep(0.0, 0.12, t))
          * mix(1.0, 0.65, smoothstep(0.3, 1.0, t));
  float b = mix(0.08, 1.0, smoothstep(0.03, 0.35, t));

  vec3 c = vec3(r, g, b);

  // Saturation boost
  float luma = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(luma), c, 1.5);

  return clamp(c, 0.0, 1.0);
}
`;
