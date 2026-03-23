// ═══════════════════════════════════════════════════════════════════════════
// OMICRON — Galaxy Background  (+emission nebula blobs  +deeper dust channel
//                               +very slow galactic rotation)
// ═══════════════════════════════════════════════════════════════════════════

struct Globals {
    view_proj_inv : mat4x4<f32>,
    cam_pos       : vec3<f32>,
    time          : f32,
}

@group(0) @binding(0) var<uniform> globals : Globals;

struct VertOut {
    @builtin(position) clip : vec4<f32>,
    @location(0)       ndc  : vec2<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) vid : u32) -> VertOut {
    let x = select(-1.0, 3.0, vid == 1u);
    let y = select(-1.0, 3.0, vid == 2u);
    var out : VertOut;
    out.clip = vec4(x, y, 1.0, 1.0);
    out.ndc  = vec2(x, y);
    return out;
}

fn hash3(p: vec3<f32>) -> f32 {
    var q = fract(p * vec3(0.1031, 0.1030, 0.0973));
    q += dot(q, q.yxz + 19.19);
    return fract((q.x + q.y) * q.z);
}

fn vnoise(p: vec3<f32>) -> f32 {
    let i = floor(p); let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(mix(hash3(i),               hash3(i + vec3(1,0,0)), u.x),
            mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), u.x), u.y),
        mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), u.x),
            mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), u.x), u.y),
        u.z
    );
}

fn fbm(p: vec3<f32>, oct: i32) -> f32 {
    var v = 0.0; var a = 0.5; var q = p;
    for (var i = 0; i < oct; i++) { v += a * vnoise(q); a *= 0.5; q *= 2.1; }
    return v;
}

@fragment
fn fs_main(in : VertOut) -> @location(0) vec4<f32> {
    let clip   = vec4(in.ndc, 0.0, 1.0);
    let world4 = globals.view_proj_inv * clip;
    let ray    = normalize(world4.xyz / world4.w - globals.cam_pos);

    let lat = asin(clamp(ray.y, -1.0, 1.0));

    // ── #13 Very slow galactic rotation — barely perceptible, adds life
    let lon = atan2(ray.z, ray.x) + globals.time * 0.00005;

    let band_tight = exp(-lat * lat * 18.0);
    let band_wide  = exp(-lat * lat *  4.0);

    let core_ang  = acos(clamp(ray.x, -1.0, 1.0));
    let core_glow = exp(-core_ang * core_ang * 1.8) * band_tight * 1.4;

    // ── Primary dust lane
    let p_dust    = ray * 4.0 + vec3(0.0, 0.0, globals.time * 0.002);
    let dust      = fbm(p_dust, 5);
    let dust_dark = smoothstep(0.55, 0.72, dust) * band_tight * 0.8;

    // ── #12 Second, narrower deep-void dust channel slightly off-centre
    let lat2       = lat - 0.08;
    let band2      = exp(-lat2 * lat2 * 35.0);
    let p_dust2    = ray * 6.5 + vec3(1.3, 0.0, globals.time * 0.0015);
    let dust2      = fbm(p_dust2, 4);
    let dust_dark2 = smoothstep(0.60, 0.78, dust2) * band2 * 0.6;

    let star_wash = fbm(ray * 9.0 + vec3(1.7, 0.3, 0.9), 4)
                  * fbm(ray * 9.0 + vec3(1.7, 0.3, 0.9), 4) * band_wide * 0.9;

    // ── #27 Slow arm brightness cycle — spiral arms breathe independently
    let arm_pulse = 0.85 + 0.15 * sin(globals.time * 0.006 + lon * 0.5);
    let arm1 = exp(-pow(sin(lon - 1.05) * 3.5, 2.0)) * band_tight * 0.5 * arm_pulse;
    let arm2 = exp(-pow(sin(lon + 1.05) * 3.5, 2.0)) * band_tight * 0.4 * arm_pulse;

    // ── #11 Emission nebula blobs — soft colored Gaussians at fixed sky dirs
    // Nebula A: warm yellow-orange (toward +X/+Z quadrant)
    let na_dir = normalize(vec3<f32>( 0.60, 0.05,  0.80));
    let na_ang = acos(clamp(dot(ray, na_dir), -1.0, 1.0));
    let na     = exp(-na_ang * na_ang * 22.0)
               * fbm(ray * 5.0 + vec3<f32>(2.1, 0.5, 1.3), 3) * 0.9;

    // Nebula B: cool blue (hot O-star association, toward -X/+Z)
    let nb_dir = normalize(vec3<f32>(-0.50, 0.12,  0.87));
    let nb_ang = acos(clamp(dot(ray, nb_dir), -1.0, 1.0));
    let nb     = exp(-nb_ang * nb_ang * 30.0)
               * fbm(ray * 7.0 + vec3<f32>(4.2, 1.1, 0.7), 3) * 0.7;

    // Nebula C: faint red H-II region (toward +Y / galactic north)
    let nc_dir = normalize(vec3<f32>( 0.30, 0.45,  0.84));
    let nc_ang = acos(clamp(dot(ray, nc_dir), -1.0, 1.0));
    let nc     = exp(-nc_ang * nc_ang * 18.0)
               * fbm(ray * 4.0 + vec3<f32>(0.8, 3.3, 2.1), 3) * 0.8;

    let neb = vec3<f32>(0.55, 0.28, 0.06) * na * 0.040
            + vec3<f32>(0.08, 0.18, 0.42) * nb * 0.035
            + vec3<f32>(0.30, 0.04, 0.04) * nc * 0.025;

    // ── Colour palette
    let core_col = vec3(0.55, 0.40, 0.18);
    let disc_col = vec3(0.08, 0.10, 0.22);
    let wash_col = vec3(0.06, 0.08, 0.18);

    let brightness =
          core_glow  * 0.055
        + (band_tight * dust * 0.5 + star_wash * 0.4) * 0.055
        + (arm1 + arm2) * 0.028
        - dust_dark  * 0.020
        - dust_dark2 * 0.015;

    let col = mix(
        mix(wash_col, disc_col, band_tight),
        core_col, core_glow * 0.5
    ) * clamp(brightness, 0.0, 0.12) + neb;

    let micro = step(0.985, hash3(floor(ray * 60.0) * 0.1)) * 0.008;

    return vec4(col + vec3(micro), 1.0);
}
