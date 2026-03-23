// ═══════════════════════════════════════════════════════════════════════════
// OMICRON — Star Field Shader  (+radius-weighted size  +distance-adaptive
//           twinkling  +spectral outer halo  +planet-count HZ ring scaling)
// ═══════════════════════════════════════════════════════════════════════════

struct Globals {
    view_proj : mat4x4<f32>,
    cam_pos   : vec3<f32>,
    time      : f32,
}

@group(0) @binding(0) var<uniform> globals : Globals;

struct StarIn {
    @location(0) position     : vec3<f32>,
    @location(1) teff         : f32,
    @location(2) luminosity   : f32,
    @location(3) radius       : f32,
    @location(4) multiplicity : f32,
    @location(5) confidence   : f32,
    @location(6) planet_count : f32,
}

struct VertOut {
    @builtin(position) clip         : vec4<f32>,
    @location(0)       uv           : vec2<f32>,
    @location(1)       color        : vec3<f32>,
    @location(2)       confidence   : f32,
    @location(3)       planet_count : f32,
    @location(4)       multiplicity : f32,
    @location(5)       seed         : f32,
    @location(6)       dist_pc      : f32,
    @location(7)       luminosity   : f32,
}

// ── Blackbody color ──────────────────────────────────────────────────────────

fn blackbody(t: f32) -> vec3<f32> {
    let tc = clamp(t, 1000.0, 40000.0);
    var r = 0.0; var g = 0.0; var b = 0.0;
    if tc <= 6600.0 {
        r = 1.0;
        g = clamp(0.39008157 * log(tc / 100.0) - 0.63184144, 0.0, 1.0);
        b = select(0.0,
            clamp(0.54320678 * log(tc / 100.0 - 10.0) - 1.19625408, 0.0, 1.0),
            tc > 1900.0);
    } else {
        r = clamp(1.29293618 * pow(tc / 100.0 - 60.0, -0.1332047592), 0.0, 1.0);
        g = clamp(1.12989086 * pow(tc / 100.0 - 60.0, -0.0755148492), 0.0, 1.0);
        b = 1.0;
    }
    let boost = select(1.0, 1.0 + (tc - 6600.0) / 33400.0 * 0.8, tc > 6600.0);
    return vec3(r, g, b) * boost;
}

fn quad_corner(vid: u32) -> vec2<f32> {
    let x = select(-1.0, 1.0, vid == 1u || vid == 4u || vid == 5u);
    let y = select(-1.0, 1.0, vid == 2u || vid == 3u || vid == 5u);
    return vec2(x, y);
}

// ── Vertex ───────────────────────────────────────────────────────────────────

@vertex
fn vs_main(
    @builtin(vertex_index) vid : u32,
    inst                       : StarIn,
) -> VertOut {
    let clip_c = globals.view_proj * vec4(inst.position, 1.0);

    // ── #5 Radius-weighted size — blend luminosity size with physical radius
    let lum_base = clamp(pow(max(inst.luminosity, 0.0001), 0.30) * 0.007 + 0.003,
                         0.003, 0.030);
    let rad_base = clamp(pow(max(inst.radius,     0.10  ), 0.40) * 0.005 + 0.003,
                         0.003, 0.025);
    var base     = mix(lum_base, rad_base, 0.35);

    let is_sol = length(inst.position) < 0.01;
    base = select(base, 0.034, is_sol);

    let pulse = select(1.0,
        1.0 + 0.12 * sin(globals.time * 6.9115),
        inst.planet_count > 0.5);

    let seed = fract(
        inst.position.x * 12.9898 +
        inst.position.y * 78.233  +
        inst.position.z * 43.978
    ) * 43758.5453;

    // ── #22 Variable star pulsation — cool K/M stars breathe slowly in size
    let cool_frac = clamp(1.0 - (inst.teff - 3000.0) / 1500.0, 0.0, 1.0);
    let breathe   = 1.0 + 0.10 * cool_frac * sin(globals.time * 0.65 + seed * 3.17);
    base *= breathe;

    let spike_scale = select(1.0, 1.6, inst.luminosity > 5.0);
    let size_ndc    = base * pulse * spike_scale;

    // ── #29 Parallax offset — nearest stars drift slightly with camera position
    let dist_pc   = length(inst.position);
    let par_frac  = clamp(1.0 - dist_pc / 2.5, 0.0, 1.0);
    let par_shift = globals.cam_pos.xy * 0.00012 * par_frac;

    let corner = quad_corner(vid);
    let offset = corner * size_ndc * clip_c.w;

    var out : VertOut;
    out.clip         = vec4(clip_c.xy + offset + par_shift * clip_c.w, clip_c.zw);
    out.uv           = corner;
    out.color        = blackbody(inst.teff);
    out.confidence   = inst.confidence;
    out.planet_count = inst.planet_count;
    out.multiplicity = inst.multiplicity;
    out.seed         = seed;
    out.dist_pc      = length(inst.position);
    out.luminosity   = inst.luminosity;
    return out;
}

// ── Fragment ─────────────────────────────────────────────────────────────────

@fragment
fn fs_main(in : VertOut) -> @location(0) vec4<f32> {
    let d = length(in.uv);
    let t = globals.time;

    // ── #6 Distance-adaptive twinkling — nearby stars are atmospherically stable
    let twinkle_amp = clamp(in.dist_pc * 0.20, 0.10, 1.0);
    let twinkle = 1.0
        + 0.09 * twinkle_amp * sin(t * 3.73 + in.seed * 4.11)
        + 0.04 * twinkle_amp * sin(t * 7.17 + in.seed * 11.3);

    // ── Distance fog
    let fog = clamp(1.0 - (in.dist_pc - 8.0) / 10.0, 0.20, 1.0);

    // ── Luminosity-driven corona spread
    let halo_spread = 3.0 + clamp(log(in.color.r + in.color.g + in.color.b + 0.1) * 0.8, 0.0, 2.5);

    // ── Radial zones
    let core = smoothstep(0.30, 0.0,  d);
    let disc = smoothstep(0.60, 0.10, d);
    let glow = exp(-d * d * halo_spread);

    let core_w     = core / (core + disc + 0.001);
    let core_color = mix(in.color, vec3(1.5, 1.4, 1.3), core_w);
    var color      = core_color * (core * 2.5 + disc * 1.2 + glow * 0.8) * twinkle * fog;

    // ── #7 Spectral outer halo — hot=blue, cool=orange/red
    let blue_frac = clamp((in.color.b - 0.3) / 0.7, 0.0, 1.0);
    let halo_col  = mix(vec3<f32>(1.0, 0.42, 0.12), vec3<f32>(0.28, 0.60, 1.0), blue_frac);
    color += halo_col * exp(-d * d * 1.5) * 0.10 * twinkle * fog;

    // ── Diffraction cross spikes (bright stars only)
    if in.luminosity > 5.0 {
        let spike_h  = exp(-in.uv.y * in.uv.y * 55.0) * exp(-abs(in.uv.x) * 2.8);
        let spike_v  = exp(-in.uv.x * in.uv.x * 55.0) * exp(-abs(in.uv.y) * 2.8);
        let duv      = vec2(in.uv.x + in.uv.y, in.uv.x - in.uv.y) * 0.7071;
        let spike_d1 = exp(-duv.y * duv.y * 55.0) * exp(-abs(duv.x) * 3.5);
        let spike_d2 = exp(-duv.x * duv.x * 55.0) * exp(-abs(duv.y) * 3.5);
        let fade     = smoothstep(0.05, 0.25, d);
        let str      = (spike_h + spike_v) * 0.55 + (spike_d1 + spike_d2) * 0.22;
        let scol     = mix(in.color, vec3(1.2, 1.1, 1.0), 0.4);
        let rot_mod  = 0.85 + 0.15 * sin(t * 0.08 + in.seed * 1.57);
        color += scol * str * fade * fog * rot_mod * 0.70;
    }

    // ── Sol gold marker ring
    if in.dist_pc < 0.01 {
        let ring_fade  = exp(-pow((d - 0.68) / 0.025, 2.0));
        let ring_pulse = 0.8 + 0.2 * sin(t * 1.8);
        color += vec3(1.0, 0.78, 0.15) * ring_fade * ring_pulse * 2.0;
        color += vec3(0.9, 0.55, 0.05) * exp(-pow((d - 0.84) / 0.018, 2.0)) * 0.6;
        color += vec3(0.8, 0.50, 0.00) * glow * 0.4;
    }

    // ── Confidence shimmer
    let shimmer = select(1.0,
        0.60 + 0.40 * abs(sin(t * 2.5 + in.seed * 3.14)),
        in.confidence < 0.85);

    // ── Multiplicity rings
    if in.multiplicity > 1.5 {
        color += vec3(0.3, 0.55, 1.0) * (1.0 - smoothstep(0.0, 0.04, abs(d - 0.68))) * 0.9 * fog;
        color += vec3(0.2, 0.45, 0.9) * (1.0 - smoothstep(0.0, 0.03, abs(d - 0.82))) * 0.6 * fog;
    } else if in.multiplicity > 0.5 {
        color += vec3(0.35, 0.60, 1.0) * (1.0 - smoothstep(0.0, 0.04, abs(d - 0.72))) * 0.8 * fog;
    }

    // ── #20 Planet-count HZ ring — scales with system richness
    if in.planet_count > 0.5 {
        let hz_breath    = 0.50 + 0.50 * sin(t * 5.31 + in.seed * 2.17);
        let planet_scale = min(in.planet_count / 5.0, 1.0);
        let hz_r         = 0.55 - planet_scale * 0.07;   // ring tightens for richer systems
        let hz_bright    = 0.35 + planet_scale * 0.25;   // brighter with more planets
        let hz_ring      = exp(-pow(d - hz_r, 2.0) * 18.0);
        color += vec3(0.05, 0.72, 0.22) * (hz_ring * hz_bright + glow * 0.03)
                 * hz_breath * fog;
    }

    let alpha = clamp((disc * 0.9 + glow * 0.7) * shimmer, 0.0, 1.0);
    return vec4(color, alpha);
}
