/**
 * atm.ts — Fresnel atmosphere shell shaders.
 *
 * Based on the Fresnel rim-glow technique (ref: bobbyroe/threejs-earth).
 * A slightly oversized sphere using AdditiveBlending produces the iconic
 * blue atmospheric rim visible from space.
 *
 * Enhancements over the bare Fresnel:
 *   - NdotL sun-facing modulation: bright on day side, faint on night side
 *   - Terminator sunset: warm orange injection at the day/night boundary
 *   - Profile-driven atmColor so each world type has its own sky tint
 *   - Planet-shine pass for moon scenarios (reflected parent light)
 */

export const ATM_VERT = /* glsl */`
uniform vec3 uSunDir;

varying float vFresnel;
varying float vNdotL;
varying float vForwardScatter;

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  // World-space normal (no need for normalMatrix — uniform scale only)
  vec3 wN = normalize(mat3(
    modelMatrix[0].xyz, modelMatrix[1].xyz, modelMatrix[2].xyz
  ) * normal);
  // View direction from camera to this vertex
  vec3 I = normalize(wp.xyz - cameraPosition);

  // Fresnel factor: 0 when camera-facing, approaches 1 at the rim edge.
  // dot(I, wN) = -1 at front face, 0 at rim, +1 at back.
  // f = 1 + dot(I,N) gives 0 at rim and 2 at the back (back-face culled by Three.js).
  float f  = clamp(1.0 + dot(I, wN), 0.0, 1.0);
  // Power 4.5 tightens the glow to the rim edge; bias 0.06 prevents total black.
  vFresnel = clamp(0.06 + 0.94 * pow(f, 4.5), 0.0, 1.0);

  vNdotL = dot(wN, normalize(uSunDir));

  // Forward scatter: are we looking toward the star through this limb segment?
  // High when view ray and sun direction are roughly aligned (backlit halo).
  vForwardScatter = clamp(dot(-I, normalize(uSunDir)), 0.0, 1.0);

  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const ATM_FRAG = /* glsl */`
precision highp float;

uniform vec3  uAtmColor;
uniform float uAtmThickness;
uniform vec3  uSunDir;
uniform vec3  uPlanetShineColor;

varying float vFresnel;
varying float vNdotL;
varying float vForwardScatter;

void main() {
  // Day/night: atmosphere is brightest on the lit side.
  // Night side retains a faint glow (aurora-like backscatter, not total black).
  float dayGlow   = smoothstep(-0.18, 0.65, vNdotL);
  float atmGlow   = max(0.08, dayGlow);

  // Terminator: inject warm sunset orange/red at the day-night boundary.
  // exp(-x²) peaks at vNdotL=0 (the terminator ring) and falls off both ways.
  float termFactor = exp(-pow(vNdotL * 3.2, 2.0));
  // Sunset color shifts from deep orange on the dark side to warm amber on lit side
  vec3 sunsetCol = mix(
    vec3(1.0, 0.40, 0.12),   // deep terminator: burnt orange
    vec3(1.0, 0.72, 0.28),   // lit side edge: warm amber
    clamp(vNdotL * 2.0 + 0.5, 0.0, 1.0)
  );
  vec3 atmCol = mix(uAtmColor, sunsetCol, termFactor * 0.58);

  // ── RAYLEIGH SUN-ANGLE SCATTERING ────────────────────────────────────────
  // When we're looking through the limb toward the star (high vForwardScatter),
  // Rayleigh scattering shifts the outer rim toward blue-white (shorter λ wins).
  // Near the terminator or night side the forward scatter is low and has no effect.
  float rayleighStr = vForwardScatter * vForwardScatter * dayGlow;
  // Rayleigh blue: desaturate atmColor slightly and push toward blue-white
  vec3 rayleighBlue = mix(uAtmColor, vec3(0.55, 0.70, 1.00), 0.60);
  atmCol = mix(atmCol, rayleighBlue, rayleighStr * 0.38);

  // Optional planet-shine tint (reflected light from parent body)
  float pshine = dot(uPlanetShineColor, vec3(0.33));
  if(pshine > 0.01) {
    atmCol = mix(atmCol, uPlanetShineColor * 1.5 + atmCol * 0.5, pshine * 0.35);
  }

  // ── ALTITUDE STRATIFICATION ───────────────────────────────────────────────
  // vFresnel near 1.0 = upper atmosphere (thin, outer limb).
  // vFresnel in mid range = lower atmosphere (denser, more colored).
  // Upper atmosphere glows cleaner/bluer; lower retains the full profile tint.
  float upperAtm  = smoothstep(0.72, 0.95, vFresnel);  // thin outer shell fraction
  float lowerAtm  = 1.0 - upperAtm;
  // Upper layer: shift toward a slightly higher-altitude (cooler, bluer) tint
  vec3 upperCol = mix(atmCol, rayleighBlue, 0.28 * dayGlow);
  vec3 layeredCol = mix(atmCol, upperCol, upperAtm);

  // Final rim alpha: squared fresnel keeps glow tight to the limb.
  // Upper atmosphere gets a tighter falloff; lower atmosphere a slightly broader base.
  float rimLower  = vFresnel * vFresnel;
  float rimUpper  = vFresnel * vFresnel * vFresnel;  // tighter outer shell
  float rim = mix(rimLower, rimUpper, upperAtm);
  float alpha = rim * atmGlow * (0.5 + uAtmThickness * 1.4);

  gl_FragColor = vec4(layeredCol, clamp(alpha, 0.0, 0.90));
}
`;
