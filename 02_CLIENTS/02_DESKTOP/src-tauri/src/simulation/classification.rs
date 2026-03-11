//! Multi-axis world classification system.
//!
//! Every world body (planet, moon, dwarf, binary companion) receives a
//! `ClassificationBundle` — a set of orthogonal classification axes that
//! together describe the body's nature.  No single enum captures everything;
//! the bundle of tags *is* the identity.
//!
//! Design principles:
//!   - A moon is not a lesser category than a planet — same pipeline, same tags
//!   - Classification is *inferred* from physical state, not assigned a-priori
//!   - Multiple axes can overlap (e.g. a body can be both "ocean" and "tectonic")
//!   - Special tags capture emergent "interesting-ness" for gameplay/narrative
//!
//! Axes:
//!   1. BodyClass       — planet / moon / dwarf / ring-moonlet / binary companion
//!   2. DynamicalClass  — orbital context (regular, irregular, trojan, co-orbital…)
//!   3. MassClass       — mass regime (sub-earth, earth-mass, super-earth, sub-neptune…)
//!   4. CompositionClass — dominant material (iron, silicate, volatile, gas, mixed…)
//!   5. AtmosphereClass — atmosphere state (none, tenuous, thin, moderate, thick, runaway…)
//!   6. ThermalClass    — thermal regime (frozen, cryogenic, temperate, warm, molten…)
//!   7. HydrosphereClass — surface volatile state (dry, arid, lacustrine, ocean…)
//!   8. TectonicClass   — tectonic/geologic mode
//!   9. HabitabilityClass — habitability potential
//!  10. SpecialTag      — emergent/narrative tags (set of zero or more)
//!
//! References:
//!   - IAU Working Group on Extrasolar Planets (2003)
//!   - Kopparapu et al. (2018) — "Exoplanet Classification and Habitability"
//!   - Lammer et al. (2009) — "What makes a planet habitable?"
//!   - Catling & Kasting (2017) — "Atmospheric Evolution on Inhabited and
//!     Lifeless Worlds"

use serde::{Deserialize, Serialize};

// ═══════════════════════════════════════════════════════
// Axis 1 — Body Class
// ═══════════════════════════════════════════════════════

/// What kind of body is this in the hierarchy of its system?
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum BodyClass {
    /// Orbits a star directly
    Planet,
    /// Orbits a planet
    Moon,
    /// Dwarf planet / minor body (cleared-orbit criterion not met)
    DwarfPlanet,
    /// Tiny moonlet embedded in a ring system
    RingMoonlet,
    /// One half of a binary/co-orbiting pair (Pluto-Charon style)
    BinaryCompanion,
    /// Free-floating (rogue) body not bound to any star
    RogueBody,
}

// ═══════════════════════════════════════════════════════
// Axis 2 — Dynamical Class
// ═══════════════════════════════════════════════════════

/// Orbital dynamical context.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum DynamicalClass {
    /// Prograde, low-inclination, near-circular orbit
    Regular,
    /// Captured body — high inclination, often retrograde
    Irregular,
    /// In a Lagrange point (L4/L5) of a larger body
    Trojan,
    /// Shares an orbit with another body (horseshoe/tadpole)
    CoOrbital,
    /// Locked in spin-orbit resonance (e.g. tidally locked)
    TidallyLocked,
    /// In mean-motion resonance chain (e.g. Galilean moons, TRAPPIST-1)
    ResonantChain,
    /// Highly eccentric orbit (e > 0.4)
    HighlyEccentric,
    /// Retrograde orbit around parent
    Retrograde,
    /// Circumbinary — orbits both stars of a binary pair
    Circumbinary,
}

// ═══════════════════════════════════════════════════════
// Axis 3 — Mass Class
// ═══════════════════════════════════════════════════════

/// Mass regime — determines which physics dominate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum MassClass {
    /// < 0.01 M⊕ — asteroid/dwarf planet scale
    Asteroidal,
    /// 0.01–0.1 M⊕ — Ceres to Mars
    SubTerran,
    /// 0.1–0.5 M⊕ — Mars to sub-Earth
    Terran,
    /// 0.5–2.0 M⊕ — Earth-class
    SuperTerran,
    /// 2.0–10 M⊕ — super-Earth to mini-Neptune transition
    SuperEarth,
    /// 10–50 M⊕ — Neptune-class (substantial gas envelope)
    SubNeptune,
    /// 50–300 M⊕ (~0.15–1 Mj) — ice/gas giant
    NeptuneMass,
    /// 300–4000 M⊕ (~1–13 Mj) — gas giant
    GasGiant,
    /// > 4000 M⊕ (~13 Mj) — brown dwarf territory
    SuperJovian,
}

impl MassClass {
    /// Infer mass class from mass in Earth masses.
    pub fn from_mass(mass_earth: f64) -> Self {
        match mass_earth {
            m if m < 0.01 => MassClass::Asteroidal,
            m if m < 0.1 => MassClass::SubTerran,
            m if m < 0.5 => MassClass::Terran,
            m if m < 2.0 => MassClass::SuperTerran,
            m if m < 10.0 => MassClass::SuperEarth,
            m if m < 50.0 => MassClass::SubNeptune,
            m if m < 300.0 => MassClass::NeptuneMass,
            m if m < 4000.0 => MassClass::GasGiant,
            _ => MassClass::SuperJovian,
        }
    }
}

// ═══════════════════════════════════════════════════════
// Axis 4 — Composition Class
// ═══════════════════════════════════════════════════════

/// Dominant composition / material category.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum CompositionClass {
    /// > 60% iron by mass (Mercury analog)
    IronDominated,
    /// > 50% silicate, < 60% iron (Earth-like rocky)
    Silicate,
    /// Significant volatile fraction (> 25% H₂O/ice)
    WaterIce,
    /// Carbon-rich: graphite, diamond, carbides, tar
    Carbonaceous,
    /// Substantial H/He envelope but rocky/icy core
    GasRich,
    /// Dominated by H/He ≫ metals
    HydrogenHelium,
    /// Ambiguous / mixed — no single component dominates clearly
    Mixed,
}

impl CompositionClass {
    /// Infer from bulk composition fractions.
    pub fn from_fractions(iron: f64, silicate: f64, volatile: f64, h_he: f64) -> Self {
        if h_he > 0.5 {
            CompositionClass::HydrogenHelium
        } else if h_he > 0.15 {
            CompositionClass::GasRich
        } else if iron > 0.6 {
            CompositionClass::IronDominated
        } else if volatile > 0.25 {
            CompositionClass::WaterIce
        } else if silicate > 0.5 {
            CompositionClass::Silicate
        } else {
            CompositionClass::Mixed
        }
    }
}

// ═══════════════════════════════════════════════════════
// Axis 5 — Atmosphere Class
// ═══════════════════════════════════════════════════════

/// Atmospheric state classification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum AtmosphereClass {
    /// No detectable atmosphere (< 10⁻⁹ bar) — airless body
    None,
    /// Exosphere only (10⁻⁹ – 10⁻⁶ bar) — Mercury-like
    Exospheric,
    /// Tenuous (10⁻⁶ – 10⁻³ bar) — Mars-like
    Tenuous,
    /// Thin (10⁻³ – 0.3 bar) — early Mars, large moons
    Thin,
    /// Moderate (0.3 – 3 bar) — Earth-like
    Moderate,
    /// Thick (3 – 100 bar) — Venus-class
    Thick,
    /// Crushing (100 – 10⁴ bar) — super-Venus, sub-Neptune
    Crushing,
    /// Envelope (> 10⁴ bar on the "surface") — gas/ice giant
    Envelope,
    /// Runaway greenhouse state
    RunawayGreenhouse,
    /// Steam atmosphere (magma ocean phase, post-impact)
    SteamAtmosphere,
    /// Primarily stripped — remnant after XUV erosion
    Stripped,
}

impl AtmosphereClass {
    /// Infer from surface pressure in bar.
    pub fn from_pressure(pressure_bar: f64, is_stripped: bool, is_runaway: bool) -> Self {
        if is_stripped {
            return AtmosphereClass::Stripped;
        }
        if is_runaway {
            return AtmosphereClass::RunawayGreenhouse;
        }
        match pressure_bar {
            p if p < 1e-9 => AtmosphereClass::None,
            p if p < 1e-6 => AtmosphereClass::Exospheric,
            p if p < 1e-3 => AtmosphereClass::Tenuous,
            p if p < 0.3 => AtmosphereClass::Thin,
            p if p < 3.0 => AtmosphereClass::Moderate,
            p if p < 100.0 => AtmosphereClass::Thick,
            p if p < 1e4 => AtmosphereClass::Crushing,
            _ => AtmosphereClass::Envelope,
        }
    }
}

// ═══════════════════════════════════════════════════════
// Axis 6 — Thermal Class
// ═══════════════════════════════════════════════════════

/// Surface/effective temperature regime.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ThermalClass {
    /// < 50 K — outer Kuiper belt objects
    Hyperfrozen,
    /// 50–120 K — Pluto, Titan, Triton
    Cryogenic,
    /// 120–200 K — Mars-like, outer HZ
    Frozen,
    /// 200–260 K — marginally habitable cold
    Cold,
    /// 260–320 K — temperate (HZ sweet spot)
    Temperate,
    /// 320–500 K — inner HZ, greenhouse warming
    Warm,
    /// 500–1000 K — hot rocky worlds, moderate hot Jupiters
    Hot,
    /// 1000–2500 K — lava worlds, ultra-hot Jupiters
    Scorching,
    /// > 2500 K — silicate vapor, nearly stellar
    Ultrahot,
}

impl ThermalClass {
    /// Infer from surface/effective temperature in Kelvin.
    pub fn from_temperature(temp_k: f64) -> Self {
        match temp_k {
            t if t < 50.0 => ThermalClass::Hyperfrozen,
            t if t < 120.0 => ThermalClass::Cryogenic,
            t if t < 200.0 => ThermalClass::Frozen,
            t if t < 260.0 => ThermalClass::Cold,
            t if t < 320.0 => ThermalClass::Temperate,
            t if t < 500.0 => ThermalClass::Warm,
            t if t < 1000.0 => ThermalClass::Hot,
            t if t < 2500.0 => ThermalClass::Scorching,
            _ => ThermalClass::Ultrahot,
        }
    }
}

// ═══════════════════════════════════════════════════════
// Axis 7 — Hydrosphere Class
// ═══════════════════════════════════════════════════════

/// Surface volatile / liquid state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum HydrosphereClass {
    /// No surface volatiles at all
    Desiccated,
    /// Trace moisture, no standing liquid
    Arid,
    /// Small lakes or seasonal flows (< 10% coverage)
    Lacustrine,
    /// Moderate ocean coverage (10–60%)
    PartialOcean,
    /// Dominant ocean (60–95% coverage), some land
    OceanWorld,
    /// No exposed land (> 95% ocean)
    Pelagic,
    /// Deep global ocean (100+ km deep, high-pressure ice floor)
    AbyssalOcean,
    /// Subsurface ocean under ice shell (Europa/Enceladus analog)
    SubsurfaceOcean,
    /// Hydrocarbon lakes (methane/ethane — Titan analog)
    HydrocarbonSeas,
    /// Supercritical fluid ocean (high-P, high-T water or CO₂)
    SupercriticalFluid,
    /// Global ice shell, no liquid
    GlobalIce,
    /// Lava ocean on the surface
    LavaOcean,
}

impl HydrosphereClass {
    /// Infer from ocean fraction, ice fraction, surface conditions.
    pub fn from_surface(
        ocean_frac: f64,
        ice_frac: f64,
        surface_temp_k: f64,
        surface_pressure_bar: f64,
        volatile_frac: f64,
    ) -> Self {
        // Lava ocean
        if surface_temp_k > 1500.0 {
            return HydrosphereClass::LavaOcean;
        }
        // Supercritical
        if surface_temp_k > 647.0 && surface_pressure_bar > 220.0 && volatile_frac > 0.1 {
            return HydrosphereClass::SupercriticalFluid;
        }
        // Hydrocarbon seas (Titan analog: 90-120K, methane liquid)
        if surface_temp_k > 85.0 && surface_temp_k < 130.0 && volatile_frac > 0.1 {
            return HydrosphereClass::HydrocarbonSeas;
        }
        // Subsurface ocean (frozen surface but internal heat + volatiles)
        if surface_temp_k < 200.0 && ice_frac > 0.5 && volatile_frac > 0.15 {
            return HydrosphereClass::SubsurfaceOcean;
        }
        // Global ice
        if ice_frac > 0.9 {
            return HydrosphereClass::GlobalIce;
        }
        // Abyssal ocean (water-rich + liquid)
        if ocean_frac > 0.95 && volatile_frac > 0.4 {
            return HydrosphereClass::AbyssalOcean;
        }
        // Pelagic
        if ocean_frac > 0.95 {
            return HydrosphereClass::Pelagic;
        }
        // Ocean world
        if ocean_frac > 0.60 {
            return HydrosphereClass::OceanWorld;
        }
        // Partial ocean
        if ocean_frac > 0.10 {
            return HydrosphereClass::PartialOcean;
        }
        // Lacustrine
        if ocean_frac > 0.01 {
            return HydrosphereClass::Lacustrine;
        }
        // Arid
        if volatile_frac > 0.01 && surface_pressure_bar > 0.001 {
            return HydrosphereClass::Arid;
        }
        HydrosphereClass::Desiccated
    }
}

// ═══════════════════════════════════════════════════════
// Axis 8 — Tectonic Class
// ═══════════════════════════════════════════════════════

/// Tectonic / geologic activity mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum TectonicClass {
    /// No detectable geological activity — dead body
    Inert,
    /// Stagnant lid convection (one-plate planet, Mars/Venus-like)
    StagnantLid,
    /// Episodic overturn (catastrophic resurfacing cycles, Venus model)
    EpisodicOverturn,
    /// Mobile lid / plate tectonics (Earth-like)
    PlateTectonics,
    /// Heat-pipe volcanism (Io analog — dominated by tidal heating)
    HeatPipe,
    /// Cryovolcanism (icy body with subsurface activity)
    Cryovolcanic,
    /// Magma ocean surface (lava world, newly formed)
    MagmaOcean,
    /// Differentiated but geologically quiescent (large icy body)
    Quiescent,
}

impl TectonicClass {
    /// Infer from existing geology regime + special conditions.
    pub fn from_geology(
        regime: &super::geology::TectonicRegime,
        surface_temp_k: f64,
        tidal_heating_w_m2: f64,
        is_icy: bool,
    ) -> Self {
        // Magma ocean
        if surface_temp_k > 1500.0 {
            return TectonicClass::MagmaOcean;
        }
        // Heat-pipe volcanism (Io: high tidal heating)
        if tidal_heating_w_m2 > 2.0 {
            return TectonicClass::HeatPipe;
        }
        // Cryovolcanic
        if is_icy && tidal_heating_w_m2 > 0.01 {
            return TectonicClass::Cryovolcanic;
        }
        // Map from existing geology regime
        match regime {
            super::geology::TectonicRegime::MobileLid => TectonicClass::PlateTectonics,
            super::geology::TectonicRegime::Episodic => TectonicClass::EpisodicOverturn,
            super::geology::TectonicRegime::StagnantLid => TectonicClass::StagnantLid,
            super::geology::TectonicRegime::None => {
                if is_icy {
                    TectonicClass::Quiescent
                } else {
                    TectonicClass::Inert
                }
            }
        }
    }
}

// ═══════════════════════════════════════════════════════
// Axis 9 — Habitability Class
// ═══════════════════════════════════════════════════════

/// Habitability potential for colonization and life.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum HabitabilityClass {
    /// Effectively uninhabitable — no known pathway to life
    Sterile,
    /// Extreme environment but marginally possible (extremophile territory)
    Extremophile,
    /// Habitable subsurface only (ice shell ocean, lava tube biosphere)
    SubsurfaceHabitable,
    /// Surface habitable with significant engineering (terraforming candidate)
    ConditionallyHabitable,
    /// Surface habitable in the HZ with liquid water
    Habitable,
    /// Optimal conditions — deep HZ, moderate atmosphere, plate tectonics
    OptimallyHabitable,
    /// Pre-biotic chemistry likely but not yet proven
    Prebiotic,
}

impl HabitabilityClass {
    /// Infer from thermal, atmosphere, hydrosphere and tectonic classifications.
    pub fn infer(
        thermal: &ThermalClass,
        atm: &AtmosphereClass,
        hydro: &HydrosphereClass,
        tectonic: &TectonicClass,
        in_hz: bool,
    ) -> Self {
        // Gas giants / magma oceans / ultra-hot → sterile
        if matches!(thermal, ThermalClass::Ultrahot | ThermalClass::Scorching)
            || matches!(tectonic, TectonicClass::MagmaOcean)
            || matches!(atm, AtmosphereClass::Envelope)
        {
            return HabitabilityClass::Sterile;
        }

        // Subsurface ocean → subsurface habitable
        if matches!(hydro, HydrosphereClass::SubsurfaceOcean) {
            return HabitabilityClass::SubsurfaceHabitable;
        }

        // Cryogenic / hyperfrozen with no subsurface → sterile
        if matches!(thermal, ThermalClass::Hyperfrozen | ThermalClass::Cryogenic)
            && !matches!(hydro, HydrosphereClass::SubsurfaceOcean)
        {
            return HabitabilityClass::Sterile;
        }

        // No atmosphere and temperate → conditional
        if matches!(atm, AtmosphereClass::None | AtmosphereClass::Exospheric) {
            return HabitabilityClass::Extremophile;
        }

        // In HZ + liquid water
        if in_hz
            && matches!(
                thermal,
                ThermalClass::Cold | ThermalClass::Temperate | ThermalClass::Warm
            )
        {
            // Has surface water?
            let has_water = matches!(
                hydro,
                HydrosphereClass::PartialOcean
                    | HydrosphereClass::OceanWorld
                    | HydrosphereClass::Pelagic
                    | HydrosphereClass::Lacustrine
            );

            if has_water {
                // Plate tectonics = carbon cycle = optimal
                if matches!(tectonic, TectonicClass::PlateTectonics) {
                    return HabitabilityClass::OptimallyHabitable;
                }
                return HabitabilityClass::Habitable;
            }

            // In HZ but dry → conditional
            return HabitabilityClass::ConditionallyHabitable;
        }

        // Warm with some volatiles → prebiotic chemistry possible
        if matches!(thermal, ThermalClass::Warm)
            && !matches!(
                hydro,
                HydrosphereClass::Desiccated | HydrosphereClass::LavaOcean
            )
        {
            return HabitabilityClass::Prebiotic;
        }

        // Frozen with some volatiles → extremophile
        if matches!(thermal, ThermalClass::Frozen | ThermalClass::Cold)
            && matches!(
                atm,
                AtmosphereClass::Tenuous | AtmosphereClass::Thin | AtmosphereClass::Moderate
            )
        {
            return HabitabilityClass::Extremophile;
        }

        HabitabilityClass::Sterile
    }
}

// ═══════════════════════════════════════════════════════
// Axis 10 — Special Tags (emergent / narrative)
// ═══════════════════════════════════════════════════════

/// Emergent tags that flag interesting or rare properties.
/// A body may have zero or many of these.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum SpecialTag {
    // ── Formation / history ──
    /// Recent giant impact event (asymmetric terrain, debris ring)
    GiantImpact,
    /// Captured body (irregular orbit, retrograde, compositional mismatch)
    Captured,
    /// Migrated from a different orbital zone
    MigratedInward,
    MigratedOutward,
    /// In a resonance chain (Laplace, etc.)
    ResonanceChain,

    // ── Atmosphere ──
    /// Atmosphere partially stripped by stellar XUV
    AtmosphereStripped,
    /// Active atmospheric escape (ongoing mass loss)
    ActiveEscape,
    /// Volcanic outgassing significantly altering atmosphere
    OutgassingDriven,
    /// Thick photochemical haze layer (Titan analog)
    PhotochemicalHaze,
    /// Atmospheric super-rotation (Venus-like)
    SuperRotation,

    // ── Surface / interior ──
    /// Tidally heated (Io analog)
    TidallyHeated,
    /// Magnetic field detected/likely
    MagneticField,
    /// No magnetic field (stripped protection)
    NoMagneticField,
    /// Active cryovolcanism
    Cryovolcanism,
    /// Subsurface lava tube network
    LavaTubeNetwork,
    /// Subsurface ice cavern network
    IceCavernNetwork,
    /// Brine pocket network under surface
    BrinePockets,
    /// Ring system present
    RingSystem,
    /// Shepherd moon for a ring
    ShepherdMoon,

    // ── Exotic ──
    /// Eyeball planet (tidally locked with one habitable hemisphere)
    EyeballPlanet,
    /// Terminator habitability (thin habitable strip)
    TerminatorZone,
    /// Carbon planet (diamond/graphite interior)
    CarbonWorld,
    /// Iron planet (Mercury-like, oversized core)
    IronWorld,
    /// Helium-rain interior (gas giant)
    HeliumRain,
    /// Metallic hydrogen core
    MetallicHydrogen,
    /// Pluto-Charon style co-orbiting binary
    BinaryPair,
    /// Roche-limit close — being tidally deformed
    TidallyDistorted,

    // ── Gameplay / colonization ──
    /// Exceptional resource deposits
    ResourceRich,
    /// Strategic location (chokepoint, relay, HZ sweet spot)
    StrategicLocation,
    /// Settlement already established (campaign state)
    Colonized,
    /// Terraforming candidate
    TerraformCandidate,
    /// Anomalous readings (mystery / quest hook)
    Anomalous,
}

// ═══════════════════════════════════════════════════════
// Classification Bundle
// ═══════════════════════════════════════════════════════

/// The complete multi-axis classification of a world body.
/// This bundle *is* the body's identity — the combination of tags
/// determines gameplay, rendering, and narrative.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassificationBundle {
    pub body_class: BodyClass,
    pub dynamical_class: DynamicalClass,
    pub mass_class: MassClass,
    pub composition_class: CompositionClass,
    pub atmosphere_class: AtmosphereClass,
    pub thermal_class: ThermalClass,
    pub hydrosphere_class: HydrosphereClass,
    pub tectonic_class: TectonicClass,
    pub habitability_class: HabitabilityClass,
    pub special_tags: Vec<SpecialTag>,
}

impl ClassificationBundle {
    /// Build a classification bundle from physical state.
    /// This is the primary entry point — all axes are inferred.
    pub fn classify(params: &ClassificationInput) -> Self {
        let mass_class = MassClass::from_mass(params.mass_earth);
        let composition_class = CompositionClass::from_fractions(
            params.iron_fraction,
            params.silicate_fraction,
            params.volatile_fraction,
            params.h_he_fraction,
        );
        let atmosphere_class = AtmosphereClass::from_pressure(
            params.surface_pressure_bar,
            params.is_atmosphere_stripped,
            params.is_runaway_greenhouse,
        );
        let thermal_class = ThermalClass::from_temperature(params.surface_temp_k);
        let hydrosphere_class = HydrosphereClass::from_surface(
            params.ocean_fraction,
            params.ice_fraction,
            params.surface_temp_k,
            params.surface_pressure_bar,
            params.volatile_fraction,
        );
        let tectonic_class = TectonicClass::from_geology(
            &params.tectonic_regime,
            params.surface_temp_k,
            params.tidal_heating_w_m2,
            params.volatile_fraction > 0.25,
        );
        let habitability_class = HabitabilityClass::infer(
            &thermal_class,
            &atmosphere_class,
            &hydrosphere_class,
            &tectonic_class,
            params.in_habitable_zone,
        );

        // Infer special tags
        let special_tags = infer_special_tags(params, &ClassificationBundle {
            body_class: params.body_class,
            dynamical_class: params.dynamical_class,
            mass_class,
            composition_class,
            atmosphere_class,
            thermal_class,
            hydrosphere_class,
            tectonic_class,
            habitability_class,
            special_tags: vec![],
        });

        ClassificationBundle {
            body_class: params.body_class,
            dynamical_class: params.dynamical_class,
            mass_class,
            composition_class,
            atmosphere_class,
            thermal_class,
            hydrosphere_class,
            tectonic_class,
            habitability_class,
            special_tags,
        }
    }

    /// Check whether this body has a specific special tag.
    pub fn has_tag(&self, tag: SpecialTag) -> bool {
        self.special_tags.contains(&tag)
    }

    /// Short human-readable label for the classification.
    pub fn label(&self) -> String {
        format!(
            "{:?} {:?} {:?} {:?}",
            self.thermal_class,
            self.composition_class,
            self.atmosphere_class,
            self.body_class,
        )
    }
}

// ═══════════════════════════════════════════════════════
// Classification Input
// ═══════════════════════════════════════════════════════

/// All parameters needed to classify a world body.
#[derive(Debug, Clone)]
pub struct ClassificationInput {
    // Identity
    pub body_class: BodyClass,
    pub dynamical_class: DynamicalClass,

    // Physical
    pub mass_earth: f64,
    pub radius_earth: f64,
    pub surface_temp_k: f64,
    pub surface_pressure_bar: f64,

    // Composition fractions
    pub iron_fraction: f64,
    pub silicate_fraction: f64,
    pub volatile_fraction: f64,
    pub h_he_fraction: f64,

    // Surface state
    pub ocean_fraction: f64,
    pub ice_fraction: f64,

    // Geology
    pub tectonic_regime: super::geology::TectonicRegime,
    pub volcanism_level: f64,

    // Flags
    pub in_habitable_zone: bool,
    pub is_atmosphere_stripped: bool,
    pub is_runaway_greenhouse: bool,
    pub tidal_heating_w_m2: f64,
    pub has_magnetic_field: bool,
    pub eccentricity: f64,
    pub age_gyr: f64,
    pub star_teff: f64,
}

// ═══════════════════════════════════════════════════════
// Special Tag Inference
// ═══════════════════════════════════════════════════════

/// Infer special tags from physical state and classification.
fn infer_special_tags(
    params: &ClassificationInput,
    bundle: &ClassificationBundle,
) -> Vec<SpecialTag> {
    let mut tags = Vec::new();

    // Atmosphere stripping
    if params.is_atmosphere_stripped {
        tags.push(SpecialTag::AtmosphereStripped);
    }

    // Magnetic field
    if params.has_magnetic_field {
        tags.push(SpecialTag::MagneticField);
    } else if params.mass_earth > 0.1 {
        // Non-trivial body without magnetic protection
        tags.push(SpecialTag::NoMagneticField);
    }

    // Tidal heating (Io analog)
    if params.tidal_heating_w_m2 > 1.0 {
        tags.push(SpecialTag::TidallyHeated);
    }

    // Cryovolcanism
    if matches!(bundle.tectonic_class, TectonicClass::Cryovolcanic) {
        tags.push(SpecialTag::Cryovolcanism);
    }

    // Eyeball planet (tidally locked + temperate zone)
    if matches!(bundle.dynamical_class, DynamicalClass::TidallyLocked)
        && matches!(
            bundle.thermal_class,
            ThermalClass::Temperate | ThermalClass::Cold | ThermalClass::Warm
        )
    {
        tags.push(SpecialTag::EyeballPlanet);
    }

    // Terminator zone habitability
    if matches!(bundle.dynamical_class, DynamicalClass::TidallyLocked)
        && matches!(bundle.thermal_class, ThermalClass::Hot | ThermalClass::Warm)
        && params.in_habitable_zone
    {
        tags.push(SpecialTag::TerminatorZone);
    }

    // Carbon world
    if matches!(bundle.composition_class, CompositionClass::Carbonaceous) {
        tags.push(SpecialTag::CarbonWorld);
    }

    // Iron world (Mercury analog)
    if matches!(bundle.composition_class, CompositionClass::IronDominated) {
        tags.push(SpecialTag::IronWorld);
    }

    // Outgassing-driven atmosphere
    if params.volcanism_level > 0.5
        && matches!(
            bundle.atmosphere_class,
            AtmosphereClass::Tenuous | AtmosphereClass::Thin | AtmosphereClass::Moderate
        )
    {
        tags.push(SpecialTag::OutgassingDriven);
    }

    // Resonance chain
    if matches!(bundle.dynamical_class, DynamicalClass::ResonantChain) {
        tags.push(SpecialTag::ResonanceChain);
    }

    // Highly eccentric → captured?
    if params.eccentricity > 0.5 {
        tags.push(SpecialTag::Captured);
    }

    // Super-rotation (hot thick atmosphere + tidal locking)
    if matches!(bundle.dynamical_class, DynamicalClass::TidallyLocked)
        && matches!(
            bundle.atmosphere_class,
            AtmosphereClass::Thick | AtmosphereClass::Crushing
        )
    {
        tags.push(SpecialTag::SuperRotation);
    }

    // Terraforming candidate
    if matches!(
        bundle.habitability_class,
        HabitabilityClass::ConditionallyHabitable
    ) && matches!(
        bundle.atmosphere_class,
        AtmosphereClass::Thin | AtmosphereClass::Tenuous | AtmosphereClass::Moderate
    ) {
        tags.push(SpecialTag::TerraformCandidate);
    }

    // Metallic hydrogen (massive gas giant interior)
    if matches!(bundle.mass_class, MassClass::GasGiant | MassClass::SuperJovian) {
        tags.push(SpecialTag::MetallicHydrogen);
    }

    // Helium rain (Saturn-class)
    if matches!(bundle.mass_class, MassClass::GasGiant)
        && matches!(bundle.composition_class, CompositionClass::HydrogenHelium)
    {
        tags.push(SpecialTag::HeliumRain);
    }

    // M-dwarf flare star context → if close in, likely stripped
    if params.star_teff < 3500.0 && params.mass_earth < 5.0 {
        // M-dwarf hosts → photochemical hazes are common
        if matches!(
            bundle.atmosphere_class,
            AtmosphereClass::Thin | AtmosphereClass::Moderate | AtmosphereClass::Thick
        ) {
            tags.push(SpecialTag::PhotochemicalHaze);
        }
    }

    tags
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::simulation::geology::TectonicRegime;

    fn earth_input() -> ClassificationInput {
        ClassificationInput {
            body_class: BodyClass::Planet,
            dynamical_class: DynamicalClass::Regular,
            mass_earth: 1.0,
            radius_earth: 1.0,
            surface_temp_k: 288.0,
            surface_pressure_bar: 1.013,
            iron_fraction: 0.32,
            silicate_fraction: 0.50,
            volatile_fraction: 0.15,
            h_he_fraction: 0.0,
            ocean_fraction: 0.71,
            ice_fraction: 0.03,
            tectonic_regime: TectonicRegime::MobileLid,
            volcanism_level: 0.3,
            in_habitable_zone: true,
            is_atmosphere_stripped: false,
            is_runaway_greenhouse: false,
            tidal_heating_w_m2: 0.0,
            has_magnetic_field: true,
            eccentricity: 0.017,
            age_gyr: 4.6,
            star_teff: 5778.0,
        }
    }

    #[test]
    fn test_earth_classification() {
        let bundle = ClassificationBundle::classify(&earth_input());
        assert_eq!(bundle.mass_class, MassClass::SuperTerran);
        assert_eq!(bundle.composition_class, CompositionClass::Silicate);
        assert_eq!(bundle.atmosphere_class, AtmosphereClass::Moderate);
        assert_eq!(bundle.thermal_class, ThermalClass::Temperate);
        assert_eq!(bundle.hydrosphere_class, HydrosphereClass::OceanWorld);
        assert_eq!(bundle.tectonic_class, TectonicClass::PlateTectonics);
        assert_eq!(bundle.habitability_class, HabitabilityClass::OptimallyHabitable);
        assert!(bundle.has_tag(SpecialTag::MagneticField));
    }

    #[test]
    fn test_mars_classification() {
        let mut input = earth_input();
        input.mass_earth = 0.107;
        input.radius_earth = 0.532;
        input.surface_temp_k = 210.0;
        input.surface_pressure_bar = 0.006;
        input.ocean_fraction = 0.0;
        input.ice_fraction = 0.05;
        input.tectonic_regime = TectonicRegime::StagnantLid;
        input.volcanism_level = 0.05;
        input.has_magnetic_field = false;
        let bundle = ClassificationBundle::classify(&input);
        assert_eq!(bundle.mass_class, MassClass::SubTerran);
        assert_eq!(bundle.atmosphere_class, AtmosphereClass::Tenuous);
        assert_eq!(bundle.thermal_class, ThermalClass::Frozen);
        assert_eq!(bundle.tectonic_class, TectonicClass::StagnantLid);
        assert!(bundle.has_tag(SpecialTag::TerraformCandidate));
    }

    #[test]
    fn test_venus_classification() {
        let mut input = earth_input();
        input.surface_temp_k = 737.0;
        input.surface_pressure_bar = 92.0;
        input.ocean_fraction = 0.0;
        input.ice_fraction = 0.0;
        input.tectonic_regime = TectonicRegime::Episodic;
        input.volcanism_level = 0.7;
        input.in_habitable_zone = false;
        input.is_runaway_greenhouse = true;
        input.has_magnetic_field = false;
        let bundle = ClassificationBundle::classify(&input);
        assert_eq!(bundle.atmosphere_class, AtmosphereClass::RunawayGreenhouse);
        assert_eq!(bundle.thermal_class, ThermalClass::Hot);
        assert_eq!(bundle.hydrosphere_class, HydrosphereClass::Desiccated);
        assert_eq!(bundle.tectonic_class, TectonicClass::EpisodicOverturn);
    }

    #[test]
    fn test_europa_classification() {
        let mut input = earth_input();
        input.body_class = BodyClass::Moon;
        input.dynamical_class = DynamicalClass::ResonantChain;
        input.mass_earth = 0.008;
        input.radius_earth = 0.245;
        input.surface_temp_k = 102.0;
        input.surface_pressure_bar = 1e-12;
        input.iron_fraction = 0.10;
        input.silicate_fraction = 0.40;
        input.volatile_fraction = 0.50;
        input.h_he_fraction = 0.0;
        input.ocean_fraction = 0.0;
        input.ice_fraction = 0.95;
        input.tectonic_regime = TectonicRegime::None;
        input.volcanism_level = 0.0;
        input.in_habitable_zone = false;
        input.tidal_heating_w_m2 = 0.05;
        input.has_magnetic_field = false;
        let bundle = ClassificationBundle::classify(&input);
        assert_eq!(bundle.body_class, BodyClass::Moon);
        assert_eq!(bundle.tectonic_class, TectonicClass::Cryovolcanic);
        assert_eq!(bundle.hydrosphere_class, HydrosphereClass::SubsurfaceOcean);
        assert_eq!(bundle.habitability_class, HabitabilityClass::SubsurfaceHabitable);
        assert!(bundle.has_tag(SpecialTag::Cryovolcanism));
        assert!(bundle.has_tag(SpecialTag::ResonanceChain));
    }
}
