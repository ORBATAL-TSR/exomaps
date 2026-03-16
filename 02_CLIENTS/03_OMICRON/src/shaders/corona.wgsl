// ═══════════════════════════════════════════════════════════════════════════
// OMICRON — Corona Shell Shader  (+luminosity-driven opacity)
// Fresnel rim glow · streamer rays · chromosphere seam
// Rendered on a sphere at 1.5× star radius, additive blending.
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

struct VertIn {
    @location(0) position : vec3<f32>,
    @location(1) normal   : vec3<f32>,
    @location(2) uv       : vec2<f32>,
}

struct VertOut {
    @builtin(position) clip_pos  : vec4<f32>,
    @location(0)       world_pos : vec3<f32>,
    @location(1)       normal    : vec3<f32>,
}

@vertex
fn vs_main(v: VertIn) -> VertOut {
    var out: VertOut;
    let world    = v.position * star.radius * 1.5;
    out.clip_pos  = cam.view_proj * vec4<f32>(world, 1.0);
    out.world_pos = world;
    out.normal    = v.normal;
    return out;
}

fn chash(n: f32) -> f32 { return fract(sin(n) * 43758.5453); }

@fragment
fn fs_main(in: VertOut) -> @location(0) vec4<f32> {
    let N = normalize(in.normal);
    let V = normalize(cam.cam_pos - in.world_pos);

    let ndotv = abs(dot(N, V));
    let edge  = 1.0 - ndotv;

    let glow_inner = pow(edge, 2.0) * 0.7;
    let glow_outer = pow(edge, 5.0) * 1.5;
    let glow       = glow_inner + glow_outer;

    let chrom = pow(edge, 10.0) * 2.5;

    let angle = atan2(N.y, N.x);

    let f1 = 1.0 * 2.0 + chash(1.0 * 3.7) * 2.0;
    let f2 = 2.0 * 2.0 + chash(2.0 * 3.7) * 2.0;
    let f3 = 3.0 * 2.0 + chash(3.0 * 3.7) * 2.0;
    let f4 = 4.0 * 2.0 + chash(4.0 * 3.7) * 2.0;
    let f5 = 5.0 * 2.0 + chash(5.0 * 3.7) * 2.0;
    let f6 = 6.0 * 2.0 + chash(6.0 * 3.7) * 2.0;

    let t  = star.time;
    var rn = sin(angle * f1 + t * 0.09 + chash(1.0) * 6.2832) * 1.0000
           + sin(angle * f2 + t * 0.12 + chash(2.0) * 6.2832) * 0.5000
           + sin(angle * f3 + t * 0.15 + chash(3.0) * 6.2832) * 0.3333
           + sin(angle * f4 + t * 0.18 + chash(4.0) * 6.2832) * 0.2500
           + sin(angle * f5 + t * 0.21 + chash(5.0) * 6.2832) * 0.2000
           + sin(angle * f6 + t * 0.24 + chash(6.0) * 6.2832) * 0.1667;

    rn = rn / 2.4167 * 0.5 + 0.5;
    let stream_bright = rn * rn;
    let stream_pulse  = 0.85 + 0.15 * sin(t * 0.5 + angle * 1.5);

    // ── #28 Solar activity cycle — slow ~26-min visual period modulates corona
    let solar_cycle = 0.75 + 0.25 * sin(t * 0.004);
    let corona_i    = glow * (0.35 + 0.65 * stream_bright) * stream_pulse * solar_cycle;

    let hot_frac  = dot(star.color, vec3<f32>(0.15, 0.30, 0.55));
    let tip_color = mix(star.color * 1.2, vec3<f32>(0.85, 0.90, 1.0), hot_frac);
    var col       = mix(vec3<f32>(1.0, 0.98, 0.95), star.color, edge * 0.65);
    col           = mix(col, tip_color, pow(edge, 4.0) * 0.3);

    let chrom_col = mix(vec3<f32>(1.0, 0.6, 0.4), vec3<f32>(0.9, 0.95, 1.0), hot_frac);
    let flicker   = 1.0 + 0.04 * sin(t * 3.5 + angle * 2.0);
    let final_col = col * corona_i * flicker + chrom_col * chrom * glow;

    // ── #19 Luminosity-driven opacity — brighter stars have more visible corona
    let lum_scale = clamp(sqrt(max(star.luminosity, 0.001)) * 0.75, 0.35, 2.2);
    let final_a   = (corona_i * 0.60 + chrom * 0.5) * lum_scale;

    return vec4<f32>(final_col * lum_scale, final_a);
}
