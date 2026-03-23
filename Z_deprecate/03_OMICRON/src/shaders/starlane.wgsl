// ═══════════════════════════════════════════════════════════════════════════
// OMICRON — Star Lane  (+bidirectional flow  +width by length
//                       +per-lane vitality pulse)
// ═══════════════════════════════════════════════════════════════════════════

struct Globals {
    view_proj : mat4x4<f32>,
    cam_pos   : vec3<f32>,
    time      : f32,
}

@group(0) @binding(0) var<uniform> globals : Globals;

struct LaneIn {
    @location(0) pos_a : vec4<f32>,
    @location(1) pos_b : vec4<f32>,
}

struct VertOut {
    @builtin(position) clip    : vec4<f32>,
    @location(0) t             : f32,
    @location(1) side          : f32,
    @location(2) cam_dist      : f32,
    @location(3) len_ndc       : f32,
    @location(4) lane_seed     : f32,   // #8 per-lane hash seed
    @location(5) flow_dir      : f32,   // #8 ±1 for bidirectional flow
}

@vertex
fn vs_main(
    @builtin(vertex_index) vid : u32,
    lane : LaneIn
) -> VertOut {
    let at_b    = vid == 2u || vid == 4u || vid == 5u;
    let at_plus = vid == 0u || vid == 2u || vid == 5u;

    let t         = select(0.0, 1.0, at_b);
    let side_sign = select(-1.0, 1.0, at_plus);

    let clip_a = globals.view_proj * vec4(lane.pos_a.xyz, 1.0);
    let clip_b = globals.view_proj * vec4(lane.pos_b.xyz, 1.0);
    let ndc_a  = clip_a.xy / clip_a.w;
    let ndc_b  = clip_b.xy / clip_b.w;

    let line_vec = ndc_b - ndc_a;
    let len_ndc  = length(line_vec);
    let line_dir = select(vec2(1.0, 0.0), normalize(line_vec), len_ndc > 0.0001);
    let perp     = vec2(-line_dir.y, line_dir.x);

    // ── #9 Width inversely scales with projected length
    // Short lanes (close stars) stay thick; long lanes thin to hairlines.
    let len_norm = clamp(len_ndc * 5.0, 0.0, 1.0);
    let half_w   = 0.0022 * (1.0 - 0.55 * len_norm);

    let clip_cur = select(clip_a, clip_b, at_b);
    let offset   = perp * side_sign * half_w * clip_cur.w;

    // ── #8 Lane seed from endpoint positions
    let lane_seed = fract(
        lane.pos_a.x * 12.9898 + lane.pos_a.z * 78.233 +
        lane.pos_b.x * 43.978  + lane.pos_b.z * 19.345
    ) * 43758.5453;

    // Bidirectional: alternate flow direction per lane using seed
    let flow_dir = select(-1.0, 1.0, fract(lane_seed * 0.01) > 0.5);

    var out : VertOut;
    out.clip      = vec4(clip_cur.xy + offset, clip_cur.z, clip_cur.w);
    out.t         = t;
    out.side      = side_sign;
    out.cam_dist  = length((lane.pos_a.xyz + lane.pos_b.xyz) * 0.5 - globals.cam_pos);
    out.len_ndc   = len_ndc;
    out.lane_seed = lane_seed;
    out.flow_dir  = flow_dir;
    return out;
}

@fragment
fn fs_main(in : VertOut) -> @location(0) vec4<f32> {
    let end_fade = smoothstep(0.0, 0.06, in.t) * smoothstep(0.0, 0.06, 1.0 - in.t);

    let abs_side = abs(in.side);
    let core     = 1.0 - abs_side;
    let halo     = exp(-abs_side * abs_side * 6.0);
    let profile  = core * 0.5 + halo * 0.5;

    // ── #8 Bidirectional flow — direction flipped per lane
    let flow_t = fract(in.t * in.flow_dir - globals.time * 0.30 * in.flow_dir);
    let pulse  = exp(-flow_t * flow_t * 18.0) * 0.35;

    // ── #10 Per-lane vitality — slow independent brightness cycle
    let vitality = 0.75 + 0.25 * sin(globals.time * 0.028 + in.lane_seed * 2.17);

    let shimmer   = 0.5 + 0.5 * sin(in.t * 7.0 + globals.time * 1.4);
    let shimmer_m = 0.05 * shimmer;

    let fog = exp(-in.cam_dist * 0.055);

    if in.len_ndc < 0.003 { discard; }

    // ── #30 Hot lanes — short routes carry more energy, glow warmer (orange-amber)
    let short_frac = clamp(1.0 - in.len_ndc * 7.0, 0.0, 1.0);
    let base_col   = mix(vec3(0.18, 0.38, 0.72), vec3(0.70, 0.38, 0.14), short_frac * 0.55);
    let pulse_col  = mix(vec3(0.55, 0.75, 1.00), vec3(1.00, 0.72, 0.35), short_frac * 0.55);
    let col        = mix(base_col, pulse_col, pulse + shimmer_m) * profile * vitality;

    let alpha = profile * end_fade * fog * 0.18 * vitality + pulse * end_fade * fog * 0.45;

    return vec4(col * alpha, alpha);
}
