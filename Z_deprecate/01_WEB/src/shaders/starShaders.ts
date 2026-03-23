/**
 * GLSL shaders for GPU-instanced star rendering.
 *
 * Each star is a billboard quad positioned at its XYZ (parsecs).
 * Vertex shader sizes the point by luminosity & distance.
 * Fragment shader creates a radial glow colored by effective temperature.
 *
 * P0 UPGRADE: Vivid spectral colors, stronger size exaggeration,
 * planet-host breathing pulse, enhanced corona.
 */

/* ── Vertex shader ─────────────────────────────────── */
export const starVertexShader = /* glsl */ `
  // Per-instance attributes
  attribute float aLuminosity;
  attribute float aTeff;
  attribute float aMultiplicity;
  attribute float aConfidence;
  attribute float aPlanetCount;
  attribute float aSelected;

  // Passed to fragment shader
  varying float vTeff;
  varying float vLuminosity;
  varying float vMultiplicity;
  varying float vConfidence;
  varying float vDistToCamera;
  varying float vPlanetCount;
  varying float vSelected;
  varying float vFocusFade;

  uniform float uTime;
  uniform float uBaseSize;
  uniform vec3 uFocusCenter;
  uniform float uFocusRadius;

  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vDistToCamera = -mvPosition.z;

    // Pass attrs to fragment
    vTeff = aTeff;
    vLuminosity = aLuminosity;
    vMultiplicity = aMultiplicity;
    vConfidence = aConfidence;
    vPlanetCount = aPlanetCount;
    vSelected = aSelected;

    // Distance from focus center (in world space) for neighborhood dimming
    float distFromFocus = length(position - uFocusCenter);
    float focusFade = 1.0 - smoothstep(uFocusRadius * 0.7, uFocusRadius * 2.5, distFromFocus);
    focusFade = max(focusFade, 0.25); // floor: distant stars still faintly visible

    // Point size: luminosity-driven with clamped floor so dim stars stay visible
    //   L^0.30 (slightly less exaggerated) + guaranteed minimum for faint M/L/T dwarfs
    float lumScale = 0.30 + 0.70 * pow(max(aLuminosity, 0.001), 0.30);
    lumScale = max(lumScale, 0.22);  // floor: even 0.0001 L☉ stars are visible

    float distScale = 280.0 / max(vDistToCamera, 1.0);

    // Twinkle: per-star scintillation (subtler)
    float twinkle = 1.0 + 0.07 * sin(uTime * 2.8 + position.x * 19.3)
                       * cos(uTime * 1.9 + position.z * 14.7);

    // Planet-host breathing pulse (slow, rhythmic)
    float breath = 1.0;
    if (aPlanetCount > 0.0) {
      breath = 1.0 + 0.07 * sin(uTime * 1.1 + position.y * 5.0);
    }

    // Confidence: inferred stars are smaller
    float confScale = mix(0.55, 1.0, aConfidence);

    // Selected star is slightly larger
    float selScale = aSelected > 0.5 ? 1.4 : 1.0;

    gl_PointSize = uBaseSize * lumScale * distScale * twinkle * confScale * breath * selScale * focusFade;
    gl_PointSize = clamp(gl_PointSize, 1.8, 55.0);  // lower max = less bloom on bright stars

    vFocusFade = focusFade;

    gl_Position = projectionMatrix * mvPosition;
  }
`;

/* ── Fragment shader ───────────────────────────────── */
export const starFragmentShader = /* glsl */ `
  varying float vTeff;
  varying float vLuminosity;
  varying float vMultiplicity;
  varying float vConfidence;
  varying float vDistToCamera;
  varying float vPlanetCount;
  varying float vSelected;
  varying float vFocusFade;

  uniform float uTime;

  // ── Vivid Blackbody Teff → saturated sRGB ──
  // Dramatically boosted compared to physical for visual impact.
  vec3 teffToColor(float teff) {
    float t = clamp((teff - 2000.0) / 38000.0, 0.0, 1.0);

    // Red: M-types glow deep amber-orange
    float r = mix(1.0, 0.55, smoothstep(0.0, 0.45, t));

    // Green: peaks around F/G, drops for hot & cool
    float g = mix(0.35, 0.95, smoothstep(0.0, 0.12, t))
            * mix(1.0, 0.65, smoothstep(0.3, 1.0, t));

    // Blue: O/B types are vivid electric blue
    float b = mix(0.08, 1.0, smoothstep(0.03, 0.35, t));

    vec3 c = vec3(r, g, b);

    // Saturation boost: push away from grey toward vivid
    float luma = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(vec3(luma), c, 1.5);  // 1.5x saturation

    return clamp(c, 0.0, 1.0);
  }

  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float dist = length(uv) * 2.0;

    if (dist > 1.0) discard;

    // ── Luminosity-aware radial profile ──
    //    Bright stars (L>1) get wider corona; dim stars are tight points.
    float lumNorm = clamp(log(max(vLuminosity, 0.001)) / 8.0 + 0.5, 0.0, 1.0);

    float core   = exp(-dist * dist * 12.0);  // tighter core
    // Corona width scales with luminosity: dim stars have almost no corona
    float coronaWidth = mix(6.0, 2.8, lumNorm);  // 6.0 = tight (dim), 2.8 = wide (bright)
    float coronaStrength = mix(0.12, 0.40, lumNorm);
    float corona = exp(-dist * coronaWidth) * coronaStrength;
    // Bloom: very subtle, only for luminous stars
    float bloom  = exp(-dist * dist * 2.5) * mix(0.02, 0.12, lumNorm);
    float intensity = core + corona + bloom;

    // ── Camera-distance brightness attenuation ──
    //    Stars far from camera dim in brightness, not just size.
    float distAtten = 1.0 / (1.0 + vDistToCamera * 0.012);
    intensity *= mix(distAtten, 1.0, 0.35);  // 35% floor so far stars don't vanish

    // ── Spectral color ──
    vec3 baseColor = teffToColor(vTeff);

    // Core burns white-hot (less aggressive white-out for dim stars)
    float coreWhite = mix(0.35, 0.65, lumNorm);
    vec3 coreColor = mix(baseColor, vec3(1.0), coreWhite);
    vec3 color = mix(baseColor, coreColor, core);

    // ── Multiplicity rings ──
    if (vMultiplicity >= 2.0) {
      float ring = smoothstep(0.33, 0.35, dist) * smoothstep(0.42, 0.39, dist);
      color += vec3(0.25, 0.55, 1.0) * ring * 0.8;
      if (vMultiplicity >= 3.0) {
        float ring2 = smoothstep(0.50, 0.52, dist) * smoothstep(0.59, 0.56, dist);
        color += vec3(0.15, 0.85, 0.55) * ring2 * 0.6;
      }
    }

    // ── Confidence shimmer for inferred stars ──
    if (vConfidence < 0.5) {
      float angle = atan(uv.y, uv.x);
      float dash = step(0.5, fract(angle * 3.0 / 3.14159));
      float halo = smoothstep(0.68, 0.71, dist) * smoothstep(0.78, 0.75, dist);
      color += vec3(0.4, 0.25, 0.08) * halo * dash * 0.3;
      float shimmer = 0.85 + 0.15 * sin(uTime * 1.5 + vTeff * 0.01);
      intensity *= shimmer * 0.72;
    }

    // ── Selected star: spectral-tinted selection aura ──
    if (vSelected > 0.5) {
      // Ring color = brighter version of the star's own spectral color
      vec3 selColor = mix(baseColor, vec3(1.0), 0.5);
      float selRing = smoothstep(0.52, 0.55, dist) * smoothstep(0.66, 0.62, dist);
      float spin = sin(uTime * 3.0 + atan(uv.y, uv.x) * 8.0) * 0.5 + 0.5;
      color += selColor * selRing * spin * 1.0;
      // Subtle glow boost
      intensity += 0.10 * exp(-dist * dist * 3.0);
    }

    // ── Distance fog (pushed out further) ──
    float fogFactor = smoothstep(70.0, 140.0, vDistToCamera);
    color = mix(color, vec3(0.06, 0.10, 0.22), fogFactor * 0.50);
    intensity *= mix(1.0, 0.35, fogFactor);

    float alpha = smoothstep(1.0, 0.35, dist) * intensity;
    alpha *= vFocusFade; // dim stars outside focus neighborhood
    alpha = clamp(alpha, 0.0, 1.0);

    gl_FragColor = vec4(color * intensity * vFocusFade, alpha);
  }
`;
