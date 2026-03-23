// ═══════════════════════════════════════════════════════════════════════════
// OMICRON — Vignette Pass  (#25)
// Full-screen alpha-blend quad darkening screen corners for cinematic depth.
// Outputs (0,0,0, alpha) — blended over the scene, dims edges naturally.
// ═══════════════════════════════════════════════════════════════════════════

struct VertOut {
    @builtin(position) clip : vec4<f32>,
    @location(0)       uv  : vec2<f32>,  // [-1, 1]
}

fn quad_corner(vid: u32) -> vec2<f32> {
    let x = select(-1.0, 1.0, vid == 1u || vid == 4u || vid == 5u);
    let y = select(-1.0, 1.0, vid == 2u || vid == 3u || vid == 5u);
    return vec2<f32>(x, y);
}

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VertOut {
    let uv = quad_corner(vid);
    var out: VertOut;
    out.clip = vec4<f32>(uv, 0.0, 1.0);
    out.uv   = uv;
    return out;
}

@fragment
fn fs_main(in: VertOut) -> @location(0) vec4<f32> {
    let r    = length(in.uv);
    // Smooth onset at ~55% radius, full darkness at corners (~142%)
    let vig  = smoothstep(0.55, 1.42, r);
    let vig2 = vig * vig * 0.72;   // squared for natural-looking falloff
    if vig2 < 0.004 { discard; }
    return vec4<f32>(0.0, 0.0, 0.0, vig2);
}
