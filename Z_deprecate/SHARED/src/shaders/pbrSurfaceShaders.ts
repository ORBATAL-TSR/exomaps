/**
 * PBR Surface Shader for V2 Terrain Pipeline
 *
 * Uses 4 texture maps from the Rust terrain generator:
 *   1. Albedo map — biome-driven base color
 *   2. Heightmap — displacement + parallax
 *   3. Normal map — Sobel-derived tangent-space normals
 *   4. PBR map — R: roughness, G: metalness, B: AO, A: emissive
 *
 * Lighting model: Cook-Torrance BRDF with:
 *   - GGX normal distribution
 *   - Schlick-Beckmann geometry
 *   - Fresnel-Schlick approximation
 *   - Image-based ambient (simple hemisphere)
 *
 * Additional features:
 *   - Atmosphere rim glow (Rayleigh approximation)
 *   - Ocean specular glint
 *   - Terminator softening
 *   - Night-side emissive (lava, city lights)
 *   - Displacement mapping in vertex shader
 */

// ─── Vertex Shader ─────────────────────────────────

export const pbrVertexShader = /* glsl */ `
precision highp float;

// Attributes (from QuadSphere geometry)
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
attribute vec4 tangent;

// Uniforms
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;

uniform sampler2D uHeightmap;
uniform float uDisplacementScale;  // planet radius fraction for terrain height
uniform float uOceanLevel;         // height threshold for ocean

// Varyings
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying vec3 vLocalNormal;     // sphere-surface normal for equirectangular UV
varying vec2 vUv;
varying vec3 vViewDir;
varying mat3 vTBN;
varying float vHeight;

const float PI = 3.14159265359;

// Compute equirectangular UV from a unit-sphere normal direction
vec2 equirectUV(vec3 dir) {
    float lon = atan(dir.z, dir.x);             // -π … π
    float lat = asin(clamp(dir.y, -1.0, 1.0));  // -π/2 … π/2
    return vec2(lon / (2.0 * PI) + 0.5, lat / PI + 0.5);
}

void main() {
    // Store the unit-sphere normal BEFORE any model transform
    vec3 sphereNormal = normalize(position);  // QuadSphere vertices are already on the sphere
    vLocalNormal = sphereNormal;

    // Compute equirectangular UVs from sphere position
    vUv = equirectUV(sphereNormal);

    // Sample heightmap for displacement
    float height = texture2D(uHeightmap, vUv).r;
    vHeight = height;

    // Displacement along normal (only above ocean level)
    float displacement = max(height - uOceanLevel, 0.0) * uDisplacementScale;
    vec3 displaced = position + normal * displacement;

    // World-space transforms
    vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
    vWorldPosition = worldPos.xyz;

    // TBN matrix for normal mapping
    vec3 N = normalize(normalMatrix * normal);
    vec3 T;
    if (tangent.x != 0.0 || tangent.y != 0.0 || tangent.z != 0.0) {
        T = normalize(normalMatrix * tangent.xyz);
        // Re-orthogonalize T with respect to N (Gram-Schmidt)
        T = normalize(T - dot(T, N) * N);
    } else {
        // Fallback tangent from sphere geometry
        vec3 up = abs(N.y) < 0.999 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
        T = normalize(cross(up, N));
    }
    vec3 B = cross(N, T) * tangent.w;
    vTBN = mat3(T, B, N);

    vWorldNormal = N;

    // View direction (camera to fragment)
    vec3 cameraPos = (inverse(viewMatrix) * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vViewDir = normalize(cameraPos - worldPos.xyz);

    gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

// ─── Fragment Shader ───────────────────────────────

export const pbrFragmentShader = /* glsl */ `
precision highp float;

// Texture maps from V2 terrain pipeline
uniform sampler2D uAlbedo;
uniform sampler2D uHeightmap;
uniform sampler2D uNormalMap;
uniform sampler2D uPbrMap;      // R=roughness, G=metalness, B=AO, A=emissive

// Lighting
uniform vec3 uSunDirection;     // normalized direction TO the sun
uniform vec3 uSunColor;         // star color (from Teff)
uniform float uSunIntensity;    // luminosity factor

// Planet properties
uniform float uOceanLevel;
uniform vec3 uAtmosphereColor;  // Rayleigh scattering color
uniform float uAtmosphereThickness; // optical depth proxy (0-1)
uniform float uPlanetRadius;    // for atmosphere calculations

// Phase (for night/day)
uniform float uTimeOfDay;       // 0-1, rotation phase (for animated rendering)

// Varyings
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying vec3 vLocalNormal;     // unit-sphere normal for equirectangular UV
varying vec2 vUv;
varying vec3 vViewDir;
varying mat3 vTBN;
varying float vHeight;

// ── Constants ──
const float PI = 3.14159265359;
const float EPSILON = 0.001;
const vec3 DIELECTRIC_F0 = vec3(0.04); // default reflectance at normal incidence

// Compute equirectangular UV from a unit-sphere normal direction
vec2 equirectUV(vec3 dir) {
    float lon = atan(dir.z, dir.x);             // -π … π
    float lat = asin(clamp(dir.y, -1.0, 1.0));  // -π/2 … π/2
    return vec2(lon / (2.0 * PI) + 0.5, lat / PI + 0.5);
}

// ── PBR Functions ──

// GGX/Trowbridge-Reitz Normal Distribution Function
float distributionGGX(vec3 N, vec3 H, float roughness) {
    float a = roughness * roughness;
    float a2 = a * a;
    float NdotH = max(dot(N, H), 0.0);
    float NdotH2 = NdotH * NdotH;

    float denom = NdotH2 * (a2 - 1.0) + 1.0;
    return a2 / (PI * denom * denom + EPSILON);
}

// Schlick-Beckmann Geometry Function
float geometrySchlickGGX(float NdotV, float roughness) {
    float r = roughness + 1.0;
    float k = (r * r) / 8.0;
    return NdotV / (NdotV * (1.0 - k) + k + EPSILON);
}

// Smith's method for geometry obstruction
float geometrySmith(vec3 N, vec3 V, vec3 L, float roughness) {
    float NdotV = max(dot(N, V), 0.0);
    float NdotL = max(dot(N, L), 0.0);
    return geometrySchlickGGX(NdotV, roughness) * geometrySchlickGGX(NdotL, roughness);
}

// Fresnel-Schlick approximation
vec3 fresnelSchlick(float cosTheta, vec3 F0) {
    return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

// Fresnel-Schlick with roughness (for ambient)
vec3 fresnelSchlickRoughness(float cosTheta, vec3 F0, float roughness) {
    return F0 + (max(vec3(1.0 - roughness), F0) - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

void main() {
    // ── Compute equirectangular UVs from sphere normal ──
    vec3 sp = normalize(vLocalNormal);
    vec2 eqUV = equirectUV(sp);

    // ── Sample texture maps using equirectangular UVs ──
    vec3 albedo = texture2D(uAlbedo, eqUV).rgb;
    // Albedo loaded as LINEAR (not sRGB) — no manual gamma decode needed

    vec3 normalSample = texture2D(uNormalMap, eqUV).rgb * 2.0 - 1.0;
    vec4 pbrSample = texture2D(uPbrMap, eqUV);
    float height = texture2D(uHeightmap, eqUV).r;

    float roughness = clamp(pbrSample.r, 0.05, 1.0);
    float metalness = pbrSample.g;
    float ao = pbrSample.b;
    float emissive = pbrSample.a;

    // ── Normal mapping ──
    vec3 N = normalize(vTBN * normalSample);
    vec3 V = normalize(vViewDir);
    vec3 L = normalize(uSunDirection);
    vec3 H = normalize(V + L);

    // ── Ocean override ──
    bool isOcean = height < uOceanLevel;
    if (isOcean) {
        // Ocean: smooth, reflective water
        albedo = vec3(0.02, 0.06, 0.18); // deep ocean dark blue
        roughness = 0.06;
        metalness = 0.0;
        N = normalize(vWorldNormal); // flat ocean surface
    }

    // ── Cook-Torrance BRDF ──
    vec3 F0 = mix(DIELECTRIC_F0, albedo, metalness);

    float NdotL = max(dot(N, L), 0.0);
    float NdotV = max(dot(N, V), 0.0);
    float HdotV = max(dot(H, V), 0.0);

    // Specular
    float D = distributionGGX(N, H, roughness);
    float G = geometrySmith(N, V, L, roughness);
    vec3 F = fresnelSchlick(HdotV, F0);

    vec3 numerator = D * G * F;
    float denominator = 4.0 * NdotV * NdotL + EPSILON;
    vec3 specular = numerator / denominator;

    // Energy conservation
    vec3 kS = F;
    vec3 kD = (1.0 - kS) * (1.0 - metalness);

    // Direct lighting
    vec3 directLight = (kD * albedo / PI + specular) * uSunColor * uSunIntensity * NdotL;

    // ── Ambient lighting (hemisphere approximation) ──
    vec3 skyColor = mix(vec3(0.03, 0.03, 0.06), uAtmosphereColor * 0.3, uAtmosphereThickness);
    vec3 groundColor = albedo * 0.02;
    float hemisphereBlend = dot(N, vec3(0.0, 1.0, 0.0)) * 0.5 + 0.5;
    vec3 ambient = mix(groundColor, skyColor, hemisphereBlend) * ao;

    // Fresnel for ambient
    vec3 F_ambient = fresnelSchlickRoughness(NdotV, F0, roughness);
    vec3 kD_ambient = (1.0 - F_ambient) * (1.0 - metalness);
    ambient = kD_ambient * ambient;

    // ── Ocean specular glint ──
    vec3 oceanGlint = vec3(0.0);
    if (isOcean) {
        // Sun glitter on water
        float sunGlint = pow(max(dot(reflect(-L, N), V), 0.0), 256.0);
        oceanGlint = uSunColor * sunGlint * 2.0;
    }

    // ── Atmosphere rim glow ──
    float rimFactor = 1.0 - NdotV;
    float atmosphereRim = pow(rimFactor, 3.0) * uAtmosphereThickness;
    vec3 rimGlow = uAtmosphereColor * atmosphereRim * 0.5;

    // ── Terminator softening ──
    // Smooth transition from day to night at the terminator
    float terminator = smoothstep(-0.1, 0.15, NdotL);

    // ── Night-side emission ──
    vec3 nightEmission = vec3(0.0);
    if (emissive > 0.0) {
        // Lava glow on hot worlds
        float nightFactor = 1.0 - terminator;
        vec3 lavaColor = vec3(1.0, 0.3, 0.05) * emissive;
        nightEmission = lavaColor * nightFactor * 2.0;
    }

    // ── Compose final color ──
    vec3 color = vec3(0.0);
    color += directLight * terminator;
    color += ambient;
    color += oceanGlint * terminator;
    color += rimGlow;
    color += nightEmission;

    // ── Atmospheric scattering (simple in-scatter) ──
    float scatter = pow(rimFactor, 2.0) * uAtmosphereThickness;
    color = mix(color, uAtmosphereColor * uSunIntensity * 0.3, scatter * 0.3);

    // ── Tone mapping (ACES approximation) ──
    color = color / (color + vec3(1.0)); // Reinhard

    // ShaderMaterial bypasses Three.js color management — apply gamma manually
    color = pow(color, vec3(1.0 / 2.2));

    gl_FragColor = vec4(color, 1.0);
}
`;

// ─── Atmosphere Shell Shader ───────────────────────
// Rendered as a slightly-larger sphere around the planet

export const atmosphereShellVertexShader = /* glsl */ `
precision highp float;

attribute vec3 position;
attribute vec3 normal;

uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;

varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying vec3 vViewDir;

void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
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
uniform vec3 uAtmosphereColor;     // Rayleigh scattering tint
uniform float uAtmosphereThickness; // optical depth (0-1)
uniform float uAtmosphereFalloff;   // edge sharpness

varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying vec3 vViewDir;

const float PI = 3.14159265359;

void main() {
    vec3 N = normalize(vWorldNormal);
    vec3 V = normalize(vViewDir);
    vec3 L = normalize(uSunDirection);

    float NdotV = dot(N, V);
    float NdotL = max(dot(N, L), 0.0);

    // Rim-based opacity (thicker at edges, transparent at center)
    float rim = 1.0 - max(NdotV, 0.0);
    float atmosphereOpacity = pow(rim, uAtmosphereFalloff) * uAtmosphereThickness;

    // Rayleigh phase function: (3/16π)(1 + cos²θ)
    float cosTheta = dot(V, L);
    float rayleighPhase = (3.0 / (16.0 * PI)) * (1.0 + cosTheta * cosTheta);

    // Mie phase (forward scattering halo around sun)
    float g = 0.76; // asymmetry parameter
    float miePhase = (1.0 - g * g) / (4.0 * PI * pow(1.0 + g * g - 2.0 * g * cosTheta, 1.5));

    // Combine scattering
    vec3 rayleigh = uAtmosphereColor * rayleighPhase * 2.0;
    vec3 mie = vec3(1.0) * miePhase * 0.3;

    vec3 scatteredLight = (rayleigh + mie) * uSunColor * uSunIntensity;

    // Day/night modulation
    float dayFactor = smoothstep(-0.2, 0.3, NdotL);
    scatteredLight *= mix(0.05, 1.0, dayFactor);

    // Horizon brightening
    float horizonBoost = pow(rim, 1.5) * 0.5;
    scatteredLight += uAtmosphereColor * horizonBoost * dayFactor;

    gl_FragColor = vec4(scatteredLight, atmosphereOpacity);
}
`;
