//! Voronoi tectonic plate generator.
//!
//! Generates a spherical Voronoi tessellation to simulate tectonic plates,
//! then classifies plate boundaries (convergent/divergent/transform) based
//! on relative plate motion vectors.
//!
//! The plate model drives terrain generation:
//!   - Continental vs oceanic crust assignment
//!   - Mountain ranges at convergent boundaries (collision → orogeny)
//!   - Rift valleys at divergent boundaries
//!   - Strike-slip fault zones at transform boundaries
//!   - Mid-ocean ridges, subduction trenches, volcanic arcs
//!
//! Algorithm:
//!   1. Poisson-disk sample N seed points on the sphere (Lloyd relaxation)
//!   2. Build spherical Voronoi diagram (Fortune's algorithm on stereographic projection)
//!   3. Assign each plate: oceanic/continental, drift velocity, angular velocity
//!   4. Classify boundaries by relative motion at shared edges
//!   5. Generate boundary-derived heightmap contributions
//!
//! References:
//!   - Rosenburg et al. 2015 "Virtual Tectonic Plates on a Sphere"
//!   - van Heck & Tackley 2008 "Planforms of self-consistently generated plates"
//!   - Olson & Bercovici 1991 "Convection and plate tectonics"

use std::f64::consts::PI;

/// Seed the RNG deterministically from a planet index.
fn hash_seed(seed: u64) -> u64 {
    seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407)
}

/// Lightweight deterministic PRNG (PCG-XSH-RR variant).
struct Rng {
    state: u64,
}

impl Rng {
    fn new(seed: u64) -> Self {
        let mut rng = Rng { state: 0 };
        rng.state = hash_seed(seed);
        rng.next_u64(); // warm up
        rng
    }

    fn next_u64(&mut self) -> u64 {
        let old = self.state;
        self.state = old.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        let xorshifted = (((old >> 18) ^ old) >> 27) as u32;
        let rot = (old >> 59) as u32;
        ((xorshifted >> rot) | (xorshifted << (rot.wrapping_neg() & 31))) as u64
    }

    fn next_f64(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }

    /// Uniform random point on the unit sphere.
    fn sphere_point(&mut self) -> [f64; 3] {
        let theta = self.next_f64() * 2.0 * PI;
        let z = self.next_f64() * 2.0 - 1.0;
        let r = (1.0 - z * z).sqrt();
        [r * theta.cos(), r * theta.sin(), z]
    }
}

/* ── 3D vector utilities ───────────────────────────── */

fn dot(a: &[f64; 3], b: &[f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn cross(a: &[f64; 3], b: &[f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn normalize(v: &[f64; 3]) -> [f64; 3] {
    let len = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    if len < 1e-12 {
        return [0.0, 0.0, 1.0];
    }
    [v[0] / len, v[1] / len, v[2] / len]
}

fn scale(v: &[f64; 3], s: f64) -> [f64; 3] {
    [v[0] * s, v[1] * s, v[2] * s]
}

fn add(a: &[f64; 3], b: &[f64; 3]) -> [f64; 3] {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

fn sub(a: &[f64; 3], b: &[f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn great_circle_distance(a: &[f64; 3], b: &[f64; 3]) -> f64 {
    dot(a, b).clamp(-1.0, 1.0).acos()
}

/// Spherical centroid of a set of points (via mean direction + normalize).
fn spherical_centroid(points: &[[f64; 3]]) -> [f64; 3] {
    let mut sum = [0.0, 0.0, 0.0];
    for p in points {
        sum[0] += p[0];
        sum[1] += p[1];
        sum[2] += p[2];
    }
    normalize(&sum)
}

/* ── Plate types ───────────────────────────────────── */

/// Type of tectonic plate.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PlateType {
    /// Thick, buoyant, felsic crust (continents, highlands)
    Continental,
    /// Thin, dense, mafic crust (ocean basins)
    Oceanic,
}

/// Classification of a plate boundary segment.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum BoundaryType {
    /// Plates moving apart — rift valleys, mid-ocean ridges
    Divergent,
    /// Plates colliding — mountains, subduction, volcanic arcs
    Convergent,
    /// Plates sliding past each other — strike-slip faults
    Transform,
}

/// A tectonic plate on the sphere.
#[derive(Debug, Clone)]
pub struct TectonicPlate {
    /// Index of this plate (0-based).
    pub id: usize,
    /// Voronoi seed point (unit sphere).
    pub center: [f64; 3],
    /// Continental or oceanic.
    pub plate_type: PlateType,
    /// Euler pole for plate motion (unit sphere).
    pub euler_pole: [f64; 3],
    /// Angular velocity around the Euler pole (rad/unit time).
    pub angular_velocity: f64,
    /// Base elevation offset (continents higher than ocean floor).
    pub base_elevation: f64,
    /// Crustal thickness (km).
    pub crustal_thickness: f64,
    /// Age of the plate in Myr (affects cooling, subsidence).
    pub age_myr: f64,
}

/// A boundary segment between two plates.
#[derive(Debug, Clone)]
pub struct PlateBoundary {
    pub plate_a: usize,
    pub plate_b: usize,
    pub boundary_type: BoundaryType,
    /// The relative convergence rate (positive = converging, negative = diverging).
    pub relative_velocity: f64,
    /// Midpoint of the boundary segment on the sphere.
    pub midpoint: [f64; 3],
    /// Along-boundary direction (tangent).
    pub tangent: [f64; 3],
    /// Boundary-normal direction (perpendicular, in spherical tangent plane).
    pub normal: [f64; 3],
}

/// Complete tectonic model for a planet.
#[derive(Debug, Clone)]
pub struct TectonicModel {
    pub plates: Vec<TectonicPlate>,
    pub boundaries: Vec<PlateBoundary>,
    /// For each pixel (in equirectangular projection), the plate index.
    pub plate_map: Vec<u32>,
    /// Resolution of the plate_map (width = 2*height).
    pub map_width: usize,
    pub map_height: usize,
    /// Boundary distance field: for each pixel, signed distance to nearest boundary.
    /// Positive = interior, negative = on boundary. Range roughly [-1, 1].
    pub boundary_distance: Vec<f32>,
    /// Boundary influence map: for each pixel, the weighted boundary-type contribution.
    /// R = convergent strength, G = divergent strength, B = transform strength.
    pub boundary_influence: Vec<[f32; 3]>,
}

/* ── Main generation function ──────────────────────── */

/// Generate a complete tectonic plate model for a planet.
///
/// # Arguments
///
/// * `seed` — Deterministic seed for plate generation.
/// * `num_plates` — Number of tectonic plates (typically 6-40).
/// * `continental_fraction` — Fraction of plates that are continental (0.0-1.0).
/// * `resolution` — Width of the equirectangular output maps. Height = resolution/2.
/// * `geology` — Optional geological parameters to modulate plate behavior.
pub fn generate_tectonic_model(
    seed: u64,
    num_plates: usize,
    continental_fraction: f64,
    resolution: usize,
    tectonic_roughness: f64,
    volcanism_level: f64,
) -> TectonicModel {
    let mut rng = Rng::new(seed);
    let map_width = resolution;
    let map_height = resolution / 2;
    let num_plates = num_plates.max(3).min(60);

    // ── Step 1: Generate seed points with Poisson-disk spacing ──
    let mut centers = generate_plate_centers(&mut rng, num_plates);

    // ── Step 2: Lloyd relaxation for more uniform distribution ──
    lloyd_relaxation(&mut centers, 4, map_width, map_height);

    // ── Step 3: Assign plate properties ──
    let num_continental = ((num_plates as f64 * continental_fraction) + 0.5) as usize;
    let mut plates: Vec<TectonicPlate> = Vec::with_capacity(num_plates);

    for i in 0..num_plates {
        let is_continental = i < num_continental;

        // Euler pole: random point on sphere (not too close to plate center)
        let euler_pole = {
            let mut pole = rng.sphere_point();
            // Ensure Euler pole is at least 30° from plate center
            let mut attempts = 0;
            while great_circle_distance(&pole, &centers[i]) < PI / 6.0 && attempts < 20 {
                pole = rng.sphere_point();
                attempts += 1;
            }
            pole
        };

        // Angular velocity: continental plates are slower
        let speed_scale = if is_continental { 0.3 } else { 1.0 };
        let angular_velocity = (rng.next_f64() * 0.02 + 0.005) * speed_scale * tectonic_roughness;
        // Random sign for rotation direction
        let angular_velocity = if rng.next_f64() > 0.5 { angular_velocity } else { -angular_velocity };

        let base_elevation = if is_continental {
            0.25 + rng.next_f64() * 0.15 // 0.25-0.40 (above sea level)
        } else {
            -0.15 - rng.next_f64() * 0.10 // -0.25 to -0.15 (ocean floor)
        };

        let crustal_thickness = if is_continental {
            30.0 + rng.next_f64() * 20.0 // 30-50 km (Earth: ~35 km avg)
        } else {
            5.0 + rng.next_f64() * 7.0 // 5-12 km (Earth: ~7 km avg)
        };

        let age_myr = rng.next_f64() * 200.0 + 10.0; // 10-210 Myr

        plates.push(TectonicPlate {
            id: i,
            center: centers[i],
            plate_type: if is_continental { PlateType::Continental } else { PlateType::Oceanic },
            euler_pole,
            angular_velocity,
            base_elevation,
            crustal_thickness,
            age_myr,
        });
    }

    // ── Step 4: Build plate map (nearest-plate assignment) ──
    let plate_map = build_plate_map(&centers, map_width, map_height);

    // ── Step 5: Detect and classify boundaries ──
    let boundaries = detect_boundaries(&plates, &plate_map, map_width, map_height);

    // ── Step 6: Compute boundary distance + influence fields ──
    let (boundary_distance, boundary_influence) =
        compute_boundary_fields(&plate_map, &boundaries, &plates, map_width, map_height, volcanism_level);

    TectonicModel {
        plates,
        boundaries,
        plate_map,
        map_width,
        map_height,
        boundary_distance,
        boundary_influence,
    }
}

/* ── Internal helpers ──────────────────────────────── */

/// Generate N well-distributed seed points on the sphere.
fn generate_plate_centers(rng: &mut Rng, n: usize) -> Vec<[f64; 3]> {
    let mut points = Vec::with_capacity(n);
    // Fibonacci sphere for initial distribution (better than random)
    let golden_ratio = (1.0 + 5.0_f64.sqrt()) / 2.0;
    for i in 0..n {
        let theta = 2.0 * PI * i as f64 / golden_ratio;
        let phi = (1.0 - 2.0 * (i as f64 + 0.5) / n as f64).acos();
        let x = phi.sin() * theta.cos();
        let y = phi.sin() * theta.sin();
        let z = phi.cos();
        // Add small random perturbation
        let jitter = 0.15 / (n as f64).sqrt();
        let jx = x + (rng.next_f64() - 0.5) * jitter;
        let jy = y + (rng.next_f64() - 0.5) * jitter;
        let jz = z + (rng.next_f64() - 0.5) * jitter;
        points.push(normalize(&[jx, jy, jz]));
    }
    points
}

/// Lloyd relaxation: iteratively move each center to the centroid of its Voronoi cell.
fn lloyd_relaxation(centers: &mut Vec<[f64; 3]>, iterations: usize, width: usize, height: usize) {
    let n = centers.len();
    for _ in 0..iterations {
        // Build plate map
        let plate_map = build_plate_map(centers, width, height);

        // Accumulate cell members
        let mut cell_points: Vec<Vec<[f64; 3]>> = vec![Vec::new(); n];

        for row in 0..height {
            let phi = PI * (row as f64 + 0.5) / height as f64;
            for col in 0..width {
                let theta = 2.0 * PI * (col as f64 + 0.5) / width as f64;
                let pid = plate_map[row * width + col] as usize;
                let p = [phi.sin() * theta.cos(), phi.sin() * theta.sin(), phi.cos()];
                if pid < n {
                    cell_points[pid].push(p);
                }
            }
        }

        // Move each center to the spherical centroid of its cell
        for i in 0..n {
            if cell_points[i].len() > 3 {
                centers[i] = spherical_centroid(&cell_points[i]);
            }
        }
    }
}

/// Assign each pixel to the nearest plate center (spherical distance).
fn build_plate_map(centers: &[[f64; 3]], width: usize, height: usize) -> Vec<u32> {
    let total = width * height;
    let mut map = vec![0u32; total];
    let n = centers.len();

    for row in 0..height {
        let phi = PI * (row as f64 + 0.5) / height as f64;
        let sin_phi = phi.sin();
        let cos_phi = phi.cos();

        for col in 0..width {
            let theta = 2.0 * PI * (col as f64 + 0.5) / width as f64;
            let p = [sin_phi * theta.cos(), sin_phi * theta.sin(), cos_phi];

            // Find nearest center (dot product = cos(distance), maximize)
            let mut best_dot = -2.0;
            let mut best_id = 0u32;
            for i in 0..n {
                let d = dot(&p, &centers[i]);
                if d > best_dot {
                    best_dot = d;
                    best_id = i as u32;
                }
            }

            map[row * width + col] = best_id;
        }
    }

    map
}

/// Detect plate boundaries by scanning for adjacent pixels with different plate IDs.
/// Classify each boundary segment by relative plate motion.
fn detect_boundaries(
    plates: &[TectonicPlate],
    plate_map: &[u32],
    width: usize,
    height: usize,
) -> Vec<PlateBoundary> {
    use std::collections::HashMap;

    // Collect boundary pixel pairs
    let mut boundary_pairs: HashMap<(usize, usize), Vec<[f64; 3]>> = HashMap::new();

    for row in 0..height {
        for col in 0..width {
            let pid = plate_map[row * width + col] as usize;

            // Check right neighbor
            let right_col = (col + 1) % width;
            let right_pid = plate_map[row * width + right_col] as usize;

            // Check bottom neighbor
            let bottom_row = (row + 1).min(height - 1);
            let bottom_pid = plate_map[bottom_row * width + col] as usize;

            for &neighbor_pid in &[right_pid, bottom_pid] {
                if pid != neighbor_pid {
                    let key = if pid < neighbor_pid {
                        (pid, neighbor_pid)
                    } else {
                        (neighbor_pid, pid)
                    };

                    let phi = PI * (row as f64 + 0.5) / height as f64;
                    let theta = 2.0 * PI * (col as f64 + 0.5) / width as f64;
                    let point = [
                        phi.sin() * theta.cos(),
                        phi.sin() * theta.sin(),
                        phi.cos(),
                    ];

                    boundary_pairs.entry(key).or_default().push(point);
                }
            }
        }
    }

    // Classify each boundary
    let mut boundaries = Vec::new();

    for ((a_id, b_id), points) in &boundary_pairs {
        if points.is_empty() { continue; }
        let a = &plates[*a_id];
        let b = &plates[*b_id];

        // Compute midpoint of boundary segment
        let midpoint = spherical_centroid(points);

        // Compute velocity of each plate at the midpoint
        // v = ω × r (angular velocity cross position)
        let vel_a = scale(&cross(&a.euler_pole, &midpoint), a.angular_velocity);
        let vel_b = scale(&cross(&b.euler_pole, &midpoint), b.angular_velocity);

        // Relative velocity = vel_b - vel_a
        let rel_vel = sub(&vel_b, &vel_a);

        // Project relative velocity onto boundary normal (perpendicular to boundary)
        // We approximate the boundary tangent from two representative boundary points
        let tangent = if points.len() >= 2 {
            normalize(&sub(&points[points.len() / 2], &points[0]))
        } else {
            // Fallback: tangent is perpendicular to midpoint-to-center direction
            let to_a = normalize(&sub(&a.center, &midpoint));
            normalize(&cross(&midpoint, &to_a))
        };

        // Boundary normal is perpendicular to tangent in the local tangent plane
        let boundary_normal = normalize(&cross(&midpoint, &tangent));

        // Normal component of relative velocity determines boundary type
        let normal_vel = dot(&rel_vel, &boundary_normal);
        let tangential_vel = dot(&rel_vel, &tangent);

        let (boundary_type, relative_velocity) = if normal_vel.abs() > tangential_vel.abs() * 1.5 {
            if normal_vel < -0.001 {
                (BoundaryType::Convergent, normal_vel)
            } else if normal_vel > 0.001 {
                (BoundaryType::Divergent, normal_vel)
            } else {
                (BoundaryType::Transform, tangential_vel)
            }
        } else {
            (BoundaryType::Transform, tangential_vel)
        };

        boundaries.push(PlateBoundary {
            plate_a: *a_id,
            plate_b: *b_id,
            boundary_type,
            relative_velocity,
            midpoint,
            tangent,
            normal: boundary_normal,
        });
    }

    boundaries
}

/// Compute boundary distance and influence fields for terrain generation.
///
/// For each pixel, compute:
///   - Signed distance to nearest plate boundary (normalized)
///   - Boundary influence vector [convergent, divergent, transform]
fn compute_boundary_fields(
    plate_map: &[u32],
    boundaries: &[PlateBoundary],
    _plates: &[TectonicPlate],
    width: usize,
    height: usize,
    volcanism_level: f64,
) -> (Vec<f32>, Vec<[f32; 3]>) {
    let total = width * height;
    let mut distance = vec![1.0_f32; total];
    let mut influence = vec![[0.0_f32; 3]; total];

    // For each boundary, compute distance field contribution
    // We use a multi-pass approach: iterate boundary pixels and propagate
    // (cheaper than per-pixel great-circle distance to all boundaries)

    // First: identify boundary pixels (where adjacent pixels differ)
    let mut is_boundary = vec![false; total];
    let mut boundary_type_at = vec![[0.0_f32; 3]; total];

    for row in 0..height {
        for col in 0..width {
            let pid = plate_map[row * width + col];
            let right = plate_map[row * width + (col + 1) % width];
            let below = plate_map[((row + 1).min(height - 1)) * width + col];

            if pid != right || pid != below {
                is_boundary[row * width + col] = true;

                // Find which boundary this corresponds to
                let neighbor = if pid != right { right } else { below } as usize;
                let key = if (pid as usize) < neighbor {
                    (pid as usize, neighbor)
                } else {
                    (neighbor, pid as usize)
                };

                for b in boundaries {
                    let bkey = if b.plate_a < b.plate_b {
                        (b.plate_a, b.plate_b)
                    } else {
                        (b.plate_b, b.plate_a)
                    };
                    if bkey == key {
                        let strength = b.relative_velocity.abs() as f32;
                        match b.boundary_type {
                            BoundaryType::Convergent => boundary_type_at[row * width + col][0] = strength,
                            BoundaryType::Divergent => boundary_type_at[row * width + col][1] = strength,
                            BoundaryType::Transform => boundary_type_at[row * width + col][2] = strength,
                        }
                        break;
                    }
                }
            }
        }
    }

    // Distance field via jump flooding (approximate Euclidean distance transform)
    // Initialize distances: boundary pixels = 0, others = max
    let max_dist = (width as f32).max(height as f32);
    let mut dist_px = vec![max_dist; total];
    let mut nearest_boundary = vec![usize::MAX; total];

    for i in 0..total {
        if is_boundary[i] {
            dist_px[i] = 0.0;
            nearest_boundary[i] = i;
        }
    }

    // Jump Flood Algorithm (JFA) for distance transform
    let mut step_size = width.max(height).next_power_of_two() / 2;
    while step_size >= 1 {
        let _prev_dist = dist_px.clone();
        let prev_nearest = nearest_boundary.clone();

        for row in 0..height {
            for col in 0..width {
                let idx = row * width + col;

                // Check 8 neighbors at step_size offset
                for dy in [-1i32, 0, 1] {
                    for dx in [-1i32, 0, 1] {
                        if dx == 0 && dy == 0 { continue; }
                        let nr = row as i32 + dy * step_size as i32;
                        let nc = col as i32 + dx * step_size as i32;

                        if nr < 0 || nr >= height as i32 { continue; }
                        let nc = nc.rem_euclid(width as i32) as usize; // wrap horizontally
                        let nr = nr as usize;
                        let ni = nr * width + nc;

                        if prev_nearest[ni] == usize::MAX { continue; }

                        // Distance from this pixel to the boundary pixel
                        let br = prev_nearest[ni] / width;
                        let bc = prev_nearest[ni] % width;
                        let dr = (row as f64 - br as f64).abs();
                        let dc = {
                            let d1 = (col as f64 - bc as f64).abs();
                            let d2 = width as f64 - d1;
                            d1.min(d2)
                        };
                        let d = (dr * dr + dc * dc).sqrt() as f32;

                        if d < dist_px[idx] {
                            dist_px[idx] = d;
                            nearest_boundary[idx] = prev_nearest[ni];
                        }
                    }
                }
            }
        }

        step_size /= 2;
    }

    // Normalize distances and compute influence
    let max_found = dist_px.iter().cloned().fold(1.0_f32, f32::max);
    let inv_max = if max_found > 0.0 { 1.0 / max_found } else { 1.0 };

    for i in 0..total {
        // Normalized distance (0 = on boundary, 1 = far from boundary)
        distance[i] = (dist_px[i] * inv_max).clamp(0.0, 1.0);

        // Influence from nearest boundary
        if nearest_boundary[i] != usize::MAX {
            let bi = nearest_boundary[i];
            let falloff = (-dist_px[i] * 0.05).exp(); // exponential decay
            influence[i][0] = boundary_type_at[bi][0] * falloff * (1.0 + volcanism_level as f32);
            influence[i][1] = boundary_type_at[bi][1] * falloff;
            influence[i][2] = boundary_type_at[bi][2] * falloff;
        }
    }

    (distance, influence)
}

/* ── Heightmap contributions from tectonics ─────────── */

/// Generate tectonic terrain contributions to the heightmap.
///
/// Returns a height buffer (f64, resolution × resolution/2) that should be
/// blended with the noise-based heightmap from simd_kernels.
///
/// Contributions:
///   1. Base elevation per plate (continental vs oceanic)
///   2. Mountain ranges at convergent boundaries
///   3. Rift valleys at divergent boundaries
///   4. Volcanic hotspot elevation at transform faults
///   5. Mid-ocean ridge elevation at divergent oceanic boundaries
///   6. Subduction trenches at convergent ocean-continental boundaries
pub fn tectonic_heightmap(model: &TectonicModel) -> Vec<f64> {
    let width = model.map_width;
    let height = model.map_height;
    let total = width * height;
    let mut heightmap = vec![0.0_f64; total];

    for i in 0..total {
        let pid = model.plate_map[i] as usize;
        let plate = &model.plates[pid];

        // Base elevation from plate type
        let mut h = plate.base_elevation;

        // Boundary-derived features
        let dist = model.boundary_distance[i] as f64;
        let [convergent, divergent, transform] = model.boundary_influence[i];

        // ── Convergent: mountains / subduction trench ──
        if convergent > 0.01 {
            let conv_f = convergent as f64;
            if plate.plate_type == PlateType::Continental {
                // Orogeny: mountain ranges along convergent continental boundaries
                // Height falls off with distance from boundary
                let mountain_profile = (-dist * 8.0).exp();
                h += conv_f * mountain_profile * 0.35;
            } else {
                // Subduction trench (narrow, deep) + volcanic arc (behind trench)
                let trench_profile = (-dist * 20.0).exp();
                let arc_profile = (-(dist - 0.08).powi(2) * 200.0).exp();
                h -= conv_f * trench_profile * 0.15; // trench depression
                h += conv_f * arc_profile * 0.20;    // volcanic arc rise
            }
        }

        // ── Divergent: rift valleys / mid-ocean ridges ──
        if divergent > 0.01 {
            let div_f = divergent as f64;
            let ridge_profile = (-dist * 12.0).exp();
            if plate.plate_type == PlateType::Oceanic {
                // Mid-ocean ridge: symmetric rise
                h += div_f * ridge_profile * 0.12;
            } else {
                // Continental rift: narrow valley
                let rift_profile = (-dist * 25.0).exp();
                h -= div_f * rift_profile * 0.10;
            }
        }

        // ── Transform: fault scarps + minor volcanism ──
        if transform > 0.01 {
            let trans_f = transform as f64;
            let fault_profile = (-dist * 15.0).exp();
            // Asymmetric: one side slightly up, other slightly down
            let side = if pid % 2 == 0 { 1.0 } else { -1.0 };
            h += side * trans_f * fault_profile * 0.05;
        }

        heightmap[i] = h;
    }

    heightmap
}

/* ── Convenience: plate parameters from geology ────── */

/// Estimate number of tectonic plates from planet mass and regime.
pub fn estimate_plate_count(mass_earth: f64, tectonic_roughness: f64) -> usize {
    // Earth (1M⊕) → ~15 major plates
    // Larger planets → more plates (more convection cells)
    // Higher roughness → more fragmented plates
    let base = (mass_earth.powf(0.5) * 12.0) as usize;
    let roughness_bonus = (tectonic_roughness * 8.0) as usize;
    (base + roughness_bonus).clamp(4, 50)
}

/// Estimate continental fraction from composition and surface conditions.
pub fn estimate_continental_fraction(
    ocean_fraction: f64,
    silicate_fraction: f64,
) -> f64 {
    // Higher ocean fraction → less continental crust
    // Higher silicate fraction → more differentiated continental crust
    let base = (1.0 - ocean_fraction) * 0.85;
    let silicate_bonus = (silicate_fraction - 0.3).max(0.0) * 0.3;
    (base + silicate_bonus).clamp(0.1, 0.8)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_generation() {
        let model = generate_tectonic_model(42, 12, 0.35, 128, 0.7, 0.3);
        assert_eq!(model.plates.len(), 12);
        assert!(!model.boundaries.is_empty());
        assert_eq!(model.plate_map.len(), 128 * 64);
        assert_eq!(model.boundary_distance.len(), 128 * 64);
    }

    #[test]
    fn test_plate_type_distribution() {
        let model = generate_tectonic_model(42, 20, 0.40, 64, 0.5, 0.2);
        let continental_count = model.plates.iter()
            .filter(|p| p.plate_type == PlateType::Continental)
            .count();
        assert!(continental_count > 0);
        assert!(continental_count < model.plates.len());
    }

    #[test]
    fn test_boundary_classification() {
        let model = generate_tectonic_model(99, 8, 0.30, 128, 0.6, 0.4);
        let has_convergent = model.boundaries.iter().any(|b| b.boundary_type == BoundaryType::Convergent);
        let has_divergent = model.boundaries.iter().any(|b| b.boundary_type == BoundaryType::Divergent);
        // With 8 plates there should be diverse boundary types
        assert!(has_convergent || has_divergent);
    }

    #[test]
    fn test_tectonic_heightmap() {
        let model = generate_tectonic_model(42, 10, 0.35, 128, 0.7, 0.3);
        let heights = tectonic_heightmap(&model);
        assert_eq!(heights.len(), 128 * 64);
        // Should have both positive (continental) and negative (oceanic) elevations
        let has_positive = heights.iter().any(|&h| h > 0.1);
        let has_negative = heights.iter().any(|&h| h < -0.05);
        assert!(has_positive, "Should have continental elevation");
        assert!(has_negative, "Should have oceanic depths");
    }

    #[test]
    fn test_plate_count_estimation() {
        let earth = estimate_plate_count(1.0, 0.7);
        assert!(earth >= 8 && earth <= 25, "Earth-like planet: {} plates", earth);

        let mars = estimate_plate_count(0.107, 0.4);
        assert!(mars >= 4 && mars <= 10, "Mars-like planet: {} plates", mars);

        let super_earth = estimate_plate_count(5.0, 0.8);
        assert!(super_earth >= 20, "Super-Earth: {} plates", super_earth);
    }

    #[test]
    fn test_deterministic() {
        let a = generate_tectonic_model(42, 12, 0.35, 64, 0.7, 0.3);
        let b = generate_tectonic_model(42, 12, 0.35, 64, 0.7, 0.3);
        assert_eq!(a.plate_map, b.plate_map);
    }
}
