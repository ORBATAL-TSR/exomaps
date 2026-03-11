//! Render profile builder.
//!
//! Converts a `WorldBody`'s physical + classification state into a
//! `RenderProfile` that drives the frontend's Three.js / wgpu shaders.
//!
//! Determines:
//!   - Body shape (spheroid, oblate, irregular)
//!   - Terrain generation recipe (noise type, tectonics, craters, bands)
//!   - Material palette (PBR colors per biome/terrain type)
//!   - Atmosphere rendering config (scattering, clouds, thickness)
//!   - Ring system
//!   - Emissive features (lava glow, aurora, city lights)

use super::classification::*;
use super::world_body::*;

// ═══════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════

/// Build a complete render profile from a WorldBody's current state.
pub fn build_render_profile(body: &WorldBody) -> RenderProfile {
    RenderProfile {
        shape: infer_shape(body),
        terrain: build_terrain_recipe(body),
        palette: build_palette(body),
        atmosphere_render: build_atmosphere_render(body),
        ring: build_ring(body),
        emissive: build_emissive(body),
    }
}

// ═══════════════════════════════════════════════════════
// Shape
// ═══════════════════════════════════════════════════════

fn infer_shape(body: &WorldBody) -> BodyShape {
    // Fast-rotating gas giants → oblate
    if body.physical.h_he_fraction > 0.3
        && body.orbit.rotation_period_hours < 15.0
    {
        return BodyShape::Oblate;
    }

    // Very small bodies are irregular
    if body.physical.mass_earth < 0.001 {
        return BodyShape::Irregular;
    }

    // Close to Roche limit → tidally distorted
    // (check if SMA is within 2x Roche limit)
    if body.orbit.sma_au < body.orbit.roche_limit_au * 2.5
        && body.orbit.roche_limit_au > 0.0
    {
        return BodyShape::TidallyDistorted;
    }

    BodyShape::Spheroid
}

// ═══════════════════════════════════════════════════════
// Terrain Recipe
// ═══════════════════════════════════════════════════════

fn build_terrain_recipe(body: &WorldBody) -> TerrainRecipe {
    let cls = &body.classification;

    // Gas giant: band structure, no solid terrain
    if matches!(cls.mass_class, MassClass::GasGiant | MassClass::SuperJovian | MassClass::NeptuneMass | MassClass::SubNeptune) {
        return TerrainRecipe {
            algorithm: "gas_giant_bands".into(),
            detail_level: 10,
            warp_strength: 0.6,
            use_tectonics: false,
            use_craters: false,
            use_volcanism: false,
            use_bands: true,
        };
    }

    // Lava world
    if body.surface.surface_temp_k > 1500.0 {
        return TerrainRecipe {
            algorithm: "fbm_ridged_volcanic".into(),
            detail_level: 10,
            warp_strength: 0.5,
            use_tectonics: true,
            use_craters: false,
            use_volcanism: true,
            use_bands: false,
        };
    }

    // Ice world
    if body.surface.ice_fraction > 0.7 {
        return TerrainRecipe {
            algorithm: "fbm_smooth_ice".into(),
            detail_level: 8,
            warp_strength: 0.2,
            use_tectonics: false,
            use_craters: true,
            use_volcanism: matches!(cls.tectonic_class, TectonicClass::Cryovolcanic),
            use_bands: false,
        };
    }

    // Ocean world
    if body.surface.ocean_fraction > 0.8 {
        return TerrainRecipe {
            algorithm: "fbm_archipelago".into(),
            detail_level: 10,
            warp_strength: 0.3,
            use_tectonics: true,
            use_craters: false,
            use_volcanism: body.surface.volcanism_level > 0.3,
            use_bands: false,
        };
    }

    // Dead airless body (Mercury/Moon analog)
    if body.atmosphere.is_none() && body.surface.ocean_fraction < 0.01 {
        return TerrainRecipe {
            algorithm: "fbm_cratered".into(),
            detail_level: 9,
            warp_strength: 0.15,
            use_tectonics: false,
            use_craters: true,
            use_volcanism: body.surface.volcanism_level > 0.1,
            use_bands: false,
        };
    }

    // Default: Earth-like terrain
    let use_tec = matches!(
        cls.tectonic_class,
        TectonicClass::PlateTectonics | TectonicClass::EpisodicOverturn
    );

    TerrainRecipe {
        algorithm: "fbm_ridged".into(),
        detail_level: 10,
        warp_strength: 0.35,
        use_tectonics: use_tec,
        use_craters: body.surface.crater_density > 0.2,
        use_volcanism: body.surface.volcanism_level > 0.1,
        use_bands: false,
    }
}

// ═══════════════════════════════════════════════════════
// Material Palette
// ═══════════════════════════════════════════════════════

fn build_palette(body: &WorldBody) -> MaterialPalette {
    let mut entries = Vec::new();

    // Use existing surface materials as base
    for mat in &body.surface.materials {
        entries.push(PaletteEntry {
            name: mat.name.clone(),
            color: mat.color,
            roughness: mat.roughness,
            metalness: mat.metalness,
            emissive: if mat.name.contains("Molten") || mat.name.contains("lava") {
                0.8
            } else {
                0.0
            },
            coverage: mat.coverage_fraction,
        });
    }

    // Add type-specific entries
    let cls = &body.classification;

    // Gas giant band colors
    if matches!(cls.mass_class, MassClass::GasGiant | MassClass::SuperJovian) {
        entries.clear();
        match cls.thermal_class {
            ThermalClass::Hot | ThermalClass::Ultrahot => {
                // Hot Jupiter: dark, reddish
                entries.push(PaletteEntry {
                    name: "Dark band".into(),
                    color: [0.15, 0.08, 0.05],
                    roughness: 0.3, metalness: 0.0, emissive: 0.1, coverage: 0.5,
                });
                entries.push(PaletteEntry {
                    name: "Bright band".into(),
                    color: [0.4, 0.15, 0.05],
                    roughness: 0.3, metalness: 0.0, emissive: 0.05, coverage: 0.5,
                });
            }
            ThermalClass::Warm => {
                // Warm Jupiter: brown/tan
                entries.push(PaletteEntry {
                    name: "Zone".into(),
                    color: [0.75, 0.6, 0.4],
                    roughness: 0.2, metalness: 0.0, emissive: 0.0, coverage: 0.5,
                });
                entries.push(PaletteEntry {
                    name: "Belt".into(),
                    color: [0.5, 0.35, 0.2],
                    roughness: 0.25, metalness: 0.0, emissive: 0.0, coverage: 0.5,
                });
            }
            _ => {
                // Cold Jupiter: pale/white stripes
                entries.push(PaletteEntry {
                    name: "Ammonia zone".into(),
                    color: [0.9, 0.85, 0.7],
                    roughness: 0.15, metalness: 0.0, emissive: 0.0, coverage: 0.4,
                });
                entries.push(PaletteEntry {
                    name: "NH₄SH belt".into(),
                    color: [0.6, 0.45, 0.3],
                    roughness: 0.2, metalness: 0.0, emissive: 0.0, coverage: 0.3,
                });
                entries.push(PaletteEntry {
                    name: "Storm".into(),
                    color: [0.8, 0.3, 0.15],
                    roughness: 0.1, metalness: 0.0, emissive: 0.0, coverage: 0.1,
                });
            }
        }
    }

    // Ice giant specific
    if matches!(cls.mass_class, MassClass::NeptuneMass | MassClass::SubNeptune) {
        entries.clear();
        entries.push(PaletteEntry {
            name: "Methane haze".into(),
            color: [0.3, 0.5, 0.7],
            roughness: 0.15, metalness: 0.0, emissive: 0.0, coverage: 0.7,
        });
        entries.push(PaletteEntry {
            name: "Deep cloud".into(),
            color: [0.2, 0.35, 0.55],
            roughness: 0.2, metalness: 0.0, emissive: 0.0, coverage: 0.3,
        });
    }

    // Vegetation
    if body.surface.vegetation_fraction > 0.05 {
        entries.push(PaletteEntry {
            name: "Vegetation".into(),
            color: [0.15, 0.35, 0.1],
            roughness: 0.6,
            metalness: 0.0,
            emissive: 0.0,
            coverage: body.surface.vegetation_fraction as f64,
        });
    }

    MaterialPalette { entries }
}

// ═══════════════════════════════════════════════════════
// Atmosphere Render
// ═══════════════════════════════════════════════════════

fn build_atmosphere_render(body: &WorldBody) -> Option<AtmosphereRenderConfig> {
    let atmo = body.atmosphere.as_ref()?;

    // Thickness relative to planet size
    let thickness = (atmo.scale_height_km * 5.0)
        / (body.physical.radius_earth * 6371.0);
    let thickness = thickness.clamp(0.01, 0.5);

    // Scattering color from optics
    let scatter = if let Some(ref atm) = body.atmosphere {
        atm.optical.zenith_color
    } else {
        [0.4, 0.6, 0.9]
    };

    // Cloud opacity
    let cloud_opacity = if atmo.cloud_decks.is_empty() {
        0.0
    } else {
        let max_od: f64 = atmo.cloud_decks.iter()
            .map(|c| c.optical_depth)
            .fold(0.0, f64::max);
        (max_od / 30.0).min(1.0)
    };

    Some(AtmosphereRenderConfig {
        thickness_fraction: thickness,
        scattering_color: scatter,
        density_falloff: (1.0 / thickness).min(10.0),
        cloud_opacity,
        cloud_layers: atmo.cloud_decks.len() as u32,
    })
}

// ═══════════════════════════════════════════════════════
// Ring System
// ═══════════════════════════════════════════════════════

fn build_ring(body: &WorldBody) -> Option<RingRenderConfig> {
    // Only gas giants / ice giants get rings
    if !matches!(
        body.classification.mass_class,
        MassClass::GasGiant | MassClass::SuperJovian | MassClass::NeptuneMass | MassClass::SubNeptune
    ) {
        return None;
    }

    // Probability-based: ~50% of gas giants get visible rings
    // Use seed for determinism
    let ring_seed = body.seed.wrapping_mul(7919);
    if ring_seed % 2 == 0 {
        return None;
    }

    let inner = 1.2 + (ring_seed % 100) as f64 * 0.005; // 1.2–1.7 planet radii
    let outer = inner + 0.5 + (ring_seed % 200) as f64 * 0.005; // +0.5–1.5

    // Opacity profile (gaps)
    let n_samples = 16;
    let opacity_profile: Vec<f64> = (0..n_samples)
        .map(|i| {
            let r = inner + (outer - inner) * (i as f64 / n_samples as f64);
            let base = 0.5;
            // Create Cassini-division-like gaps
            let gap = ((r * 3.0).sin() * 0.3).abs();
            (base - gap).max(0.05)
        })
        .collect();

    let color = if matches!(body.classification.thermal_class, ThermalClass::Hot | ThermalClass::Ultrahot) {
        [0.6, 0.4, 0.3] // dusty/dark rings for hot bodies
    } else {
        [0.8, 0.75, 0.65] // icy rings
    };

    Some(RingRenderConfig {
        inner_radius: inner,
        outer_radius: outer,
        opacity_profile,
        color,
        tilt_deg: body.orbit.obliquity_deg,
    })
}

// ═══════════════════════════════════════════════════════
// Emissive Features
// ═══════════════════════════════════════════════════════

fn build_emissive(body: &WorldBody) -> EmissiveConfig {
    let cls = &body.classification;

    // Night-side glow: hot tidally locked planets
    let night_glow = body.orbit.is_tidally_locked
        && body.surface.surface_temp_k > 800.0;

    // Lava glow: volcanism + high surface temp
    let lava_glow = body.surface.volcanism_level > 0.4
        && body.surface.surface_temp_k > 600.0;

    // Auroras: magnetic field + stellar wind
    let auroras = body.physical.has_magnetic_field
        && body.star.activity_level > 0.2;

    // City lights: colonized (gameplay state — false by default)
    let city_lights = cls.has_tag(SpecialTag::Colonized);

    // Emissive color
    let color = if lava_glow {
        [0.95, 0.3, 0.05]  // orange-red lava
    } else if night_glow {
        [0.8, 0.2, 0.05]   // dim red thermal glow
    } else if auroras {
        [0.2, 0.8, 0.4]    // green aurora
    } else {
        [0.0, 0.0, 0.0]
    };

    let intensity = if lava_glow {
        body.surface.volcanism_level
    } else if night_glow {
        ((body.surface.surface_temp_k - 800.0) / 2000.0).clamp(0.0, 1.0)
    } else if auroras {
        (body.star.activity_level * 0.5).clamp(0.0, 0.5)
    } else {
        0.0
    };

    EmissiveConfig {
        night_glow,
        lava_glow,
        city_lights,
        auroras,
        emissive_color: color,
        emissive_intensity: intensity,
    }
}
