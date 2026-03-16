// OMICRON Planet Shader (WGSL)
// Cook-Torrance BRDF + procedural surface (noise → tectonics → biomes)
// Status: STUB — PBR implementation follows StarPass completion.

struct CameraUniform {
    view_proj : mat4x4<f32>,
    eye       : vec3<f32>,
    _pad      : f32,
}

struct PlanetUniform {
    model       : mat4x4<f32>,
    planet_type : f32,   // 0-5
    temperature : f32,   // Kelvin
    seed        : f32,
    in_hz       : f32,
    time        : f32,
    _pad        : vec3<f32>,
}

@group(0) @binding(0) var<uniform> camera  : CameraUniform;
@group(1) @binding(0) var<uniform> planet  : PlanetUniform;

struct VertexOut {
    @builtin(position) clip_pos    : vec4<f32>,
    @location(0)       world_pos   : vec3<f32>,
    @location(1)       world_normal: vec3<f32>,
    @location(2)       uv          : vec2<f32>,
}

@vertex
fn vs_main(
    @location(0) position : vec3<f32>,
    @location(1) normal   : vec3<f32>,
    @location(2) uv       : vec2<f32>,
) -> VertexOut {
    var out: VertexOut;
    let world_pos = (planet.model * vec4(position, 1.0)).xyz;
    out.clip_pos     = camera.view_proj * vec4(world_pos, 1.0);
    out.world_pos    = world_pos;
    out.world_normal = normalize((planet.model * vec4(normal, 0.0)).xyz);
    out.uv           = uv;
    return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
    // TODO: Cook-Torrance BRDF, procedural albedo from planet_type + seed, atmosphere rim
    return vec4(0.2, 0.3, 0.5, 1.0);
}
