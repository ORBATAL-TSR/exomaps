//! OMICRON Simulation — star catalog generation, K-NN starlane graph, GPU uniforms.

use crate::renderer::scene::{LaneInstance, StarInstance};

// ─── Deterministic RNG (xorshift64 + splitmix finaliser) ─────────────────────

struct Rng { state: u64 }

impl Rng {
    fn seed(s: u64) -> Self {
        let mut z = s.wrapping_add(0x9e3779b97f4a7c15);
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
        z ^= z >> 31;
        Self { state: z.max(1) }
    }

    fn u64(&mut self) -> u64 {
        self.state ^= self.state << 13;
        self.state ^= self.state >> 7;
        self.state ^= self.state << 17;
        self.state
    }

    fn f32(&mut self) -> f32 {
        (self.u64() >> 33) as f32 / 2_147_483_647.0
    }

    fn range(&mut self, lo: f32, hi: f32) -> f32 {
        lo + self.f32() * (hi - lo)
    }

    // Volume-uniform point inside sphere
    fn in_sphere(&mut self, radius: f32) -> [f32; 3] {
        let r   = radius * self.f32().cbrt();
        let u   = 1.0 - 2.0 * self.f32();
        let phi = self.f32() * std::f32::consts::TAU;
        let s   = (1.0_f32 - u * u).max(0.0).sqrt();
        [r * s * phi.cos(), r * u, r * s * phi.sin()]
    }
}

// ─── Stellar spectral type → physical properties ──────────────────────────────
// Frequency distribution matches actual solar neighbourhood IMF.
// Returns (teff_K, luminosity_Lsun, radius_Rsun).

fn stellar_properties(rng: &mut Rng) -> (f32, f32, f32) {
    let roll = rng.f32();

    if roll < 0.005 {
        // O/B — rare, hot, luminous
        let t = rng.range(10_000.0, 35_000.0);
        let l = rng.range(100.0, 50_000.0);
        (t, l, l.powf(0.14) * 2.5)

    } else if roll < 0.025 {
        // A star
        let t = rng.range(7_500.0, 10_000.0);
        let l = rng.range(8.0, 80.0);
        (t, l, l.powf(0.22))

    } else if roll < 0.075 {
        // F star
        let t = rng.range(6_000.0, 7_500.0);
        let l = rng.range(1.5, 8.0);
        (t, l, l.powf(0.25))

    } else if roll < 0.185 {
        // G (solar type)
        let t = rng.range(5_200.0, 6_000.0);
        let l = rng.range(0.5, 2.0);
        (t, l, l.powf(0.27))

    } else if roll < 0.38 {
        // K dwarf
        let t = rng.range(3_900.0, 5_200.0);
        let l = rng.range(0.08, 0.6);
        (t, l, (l.powf(0.3) * 0.8).max(0.5))

    } else {
        // M dwarf — dominates the solar neighbourhood (~62 %)
        let t = rng.range(2_400.0, 3_900.0);
        let l = rng.f32().powf(2.5) * 0.1;
        let r = (l * 12.0).powf(0.4).clamp(0.08, 0.6);
        (t, l.max(0.0001), r)
    }
}

// ─── Catalog generation ───────────────────────────────────────────────────────

/// Build a realistic synthetic stellar catalogue of `n` stars within 15 pc.
/// Deterministic for a given `seed`. Sol is always index 0 at the origin.
pub fn generate_star_catalog(n: usize, seed: u64) -> Vec<StarInstance> {
    let mut rng = Rng::seed(seed);
    let mut stars = Vec::with_capacity(n);

    // Sol — always at origin
    stars.push(StarInstance {
        position:     [0.0, 0.0, 0.0],
        teff:         5778.0,
        luminosity:   1.0,
        radius:       1.0,
        multiplicity: 1.0,
        confidence:   1.0,
        planet_count: 8.0,
        _pad:         [0.0; 3],
    });

    for _ in 1..n {
        let pos              = rng.in_sphere(15.0);
        let (teff, lum, rad) = stellar_properties(&mut rng);

        // Binary / triple fraction ~42 %
        let multi = if rng.f32() < 0.42 {
            if rng.f32() < 0.18 { 3.0 } else { 2.0 }
        } else { 1.0 };

        // Planet host probability — biased toward FGK, rarer elsewhere
        let planet_prob = match teff as u32 {
            5_200..=7_500 => 0.32,
            3_900..=5_199 => 0.18,
            2_400..=3_899 => 0.07,
            _             => 0.06,
        };
        let planets = if rng.f32() < planet_prob {
            (rng.f32() * 6.0 + 1.0).floor()
        } else { 0.0 };

        // Confidence: all bright nearby stars are observed; outer edge has inferred systems
        let dist = (pos[0]*pos[0] + pos[1]*pos[1] + pos[2]*pos[2]).sqrt();
        let conf = if dist < 7.0 {
            if rng.f32() < 0.98 { 1.0 } else { rng.range(0.75, 0.95) }
        } else {
            rng.range(0.45, 0.95) * (1.0 - (dist - 7.0) / 9.0).clamp(0.4, 1.0)
        };

        stars.push(StarInstance {
            position:     pos,
            teff,
            luminosity:   lum,
            radius:       rad,
            multiplicity: multi,
            confidence:   conf.clamp(0.3, 1.0),
            planet_count: planets,
            _pad:         [0.0; 3],
        });
    }

    stars
}

// ─── K-NN starlane graph ──────────────────────────────────────────────────────

/// Build a deduplicated K-nearest-neighbour edge set (K=`k`, max `max_dist_pc` parsecs).
/// Returns lane instances ready for GPU upload.
pub fn build_starlanes(
    stars:       &[StarInstance],
    k:           usize,
    max_dist_pc: f32,
) -> Vec<LaneInstance> {
    let max_sq  = max_dist_pc * max_dist_pc;
    let mut seen: std::collections::HashSet<u64> = Default::default();
    let mut lanes = Vec::new();

    for (i, a) in stars.iter().enumerate() {
        let mut dists: Vec<(f32, usize)> = stars
            .iter()
            .enumerate()
            .filter(|(j, _)| *j != i)
            .map(|(j, b)| {
                let dx = a.position[0] - b.position[0];
                let dy = a.position[1] - b.position[1];
                let dz = a.position[2] - b.position[2];
                (dx*dx + dy*dy + dz*dz, j)
            })
            .collect();

        dists.sort_by(|x, y| x.0.partial_cmp(&y.0).unwrap_or(std::cmp::Ordering::Equal));

        for (dist_sq, j) in dists.iter().take(k) {
            if *dist_sq > max_sq { break; }

            let lo  = i.min(*j) as u64;
            let hi  = i.max(*j) as u64;
            let key = (lo << 32) | hi;

            if seen.insert(key) {
                let b = &stars[*j];
                lanes.push(LaneInstance {
                    pos_a: [a.position[0], a.position[1], a.position[2], 0.0],
                    pos_b: [b.position[0], b.position[1], b.position[2], 0.0],
                });
            }
        }
    }

    lanes
}

// ─── Focus star GPU uniform ───────────────────────────────────────────────────

pub struct StarParams {
    pub temperature: f32,
    pub radius:      f32,
    pub luminosity:  f32,
}

impl StarParams {
    pub fn sol() -> Self {
        Self { temperature: 5778.0, radius: 1.0, luminosity: 1.0 }
    }
}

#[repr(C)]
#[derive(Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
pub struct StarUniform {
    pub color:       [f32; 3],
    pub _pad:        f32,
    pub temperature: f32,
    pub radius:      f32,
    pub luminosity:  f32,
    pub time:        f32,
}

pub fn star_uniform(star: &StarParams, time: f32) -> StarUniform {
    StarUniform {
        temperature: star.temperature,
        radius:      star.radius,
        luminosity:  star.luminosity,
        time,
        color:       blackbody_to_rgb(star.temperature),
        _pad:        0.0,
    }
}

pub fn blackbody_to_rgb(temp: f32) -> [f32; 3] {
    let t = temp.clamp(1_000.0, 40_000.0);
    let (r, g, b) = if t <= 6_600.0 {
        let r = 1.0_f32;
        let g = (0.39008157 * (t / 100.0).ln() - 0.63184144).clamp(0.0, 1.0);
        let b = if t <= 1_900.0 { 0.0 }
                else { (0.54320678 * (t / 100.0 - 10.0).ln() - 1.19625408).clamp(0.0, 1.0) };
        (r, g, b)
    } else {
        let r = (1.29293618 * (t / 100.0 - 60.0).powf(-0.1332047592)).clamp(0.0, 1.0);
        let g = (1.12989086 * (t / 100.0 - 60.0).powf(-0.0755148492)).clamp(0.0, 1.0);
        let b = 1.0_f32;
        (r, g, b)
    };
    [r, g, b]
}

pub struct WorldGen;
impl WorldGen { pub fn new() -> Self { Self } }
