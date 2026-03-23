/**
 * Procedural planet GLSL shaders — shared source.
 *
 * 6 planet types × 2 tiers:
 *   - WEB/MOBILE: 2-octave fbm, simple lighting
 *   - DESKTOP: 4-octave fbm, atmosphere scattering, PBR (via preprocessor)
 *
 * Re-exported from the web client's original planetShaders.ts.
 */

export const planetVertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vPosition;
  varying vec2 vUv;

  void main() {
    vNormal = normalize(normalMatrix * normal);
    vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const planetFragmentShader = /* glsl */ `
  precision highp float;

  varying vec3 vNormal;
  varying vec3 vPosition;
  varying vec2 vUv;

  uniform float uPlanetType;   // 0-5
  uniform float uTemperature;  // Kelvin
  uniform float uAlbedo;       // 0-1
  uniform float uSeed;         // per-planet hash
  uniform float uInHZ;         // 1.0 if in habitable zone
  uniform float uConfidence;   // 1.0 = observed, 0.0 = inferred
  uniform float uTime;
  uniform float uHasRings;     // 1.0 for gas giants with rings

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
    #ifdef DESKTOP
    v += 0.125 * noise(p * 4.0 + 27.3);
    v += 0.0625 * noise(p * 8.0 + 41.9);
    return v / 0.9375;
    #else
    return v / 0.75;
    #endif
  }

  vec3 subEarthPalette(vec2 uv, float seed) {
    float n = fbm(uv * 6.0 + seed * 100.0);
    float crater = smoothstep(0.55, 0.5, noise(uv * 14.0 + seed * 50.0));
    vec3 base = mix(vec3(0.45, 0.43, 0.41), vec3(0.65, 0.63, 0.60), n);
    base *= 1.0 - crater * 0.25;
    return base;
  }

  vec3 rockyPalette(vec2 uv, float seed) {
    float n = fbm(uv * 5.0 + seed * 80.0);
    float ridge = smoothstep(0.4, 0.6, noise(uv * 10.0 + seed * 30.0));
    vec3 low = vec3(0.55, 0.42, 0.28);
    vec3 high = vec3(0.78, 0.65, 0.45);
    vec3 base = mix(low, high, n);
    base = mix(base, base * 0.8, ridge * 0.3);
    return base;
  }

  vec3 superEarthPalette(vec2 uv, float seed, float inHZ) {
    float n = fbm(uv * 4.0 + seed * 60.0);
    float detail = noise(uv * 12.0 + seed * 40.0);
    if (inHZ > 0.5) {
      vec3 ocean = vec3(0.15, 0.35, 0.65);
      vec3 land = vec3(0.28, 0.55, 0.22);
      vec3 ice = vec3(0.85, 0.90, 0.95);
      float landMask = smoothstep(0.42, 0.58, n);
      vec3 base = mix(ocean, land, landMask);
      float lat = abs(uv.y - 0.5) * 2.0;
      float poleCap = smoothstep(0.75, 0.95, lat + detail * 0.15);
      base = mix(base, ice, poleCap * 0.7);
      return base;
    } else {
      vec3 low = vec3(0.50, 0.48, 0.32);
      vec3 high = vec3(0.72, 0.62, 0.40);
      return mix(low, high, n);
    }
  }

  vec3 neptunePalette(vec2 uv, float seed) {
    float lat = uv.y;
    float band = sin(lat * 18.0 + seed * 5.0) * 0.5 + 0.5;
    float n = fbm(vec2(uv.x * 8.0, lat * 3.0) + seed * 40.0);
    vec3 dark = vec3(0.12, 0.28, 0.55);
    vec3 light = vec3(0.35, 0.60, 0.85);
    vec3 base = mix(dark, light, band * 0.6 + n * 0.4);
    float spot = 1.0 - smoothstep(0.0, 0.08, length(uv - vec2(0.3 + seed * 0.2, 0.45)));
    base = mix(base, vec3(0.7, 0.85, 1.0), spot * 0.5);
    return base;
  }

  vec3 gasGiantPalette(vec2 uv, float seed) {
    float lat = uv.y;
    float band = sin(lat * 22.0 + seed * 7.0) * 0.5 + 0.5;
    float n = fbm(vec2(uv.x * 10.0, lat * 2.0) + seed * 30.0);
    float swirl = noise(vec2(uv.x * 6.0 + n * 2.0, lat * 4.0) + seed * 20.0);
    vec3 dark = vec3(0.55, 0.30, 0.12);
    vec3 light = vec3(0.92, 0.72, 0.38);
    vec3 pale = vec3(0.95, 0.88, 0.72);
    vec3 base = mix(dark, light, band * 0.5 + swirl * 0.3);
    base = mix(base, pale, n * 0.25);
    float spot = 1.0 - smoothstep(0.0, 0.06, length(uv - vec2(0.6 + seed * 0.15, 0.42)));
    base = mix(base, vec3(0.85, 0.35, 0.15), spot * 0.7);
    return base;
  }

  vec3 superJupiterPalette(vec2 uv, float seed) {
    float lat = uv.y;
    float band = sin(lat * 16.0 + seed * 4.0) * 0.5 + 0.5;
    float n = fbm(vec2(uv.x * 8.0, lat * 2.5) + seed * 25.0);
    vec3 dark = vec3(0.40, 0.15, 0.10);
    vec3 mid = vec3(0.70, 0.30, 0.15);
    vec3 light = vec3(0.85, 0.50, 0.25);
    vec3 base = mix(dark, mid, band * 0.6);
    base = mix(base, light, n * 0.35);
    float storm = smoothstep(0.6, 0.65, noise(vec2(uv.x * 12.0, lat * 6.0) + seed * 15.0));
    base = mix(base, vec3(0.90, 0.45, 0.20), storm * 0.4);
    return base;
  }

  void main() {
    vec2 uv = vUv;
    uv.x = fract(uv.x + uTime * 0.02 + uSeed * 0.5);

    vec3 surfaceColor;
    int ptype = int(uPlanetType + 0.5);
    if (ptype == 0) {
      surfaceColor = subEarthPalette(uv, uSeed);
    } else if (ptype == 1) {
      surfaceColor = rockyPalette(uv, uSeed);
    } else if (ptype == 2) {
      surfaceColor = superEarthPalette(uv, uSeed, uInHZ);
    } else if (ptype == 3) {
      surfaceColor = neptunePalette(uv, uSeed);
    } else if (ptype == 4) {
      surfaceColor = gasGiantPalette(uv, uSeed);
    } else {
      surfaceColor = superJupiterPalette(uv, uSeed);
    }

    // Temperature tinting
    if (uTemperature > 0.0) {
      float hotFactor = smoothstep(600.0, 2000.0, uTemperature);
      surfaceColor = mix(surfaceColor, vec3(1.0, 0.4, 0.15), hotFactor * 0.35);
      float coldFactor = smoothstep(200.0, 50.0, uTemperature);
      surfaceColor = mix(surfaceColor, vec3(0.6, 0.7, 0.9), coldFactor * 0.2);
    }

    float albedoMix = uAlbedo > 0.0 ? uAlbedo : 0.3;
    surfaceColor *= 0.7 + albedoMix * 0.6;

    // Lighting
    vec3 lightDir = normalize(vec3(0.8, 0.5, 1.0));
    float NdotL = dot(vNormal, lightDir);
    float wrap = max(NdotL * 0.5 + 0.5, 0.0);

    vec3 lit = surfaceColor * (0.15 + wrap * 0.85);

    // Rim/atmosphere glow
    vec3 viewDir = normalize(-vPosition);
    float rim = 1.0 - max(dot(vNormal, viewDir), 0.0);
    rim = pow(rim, 2.5);

    vec3 rimColor;
    if (ptype <= 1) {
      rimColor = vec3(0.5, 0.5, 0.55);
    } else if (ptype == 2) {
      rimColor = uInHZ > 0.5 ? vec3(0.3, 0.6, 1.0) : vec3(0.6, 0.55, 0.4);
    } else if (ptype == 3) {
      rimColor = vec3(0.3, 0.55, 0.9);
    } else {
      rimColor = vec3(0.8, 0.5, 0.2);
    }
    float rimStrength = ptype >= 2 ? 0.5 : 0.18;
    lit += rimColor * rim * rimStrength;

    // Terminator
    float terminator = smoothstep(-0.1, 0.15, NdotL);
    lit *= 0.3 + 0.7 * terminator;

    // Night side glow for hot planets
    if (uTemperature > 800.0 && NdotL < 0.0) {
      float glow = smoothstep(-0.5, 0.0, NdotL);
      float hotGlow = smoothstep(800.0, 2500.0, uTemperature);
      float cracks = smoothstep(0.45, 0.55, noise(vUv * 20.0 + uSeed * 10.0));
      lit += vec3(1.0, 0.3, 0.05) * glow * hotGlow * cracks * 0.6;
    }

    // Confidence ghosting
    float alpha = 1.0;
    if (uConfidence < 0.5) {
      alpha = 0.72;
      float dither = hash(gl_FragCoord.xy * 0.5) * 0.15;
      alpha -= dither;
      float luma = dot(lit, vec3(0.299, 0.587, 0.114));
      lit = mix(lit, vec3(luma), 0.25);
    }

    gl_FragColor = vec4(lit, alpha);
  }
`;

/* ── Ring shader ───────────────────────────────────── */

export const ringVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const ringFragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uSeed;
  uniform float uPlanetType;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
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

  void main() {
    float r = length(vUv - 0.5) * 2.0;
    if (r < 0.35 || r > 0.95) discard;

    float band = noise(vec2(r * 30.0 + uSeed * 10.0, 0.0));
    float gap = smoothstep(0.48, 0.50, noise(vec2(r * 50.0, uSeed * 5.0)));

    vec3 color;
    if (uPlanetType > 3.5) {
      color = mix(vec3(0.7, 0.55, 0.35), vec3(0.85, 0.75, 0.55), band);
    } else {
      color = mix(vec3(0.5, 0.6, 0.75), vec3(0.75, 0.80, 0.90), band);
    }

    float alpha = (0.25 + band * 0.2) * (1.0 - gap * 0.6);
    alpha *= smoothstep(0.35, 0.45, r) * smoothstep(0.95, 0.85, r);

    gl_FragColor = vec4(color, alpha);
  }
`;

/* ── Planet type → numeric code mapping ────────────── */
export const PLANET_TYPE_CODE: Record<string, number> = {
  'sub-earth': 0,
  rocky: 1,
  'super-earth': 2,
  'neptune-like': 3,
  'gas-giant': 4,
  'super-jupiter': 5,
  unknown: 1,
};
