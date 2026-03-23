/**
 * cloudVol.ts — Volumetric cloud sphere shader.
 *
 * Dedicated sphere mesh at r ≈ 1.03, rendered between the planet surface
 * and the atmosphere shell.
 *
 * Technique:
 *   - Latitude-based atmospheric circulation mask (ITCZ / subtropical dry /
 *     mid-latitude storm track / polar cap) drives WHERE clouds appear.
 *   - Differential wind rotation per latitude layer animates each altitude
 *     band at a unique speed, producing realistic wind shear.
 *   - Three-altitude FBM sampling (inner / mid / outer shell) creates genuine
 *     cloud depth at the limb — near-edge clouds look taller than centre-disc.
 *   - Self-shadowing: a sun-offset density sample darkens cloud bases.
 *
 * Uniforms:  uTime, uSeed, uSunDir, uCloudDensity, uAtmThickness
 */

export const CLOUD_VOL_VERT = /* glsl */`
varying vec3 vLocalPos;
void main() {
  vLocalPos = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const CLOUD_VOL_FRAG = /* glsl */`
precision highp float;
uniform float uTime;
uniform float uSeed;
uniform vec3  uSunDir;
uniform float uCloudDensity;
uniform float uAtmThickness;

varying vec3 vLocalPos;

// ── Minimal self-contained noise ──────────────────────────────────
vec3 _ch33(vec3 p) {
  p = vec3(dot(p,vec3(127.1,311.7,74.7)),
           dot(p,vec3(269.5,183.3,246.1)),
           dot(p,vec3(113.5,271.9,124.6)));
  return -1.0 + 2.0*fract(sin(p)*43758.5453);
}
float _cn(vec3 p) {
  vec3 i=floor(p), f=fract(p);
  vec3 u=f*f*f*(f*(f*6.0-15.0)+10.0);
  return mix(mix(mix(dot(_ch33(i),f),
    dot(_ch33(i+vec3(1,0,0)),f-vec3(1,0,0)),u.x),
    mix(dot(_ch33(i+vec3(0,1,0)),f-vec3(0,1,0)),
    dot(_ch33(i+vec3(1,1,0)),f-vec3(1,1,0)),u.x),u.y),
    mix(mix(dot(_ch33(i+vec3(0,0,1)),f-vec3(0,0,1)),
    dot(_ch33(i+vec3(1,0,1)),f-vec3(1,0,1)),u.x),
    mix(dot(_ch33(i+vec3(0,1,1)),f-vec3(0,1,1)),
    dot(_ch33(i+vec3(1,1,1)),f-vec3(1,1,1)),u.x),u.y),u.z)*0.5+0.5;
}
float _cfbm(vec3 p) {
  float v=0.0, a=0.5;
  for(int i=0;i<6;i++){v+=a*_cn(p);p=p*2.03+31.97;a*=0.48;}
  return v;
}

// ── Latitude-varying wind rotation (Y-axis) ──────────────────────
vec3 _cWind(vec3 p, float speed) {
  float lat   = asin(clamp(p.y, -1.0, 1.0));
  float angle = speed * cos(lat) * uTime;
  float c=cos(angle), s=sin(angle);
  return vec3(p.x*c - p.z*s, p.y, p.x*s + p.z*c);
}

// ── Atmospheric circulation mask ──────────────────────────────────
// Models Earth-like pressure cells:
//   ITCZ:         dense convection at equator (0-15°N/S)
//   Subtropical:  stable high pressure, dry, clear (25-35°N/S)
//   Mid-lat storm track: cyclone belt (45-65°N/S)
//   Polar cap:    sparse, low stratus (70-90°N/S)
float circMask(float lat) {
  // Gaussian peaks / troughs at each circulation band
  float itcz   = exp(-pow(lat / 0.16, 2.0));                            // eq. convection
  float subDry = 1.0 - exp(-pow((abs(lat) - 0.42) / 0.13, 2.0));       // subtropical dry
  float mid    = exp(-pow((abs(lat) - 0.62) / 0.16, 2.0)) * 0.65;      // storm track
  float polar  = exp(-pow((abs(lat) - 0.90) / 0.14, 2.0)) * 0.30;     // polar stratus
  return clamp((itcz * 0.80 + mid + polar + 0.12) * subDry, 0.0, 1.0);
}

// ── Cloud density at a sphere-surface position ────────────────────
float cloudDensity(vec3 p) {
  float lat  = p.y;
  float circ = circMask(lat);

  // Differential rotation: each circulation band has a different wind speed.
  // Trade winds (low lat) are faster than westerlies (mid) and polar easterlies.
  float windSpd1 = mix(0.038, 0.018, abs(lat));   // latitude-scaled cumulus wind
  float windSpd2 = mix(0.022, 0.010, abs(lat));   // cirrus wind (slower, higher)

  vec3 w1 = _cWind(p,        windSpd1) * 4.8;   // cumulus — smaller, more cells
  vec3 w2 = _cWind(p * 1.9,  windSpd2) * 9.2;   // cirrus  — fine wispy layer

  float cumulus = _cfbm(w1 + uSeed + vec3(0.0, uTime * 0.009, 0.0));
  float cirrus  = _cfbm(w2 + uSeed + 333.0 + vec3(uTime * 0.005, 0.0, 0.0));

  // Domain warp for extra organic shape (breaks straight-FBM oval look)
  vec3 warp = vec3(_cn(w1 + uSeed + 88.0), _cn(w1 + uSeed + 44.0), 0.0) * 0.40;
  float cumW = _cfbm(w1 + warp + uSeed + 7.0);
  cumulus = cumulus * 0.55 + cumW * 0.45;

  float cum = pow(smoothstep(0.46, 0.70, cumulus), 1.4);  // moderate threshold
  float cir = pow(smoothstep(0.60, 0.80, cirrus),  2.0) * 0.40;

  return clamp((cum + cir) * circ, 0.0, 1.0);
}

void main() {
  if(uCloudDensity < 0.02 || uAtmThickness < 0.05) discard;

  vec3 N   = vLocalPos;
  vec3 sun = normalize(uSunDir);

  // ── Three-altitude sampling: inner/mid/outer shells ───────────
  // Sampling at different radii creates genuine limb depth — clouds at the
  // sphere edge look tall because they span a visible altitude range.
  float d0 = cloudDensity(N);           // r=1.000 (inner)
  float d1 = cloudDensity(N * 1.014);   // r=1.014 (mid)
  float d2 = cloudDensity(N * 1.028);   // r=1.028 (outer)
  float density = d0 * 0.55 + d1 * 0.30 + d2 * 0.15;

  float alpha = density * uCloudDensity;
  if(alpha < 0.01) discard;

  // ── Self-shadow: sun-offset density darkens cloud bases ────────
  float shadowD    = cloudDensity(N + sun * 0.030);
  float selfShadow = clamp(shadowD * 0.90, 0.0, 0.68);

  // ── Illumination ──────────────────────────────────────────────
  float NdotL  = max(dot(N, sun), 0.0);
  float topBot = smoothstep(-0.10, 0.42, dot(N, sun));

  // Sun-facing tops: bright white.  Undersides: cold blue-grey.
  vec3 topCol = mix(vec3(0.80, 0.84, 0.92), vec3(0.97, 0.98, 1.00), NdotL);
  vec3 botCol = mix(vec3(0.20, 0.25, 0.38), vec3(0.44, 0.48, 0.60), NdotL * 0.5);
  vec3 cloudCol = mix(botCol, topCol, topBot);

  // Self-shadow: heavier on undersides, lighter on sunlit tops
  cloudCol *= 1.0 - selfShadow * mix(0.60, 0.15, topBot);

  // Night-side fade: alpha near the terminator and beyond dims smoothly
  float litFace = smoothstep(-0.22, 0.22, dot(N, sun));
  alpha *= 0.10 + 0.90 * litFace;

  gl_FragColor = vec4(cloudCol, clamp(alpha, 0.0, 0.94));
}
`;
