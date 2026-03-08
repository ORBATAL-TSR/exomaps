/**
 * PBR Surface Shader — Cook-Torrance BRDF dfor planet surface rendering.
 *
 * Uses procedurally generated texture maps per planet type:
 *   - Albedo, heightmap, normal, PBR (roughness/metalness/AO/emissive)
 *
 * Since the web client doesn't have a Rust terrain generator, this module
 * includes a fully procedural fallback that generates all visual detail
 * on-GPU from planet parameters (type, temperature, seed, HZ status).
 */

// ─── Procedural PBR Vertex Shader ─────────────────────
export const proceduralPbrVertexShader = /* glsl */ `
precision highp float;

varying vec3 vNormal;
varying vec3 vPosition;
varying vec2 vUv;
varying vec3 vViewDir;
varying vec3 vWorldNormal;

void main() {
  vNormal = normalize(normalMatrix * normal);
  vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vPosition = worldPos.xyz;
  vUv = uv;

  vec3 cameraPos = (inverse(viewMatrix) * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vViewDir = normalize(cameraPos - worldPos.xyz);

  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

// ─── Procedural PBR Fragment Shader ───────────────────
export const proceduralPbrFragmentShader = /* glsl */ `
precision highp float;

varying vec3 vNormal;
varying vec3 vPosition;
varying vec2 vUv;
varying vec3 vViewDir;
varying vec3 vWorldNormal;

uniform float uPlanetType;   // 0-5
uniform float uTemperature;  // Kelvin
uniform float uSeed;
uniform float uInHZ;
uniform float uTime;
uniform float uMass;          // earth masses
uniform float uRadius;        // earth radii
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uAtmosphereColor;
uniform float uAtmosphereThickness;

const float PI = 3.14159265359;
const float EPSILON = 0.001;
const vec3 DIELECTRIC_F0 = vec3(0.04);

// ── Noise functions ──
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float hash3(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  f = f*f*(3.0-2.0*f);
  float a = hash(i); float b = hash(i+vec2(1,0));
  float c = hash(i+vec2(0,1)); float d = hash(i+vec2(1,1));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
float noise3(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p);
  f = f*f*(3.0-2.0*f);
  float n = dot(i, vec3(1.0, 57.0, 113.0));
  float a = hash3(i); float b = hash3(i+vec3(1,0,0));
  float c = hash3(i+vec3(0,1,0)); float d = hash3(i+vec3(1,1,0));
  float e = hash3(i+vec3(0,0,1)); float f1 = hash3(i+vec3(1,0,1));
  float g = hash3(i+vec3(0,1,1)); float h = hash3(i+vec3(1,1,1));
  return mix(mix(mix(a,b,f.x),mix(c,d,f.x),f.y),
             mix(mix(e,f1,f.x),mix(g,h,f.x),f.y), f.z);
}
float fbm(vec3 p, int octaves) {
  float v = 0.0; float a = 0.5; float totalA = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    v += a * noise3(p);
    totalA += a;
    p *= 2.17;
    a *= 0.5;
  }
  return v / totalA;
}

// ── PBR BRDF ──
float distributionGGX(vec3 N, vec3 H, float roughness) {
  float a = roughness * roughness; float a2 = a*a;
  float NdotH = max(dot(N,H), 0.0);
  float denom = NdotH*NdotH*(a2-1.0)+1.0;
  return a2 / (PI*denom*denom+EPSILON);
}
float geometrySchlickGGX(float NdotV, float roughness) {
  float r = roughness+1.0; float k = r*r/8.0;
  return NdotV / (NdotV*(1.0-k)+k+EPSILON);
}
float geometrySmith(vec3 N, vec3 V, vec3 L, float roughness) {
  return geometrySchlickGGX(max(dot(N,V),0.0), roughness) *
         geometrySchlickGGX(max(dot(N,L),0.0), roughness);
}
vec3 fresnelSchlick(float cosTheta, vec3 F0) {
  return F0 + (1.0-F0) * pow(clamp(1.0-cosTheta, 0.0, 1.0), 5.0);
}

// ── Planet surface generation ──
struct SurfaceData {
  vec3 albedo;
  float roughness;
  float metalness;
  float emissive;
  float height;
};

SurfaceData subEarthSurface(vec3 p, float seed) {
  SurfaceData s;
  float n = fbm(p * 4.0 + seed * 100.0, 6);
  float craters = 1.0 - smoothstep(0.45, 0.5, noise3(p * 12.0 + seed * 50.0));
  s.albedo = mix(vec3(0.35, 0.33, 0.31), vec3(0.55, 0.53, 0.50), n) * (1.0 - craters * 0.3);
  s.roughness = 0.85 + n * 0.1;
  s.metalness = 0.0;
  s.emissive = 0.0;
  s.height = n;
  return s;
}

SurfaceData rockySurface(vec3 p, float seed, float temp) {
  SurfaceData s;
  float n = fbm(p * 5.0 + seed * 80.0, 6);
  float ridge = smoothstep(0.38, 0.62, noise3(p * 10.0 + seed * 30.0));
  float detail = fbm(p * 20.0 + seed * 15.0, 4);
  vec3 low = vec3(0.48, 0.36, 0.22);
  vec3 high = vec3(0.72, 0.58, 0.40);
  if (temp > 800.0) {
    low = vec3(0.25, 0.12, 0.08);
    high = vec3(0.55, 0.22, 0.10);
  }
  s.albedo = mix(low, high, n) * (1.0 - ridge * 0.2 + detail * 0.1);
  s.roughness = 0.7 + ridge * 0.15;
  s.metalness = detail * 0.05;
  s.emissive = temp > 1200.0 ? smoothstep(0.4, 0.6, n) * 0.3 : 0.0;
  s.height = n;
  return s;
}

SurfaceData superEarthSurface(vec3 p, float seed, float inHZ) {
  SurfaceData s;
  float continental = fbm(p * 3.0 + seed * 60.0, 6);
  float detail = fbm(p * 12.0 + seed * 25.0, 4);
  float clouds = fbm(p * 6.0 + seed * 90.0, 3);

  if (inHZ > 0.5) {
    float oceanMask = smoothstep(0.42, 0.48, continental);
    vec3 ocean = mix(vec3(0.01, 0.04, 0.18), vec3(0.04, 0.12, 0.35), detail);
    vec3 land = mix(vec3(0.12, 0.35, 0.08), vec3(0.55, 0.52, 0.28), detail);
    vec3 ice = vec3(0.85, 0.88, 0.92);
    float lat = abs(p.y / length(p));
    float iceMask = smoothstep(0.7, 0.85, lat);
    s.albedo = mix(ocean, land, oceanMask);
    s.albedo = mix(s.albedo, ice, iceMask);
    s.albedo = mix(s.albedo, vec3(0.9), clouds * 0.2);
    s.roughness = mix(0.08, 0.75, oceanMask);
    s.metalness = 0.0;
    s.emissive = 0.0;
  } else {
    vec3 base = mix(vec3(0.45, 0.38, 0.25), vec3(0.65, 0.58, 0.42), continental);
    s.albedo = base + detail * 0.08;
    s.roughness = 0.65;
    s.metalness = 0.0;
    s.emissive = 0.0;
  }
  s.height = continental;
  return s;
}

SurfaceData neptuneSurface(vec3 p, float seed) {
  SurfaceData s;
  float bands = sin(p.y * 15.0 + seed * 40.0 + fbm(p * 3.0, 3) * 2.0) * 0.5 + 0.5;
  float swirl = fbm(p * 8.0 + vec3(seed * 20.0), 5);
  vec3 deepBlue = vec3(0.08, 0.18, 0.55);
  vec3 lightBlue = vec3(0.35, 0.55, 0.85);
  vec3 white = vec3(0.75, 0.82, 0.92);
  s.albedo = mix(deepBlue, lightBlue, bands);
  s.albedo = mix(s.albedo, white, swirl * 0.3);
  s.roughness = 0.4;
  s.metalness = 0.0;
  s.emissive = 0.0;
  s.height = 0.5;
  return s;
}

SurfaceData gasGiantSurface(vec3 p, float seed) {
  SurfaceData s;
  float bands = sin(p.y * 12.0 + fbm(p * 2.5 + seed * 30.0, 3) * 3.0) * 0.5 + 0.5;
  float turbulence = fbm(p * 6.0 + vec3(seed * 50.0), 5);
  float storm = smoothstep(0.68, 0.72, noise3(p * 3.0 + seed * 15.0));
  vec3 amber = vec3(0.78, 0.55, 0.22);
  vec3 cream = vec3(0.92, 0.85, 0.68);
  vec3 brown = vec3(0.45, 0.28, 0.12);
  vec3 stormColor = vec3(0.85, 0.42, 0.15);
  s.albedo = mix(brown, cream, bands);
  s.albedo = mix(s.albedo, amber, turbulence * 0.5);
  s.albedo = mix(s.albedo, stormColor, storm);
  s.roughness = 0.35;
  s.metalness = 0.0;
  s.emissive = 0.0;
  s.height = 0.5;
  return s;
}

SurfaceData superJupiterSurface(vec3 p, float seed) {
  SurfaceData s;
  float bands = sin(p.y * 10.0 + fbm(p * 2.0 + seed * 25.0, 4) * 4.0) * 0.5 + 0.5;
  float turbulence = fbm(p * 5.0 + vec3(seed * 45.0), 6);
  float storm = smoothstep(0.62, 0.68, noise3(p * 2.5 + seed * 12.0));
  vec3 darkRed = vec3(0.35, 0.08, 0.05);
  vec3 rust = vec3(0.65, 0.28, 0.12);
  vec3 pale = vec3(0.82, 0.65, 0.48);
  s.albedo = mix(darkRed, rust, bands);
  s.albedo = mix(s.albedo, pale, turbulence * 0.3);
  s.albedo = mix(s.albedo, vec3(0.95, 0.35, 0.1), storm * 0.6);
  s.roughness = 0.3;
  s.metalness = 0.0;
  s.emissive = 0.0;
  s.height = 0.5;
  return s;
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(vViewDir);
  vec3 L = normalize(uSunDirection);
  vec3 H = normalize(V + L);

  // Get procedural surface data based on planet type
  vec3 spherePos = normalize(vWorldNormal);
  SurfaceData surf;
  int pType = int(uPlanetType);
  if (pType == 0) surf = subEarthSurface(spherePos, uSeed);
  else if (pType == 1) surf = rockySurface(spherePos, uSeed, uTemperature);
  else if (pType == 2) surf = superEarthSurface(spherePos, uSeed, uInHZ);
  else if (pType == 3) surf = neptuneSurface(spherePos, uSeed);
  else if (pType == 4) surf = gasGiantSurface(spherePos, uSeed);
  else surf = superJupiterSurface(spherePos, uSeed);

  vec3 albedo = surf.albedo;
  float roughness = surf.roughness;
  float metalness = surf.metalness;

  // ── Perturb normal with procedural bumps ──
  float bumpScale = 0.02;
  float dx = fbm(spherePos * 20.0 + vec3(0.1, 0.0, 0.0) + uSeed, 3) -
             fbm(spherePos * 20.0 - vec3(0.1, 0.0, 0.0) + uSeed, 3);
  float dy = fbm(spherePos * 20.0 + vec3(0.0, 0.1, 0.0) + uSeed, 3) -
             fbm(spherePos * 20.0 - vec3(0.0, 0.1, 0.0) + uSeed, 3);
  N = normalize(N + (vec3(dx, dy, 0.0)) * bumpScale * 8.0);

  // ── Cook-Torrance BRDF ──
  vec3 F0 = mix(DIELECTRIC_F0, albedo, metalness);
  float NdotL = max(dot(N, L), 0.0);
  float NdotV = max(dot(N, V), 0.0);
  float HdotV = max(dot(H, V), 0.0);

  float D = distributionGGX(N, H, roughness);
  float G = geometrySmith(N, V, L, roughness);
  vec3 F = fresnelSchlick(HdotV, F0);

  vec3 specular = (D * G * F) / (4.0 * NdotV * NdotL + EPSILON);
  vec3 kS = F;
  vec3 kD = (1.0 - kS) * (1.0 - metalness);

  vec3 directLight = (kD * albedo / PI + specular) * uSunColor * uSunIntensity * NdotL;

  // ── Ambient ──
  vec3 skyColor = mix(vec3(0.02, 0.02, 0.04), uAtmosphereColor * 0.25, uAtmosphereThickness);
  vec3 ambient = albedo * skyColor * 0.3;

  // ── Atmosphere rim glow ──
  float rim = 1.0 - NdotV;
  float atmosphereRim = pow(rim, 3.0) * uAtmosphereThickness;
  vec3 rimGlow = uAtmosphereColor * atmosphereRim * 0.5;

  // ── Terminator ──
  float terminator = smoothstep(-0.1, 0.15, NdotL);

  // ── Night emission ──
  vec3 nightEmission = vec3(0.0);
  if (surf.emissive > 0.0) {
    float nightFactor = 1.0 - terminator;
    nightEmission = vec3(1.0, 0.3, 0.05) * surf.emissive * nightFactor * 2.0;
  }

  // ── Compose ──
  vec3 color = directLight * terminator + ambient + rimGlow + nightEmission;

  // ── Atmospheric scatter ──
  float scatter = pow(rim, 2.0) * uAtmosphereThickness;
  color = mix(color, uAtmosphereColor * uSunIntensity * 0.3, scatter * 0.3);

  // Reinhard tone mapping + gamma
  color = color / (color + vec3(1.0));
  color = pow(color, vec3(1.0 / 2.2));

  gl_FragColor = vec4(color, 1.0);
}
`;

// ─── Atmosphere Shell Shaders ─────────────────────────

export const atmosphereShellVertexShader = /* glsl */ `
precision highp float;

varying vec3 vWorldNormal;
varying vec3 vViewDir;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldNormal = normalize(normalMatrix * normal);
  vec3 cameraPos = (inverse(viewMatrix) * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vViewDir = normalize(cameraPos - worldPos.xyz);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

export const atmosphereShellFragmentShader = /* glsl */ `
precision highp float;

uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uAtmosphereColor;
uniform float uAtmosphereThickness;
uniform float uAtmosphereFalloff;

varying vec3 vWorldNormal;
varying vec3 vViewDir;

const float PI = 3.14159265359;

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(vViewDir);
  vec3 L = normalize(uSunDirection);

  float NdotV = dot(N, V);
  float NdotL = max(dot(N, L), 0.0);

  float rim = 1.0 - max(NdotV, 0.0);
  float atmosphereOpacity = pow(rim, uAtmosphereFalloff) * uAtmosphereThickness;

  float cosTheta = dot(V, L);
  float rayleighPhase = (3.0 / (16.0 * PI)) * (1.0 + cosTheta * cosTheta);

  float g = 0.76;
  float miePhase = (1.0 - g*g) / (4.0 * PI * pow(1.0 + g*g - 2.0*g*cosTheta, 1.5));

  vec3 scattered = (uAtmosphereColor * rayleighPhase * 2.0 + vec3(1.0) * miePhase * 0.3) * uSunColor * uSunIntensity;

  float dayFactor = smoothstep(-0.2, 0.3, NdotL);
  scattered *= mix(0.05, 1.0, dayFactor);
  scattered += uAtmosphereColor * pow(rim, 1.5) * 0.5 * dayFactor;

  gl_FragColor = vec4(scattered, atmosphereOpacity);
}
`;

export const PLANET_TYPE_CODE: Record<string, number> = {
  'sub-earth': 0,
  'rocky': 1,
  'super-earth': 2,
  'neptune-like': 3,
  'gas-giant': 4,
  'super-jupiter': 5,
  'unknown': 1,
};
