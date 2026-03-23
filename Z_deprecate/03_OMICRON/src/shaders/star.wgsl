// ═══════════════════════════════════════════════════════════════════════════
// OMICRON — Star Shader
// Warm emissive photosphere + Fresnel rim (bobbyroe approach translated to WGSL)
// Core: orange-red emissive with subtle noise variation
// Rim:  bright yellow-white Fresnel at grazing angles (additive over core)
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
    @location(2)       uv        : vec2<f32>,
}

@vertex
fn vs_main(v: VertIn) -> VertOut {
    var out: VertOut;
    out.clip_pos  = cam.view_proj * vec4<f32>(v.position * star.radius, 1.0);
    out.world_pos = v.position * star.radius;
    out.normal    = v.normal;
    out.uv        = v.uv;
    return out;
}

// ── Noise ────────────────────────────────────────────────────────────────────

fn hash3(p: vec3<f32>) -> f32 {
    var q = fract(p * vec3<f32>(0.1031, 0.1030, 0.0973));
    q += dot(q, q.yxz + 19.19);
    return fract((q.x + q.y) * q.z);
}

fn vnoise(p: vec3<f32>) -> f32 {
    let i = floor(p); let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(mix(hash3(i),               hash3(i+vec3(1,0,0)), u.x),
            mix(hash3(i+vec3(0,1,0)),   hash3(i+vec3(1,1,0)), u.x), u.y),
        mix(mix(hash3(i+vec3(0,0,1)),   hash3(i+vec3(1,0,1)), u.x),
            mix(hash3(i+vec3(0,1,1)),   hash3(i+vec3(1,1,1)), u.x), u.y),
        u.z
    );
}

fn fbm(p: vec3<f32>, oct: i32) -> f32 {
    var v = 0.0; var a = 0.5; var q = p;
    for (var i = 0; i < oct; i++) { v += a * vnoise(q); a *= 0.5; q *= 2.1; }
    return v;
}

fn worley(p: vec3<f32>) -> f32 {
    let i = floor(p); let f = fract(p);
    var md = 9999.0;
    for (var z = -1; z <= 1; z++) {
    for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
        let nb = vec3<f32>(f32(x), f32(y), f32(z));
        let c  = i + nb;
        let j  = vec3<f32>(hash3(c+vec3(0.1,0.2,0.3)),
                           hash3(c+vec3(0.4,0.5,0.6)),
                           hash3(c+vec3(0.7,0.8,0.9)));
        md = min(md, dot(nb+j-f, nb+j-f));
    }}}
    return sqrt(md);
}

// ── Sunspot groups ────────────────────────────────────────────────────────────

fn sunspot_mask(N: vec3<f32>, t: f32) -> f32 {
    let cool = clamp(1.0 - (star.temperature - 3500.0) / 3500.0, 0.0, 1.0);
    let lat   = asin(clamp(N.y, -1.0, 1.0));
    let lat_w = exp(-lat * lat * 4.2);
    let p1 = normalize(vec3(cos(t*0.0028+0.7),  0.40, sin(t*0.0028+0.7)));
    let p2 = normalize(vec3(cos(t*0.0021+2.5), -0.35, sin(t*0.0021+2.5)));
    let p3 = normalize(vec3(cos(t*0.0035+4.2),  0.25, sin(t*0.0035+4.2)));
    let p4 = normalize(vec3(cos(t*0.0018+5.8), -0.18, sin(t*0.0018+5.8)));
    let s1 = exp(-dot(N-p1,N-p1)*28.0)*0.80;
    let s2 = exp(-dot(N-p2,N-p2)*35.0)*0.70;
    let s3 = exp(-dot(N-p3,N-p3)*45.0)*0.55;
    let s4 = exp(-dot(N-p4,N-p4)*22.0)*0.40;
    let spot = max(max(s1,s2),max(s3,s4)) * lat_w * cool;
    return 1.0 - spot * 0.80;
}

// ── Fragment ─────────────────────────────────────────────────────────────────

@fragment
fn fs_main(in: VertOut) -> @location(0) vec4<f32> {
    let N = normalize(in.normal);
    let V = normalize(cam.cam_pos - in.world_pos);
    let n_dot_v = max(dot(N, V), 0.0);
    let t = star.time;

    // ── Spectral class blend factor (0 = M cool, 1 = A/F hot)
    let hot = clamp((star.temperature - 3000.0) / 9000.0, 0.0, 1.0);

    // ── Animated surface drift
    let d1 = vec3<f32>(t*0.007,  t*0.004, 0.0);
    let d2 = vec3<f32>(-t*0.003, t*0.008, t*0.002);

    // ── Granulation: Voronoi cell pattern (bright interior, darker lanes)
    let gran_w = worley(N * 8.0 + d1);
    let gran   = 1.0 - smoothstep(0.0, 0.45, gran_w);  // 0=dark lane, 1=cell center

    // ── Large-scale convection / activity variation
    let turb = fbm(N * 3.5 + d2, 5);

    // ── Photosphere: warm orange-red base (like emissive: 0xff0000 → warm)
    // Combined surface brightness: granule cells lit up by convection
    let surf_bright = gran * 0.55 + turb * 0.45;

    // Core palette: deep orange-red → bright orange-yellow
    let c_dark  = mix(vec3(0.70, 0.18, 0.01), vec3(0.75, 0.28, 0.02), hot);
    let c_mid   = mix(vec3(0.95, 0.38, 0.04), vec3(1.00, 0.55, 0.08), hot);
    let c_hot   = mix(vec3(1.00, 0.60, 0.10), vec3(1.00, 0.78, 0.25), hot);

    var color = mix(c_dark, c_mid,  smoothstep(0.20, 0.55, surf_bright));
    color     = mix(color,  c_hot,  smoothstep(0.50, 0.90, surf_bright));

    // ── Sunspot darkening
    color *= sunspot_mask(N, t);

    // ── Limb darkening: center slightly brighter / whiter, edge darker
    let limb = 1.0 - 0.45 * (1.0 - n_dot_v);
    color *= limb;

    // ── Fresnel rim (bobbyroe: fresnelBias=0.15, fresnelScale=1.2, fresnelPower=4.0)
    // At center: f≈0.15 → barely visible. At limb: f→1.0 → full yellow-white glow.
    let fresnel_f = clamp(0.15 + 1.2 * pow(1.0 - n_dot_v, 4.0), 0.0, 1.0);
    let rim_col   = mix(vec3(1.00, 0.78, 0.28), vec3(1.00, 0.95, 0.65), hot);
    color = mix(color, rim_col, fresnel_f * 0.75);

    // ── Chromosphere ring: sharp bright band at the very limb (edge ≈ 0.94)
    let edge     = 1.0 - n_dot_v;
    let chrom_r  = exp(-pow((edge - 0.93) * 30.0, 2.0));
    let chrom_c  = mix(vec3(1.00, 0.75, 0.20), vec3(1.00, 0.92, 0.55), hot);
    color += chrom_c * chrom_r * 2.0;

    // ── Prominence arcs: faint Hα emission just inside limb
    let th   = 0.05;
    let rim  = smoothstep(0.0, th, edge) * (1.0 - smoothstep(th, th * 3.0, edge));
    let lon  = atan2(N.z, N.x);
    let arc  = pow(sin(lon * 2.0 + t*0.05 + 1.1) * 0.5 + 0.5, 2.0)
             * pow(sin(lon * 3.0 + t*0.03 + 2.7) * 0.5 + 0.5, 2.0);
    let prom_c = mix(vec3(1.00, 0.45, 0.08), vec3(1.00, 0.65, 0.20), hot);
    color += prom_c * arc * rim * 1.5;

    return vec4<f32>(clamp(color, vec3(0.0), vec3(1.0)), 1.0);
}
