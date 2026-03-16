// ═══════════════════════════════════════════════════════════════════════════
// OMICRON — Distance Rings
// XZ-plane circle markers at 5, 10, 15 pc.  Rendered as thin screen-space
// ribbon quads (same billboard expansion as starlanes, just circular).
// CPU uploads a ring vertex buffer: each vertex carries (world_pos, radius_pc).
// ═══════════════════════════════════════════════════════════════════════════

struct Globals {
    view_proj : mat4x4<f32>,
    cam_pos   : vec3<f32>,
    time      : f32,
}

@group(0) @binding(0) var<uniform> globals : Globals;

// ── Vertex layout ────────────────────────────────────────────────────────────
//
// CPU sends a flat triangle-strip style mesh for the ring ribbon:
// Each "segment" of the ring is a quad (6 verts).
// Per-vertex data:
//   location 0: world_pos (vec3) — XZ-plane point on the ring
//   location 1: radius_pc (f32)  — which ring (5/10/15) for styling
//   location 2: arc_t    (f32)   — 0..1 position along the ring circumference

struct RingVert {
    @location(0) world_pos : vec3<f32>,
    @location(1) radius_pc : f32,
    @location(2) arc_t     : f32,
    @location(3) side      : f32,   // +1 / -1 ribbon half
}

struct VertOut {
    @builtin(position) clip : vec4<f32>,
    @location(0) arc_t     : f32,
    @location(1) side      : f32,
    @location(2) radius_pc : f32,
    @location(3) cam_dist  : f32,
}

@vertex
fn vs_main(v : RingVert) -> VertOut {
    let clip = globals.view_proj * vec4(v.world_pos, 1.0);
    let ndc  = clip.xy / clip.w;

    // Tangent of the ring at this point: perpendicular in XZ plane → to NDC perp
    // We pass the side sign from the CPU mesh, expand perpendicular to the
    // projected ring tangent.  The tangent is encoded as the direction from
    // the previous vertex — here we approximate it as the XZ perpendicular.

    // Ring tangent in world space: for XZ ring, tangent = (-sin, 0, cos) of the
    // current angle.  world_pos = (r·cos, 0, r·sin) so tangent = (-z/r, 0, x/r).
    let r_xz = length(v.world_pos.xz);
    let tang_w = select(
        vec3(1.0, 0.0, 0.0),
        vec3(-v.world_pos.z / r_xz, 0.0, v.world_pos.x / r_xz),
        r_xz > 0.001
    );

    // Project tangent to get screen-space direction, then find perpendicular
    let tang_clip = globals.view_proj * vec4(v.world_pos + tang_w * 0.1, 1.0);
    let tang_ndc  = tang_clip.xy / tang_clip.w;
    let screen_dir = normalize(tang_ndc - ndc);
    let perp       = vec2(-screen_dir.y, screen_dir.x);

    let half_w = 0.0014;
    let offset = perp * v.side * half_w * clip.w;

    var out : VertOut;
    out.clip      = vec4(clip.xy + offset, clip.z, clip.w);
    out.arc_t     = v.arc_t;
    out.side      = v.side;
    out.radius_pc = v.radius_pc;
    out.cam_dist  = length(v.world_pos - globals.cam_pos);
    return out;
}

@fragment
fn fs_main(in : VertOut) -> @location(0) vec4<f32> {
    // ── Radial fade (cross-ribbon gaussian)
    let profile = exp(-in.side * in.side * 5.0);

    // ── Dashed pattern — rings feel like a measurement grid, not solid lines
    // Higher frequency at inner rings so dashes stay roughly equal arc-length.
    let dash_freq = select(
        select(18.0, 24.0, in.radius_pc > 7.0),
        36.0, in.radius_pc > 12.0
    );
    let dash = smoothstep(0.0, 0.05, fract(in.arc_t * dash_freq))
             * smoothstep(0.0, 0.05, 1.0 - fract(in.arc_t * dash_freq));

    // ── Slow rotation shimmer (very subtle, like a spinning radar sweep)
    let sweep_t = fract(in.arc_t - globals.time * 0.03);
    let sweep   = exp(-sweep_t * sweep_t * 40.0) * 0.6;

    // ── Distance fog
    let fog = exp(-in.cam_dist * 0.04);

    // ── Colour by radius
    // 5 pc  → warm gold  (inner zone, well explored)
    // 10 pc → cool teal  (mid zone)
    // 15 pc → dim purple (outer boundary)
    let col_5  = vec3(0.90, 0.72, 0.20);
    let col_10 = vec3(0.20, 0.70, 0.65);
    let col_15 = vec3(0.55, 0.25, 0.80);
    let t5  = smoothstep(0.0, 1.0, clamp(1.0 - abs(in.radius_pc - 5.0), 0.0, 1.0));
    let t10 = smoothstep(0.0, 1.0, clamp(1.0 - abs(in.radius_pc - 10.0), 0.0, 1.0));
    let t15 = smoothstep(0.0, 1.0, clamp(1.0 - abs(in.radius_pc - 15.0), 0.0, 1.0));
    let col = col_5 * t5 + col_10 * t10 + col_15 * t15;

    // ── #26 Cardinal tick marks — brief brightening at N/E/S/W (0°, 90°, 180°, 270°)
    let tick_n = exp(-pow(fract(in.arc_t       ) * 2.0 - 1.0, 2.0) * 400.0);
    let tick_e = exp(-pow(fract(in.arc_t - 0.25) * 2.0 - 1.0, 2.0) * 400.0);
    let tick_s = exp(-pow(fract(in.arc_t - 0.50) * 2.0 - 1.0, 2.0) * 400.0);
    let tick_w = exp(-pow(fract(in.arc_t - 0.75) * 2.0 - 1.0, 2.0) * 400.0);
    let ticks  = (tick_n + tick_e + tick_s + tick_w) * profile * fog * 0.50;

    let base_alpha  = profile * dash * fog * 0.22;
    let sweep_alpha = sweep * profile * fog * 0.25;

    let total_alpha = base_alpha + sweep_alpha + ticks;

    return vec4(col * total_alpha, total_alpha);
}
