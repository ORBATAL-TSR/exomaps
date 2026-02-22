/**
 * GLSL shaders for GPU-instanced star rendering.
 *
 * Each star is a billboard quad positioned at its XYZ (parsecs).
 * Vertex shader sizes the point by luminosity & distance.
 * Fragment shader creates a radial glow colored by effective temperature.
 */

/* ── Vertex shader ─────────────────────────────────── */
export const starVertexShader = /* glsl */ `
  // Per-instance attributes
  attribute float aLuminosity;
  attribute float aTeff;
  attribute float aMultiplicity;
  attribute float aConfidence;

  // Passed to fragment shader
  varying float vTeff;
  varying float vLuminosity;
  varying float vMultiplicity;
  varying float vConfidence;
  varying float vDistToCamera;

  uniform float uTime;
  uniform float uBaseSize;

  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vDistToCamera = -mvPosition.z;

    // Pass attrs to fragment
    vTeff = aTeff;
    vLuminosity = aLuminosity;
    vMultiplicity = aMultiplicity;
    vConfidence = aConfidence;

    // Point size: brighter stars are larger, distant stars shrink
    float lumScale = 0.4 + 0.6 * pow(aLuminosity, 0.25);   // L^0.25 ≈ radius
    float distScale = 300.0 / max(vDistToCamera, 1.0);      // perspective shrink

    // Twinkle: per-star noise based on position + time
    float twinkle = 1.0 + 0.12 * sin(uTime * 2.3 + position.x * 17.7)
                       * cos(uTime * 1.7 + position.z * 13.3);

    // Confidence: inferred stars are smaller
    float confScale = mix(0.55, 1.0, aConfidence);

    gl_PointSize = uBaseSize * lumScale * distScale * twinkle * confScale;
    gl_PointSize = clamp(gl_PointSize, 1.5, 64.0);

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

  uniform float uTime;

  // ── Blackbody Teff → approximate sRGB ──
  // Based on Charity's color table for stellar photometry.
  vec3 teffToColor(float teff) {
    // Normalize to 0..1 range over 2000K..40000K
    float t = clamp((teff - 2000.0) / 38000.0, 0.0, 1.0);

    // Red channel: warm stars are reddish
    float r = mix(1.0, 0.6, smoothstep(0.0, 0.5, t));

    // Green channel: peaks around G/F type
    float g = mix(0.5, 1.0, smoothstep(0.0, 0.15, t))
            * mix(1.0, 0.75, smoothstep(0.3, 1.0, t));

    // Blue channel: hot stars are blue
    float b = mix(0.2, 1.0, smoothstep(0.05, 0.4, t));

    return vec3(r, g, b);
  }

  void main() {
    // Distance from center of the point sprite (0..1)
    vec2 uv = gl_PointCoord - vec2(0.5);
    float dist = length(uv) * 2.0;  // 0 at center, 1 at edge

    // Discard outside circle
    if (dist > 1.0) discard;

    // ── Core + corona radial profile ──
    // Bright Gaussian core + soft exponential halo
    float core = exp(-dist * dist * 8.0);          // tight bright center
    float corona = exp(-dist * 2.5) * 0.4;         // soft glow
    float bloom = exp(-dist * dist * 1.2) * 0.15;  // wide bloom halo

    float intensity = core + corona + bloom;

    // ── Spectral color from temperature ──
    vec3 baseColor = teffToColor(vTeff);

    // Core is whiter (hotter)
    vec3 coreColor = mix(baseColor, vec3(1.0), 0.6);
    vec3 color = mix(baseColor, coreColor, core);

    // ── Multiplicity indicator: subtle ring for binaries ──
    if (vMultiplicity >= 2.0) {
      float ring = smoothstep(0.35, 0.37, dist) * smoothstep(0.42, 0.40, dist);
      color += vec3(0.3, 0.6, 1.0) * ring * 0.8;
      // Second smaller ring for trinary
      if (vMultiplicity >= 3.0) {
        float ring2 = smoothstep(0.52, 0.54, dist) * smoothstep(0.59, 0.57, dist);
        color += vec3(0.2, 0.8, 0.6) * ring2 * 0.6;
      }
    }

    // ── Confidence: inferred stars have dashed halo ──
    if (vConfidence < 0.5) {
      // Create a dashed ring at the edge
      float angle = atan(uv.y, uv.x);
      float dash = step(0.5, fract(angle * 3.0 / 3.14159));
      float halo = smoothstep(0.7, 0.72, dist) * smoothstep(0.78, 0.76, dist);
      color += vec3(0.5, 0.3, 0.1) * halo * dash * 0.4;
      intensity *= 0.75;  // dimmer overall
    }

    // ── Distance fog: far stars fade toward deep blue ──
    float fogFactor = smoothstep(60.0, 120.0, vDistToCamera);
    color = mix(color, vec3(0.08, 0.12, 0.25), fogFactor * 0.5);
    intensity *= mix(1.0, 0.5, fogFactor);

    // Alpha: smooth falloff at edge
    float alpha = smoothstep(1.0, 0.4, dist) * intensity;
    alpha = clamp(alpha, 0.0, 1.0);

    gl_FragColor = vec4(color * intensity, alpha);
  }
`;
