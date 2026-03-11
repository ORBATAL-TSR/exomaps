//! Procedural formation history generator.
//!
//! Generates a plausible formation narrative for a world body based on
//! its classification, orbital parameters, and stellar context.
//!
//! Formation pathways are assigned probabilistically based on physical
//! constraints:
//!   - Core accretion: default for rocky/icy bodies inside snow line
//!   - Disk instability: massive gas giants far from star
//!   - Giant impact: high density anomalies, stripped mantles
//!   - Capture: high eccentricity, retrograde orbits
//!   - Co-accretion: regular satellites in circumplanetary disk
//!
//! Each pathway seeds a chain of `FormationEvent`s that constitute
//! the body's geological history.

use rand::Rng;
use rand_chacha::ChaCha8Rng;

use super::classification::BodyClass;
use super::world_body::*;

// ═══════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════

/// Generate a complete formation history from body context.
pub fn generate_formation(
    body_class: &BodyClass,
    sma_au: f64,
    mass_earth: f64,
    star_teff: f64,
    age_gyr: f64,
    rng: &mut ChaCha8Rng,
) -> FormationHistory {
    let pathway = select_pathway(body_class, sma_au, mass_earth, rng);
    let events = generate_events(&pathway, body_class, sma_au, mass_earth, star_teff, age_gyr, rng);
    let stage = infer_stage(age_gyr, mass_earth);

    FormationHistory {
        pathway,
        events,
        stage,
        age_gyr,
    }
}

// ═══════════════════════════════════════════════════════
// Pathway Selection
// ═══════════════════════════════════════════════════════

fn select_pathway(
    body_class: &BodyClass,
    sma_au: f64,
    mass_earth: f64,
    rng: &mut ChaCha8Rng,
) -> FormationPathway {
    let roll: f64 = rng.gen();

    match body_class {
        BodyClass::Moon => {
            if roll < 0.3 {
                FormationPathway::Capture
            } else if roll < 0.5 {
                FormationPathway::GiantImpact
            } else if roll < 0.7 {
                FormationPathway::Fission
            } else {
                FormationPathway::CoAccretion
            }
        }
        BodyClass::DwarfPlanet | BodyClass::RingMoonlet => {
            // Small bodies: core accretion at low mass scale
            FormationPathway::CoreAccretion
        }
        BodyClass::RogueBody => {
            if roll < 0.5 {
                FormationPathway::CoreAccretion
            } else {
                FormationPathway::DiskInstability
            }
        }
        BodyClass::BinaryCompanion => {
            if roll < 0.4 {
                FormationPathway::CoAccretion
            } else {
                FormationPathway::Capture
            }
        }
        BodyClass::Planet => {
            // Gas giant
            if mass_earth > 50.0 {
                if sma_au > 10.0 && roll < 0.4 {
                    FormationPathway::DiskInstability
                } else {
                    FormationPathway::CoreAccretion
                }
            }
            // Ice / volatile-rich
            else if sma_au > snow_line_au(1.0) && mass_earth > 5.0 {
                // Beyond snow line, both core accretion and co-accretion viable
                if roll < 0.6 {
                    FormationPathway::CoreAccretion
                } else {
                    FormationPathway::CoAccretion
                }
            }
            // Rocky
            else {
                if roll < 0.7 {
                    FormationPathway::CoreAccretion
                } else if roll < 0.85 {
                    FormationPathway::CoreAccretion
                } else {
                    FormationPathway::GiantImpact
                }
            }
        }
    }
}

/// Approximate snow line for a given stellar luminosity.
fn snow_line_au(luminosity_solar: f64) -> f64 {
    2.7 * luminosity_solar.sqrt()
}

// ═══════════════════════════════════════════════════════
// Event Generation
// ═══════════════════════════════════════════════════════

fn generate_events(
    pathway: &FormationPathway,
    body_class: &BodyClass,
    sma_au: f64,
    mass_earth: f64,
    star_teff: f64,
    age_gyr: f64,
    rng: &mut ChaCha8Rng,
) -> Vec<FormationEvent> {
    let mut events = Vec::new();

    // ── Universal early events ──

    // Disk dissipation (always first)
    events.push(FormationEvent {
        event_type: FormationEventType::DiskDissipation,
        time_gyr: rng.gen_range(0.0..0.01),
        description: "Protoplanetary disk gas begins to dissipate".into(),
    });

    // Accretion (planetesimal growth)
    events.push(FormationEvent {
        event_type: FormationEventType::Accretion,
        time_gyr: rng.gen_range(0.01..0.05),
        description: "Streaming instability concentrates pebbles into planetesimals".into(),
    });

    // ── Pathway-specific events ──

    match pathway {
        FormationPathway::CoreAccretion => {
            events.push(FormationEvent {
                event_type: FormationEventType::Accretion,
                time_gyr: rng.gen_range(0.05..0.2),
                description: "Runaway accretion builds a solid core".into(),
            });

            if mass_earth > 10.0 {
                events.push(FormationEvent {
                    event_type: FormationEventType::Accretion,
                    time_gyr: rng.gen_range(0.1..0.5),
                    description: "Core exceeds critical mass; rapid gas accretion begins".into(),
                });
            }
        }

        FormationPathway::DiskInstability => {
            events.push(FormationEvent {
                event_type: FormationEventType::Accretion,
                time_gyr: rng.gen_range(0.001..0.01),
                description: "Gravitational instability fragments disk into gas clump".into(),
            });

            events.push(FormationEvent {
                event_type: FormationEventType::Accretion,
                time_gyr: rng.gen_range(0.01..0.1),
                description: "Sedimentation of heavy elements forms a central core".into(),
            });
        }

        FormationPathway::GiantImpact => {
            events.push(FormationEvent {
                event_type: FormationEventType::Accretion,
                time_gyr: rng.gen_range(0.05..0.2),
                description: "Initial differentiated body formed via accretion".into(),
            });

            events.push(FormationEvent {
                event_type: FormationEventType::GiantImpact,
                time_gyr: rng.gen_range(0.1..0.5),
                description: "Catastrophic collision with another protoplanet".into(),
            });

            if matches!(body_class, BodyClass::Planet) {
                events.push(FormationEvent {
                    event_type: FormationEventType::GiantImpact,
                    time_gyr: rng.gen_range(0.1..0.5),
                    description: "Impact strips outer mantle, enriching iron-to-rock ratio".into(),
                });
            }
        }

        FormationPathway::Capture => {
            events.push(FormationEvent {
                event_type: FormationEventType::Accretion,
                time_gyr: rng.gen_range(0.1..1.0),
                description: "Body formed in a different orbital region".into(),
            });

            events.push(FormationEvent {
                event_type: FormationEventType::MigrationInward,
                time_gyr: age_gyr * rng.gen_range(0.2..0.6),
                description: "Gravitational capture into current orbit after close encounter".into(),
            });
        }

        FormationPathway::Fission => {
            events.push(FormationEvent {
                event_type: FormationEventType::GiantImpact,
                time_gyr: rng.gen_range(0.05..0.3),
                description: "Parent body disrupted by tidal forces or collision".into(),
            });
        }

        FormationPathway::CoAccretion => {
            events.push(FormationEvent {
                event_type: FormationEventType::Accretion,
                time_gyr: rng.gen_range(0.05..0.2),
                description: "Co-accretion from circumplanetary disk material".into(),
            });
        }

        FormationPathway::Ejected => {
            events.push(FormationEvent {
                event_type: FormationEventType::Accretion,
                time_gyr: rng.gen_range(0.02..0.1),
                description: "Formed via accretion before gravitational ejection".into(),
            });

            events.push(FormationEvent {
                event_type: FormationEventType::MigrationOutward,
                time_gyr: rng.gen_range(0.05..0.3),
                description: "Planet-planet scattering ejects body from system".into(),
            });
        }
    }

    // ── Late common events ──

    // Orbital migration (common for hot planets)
    if sma_au < 0.2 && mass_earth > 1.0 {
        events.push(FormationEvent {
            event_type: FormationEventType::MigrationInward,
            time_gyr: age_gyr * rng.gen_range(0.3..0.7),
            description: "Type I/II migration brings body to close-in orbit".into(),
        });
    }

    // Atmosphere stripping (M-dwarf or close in)
    if star_teff < 3500.0 && sma_au < 0.15 && mass_earth < 5.0 {
        events.push(FormationEvent {
            event_type: FormationEventType::AtmosphereStripping,
            time_gyr: age_gyr * rng.gen_range(0.1..0.5),
            description: "Intense XUV irradiation from young M-dwarf strips primary atmosphere".into(),
        });
    }

    // Late heavy bombardment / outgassing (common early feature)
    if age_gyr > 0.5 {
        events.push(FormationEvent {
            event_type: FormationEventType::OutgassingEpoch,
            time_gyr: rng.gen_range(0.3..0.8),
            description: "Late bombardment triggers volatile outgassing epoch".into(),
        });
    }

    // Tidal capture / locking (close-in or moon)
    if sma_au < 0.1 || matches!(body_class, BodyClass::Moon) {
        events.push(FormationEvent {
            event_type: FormationEventType::TidalCapture,
            time_gyr: age_gyr * rng.gen_range(0.4..0.8),
            description: "Tidal dissipation circularizes orbit and locks rotation".into(),
        });
    }

    // Sort by time (earliest first — lowest time_gyr)
    events.sort_by(|a, b| a.time_gyr.partial_cmp(&b.time_gyr).unwrap());

    events
}

// ═══════════════════════════════════════════════════════
// Evolutionary Stage
// ═══════════════════════════════════════════════════════

fn infer_stage(age_gyr: f64, mass_earth: f64) -> EvolutionaryStage {
    // Larger bodies retain heat longer → stay "active" longer
    let thermal_lifetime = 2.0 + mass_earth.powf(0.4) * 3.0;

    if age_gyr < 0.1 {
        EvolutionaryStage::Forming
    } else if age_gyr < 0.5 {
        EvolutionaryStage::Active
    } else if age_gyr < thermal_lifetime * 0.6 {
        EvolutionaryStage::Mature
    } else if age_gyr < thermal_lifetime {
        EvolutionaryStage::Declining
    } else if age_gyr < thermal_lifetime * 2.0 {
        EvolutionaryStage::Dormant
    } else {
        EvolutionaryStage::Ancient
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::SeedableRng;

    #[test]
    fn test_rocky_planet_formation() {
        let mut rng = ChaCha8Rng::seed_from_u64(42);
        let history = generate_formation(
            &BodyClass::Planet, 1.0, 1.0, 5778.0, 4.6, &mut rng,
        );
        assert!(!history.events.is_empty());
        assert!(matches!(history.stage, EvolutionaryStage::Mature | EvolutionaryStage::Declining));
        // Events should be sorted chronologically
        for w in history.events.windows(2) {
            assert!(w[0].time_gyr <= w[1].time_gyr);
        }
    }

    #[test]
    fn test_gas_giant_formation() {
        let mut rng = ChaCha8Rng::seed_from_u64(99);
        let history = generate_formation(
            &BodyClass::Planet, 5.2, 318.0, 5778.0, 4.6, &mut rng,
        );
        assert!(matches!(
            history.pathway,
            FormationPathway::CoreAccretion | FormationPathway::DiskInstability
        ));
        // Should have accretion events
        assert!(history.events.iter().any(|e|
            matches!(e.event_type, FormationEventType::Accretion)
        ));
    }

    #[test]
    fn test_captured_moon() {
        let mut rng = ChaCha8Rng::seed_from_u64(7);
        let history = generate_formation(
            &BodyClass::Moon, 0.003, 0.001, 5778.0, 4.6, &mut rng,
        );
        assert!(!history.events.is_empty());
    }

    #[test]
    fn test_hot_jupiter_migration() {
        let mut rng = ChaCha8Rng::seed_from_u64(123);
        let history = generate_formation(
            &BodyClass::Planet, 0.05, 300.0, 5778.0, 2.0, &mut rng,
        );
        // Should have migration event
        assert!(history.events.iter().any(|e|
            matches!(e.event_type, FormationEventType::MigrationInward)
        ));
    }
}
