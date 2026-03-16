// ═══════════════════════════════════════════════════════════════════════════
// OMICRON — Focus Star Glow Billboard  (#17 +chromatic aberration #21
//                                       +diffraction spikes #24)
// ═══════════════════════════════════════════════════════════════════════════

struct Camera {
    view_proj : mat4x4<f32>,
    cam_pos   : vec3<f32>,
    _pad      : f32,
}

struct Star {
    color       : vec3<f32>,
    _pad        : f32,
    temperature : f32,
    radius      : f32,
    luminosity  : f32,
    time        : f32,
}

@group(0) @binding(0) var<uniform> cam  : Camera;
@group(0) @binding(1) var<uniform> star : Star;

struct VertOut {
    @builtin(position) clip_pos : vec4<f32>,
    @location(0)       uv       : vec2<f32>,   // [-1,1]
}

fn quad_corner(vid: u32) -> vec2<f32> {
    let x = select(-1.0, 1.0, vid == 1u || vid == 4u || vid == 5u);
    let y = select(-1.0, 1.0, vid == 2u || vid == 3u || vid == 5u);
    return vec2<f32>(x, y);
}

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VertOut {
    let corner = quad_corner(vid);

    // Project star centre (at world origin) to clip space
    let c = cam.view_proj * vec4<f32>(0.0, 0.0, 0.0, 1.0);

    // Compute NDC half-size: project a point offset by (star.radius * 4) in world X,
    // take the NDC distance — this correctly matches the star's 3D projected footprint.
    let ce = cam.view_proj * vec4<f32>(star.radius * 4.0, 0.0, 0.0, 1.0);
    let ndc_size = abs(ce.x / ce.w - c.x / c.w);

    // Convert NDC offset back to clip space, apply luminosity boost (bigger glow for brighter)
    let lum_boost = clamp(pow(max(star.luminosity, 0.001), 0.25), 0.7, 2.5);
    let offset    = corner * ndc_size * c.w * lum_boost;

    var out : VertOut;
    out.clip_pos = vec4<f32>(c.xy + offset, c.zw);
    out.uv       = corner;
    return out;
}

@fragment
fn fs_main(in: VertOut) -> @location(0) vec4<f32> {
    let r = length(in.uv);

    // ── #21 Chromatic aberration — R shifts outward, B shifts inward (prismatic lens split)
    let r_chrom = length(in.uv * 1.018);
    let b_chrom = length(in.uv * 0.982);

    let glow_r = exp(-r_chrom * r_chrom * 4.5) * 0.40 + exp(-r_chrom * 3.2) * 0.18;
    let glow_g = exp(-r       * r       * 4.5) * 0.40 + exp(-r       * 3.2) * 0.18;
    let glow_b = exp(-b_chrom * b_chrom * 4.5) * 0.40 + exp(-b_chrom * 3.2) * 0.18;
    let glow   = (glow_r + glow_g + glow_b) / 3.0;

    if glow < 0.001 { discard; }

    // ── #24 Diffraction spikes — 4 thin cross rays (telescope aperture effect)
    let fade_from_center = smoothstep(0.05, 0.28, r);
    let spike_h = exp(-in.uv.y * in.uv.y * 140.0) * exp(-abs(in.uv.x) * 2.2);
    let spike_v = exp(-in.uv.x * in.uv.x * 140.0) * exp(-abs(in.uv.y) * 2.2);
    let spikes  = (spike_h + spike_v) * fade_from_center * 0.32;

    // ── Colour: hot white core → star spectral color → faint blue-purple edge
    let hot_frac = dot(star.color, vec3<f32>(0.15, 0.30, 0.55));
    let edge_col = mix(vec3<f32>(0.6, 0.3, 0.1), vec3<f32>(0.2, 0.25, 0.5), hot_frac);
    var col      = mix(vec3<f32>(1.0, 0.98, 0.95), star.color, r * 0.5);
    col          = mix(col, edge_col, smoothstep(0.5, 1.0, r) * 0.5);

    // ── Chromatic color split: red/blue channels slightly offset
    let chrom_col = vec3<f32>(
        col.r * (glow_r / max(glow_g, 0.001)),
        col.g,
        col.b * (glow_b / max(glow_g, 0.001))
    );

    // ── Gentle slow pulse
    let pulse = 1.0 + 0.05 * sin(star.time * 0.4);

    // ── Spike color: slightly blue-shifted (diffraction shifts short wavelengths)
    let spike_col = mix(col, vec3<f32>(0.72, 0.85, 1.0), 0.40);

    let final_col = chrom_col * glow * pulse + spike_col * spikes;
    let final_a   = glow * pulse + spikes * 0.55;

    return vec4<f32>(final_col, final_a);
}
