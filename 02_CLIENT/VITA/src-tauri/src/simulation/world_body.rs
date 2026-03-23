//! Unified WorldBody model — the canonical representation of any body
//! in an ExoMaps star system.
//!
//! Design principle: **A moon is not a lesser category than a planet.**
//! Every body — planet, moon, dwarf planet, ring moonlet, binary companion —
//! flows through the same generation pipeline and receives the same richness
//! of physical detail. The `ClassificationBundle` tells you what it *is*;
//! the `WorldBody` tells you everything about it.
//!
//! The struct is designed to be built incrementally by the 10-stage
//! `WorldGenPipeline`. Fields wrap `Option<T>` where they emerge
//! in later pipeline stages.

use serde::{Deserialize, Serialize};
use super::classification::*;

// ═══════════════════════════════════════════════════════
// Top-level WorldBody
// ═══════════════════════════════════════════════════════

/// A fully-described world body in the ExoMaps universe.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldBody {
    // ── Identity ──
    /// Unique key: "{system_id}_{body_index}"
    pub id: String,
    /// System this body belongs to (star catalog ID)
    pub system_id: String,
    /// Index within the system's body list
    pub body_index: usize,
    /// Human-readable name (generated or player-assigned)
    pub name: String,
    /// Deterministic seed for all procedural generation
    pub seed: u64,

    // ── Classification ──
    pub classification: ClassificationBundle,

    // ── Orbit ──
    pub orbit: OrbitalElements,

    // ── Physical ──
    pub physical: PhysicalProperties,

    // ── Star context ──
    pub star: StarContext,

    // ── Interior structure ──
    pub interior: Option<InteriorCrossSection>,

    // ── Atmosphere ──
    pub atmosphere: Option<AtmosphereProfile>,

    // ── Surface state ──
    pub surface: SurfaceState,

    // ── Subsurface ──
    pub subsurface: Option<SubsurfaceNetwork>,

    // ── Formation history ──
    pub formation: FormationHistory,

    // ── Colonization ──
    pub colonization: Option<ColonizationProfile>,

    // ── Render profile ──
    pub render: RenderProfile,

    // ── Children (moons, ring moonlets) ──
    pub children: Vec<String>, // IDs of child bodies

    // ── Binary companion ──
    pub binary_companion: Option<String>, // ID of paired body
}

// ═══════════════════════════════════════════════════════
// Orbital Elements
// ═══════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrbitalElements {
    /// Semi-major axis [AU] (from parent — star or planet)
    pub sma_au: f64,
    /// Eccentricity [0–1)
    pub eccentricity: f64,
    /// Inclination [degrees]
    pub inclination_deg: f64,
    /// Longitude of ascending node [degrees]
    pub longitude_ascending_deg: f64,
    /// Argument of periapsis [degrees]
    pub argument_periapsis_deg: f64,
    /// Orbital period [days]
    pub period_days: f64,
    /// True anomaly at epoch [degrees]
    pub true_anomaly_deg: f64,
    /// Obliquity / axial tilt [degrees]
    pub obliquity_deg: f64,
    /// Rotation period (sidereal) [hours]
    pub rotation_period_hours: f64,
    /// Whether tidally locked (P_rot ≈ P_orb)
    pub is_tidally_locked: bool,
    /// Hill sphere radius [AU]
    pub hill_radius_au: f64,
    /// Roche limit of parent [AU]
    pub roche_limit_au: f64,
}

// ═══════════════════════════════════════════════════════
// Physical Properties
// ═══════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhysicalProperties {
    /// Mass [M⊕]
    pub mass_earth: f64,
    /// Radius [R⊕]
    pub radius_earth: f64,
    /// Mean density [kg/m³]
    pub density_kg_m3: f64,
    /// Surface gravity [m/s²]
    pub surface_gravity_m_s2: f64,
    /// Escape velocity [km/s]
    pub escape_velocity_km_s: f64,
    /// Bond albedo [0–1]
    pub bond_albedo: f64,
    /// Age [Gyr]
    pub age_gyr: f64,
    /// Bulk composition fractions (from EOS solver)
    pub iron_fraction: f64,
    pub silicate_fraction: f64,
    pub volatile_fraction: f64,
    pub h_he_fraction: f64,
    /// Magnetic field strength [μT] (0 = none)
    pub magnetic_field_ut: f64,
    /// Whether body has a dynamo-driven magnetic field
    pub has_magnetic_field: bool,
}

// ═══════════════════════════════════════════════════════
// Star Context (host star properties)
// ═══════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StarContext {
    /// Effective temperature [K]
    pub teff_k: f64,
    /// Luminosity [L☉]
    pub luminosity_solar: f64,
    /// Mass [M☉]
    pub mass_solar: f64,
    /// Spectral type string (e.g. "G2V", "M4V")
    pub spectral_type: String,
    /// Age [Gyr]
    pub age_gyr: f64,
    /// Stellar activity level (log R'HK or proxy) [0–1 normalized]
    pub activity_level: f64,
    /// XUV luminosity fraction (L_XUV / L_bol)
    pub xuv_fraction: f64,
    /// Is this an M-dwarf flare star?
    pub is_flare_star: bool,
    /// Distance from Sol [pc]
    pub distance_pc: f64,
}

// ═══════════════════════════════════════════════════════
// Interior Cross-Section
// ═══════════════════════════════════════════════════════

/// Radial layer model for cross-section visualization.
/// Layers are ordered from center outward.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InteriorCrossSection {
    pub layers: Vec<InteriorLayer>,
    /// Central pressure [GPa]
    pub central_pressure_gpa: f64,
    /// Central temperature [K]
    pub central_temperature_k: f64,
    /// Whether the interior model converged
    pub converged: bool,
}

/// A single radial layer in the interior cross-section.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InteriorLayer {
    /// Layer type identifier
    pub layer_type: InteriorLayerType,
    /// Human-readable name
    pub name: String,
    /// Inner radius [km] (0 for innermost)
    pub inner_radius_km: f64,
    /// Outer radius [km]
    pub outer_radius_km: f64,
    /// Inner temperature [K]
    pub inner_temp_k: f64,
    /// Outer temperature [K]
    pub outer_temp_k: f64,
    /// Inner pressure [GPa]
    pub inner_pressure_gpa: f64,
    /// Outer pressure [GPa]
    pub outer_pressure_gpa: f64,
    /// Mean density [kg/m³]
    pub density_kg_m3: f64,
    /// Dominant material / composition description
    pub material: String,
    /// Render color hint (RGBA, 0–1)
    pub color: [f32; 4],
    /// Is this layer convecting?
    pub is_convecting: bool,
    /// Is this layer liquid?
    pub is_liquid: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum InteriorLayerType {
    InnerCore,
    OuterCore,
    LowerMantle,
    UpperMantle,
    Crust,
    Regolith,
    IceShell,
    SubsurfaceOcean,
    LiquidOcean,
    IceCap,
    MetallicHydrogen,
    MolecularHydrogen,
    HeliumRainZone,
    WaterIceLayer,
    HighPressureIce,
    MagmaOcean,
}

// ═══════════════════════════════════════════════════════
// Atmosphere Profile (vertical)
// ═══════════════════════════════════════════════════════

/// Vertical atmosphere profile with pressure layers,
/// cloud decks, and wind/circulation patterns.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AtmosphereProfile {
    /// Summary scalars
    pub surface_pressure_bar: f64,
    pub surface_temp_k: f64,
    pub equilibrium_temp_k: f64,
    pub scale_height_km: f64,
    pub mean_molecular_weight: f64,
    pub dominant_gas: String,
    pub greenhouse_factor: f64,

    /// Vertical column (TOA → surface)
    pub column: Vec<AtmosphereColumnLayer>,

    /// Cloud decks
    pub cloud_decks: Vec<CloudDeck>,

    /// Wind/circulation zones
    pub circulation: AtmosphericCirculation,

    /// Rayleigh scattering color for rendering
    pub rayleigh_color: [f32; 3],

    /// Atmospheric escape state
    pub escape: AtmosphericEscape,

    /// Optical properties for rendering
    pub optical: AtmosphereOptics,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AtmosphereColumnLayer {
    /// Altitude above surface [km]
    pub altitude_km: f64,
    /// Pressure [bar]
    pub pressure_bar: f64,
    /// Temperature [K]
    pub temperature_k: f64,
    /// Density [kg/m³]
    pub density_kg_m3: f64,
    /// Layer name (troposphere, stratosphere, mesosphere, thermosphere…)
    pub region: AtmosphereRegion,
    /// Major species mixing ratios
    pub mixing_ratios: Vec<GasMixingRatio>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum AtmosphereRegion {
    Troposphere,
    Stratosphere,
    Mesosphere,
    Thermosphere,
    Exosphere,
    /// Gas giant deep atmosphere
    DeepAtmosphere,
    /// Gas giant weather layer
    WeatherLayer,
    /// Gas giant upper haze
    UpperHaze,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GasMixingRatio {
    pub species: String,
    pub fraction: f64,
}

// ── Cloud decks ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudDeck {
    /// Cloud composition
    pub cloud_type: CloudType,
    /// Base altitude [km]
    pub base_altitude_km: f64,
    /// Top altitude [km]
    pub top_altitude_km: f64,
    /// Optical depth (thicker = more opaque)
    pub optical_depth: f64,
    /// Coverage fraction [0–1]
    pub coverage: f64,
    /// Particle size [μm]
    pub particle_size_um: f64,
    /// Albedo contribution
    pub albedo: f64,
    /// Render color hint
    pub color: [f32; 4],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum CloudType {
    WaterIce,
    WaterLiquid,
    CO2Ice,
    SulfuricAcid,
    Ammonia,
    AmmoniumHydrosulfide,
    MethaneCrystal,
    SilicateDust,
    IronDroplets,
    CorundumDust,
    SootHaze,
    TholinHaze,
    SodiumSulfide,
    PhosphineCrystal,
}

// ── Circulation ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AtmosphericCirculation {
    /// Wind pattern type
    pub pattern: CirculationPattern,
    /// Zonal wind bands (for gas giants / banded planets)
    pub wind_bands: Vec<WindBand>,
    /// Maximum wind speed [m/s]
    pub max_wind_speed_m_s: f64,
    /// Number of Hadley cells (1 for tidally locked, 1-3 for rotating)
    pub hadley_cells: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum CirculationPattern {
    /// Single hemisphere circulation (tidally locked)
    SubstellarAntistellar,
    /// Hadley cell pattern (slowly rotating terrestrial)
    HadleyCell,
    /// Banded zonal flow (fast rotating, gas giants)
    BandedZonal,
    /// Super-rotation (Venus-like, thick atmosphere)
    SuperRotation,
    /// No significant circulation (tenuous atmosphere)
    Negligible,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindBand {
    /// Latitude center [degrees, -90 to +90]
    pub latitude_deg: f64,
    /// Width [degrees]
    pub width_deg: f64,
    /// Zonal wind speed [m/s] (positive = prograde)
    pub wind_speed_m_s: f64,
    /// Color/albedo variation (darker = belt, lighter = zone)
    pub albedo_offset: f64,
}

// ── Atmospheric escape ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AtmosphericEscape {
    /// Jeans escape parameter λ (Λ > ~25 → gravitational binding strong)
    pub jeans_parameter: f64,
    /// Current mass-loss rate [kg/s]
    pub mass_loss_rate_kg_s: f64,
    /// XUV-driven energy-limited escape rate [kg/s]
    pub xuv_escape_rate_kg_s: f64,
    /// Cumulative mass lost [M⊕]
    pub cumulative_loss_earth_masses: f64,
    /// Is the atmosphere in a hydrodynamic blow-off regime?
    pub hydrodynamic_escape: bool,
    /// Fraction of original atmosphere retained [0–1]
    pub retention_fraction: f64,
    /// Magnetic shielding effectiveness [0–1]
    pub magnetic_shielding: f64,
}

// ── Optical properties ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AtmosphereOptics {
    /// Rayleigh scattering coefficient at 550 nm [m⁻¹]
    pub rayleigh_beta: f64,
    /// Mie scattering coefficient (haze/aerosol) [m⁻¹]
    pub mie_beta: f64,
    /// Absorption coefficient (gas + aerosol) [m⁻¹]
    pub absorption_beta: f64,
    /// Total optical depth at zenith
    pub optical_depth_zenith: f64,
    /// Sunset/sunrise color shift (normalized RGB)
    pub sunset_color: [f32; 3],
    /// Sky color at zenith (normalized RGB)
    pub zenith_color: [f32; 3],
    /// Horizon color (normalized RGB)
    pub horizon_color: [f32; 3],
}

// ═══════════════════════════════════════════════════════
// Surface State
// ═══════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SurfaceState {
    /// Surface temperature [K]
    pub surface_temp_k: f64,
    /// Ocean coverage fraction
    pub ocean_fraction: f64,
    /// Ice coverage fraction
    pub ice_fraction: f64,
    /// Desert/barren fraction
    pub desert_fraction: f64,
    /// Vegetation-analog fraction (if biosphere present)
    pub vegetation_fraction: f64,
    /// Volcanism level [0–1]
    pub volcanism_level: f64,
    /// Crater density [0–1]
    pub crater_density: f64,
    /// Maximum mountain height [km]
    pub mountain_height_km: f64,
    /// Terrain roughness [0–1]
    pub tectonic_roughness: f64,
    /// Surface materials with coverage
    pub materials: Vec<SurfaceMaterial>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SurfaceMaterial {
    pub name: String,
    pub coverage_fraction: f64,
    pub color: [f32; 3],
    pub roughness: f32,
    pub metalness: f32,
    pub emissive: f32,
}

// ═══════════════════════════════════════════════════════
// Subsurface Network
// ═══════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubsurfaceNetwork {
    /// Types of subsurface features present
    pub features: Vec<SubsurfaceFeature>,
    /// Total subsurface volume accessible [km³]
    pub total_volume_km3: f64,
    /// Average depth [km]
    pub average_depth_km: f64,
    /// Structural stability assessment
    pub stability: SubsurfaceStability,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubsurfaceFeature {
    pub feature_type: SubsurfaceType,
    /// Human-readable description
    pub description: String,
    /// Depth range [km]
    pub depth_min_km: f64,
    pub depth_max_km: f64,
    /// Extent [km]
    pub extent_km: f64,
    /// Internal temperature [K]
    pub temperature_k: f64,
    /// Internal pressure [bar]
    pub pressure_bar: f64,
    /// Is this feature suitable for habitation?
    pub habitable: bool,
    /// Colonization suitability score [0–1]
    pub colony_suitability: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum SubsurfaceType {
    /// Collapsed lava tubes (lunar/Martian analog)
    LavaTube,
    /// Ice cavern network (Europa analog)
    IceCavern,
    /// Brine pocket / aquifer
    BrinePocket,
    /// Deep geothermal cavity
    GeothermalCavity,
    /// Impact-fractured zone with void space
    ImpactFracture,
    /// Karst-like dissolution cavity in soluble rock/ice
    DissolutionCavity,
    /// Pressurized subsurface aquifer
    Aquifer,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum SubsurfaceStability {
    /// Geologically stable, low seismic risk
    Stable,
    /// Moderate activity, periodic tremors
    Moderate,
    /// Active geology, frequent quakes/eruptions
    Active,
    /// Catastrophically unstable (e.g. tidal flexing)
    Unstable,
}

// ═══════════════════════════════════════════════════════
// Formation History
// ═══════════════════════════════════════════════════════

/// Narrative summary of how this body formed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FormationHistory {
    /// Formation pathway
    pub pathway: FormationPathway,
    /// Key events in chronological order
    pub events: Vec<FormationEvent>,
    /// Current evolutionary stage
    pub stage: EvolutionaryStage,
    /// Estimated age [Gyr]
    pub age_gyr: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum FormationPathway {
    /// Core accretion (standard rocky/gas giant formation)
    CoreAccretion,
    /// Disk instability (direct collapse to gas giant)
    DiskInstability,
    /// Giant impact (Moon-forming event)
    GiantImpact,
    /// Gravitational capture (irregular satellites)
    Capture,
    /// Co-accretion from debris disk (regular satellites)
    CoAccretion,
    /// Binary fission / tidal spinoff
    Fission,
    /// Ejected from another system (rogue body)
    Ejected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FormationEvent {
    /// When (Gyr after system formation)
    pub time_gyr: f64,
    /// What happened
    pub event_type: FormationEventType,
    /// Narrative description
    pub description: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum FormationEventType {
    Accretion,
    DiskDissipation,
    GiantImpact,
    AtmosphereStripping,
    OutgassingEpoch,
    OceanCondensation,
    RunawayGreenhouse,
    IceAge,
    TectonicOnset,
    MagneticFieldOnset,
    MagneticFieldLoss,
    MigrationInward,
    MigrationOutward,
    TidalCapture,
    ResonanceLocking,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum EvolutionaryStage {
    /// Still accreting, magma ocean present
    Forming,
    /// Recently formed, cooling crust
    YoungHot,
    /// Active geology, atmosphere evolving
    Active,
    /// Mature system, stable climate
    Mature,
    /// Cooling down, losing atmosphere/water
    Declining,
    /// Geologically dead, thin/no atmosphere
    Dormant,
    /// Ancient relic, heavily cratered
    Ancient,
}

// ═══════════════════════════════════════════════════════
// Colonization Profile
// ═══════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColonizationProfile {
    /// Primary recommended strategy
    pub primary_strategy: ColonizationStrategy,
    /// All viable strategies ranked by suitability
    pub viable_strategies: Vec<ColonizationStrategyRanked>,
    /// Resources available
    pub resources: Vec<Resource>,
    /// Hazards
    pub hazards: Vec<Hazard>,
    /// Overall colonization difficulty [0–1] (0 = easy, 1 = nearly impossible)
    pub difficulty: f64,
    /// Population capacity estimate
    pub max_population: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ColonizationStrategy {
    /// Open-air surface settlement (Earth-like worlds)
    SurfaceOpen,
    /// Enclosed surface habitat (domes, pressurized)
    SurfaceDome,
    /// Underground settlement in natural cavities
    Subterranean,
    /// Settlement in lava tubes
    LavaTube,
    /// Sub-ice settlement (Europa-style)
    SubIce,
    /// Floating habitats in dense atmosphere (Venus high-altitude)
    Floating,
    /// Orbital station / space elevator
    Orbital,
    /// Under-ocean settlement
    Submarine,
    /// No viable strategy known
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColonizationStrategyRanked {
    pub strategy: ColonizationStrategy,
    pub suitability: f64, // 0–1
    pub notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Resource {
    pub name: String,
    pub resource_type: ResourceType,
    pub abundance: ResourceAbundance,
    pub accessibility: f64, // 0–1
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ResourceType {
    Water,
    Metals,
    RareEarths,
    Volatiles,
    Helium3,
    Deuterium,
    Organics,
    SiliconMinerals,
    Energy,
    Regolith,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ResourceAbundance {
    Trace,
    Low,
    Moderate,
    High,
    Abundant,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hazard {
    pub name: String,
    pub hazard_type: HazardType,
    pub severity: f64, // 0–1
    pub description: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum HazardType {
    Radiation,
    ExtremeTemperature,
    HighGravity,
    LowGravity,
    ToxicAtmosphere,
    HighPressure,
    Volcanism,
    Seismicity,
    Meteorites,
    TidalStress,
    SolarFlares,
    AtmosphericLoss,
    Dust,
    Acidic,
}

// ═══════════════════════════════════════════════════════
// Render Profile (for frontend shader configuration)
// ═══════════════════════════════════════════════════════

/// Everything the renderer needs to visualize this body.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderProfile {
    /// Body shape class (determines base geometry)
    pub shape: BodyShape,
    /// Terrain generation recipe
    pub terrain: TerrainRecipe,
    /// Material palette
    pub palette: MaterialPalette,
    /// Atmosphere render config
    pub atmosphere_render: Option<AtmosphereRenderConfig>,
    /// Ring system render config
    pub ring: Option<RingRenderConfig>,
    /// Emissive features (lava, night-side glow)
    pub emissive: EmissiveConfig,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum BodyShape {
    /// Near-spherical (most bodies)
    Spheroid,
    /// Oblate (fast rotator or gas giant)
    Oblate,
    /// Prolate / irregular (small body, tidal distortion)
    Irregular,
    /// Severely tidally distorted (Roche-limit close)
    TidallyDistorted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerrainRecipe {
    /// Primary terrain algorithm
    pub algorithm: String,
    /// Noise octaves / detail level
    pub detail_level: u32,
    /// Domain warping strength
    pub warp_strength: f64,
    /// Whether to run tectonic plate simulation
    pub use_tectonics: bool,
    /// Whether to add impact craters
    pub use_craters: bool,
    /// Whether to add volcanic features
    pub use_volcanism: bool,
    /// Gas giant band structure
    pub use_bands: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MaterialPalette {
    /// Named colors for biome/terrain types
    pub entries: Vec<PaletteEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaletteEntry {
    pub name: String,
    pub color: [f32; 3],
    pub roughness: f32,
    pub metalness: f32,
    pub emissive: f32,
    pub coverage: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AtmosphereRenderConfig {
    /// Atmosphere thickness relative to planet radius
    pub thickness_fraction: f64,
    /// Scattering color
    pub scattering_color: [f32; 3],
    /// Density falloff exponent
    pub density_falloff: f64,
    /// Cloud layer opacity
    pub cloud_opacity: f64,
    /// Number of cloud layers to render
    pub cloud_layers: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RingRenderConfig {
    /// Inner radius [planet radii]
    pub inner_radius: f64,
    /// Outer radius [planet radii]
    pub outer_radius: f64,
    /// Opacity profile (sampled at intervals)
    pub opacity_profile: Vec<f64>,
    /// Ring color
    pub color: [f32; 3],
    /// Tilt [degrees]
    pub tilt_deg: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmissiveConfig {
    /// Night-side thermal glow
    pub night_glow: bool,
    /// Lava glow (volcanism-driven)
    pub lava_glow: bool,
    /// City lights (colonized body)
    pub city_lights: bool,
    /// Aurora (magnetic field + stellar wind)
    pub auroras: bool,
    /// Emissive color
    pub emissive_color: [f32; 3],
    /// Emissive intensity [0–1]
    pub emissive_intensity: f64,
}

// ═══════════════════════════════════════════════════════
// Builder / Factory
// ═══════════════════════════════════════════════════════

impl WorldBody {
    /// Create a minimal / empty WorldBody scaffold.
    /// Fields are populated progressively by the generation pipeline.
    pub fn scaffold(
        system_id: &str,
        body_index: usize,
        seed: u64,
        body_class: BodyClass,
    ) -> Self {
        WorldBody {
            id: format!("{}_{}", system_id, body_index),
            system_id: system_id.to_string(),
            body_index,
            name: format!("{} {}", system_id, index_to_letter(body_index)),
            seed,

            classification: ClassificationBundle {
                body_class,
                dynamical_class: DynamicalClass::Regular,
                mass_class: MassClass::SuperTerran,
                composition_class: CompositionClass::Mixed,
                atmosphere_class: AtmosphereClass::None,
                thermal_class: ThermalClass::Temperate,
                hydrosphere_class: HydrosphereClass::Desiccated,
                tectonic_class: TectonicClass::Inert,
                habitability_class: HabitabilityClass::Sterile,
                special_tags: vec![],
            },

            orbit: OrbitalElements {
                sma_au: 1.0,
                eccentricity: 0.0,
                inclination_deg: 0.0,
                longitude_ascending_deg: 0.0,
                argument_periapsis_deg: 0.0,
                period_days: 365.25,
                true_anomaly_deg: 0.0,
                obliquity_deg: 23.4,
                rotation_period_hours: 24.0,
                is_tidally_locked: false,
                hill_radius_au: 0.01,
                roche_limit_au: 0.001,
            },

            physical: PhysicalProperties {
                mass_earth: 1.0,
                radius_earth: 1.0,
                density_kg_m3: 5514.0,
                surface_gravity_m_s2: 9.81,
                escape_velocity_km_s: 11.2,
                bond_albedo: 0.3,
                age_gyr: 4.6,
                iron_fraction: 0.32,
                silicate_fraction: 0.50,
                volatile_fraction: 0.15,
                h_he_fraction: 0.0,
                magnetic_field_ut: 50.0,
                has_magnetic_field: true,
            },

            star: StarContext {
                teff_k: 5778.0,
                luminosity_solar: 1.0,
                mass_solar: 1.0,
                spectral_type: "G2V".to_string(),
                age_gyr: 4.6,
                activity_level: 0.3,
                xuv_fraction: 1e-6,
                is_flare_star: false,
                distance_pc: 10.0,
            },

            interior: None,
            atmosphere: None,

            surface: SurfaceState {
                surface_temp_k: 288.0,
                ocean_fraction: 0.0,
                ice_fraction: 0.0,
                desert_fraction: 1.0,
                vegetation_fraction: 0.0,
                volcanism_level: 0.0,
                crater_density: 0.0,
                mountain_height_km: 0.0,
                tectonic_roughness: 0.5,
                materials: vec![],
            },

            subsurface: None,

            formation: FormationHistory {
                pathway: FormationPathway::CoreAccretion,
                events: vec![],
                stage: EvolutionaryStage::Mature,
                age_gyr: 4.6,
            },

            colonization: None,

            render: RenderProfile {
                shape: BodyShape::Spheroid,
                terrain: TerrainRecipe {
                    algorithm: "fbm_ridged".to_string(),
                    detail_level: 8,
                    warp_strength: 0.3,
                    use_tectonics: false,
                    use_craters: false,
                    use_volcanism: false,
                    use_bands: false,
                },
                palette: MaterialPalette { entries: vec![] },
                atmosphere_render: None,
                ring: None,
                emissive: EmissiveConfig {
                    night_glow: false,
                    lava_glow: false,
                    city_lights: false,
                    auroras: false,
                    emissive_color: [0.0, 0.0, 0.0],
                    emissive_intensity: 0.0,
                },
            },

            children: vec![],
            binary_companion: None,
        }
    }
}

/// Convert a body index to a letter designation (0→b, 1→c, …)
fn index_to_letter(index: usize) -> String {
    let letter = (b'b' + index as u8) as char;
    if letter <= 'z' {
        letter.to_string()
    } else {
        format!("{}", index + 1)
    }
}
