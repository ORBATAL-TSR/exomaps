/**
 * atm.ts — Atmosphere shell shaders (vert + frag).
 *
 * 8-sample view-ray march through atmosphere volume with analytical
 * sun optical depth. Produces correct limb brightening, sunset colours,
 * and visible halo.
 *
 * Extracted from planetShaders.ts ATM_VERT and ATM_FRAG.
 */

export const ATM_VERT = /* glsl */`
varying vec3 vWorldPos;
varying vec3 vPlanetCenter;
varying float vPlanetR;
varying float vAtmR;

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  // Planet center in world space (translation column of model matrix)
  vPlanetCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  // Planet surface radius in world units (= geometry scale factor × 1.0)
  vPlanetR = length((modelMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
  // Atmosphere radius (this sphere's geometry radius × scale)
  vAtmR = length(wp.xyz - vPlanetCenter);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const ATM_FRAG = /* glsl */`
precision highp float;
uniform vec3  uAtmColor;
uniform float uAtmThickness;
uniform vec3  uSunDir;
uniform vec3  uPlanetShineColor;

varying vec3 vWorldPos;
varying vec3 vPlanetCenter;
varying float vPlanetR;
varying float vAtmR;

// =============================================================
// Atmosphere v4 — 8-sample view-ray march through atmosphere
// volume with analytical sun optical depth.  Produces correct
// limb brightening, sunset colours, and visible halo.
// =============================================================

#define NUM_STEPS 8
#define PI 3.14159265

// Ray-sphere intersection → (tNear, tFar); both < 0 = miss
vec2 raySphere(vec3 ro, vec3 rd, vec3 c, float r) {
  vec3 oc = ro - c;
  float b = dot(oc, rd);
  float disc = b * b - (dot(oc, oc) - r * r);
  if (disc < 0.0) return vec2(-1.0);
  float s = sqrt(disc);
  return vec2(-b - s, -b + s);
}

void main() {
  vec3  center = vPlanetCenter;
  float rP = vPlanetR;                        // planet surface radius
  float rA = vAtmR;                           // atmosphere outer radius
  float H  = rA - rP;                         // atmosphere height
  if (H < 0.0001) discard;

  vec3 ro  = cameraPosition;
  vec3 rd  = normalize(vWorldPos - cameraPosition);
  vec3 sun = normalize(uSunDir);
  float mu = dot(rd, sun);                    // view-sun cosine

  // ── Intersect view ray with atmosphere and planet ──────────
  vec2 tAtm = raySphere(ro, rd, center, rA);
  vec2 tPln = raySphere(ro, rd, center, rP);

  float tNear = max(tAtm.x, 0.0);
  float tFar  = tAtm.y;
  if (tPln.x > 0.0) tFar = min(tFar, tPln.x); // stop at planet surface
  if (tFar <= tNear) discard;

  float ds = (tFar - tNear) / float(NUM_STEPS);

  // ── Scattering coefficients (tuned for geometry scale) ─────
  float invH = 1.0 / H;

  // Rayleigh: λ^-4 wavelength dependence. Mild tint by uAtmColor so
  // blue atmospheres stay strongly blue while exotic atm colours show.
  vec3  bR = vec3(0.06, 0.16, 0.40) * invH * uAtmThickness;
  bR *= (0.50 + 0.50 * uAtmColor);

  // Mie: wavelength-independent scatter, coloured by atmosphere haze
  vec3 bM = uAtmColor * 0.035 * invH * uAtmThickness;

  // Scale heights (fraction of atmosphere height)
  float hR = 0.35;    // Rayleigh
  float hM = 0.12;    // Mie (concentrated lower)

  // ── Phase functions ────────────────────────────────────────
  float phR = (3.0 / (16.0 * PI)) * (1.0 + mu * mu);

  // Cornette-Shanks Mie phase (g = 0.55 for gentle forward glow, no hot-spot)
  float g   = 0.55;
  float g2  = g * g;
  float phM = (3.0 / (8.0 * PI)) * ((1.0 - g2) * (1.0 + mu * mu))
            / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * mu, 1.5));

  // Back-scatter lobe (g = -0.25) for realistic back-lit haze
  float gB  = -0.25;
  float gB2 = gB * gB;
  float phMback = (3.0 / (8.0 * PI)) * ((1.0 - gB2) * (1.0 + mu * mu))
               / ((2.0 + gB2) * pow(1.0 + gB2 - 2.0 * gB * mu, 1.5));
  phM = phM * 0.90 + phMback * 0.10; // blend forward + backward lobes

  // ── Multi-scatter approximation ─────────────────────────────
  float ms = 0.25;

  // ── March along view ray ───────────────────────────────────
  vec3  scatter = vec3(0.0);
  float odR = 0.0, odM = 0.0;

  for (int i = 0; i < NUM_STEPS; i++) {
    float t  = tNear + (float(i) + 0.5) * ds;
    vec3  P  = ro + rd * t;
    float alt = (length(P - center) - rP) / H; // normalised altitude 0-1

    float dR = exp(-alt / hR) * ds;
    float dM = exp(-alt / hM) * ds;
    odR += dR;
    odM += dM;

    // ── Sun illumination reaching this sample ──────────────
    vec3 Pn     = normalize(P - center);
    float sunCos = dot(Pn, sun);

    if (sunCos > -0.08) {
      float sf = 1.0 / max(sunCos + 0.08, 0.012);
      sf = min(sf, 55.0);
      float sR = exp(-alt / hR) * H * hR * sf;
      float sM = exp(-alt / hM) * H * hM * sf;

      vec3 sunAttn = exp(-(bR * sR + bM * sM));
      vec3 viewAttn = exp(-(bR * odR + bM * odM) * ms);

      // Sunset color injection near terminator
      float sunsetFactor = exp(-sunCos * sunCos / 0.025) * step(-0.08, sunCos);
      vec3 sunsetTint = mix(vec3(1.0), vec3(1.0, 0.55, 0.22), sunsetFactor * 0.25);

      scatter += (dR * bR * phR + dM * bM * phM) * sunAttn * viewAttn * sunsetTint;
    }
  }

  // ── Alpha from total view optical depth (dampened) ─────────
  float od = dot(bR * odR + bM * odM, vec3(0.33)) * ms;
  float alpha = 1.0 - exp(-od * 2.5);
  alpha = max(alpha, length(scatter) * 0.45);
  float maxA = 0.35 + uAtmThickness * 0.55;

  gl_FragColor = vec4(scatter, clamp(alpha, 0.0, maxA));
}
`;
