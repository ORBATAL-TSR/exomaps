// OMICRON Atmosphere Shader (WGSL)
// Rayleigh + Mie scattering shell rendered as additive transparent sphere.
// Status: STUB

struct CameraUniform {
    view_proj : mat4x4<f32>,
    eye       : vec3<f32>,
    _pad      : f32,
}

struct AtmosphereUniform {
    model          : mat4x4<f32>,
    sun_direction  : vec3<f32>,
    _pad0          : f32,
    rayleigh_color : vec3<f32>,
    thickness      : f32,
    mie_g          : f32,        // Mie asymmetry factor
    _pad1          : vec3<f32>,
}

@group(0) @binding(0) var<uniform> camera : CameraUniform;
@group(1) @binding(0) var<uniform> atmo   : AtmosphereUniform;

struct VertexOut {
    @builtin(position) clip_pos    : vec4<f32>,
    @location(0)       world_normal: vec3<f32>,
    @location(1)       view_dir    : vec3<f32>,
}

@vertex
fn vs_main(
    @location(0) position : vec3<f32>,
    @location(1) normal   : vec3<f32>,
    @location(2) uv       : vec2<f32>,
) -> VertexOut {
    var out: VertexOut;
    let world_pos = (atmo.model * vec4(position, 1.0)).xyz;
    out.clip_pos     = camera.view_proj * vec4(world_pos, 1.0);
    out.world_normal = normalize((atmo.model * vec4(normal, 0.0)).xyz);
    out.view_dir     = normalize(camera.eye - world_pos);
    return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
    let N = normalize(in.world_normal);
    let V = normalize(in.view_dir);
    let L = normalize(atmo.sun_direction);

    let rim = 1.0 - max(dot(N, V), 0.0);
    let opacity = pow(rim, atmo.thickness);

    // TODO: full Rayleigh phase + Mie phase integration
    let day = max(dot(N, L), 0.0);
    let color = atmo.rayleigh_color * day * 0.8 + atmo.rayleigh_color * 0.05;
    return vec4(color, opacity * 0.6);
}
