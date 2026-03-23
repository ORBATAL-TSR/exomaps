// ═══════════════════════════════════════════════════════════════════
// ExoMaps — Native PBR Planet Renderer (WGSL)
//
// Cook-Torrance BRDF with:
//   - GGX normal distribution
//   - Schlick-Beckmann geometry
//   - Fresnel-Schlick approximation
//   - Atmosphere rim glow + Rayleigh scattering
//   - Ocean specular glint
//   - Night-side lava/city emission
//   - Displacement mapped heightfield
//   - Tone mapping (Reinhard) + gamma correction
// ═══════════════════════════════════════════════════════════════════

// ── Uniforms ──

struct Camera {
    view:       mat4x4<f32>,
    projection: mat4x4<f32>,
    model:      mat4x4<f32>,
    camera_pos: vec3<f32>,
    _pad0:      f32,
}

struct PlanetParams {
    sun_direction:        vec3<f32>,
    sun_intensity:        f32,
    sun_color:            vec3<f32>,
    ocean_level:          f32,
    atmosphere_color:     vec3<f32>,
    atmosphere_thickness: f32,
    planet_radius:        f32,
    displacement_scale:   f32,
    time_of_day:          f32,
    _pad1:                f32,
}

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<uniform> params: PlanetParams;

@group(1) @binding(0) var t_albedo:    texture_2d<f32>;
@group(1) @binding(1) var t_heightmap: texture_2d<f32>;
@group(1) @binding(2) var t_normal:    texture_2d<f32>;
@group(1) @binding(3) var t_pbr:       texture_2d<f32>;
@group(1) @binding(4) var samp:        sampler;

// ── Vertex I/O ──

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) normal:   vec3<f32>,
    @location(2) uv:       vec2<f32>,
    @location(3) tangent:  vec4<f32>,
}

struct VertexOutput {
    @builtin(position) clip_pos:     vec4<f32>,
    @location(0)       world_pos:    vec3<f32>,
    @location(1)       world_normal: vec3<f32>,
    @location(2)       uv:          vec2<f32>,
    @location(3)       view_dir:    vec3<f32>,
    @location(4)       tbn_col0:    vec3<f32>, // TBN matrix columns
    @location(5)       tbn_col1:    vec3<f32>,
    @location(6)       tbn_col2:    vec3<f32>,
    @location(7)       height:      f32,
    @location(8)       local_normal: vec3<f32>,
}

// ── Constants ──

const PI: f32 = 3.14159265359;
const EPSILON: f32 = 0.001;
const DIELECTRIC_F0: vec3<f32> = vec3<f32>(0.04, 0.04, 0.04);

// ── Equirectangular UV from unit-sphere direction ──

fn equirect_uv(dir: vec3<f32>) -> vec2<f32> {
    let lon = atan2(dir.z, dir.x);             // -π … π
    let lat = asin(clamp(dir.y, -1.0, 1.0));   // -π/2 … π/2
    return vec2<f32>(lon / (2.0 * PI) + 0.5, lat / PI + 0.5);
}

// ── Vertex Shader ──

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
    var out: VertexOutput;

    // Unit-sphere normal from the original vertex position
    let sphere_normal = normalize(in.position);
    out.local_normal = sphere_normal;

    // Use the mesh's built-in UV coordinates (handles seams + poles correctly).
    // The UV sphere generates u=theta/(2π), v=phi/π — directly matching the
    // equirectangular texture layout from the generation pipeline.
    // Duplicate vertices at the seam (u=0 and u=1) ensure artifact-free interpolation.
    out.uv = in.uv;

    // Sample heightmap for displacement (vertex texture fetch)
    let tex_size = vec2<f32>(textureDimensions(t_heightmap, 0));
    let tex_coord = vec2<i32>(out.uv * tex_size);
    let height = textureLoad(t_heightmap, tex_coord, 0).r;
    out.height = height;

    // Displace along the normal (above ocean level only)
    let displacement = max(height - params.ocean_level, 0.0) * params.displacement_scale;
    let displaced = in.position + in.normal * displacement;

    // World-space transforms
    let model = camera.model;
    let world_pos = model * vec4<f32>(displaced, 1.0);
    out.world_pos = world_pos.xyz;

    // Normal matrix (upper-left 3x3 of model — assumes uniform scale)
    let normal_mat = mat3x3<f32>(
        model[0].xyz,
        model[1].xyz,
        model[2].xyz,
    );
    let N = normalize(normal_mat * in.normal);

    // Build TBN (tangent-bitangent-normal) matrix for normal mapping
    var T: vec3<f32>;
    if length(in.tangent.xyz) > 0.001 {
        T = normalize(normal_mat * in.tangent.xyz);
        T = normalize(T - dot(T, N) * N); // Gram-Schmidt
    } else {
        // Fallback tangent
        let up = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), abs(N.y) > 0.999);
        T = normalize(cross(up, N));
    }
    let B = cross(N, T) * in.tangent.w;

    out.tbn_col0 = T;
    out.tbn_col1 = B;
    out.tbn_col2 = N;
    out.world_normal = N;

    // View direction
    out.view_dir = normalize(camera.camera_pos - world_pos.xyz);

    out.clip_pos = camera.projection * camera.view * world_pos;

    return out;
}

// ── PBR Functions ──

// GGX Normal Distribution
fn distribution_ggx(N: vec3<f32>, H: vec3<f32>, roughness: f32) -> f32 {
    let a = roughness * roughness;
    let a2 = a * a;
    let NdotH = max(dot(N, H), 0.0);
    let NdotH2 = NdotH * NdotH;
    let denom = NdotH2 * (a2 - 1.0) + 1.0;
    return a2 / (PI * denom * denom + EPSILON);
}

// Schlick-Beckmann Geometry
fn geometry_schlick_ggx(NdotV: f32, roughness: f32) -> f32 {
    let r = roughness + 1.0;
    let k = (r * r) / 8.0;
    return NdotV / (NdotV * (1.0 - k) + k + EPSILON);
}

// Smith's Geometry
fn geometry_smith(N: vec3<f32>, V: vec3<f32>, L: vec3<f32>, roughness: f32) -> f32 {
    let NdotV = max(dot(N, V), 0.0);
    let NdotL = max(dot(N, L), 0.0);
    return geometry_schlick_ggx(NdotV, roughness) * geometry_schlick_ggx(NdotL, roughness);
}

// Fresnel-Schlick
fn fresnel_schlick(cos_theta: f32, F0: vec3<f32>) -> vec3<f32> {
    return F0 + (1.0 - F0) * pow(clamp(1.0 - cos_theta, 0.0, 1.0), 5.0);
}

// Fresnel-Schlick with roughness (for ambient)
fn fresnel_schlick_roughness(cos_theta: f32, F0: vec3<f32>, roughness: f32) -> vec3<f32> {
    return F0 + (max(vec3<f32>(1.0 - roughness), F0) - F0) * pow(clamp(1.0 - cos_theta, 0.0, 1.0), 5.0);
}

// ── Fragment Shader ──

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    // ── Use interpolated mesh UVs (seam-safe, no atan2 wrapping artifacts) ──
    let uv = in.uv;

    // ── Sample texture maps ──
    let albedo = textureSample(t_albedo, samp, uv).rgb;
    let normal_sample = textureSample(t_normal, samp, uv).rgb * 2.0 - 1.0;
    let pbr_sample = textureSample(t_pbr, samp, uv);
    let height = textureSample(t_heightmap, samp, uv).r;

    var roughness = clamp(pbr_sample.r, 0.05, 1.0);
    var metalness = pbr_sample.g;
    let ao = pbr_sample.b;
    let emissive = pbr_sample.a;

    // ── Normal mapping via TBN matrix ──
    let tbn = mat3x3<f32>(in.tbn_col0, in.tbn_col1, in.tbn_col2);
    var N = normalize(tbn * normal_sample);
    let V = normalize(in.view_dir);
    let L = normalize(params.sun_direction);
    let H = normalize(V + L);

    // ── Ocean override ──
    var surface_albedo = albedo;
    let is_ocean = height < params.ocean_level;
    if is_ocean {
        surface_albedo = vec3<f32>(0.02, 0.06, 0.18);
        roughness = 0.06;
        metalness = 0.0;
        N = normalize(in.world_normal); // flat ocean surface
    }

    // ── Cook-Torrance BRDF ──
    let F0 = mix(DIELECTRIC_F0, surface_albedo, metalness);

    let NdotL = max(dot(N, L), 0.0);
    let NdotV = max(dot(N, V), 0.0);
    let HdotV = max(dot(H, V), 0.0);

    // Specular
    let D = distribution_ggx(N, H, roughness);
    let G = geometry_smith(N, V, L, roughness);
    let F = fresnel_schlick(HdotV, F0);

    let numerator = D * G * F;
    let denominator = 4.0 * NdotV * NdotL + EPSILON;
    let specular = numerator / denominator;

    // Energy conservation
    let kS = F;
    let kD = (1.0 - kS) * (1.0 - metalness);

    // Direct lighting
    let direct_light = (kD * surface_albedo / PI + specular) * params.sun_color * params.sun_intensity * NdotL;

    // ── Ambient lighting (hemisphere approximation) ──
    let sky_color = mix(vec3<f32>(0.03, 0.03, 0.06), params.atmosphere_color * 0.3, params.atmosphere_thickness);
    let ground_color = surface_albedo * 0.02;
    let hemi_blend = dot(N, vec3<f32>(0.0, 1.0, 0.0)) * 0.5 + 0.5;
    var ambient = mix(ground_color, sky_color, hemi_blend) * ao;

    let F_ambient = fresnel_schlick_roughness(NdotV, F0, roughness);
    let kD_ambient = (1.0 - F_ambient) * (1.0 - metalness);
    ambient = kD_ambient * ambient;

    // ── Ocean specular glint ──
    var ocean_glint = vec3<f32>(0.0);
    if is_ocean {
        let glint = pow(max(dot(reflect(-L, N), V), 0.0), 256.0);
        ocean_glint = params.sun_color * glint * 2.0;
    }

    // ── Atmosphere rim glow ──
    let rim_factor = 1.0 - NdotV;
    let atmosphere_rim = pow(rim_factor, 3.0) * params.atmosphere_thickness;
    let rim_glow = params.atmosphere_color * atmosphere_rim * 0.5;

    // ── Terminator softening ──
    let terminator = smoothstep(-0.1, 0.15, NdotL);

    // ── Night-side emission (lava glow) ──
    var night_emission = vec3<f32>(0.0);
    if emissive > 0.0 {
        let night_factor = 1.0 - terminator;
        let lava_color = vec3<f32>(1.0, 0.3, 0.05) * emissive;
        night_emission = lava_color * night_factor * 2.0;
    }

    // ── Compose ──
    var color = vec3<f32>(0.0);
    color += direct_light * terminator;
    color += ambient;
    color += ocean_glint * terminator;
    color += rim_glow;
    color += night_emission;

    // ── Atmospheric in-scatter ──
    let scatter = pow(rim_factor, 2.0) * params.atmosphere_thickness;
    color = mix(color, params.atmosphere_color * params.sun_intensity * 0.3, scatter * 0.3);

    // ── Tone mapping (Reinhard) ──
    color = color / (color + vec3<f32>(1.0));

    // NOTE: No manual gamma — the render target is Rgba8UnormSrgb,
    // which applies sRGB gamma encoding automatically in hardware.

    return vec4<f32>(color, 1.0);
}

// ═══════════════════════════════════════════════════════════════════
// Atmosphere Shell Pass (rendered as a slightly-larger back-face sphere)
// ═══════════════════════════════════════════════════════════════════

struct AtmosVertexOutput {
    @builtin(position) clip_pos:     vec4<f32>,
    @location(0)       world_pos:    vec3<f32>,
    @location(1)       world_normal: vec3<f32>,
    @location(2)       view_dir:     vec3<f32>,
}

@vertex
fn vs_atmosphere(in: VertexInput) -> AtmosVertexOutput {
    var out: AtmosVertexOutput;

    let world_pos = camera.model * vec4<f32>(in.position, 1.0);
    out.world_pos = world_pos.xyz;

    let normal_mat = mat3x3<f32>(
        camera.model[0].xyz,
        camera.model[1].xyz,
        camera.model[2].xyz,
    );
    out.world_normal = normalize(normal_mat * in.normal);
    out.view_dir = normalize(camera.camera_pos - world_pos.xyz);
    out.clip_pos = camera.projection * camera.view * world_pos;

    return out;
}

@fragment
fn fs_atmosphere(in: AtmosVertexOutput) -> @location(0) vec4<f32> {
    let N = normalize(in.world_normal);
    let V = normalize(in.view_dir);
    let L = normalize(params.sun_direction);

    let NdotV = dot(N, V);
    let NdotL = max(dot(N, L), 0.0);

    // Rim-based opacity
    let rim = 1.0 - max(NdotV, 0.0);
    let atmos_opacity = pow(rim, 3.0) * params.atmosphere_thickness;

    // Rayleigh phase: (3/16π)(1 + cos²θ)
    let cos_theta = dot(V, L);
    let rayleigh_phase = (3.0 / (16.0 * PI)) * (1.0 + cos_theta * cos_theta);

    // Mie phase (forward scatter)
    let g = 0.76;
    let mie_phase = (1.0 - g * g) / (4.0 * PI * pow(1.0 + g * g - 2.0 * g * cos_theta, 1.5));

    let rayleigh = params.atmosphere_color * rayleigh_phase * 2.0;
    let mie = vec3<f32>(1.0) * mie_phase * 0.3;
    var scattered = (rayleigh + mie) * params.sun_color * params.sun_intensity;

    // Day/night modulation
    let day_factor = smoothstep(-0.2, 0.3, NdotL);
    scattered *= mix(0.05, 1.0, day_factor);

    // Horizon brightening
    let horizon_boost = pow(rim, 1.5) * 0.5;
    scattered += params.atmosphere_color * horizon_boost * day_factor;

    return vec4<f32>(scattered, atmos_opacity);
}
