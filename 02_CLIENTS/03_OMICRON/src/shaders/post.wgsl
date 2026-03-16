// OMICRON Post-Processing Shader (WGSL)
// Bloom threshold → dual-pass Gaussian blur → composite + Reinhard HDR → gamma.
// Status: STUB

@group(0) @binding(0) var hdr_texture : texture_2d<f32>;
@group(0) @binding(1) var hdr_sampler : sampler;

struct VertexOut {
    @builtin(position) clip_pos : vec4<f32>,
    @location(0)       uv       : vec2<f32>,
}

// Fullscreen triangle — no vertex buffer needed
@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VertexOut {
    let uv = vec2(
        f32((vi << 1u) & 2u),
        f32(vi & 2u),
    );
    var out: VertexOut;
    out.clip_pos = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
    out.uv       = vec2(uv.x, 1.0 - uv.y);
    return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
    let hdr = textureSample(hdr_texture, hdr_sampler, in.uv).rgb;

    // TODO: bloom threshold + blur tap here

    // Reinhard HDR tone mapping
    let mapped = hdr / (hdr + vec3(1.0));

    // Gamma correction (sRGB)
    let gamma = pow(mapped, vec3(1.0 / 2.2));

    return vec4(gamma, 1.0);
}
