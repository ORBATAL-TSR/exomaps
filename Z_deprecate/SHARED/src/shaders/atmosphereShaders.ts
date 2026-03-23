/**
 * Atmospheric scattering GLSL shaders — desktop-tier.
 *
 * Implements single-scattering Rayleigh + Mie approximation
 * for planet atmosphere rendering. Too expensive for mobile;
 * web uses a simplified rim-glow fallback.
 *
 * Reference: Nishita et al. 1993, Bruneton & Neyret 2008
 */

export const atmosphereVertexShader = /* glsl */ `
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
    vViewDir = normalize(cameraPosition - worldPos.xyz);

    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

export const atmosphereFragmentShader = /* glsl */ `
  precision highp float;

  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;

  uniform vec3  uSunDirection;       // normalized light direction
  uniform float uPlanetRadius;       // in scene units
  uniform float uAtmosphereRadius;   // outer shell radius
  uniform float uScaleHeight;        // Rayleigh scale height (fraction of radius)
  uniform vec3  uRayleighCoeff;      // scattering coefficients per channel
  uniform float uMieCoeff;           // Mie scattering coefficient
  uniform float uMieG;              // Mie scattering asymmetry (0.76)

  const int   NUM_SAMPLES = 16;
  const int   NUM_LIGHT_SAMPLES = 8;
  const float PI = 3.14159265359;

  // Rayleigh phase function
  float rayleighPhase(float cosTheta) {
    return 3.0 / (16.0 * PI) * (1.0 + cosTheta * cosTheta);
  }

  // Henyey-Greenstein Mie phase function
  float miePhase(float cosTheta, float g) {
    float g2 = g * g;
    return 3.0 / (8.0 * PI) * ((1.0 - g2) * (1.0 + cosTheta * cosTheta))
           / (pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5) * (2.0 + g2));
  }

  // Ray-sphere intersection (returns near, far distances)
  vec2 raySphere(vec3 origin, vec3 dir, float radius) {
    float b = dot(origin, dir);
    float c = dot(origin, origin) - radius * radius;
    float d = b * b - c;
    if (d < 0.0) return vec2(-1.0);
    float sqrtD = sqrt(d);
    return vec2(-b - sqrtD, -b + sqrtD);
  }

  void main() {
    vec3 rayDir = normalize(vWorldPosition - cameraPosition);
    vec3 rayOrigin = cameraPosition;

    // Intersect atmosphere shell
    vec2 atmoHit = raySphere(rayOrigin, rayDir, uAtmosphereRadius);
    if (atmoHit.x < 0.0 && atmoHit.y < 0.0) discard;

    float tStart = max(atmoHit.x, 0.0);
    float tEnd = atmoHit.y;

    // Check if ray hits planet (opaque core)
    vec2 planetHit = raySphere(rayOrigin, rayDir, uPlanetRadius);
    if (planetHit.x > 0.0) {
      tEnd = planetHit.x; // stop at planet surface
    }

    float stepSize = (tEnd - tStart) / float(NUM_SAMPLES);
    vec3 totalRayleigh = vec3(0.0);
    vec3 totalMie = vec3(0.0);
    float opticalDepthR = 0.0;
    float opticalDepthM = 0.0;

    float scaleHeightR = uScaleHeight * uPlanetRadius;
    float scaleHeightM = scaleHeightR * 0.25;

    for (int i = 0; i < NUM_SAMPLES; i++) {
      float t = tStart + (float(i) + 0.5) * stepSize;
      vec3 samplePos = rayOrigin + rayDir * t;
      float height = length(samplePos) - uPlanetRadius;

      float densityR = exp(-height / scaleHeightR);
      float densityM = exp(-height / scaleHeightM);

      opticalDepthR += densityR * stepSize;
      opticalDepthM += densityM * stepSize;

      // Light sampling toward sun
      vec2 lightHit = raySphere(samplePos, uSunDirection, uAtmosphereRadius);
      float lightStepSize = lightHit.y / float(NUM_LIGHT_SAMPLES);
      float lightOptR = 0.0;
      float lightOptM = 0.0;

      for (int j = 0; j < NUM_LIGHT_SAMPLES; j++) {
        float lt = (float(j) + 0.5) * lightStepSize;
        vec3 lightPos = samplePos + uSunDirection * lt;
        float lHeight = length(lightPos) - uPlanetRadius;
        lightOptR += exp(-lHeight / scaleHeightR) * lightStepSize;
        lightOptM += exp(-lHeight / scaleHeightM) * lightStepSize;
      }

      vec3 tau = uRayleighCoeff * (opticalDepthR + lightOptR) +
                 vec3(uMieCoeff) * 1.1 * (opticalDepthM + lightOptM);
      vec3 attenuation = exp(-tau);

      totalRayleigh += densityR * attenuation * stepSize;
      totalMie += densityM * attenuation * stepSize;
    }

    float cosTheta = dot(rayDir, uSunDirection);
    vec3 scatter = totalRayleigh * uRayleighCoeff * rayleighPhase(cosTheta)
                 + totalMie * vec3(uMieCoeff) * miePhase(cosTheta, uMieG);

    // Sun intensity (white, adjustable)
    vec3 sunColor = vec3(1.0, 0.98, 0.95) * 20.0;
    vec3 color = scatter * sunColor;

    // Tone mapping
    color = 1.0 - exp(-color);

    float alpha = length(scatter) * 10.0;
    alpha = clamp(alpha, 0.0, 0.85);

    gl_FragColor = vec4(color, alpha);
  }
`;
