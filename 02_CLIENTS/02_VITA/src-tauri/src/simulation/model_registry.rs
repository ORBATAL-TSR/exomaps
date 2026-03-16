//! Scientific model registry and management system.
//!
//! Inspired by:
//!   - VPL/bigplanet — parameter manifests, simulation output management
//!   - VPL/atmos     — coupled model convergence, model versioning
//!   - OpenSpace     — module registry, asset/profile system
//!   - osp-magnum    — data-oriented design, typed component arrays
//!
//! Every scientific model in ExoMaps is registered here with:
//!   - unique ID + semantic version
//!   - literature citations (BibTeX keys)
//!   - input/output schema (typed parameter lists)
//!   - domain of validity (mass ranges, temperature ranges, etc.)
//!   - validation targets (known solar system bodies)
//!
//! This allows the frontend to enumerate available models, display
//! confidence/applicability warnings, and for the backend to select
//! the best model for a given planet.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;

// ── Model metadata ──────────────────────────────────

/// A registered scientific model.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelDescriptor {
    /// Unique model ID, e.g. "atm.radiative_convective.v2"
    pub id: String,
    /// Human-readable name
    pub name: String,
    /// Semantic version
    pub version: String,
    /// Domain of applicability
    pub domain: ModelDomain,
    /// Which physical module this model belongs to
    pub category: ModelCategory,
    /// Literature references (BibTeX-style keys)
    pub citations: Vec<Citation>,
    /// Named input parameters with units and valid ranges
    pub inputs: Vec<ParamDescriptor>,
    /// Named output parameters with units
    pub outputs: Vec<ParamDescriptor>,
    /// Known-body validation targets
    pub validation_targets: Vec<ValidationTarget>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ModelCategory {
    Composition,
    Interior,
    Atmosphere,
    Climate,
    Geology,
    Texture,
}

/// Domain of validity for a model.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelDomain {
    pub mass_earth_min: f64,
    pub mass_earth_max: f64,
    pub radius_earth_min: f64,
    pub radius_earth_max: f64,
    pub temp_k_min: f64,
    pub temp_k_max: f64,
    /// Planet type codes this model handles
    pub planet_types: Vec<String>,
    /// Descriptive notes on when the model breaks down
    pub caveats: Vec<String>,
}

/// A literature citation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Citation {
    pub key: String,
    pub authors: String,
    pub title: String,
    pub journal: String,
    pub year: u16,
    pub doi: Option<String>,
}

/// Descriptor for a model input or output parameter.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParamDescriptor {
    pub name: String,
    pub unit: String,
    pub description: String,
    pub range_min: Option<f64>,
    pub range_max: Option<f64>,
}

/// Validation against a known solar system body.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationTarget {
    pub body_name: String,
    pub parameter: String,
    pub observed_value: f64,
    pub observed_uncertainty: f64,
    pub unit: String,
}

// ── Model applicability check ───────────────────────

/// Result of checking whether a model applies to given parameters.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApplicabilityResult {
    pub applicable: bool,
    pub confidence: f64, // 0.0-1.0
    pub warnings: Vec<String>,
}

impl ModelDescriptor {
    /// Check whether this model applies to the given planet parameters.
    pub fn check_applicability(
        &self,
        mass_earth: Option<f64>,
        radius_earth: Option<f64>,
        temp_k: Option<f64>,
        planet_type: &str,
    ) -> ApplicabilityResult {
        let mut confidence = 1.0;
        let mut warnings = Vec::new();
        let mut applicable = true;

        // Check planet type
        if !self.domain.planet_types.is_empty()
            && !self.domain.planet_types.iter().any(|pt| pt == planet_type || pt == "*")
        {
            applicable = false;
            warnings.push(format!(
                "Model '{}' not designed for planet type '{}'",
                self.id, planet_type
            ));
        }

        // Check mass range
        if let Some(m) = mass_earth {
            if m < self.domain.mass_earth_min {
                confidence *= 0.5;
                warnings.push(format!(
                    "Mass {:.2} M⊕ below model minimum {:.2} M⊕",
                    m, self.domain.mass_earth_min
                ));
            }
            if m > self.domain.mass_earth_max {
                confidence *= 0.5;
                warnings.push(format!(
                    "Mass {:.2} M⊕ above model maximum {:.2} M⊕",
                    m, self.domain.mass_earth_max
                ));
            }
        } else {
            confidence *= 0.7;
            warnings.push("Mass unknown — model fidelity reduced".to_string());
        }

        // Check radius range
        if let Some(r) = radius_earth {
            if r < self.domain.radius_earth_min || r > self.domain.radius_earth_max {
                confidence *= 0.6;
                warnings.push(format!(
                    "Radius {:.2} R⊕ outside model range [{:.2}, {:.2}]",
                    r, self.domain.radius_earth_min, self.domain.radius_earth_max
                ));
            }
        }

        // Check temperature range
        if let Some(t) = temp_k {
            if t < self.domain.temp_k_min || t > self.domain.temp_k_max {
                confidence *= 0.6;
                warnings.push(format!(
                    "Temperature {:.0} K outside model range [{:.0}, {:.0}]",
                    t, self.domain.temp_k_min, self.domain.temp_k_max
                ));
            }
        }

        ApplicabilityResult {
            applicable,
            confidence,
            warnings,
        }
    }
}

// ── Global model registry ───────────────────────────

static REGISTRY: OnceLock<ModelRegistry> = OnceLock::new();

pub struct ModelRegistry {
    models: HashMap<String, ModelDescriptor>,
    category_index: HashMap<ModelCategory, Vec<String>>,
}

impl ModelRegistry {
    fn new() -> Self {
        let mut reg = ModelRegistry {
            models: HashMap::new(),
            category_index: HashMap::new(),
        };
        reg.register_builtin_models();
        reg
    }

    pub fn global() -> &'static ModelRegistry {
        REGISTRY.get_or_init(ModelRegistry::new)
    }

    pub fn register(&mut self, model: ModelDescriptor) {
        let id = model.id.clone();
        let cat = model.category;
        self.models.insert(id.clone(), model);
        self.category_index.entry(cat).or_default().push(id);
    }

    pub fn get(&self, id: &str) -> Option<&ModelDescriptor> {
        self.models.get(id)
    }

    pub fn models_for_category(&self, category: ModelCategory) -> Vec<&ModelDescriptor> {
        self.category_index
            .get(&category)
            .map(|ids| ids.iter().filter_map(|id| self.models.get(id)).collect())
            .unwrap_or_default()
    }

    /// Select the best model for given parameters within a category.
    pub fn select_best(
        &self,
        category: ModelCategory,
        mass_earth: Option<f64>,
        radius_earth: Option<f64>,
        temp_k: Option<f64>,
        planet_type: &str,
    ) -> Option<(&ModelDescriptor, ApplicabilityResult)> {
        self.models_for_category(category)
            .into_iter()
            .map(|m| {
                let app = m.check_applicability(mass_earth, radius_earth, temp_k, planet_type);
                (m, app)
            })
            .filter(|(_, app)| app.applicable)
            .max_by(|(_, a), (_, b)| {
                a.confidence
                    .partial_cmp(&b.confidence)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
    }

    /// Return all models as a manifest (for frontend display).
    pub fn manifest(&self) -> Vec<&ModelDescriptor> {
        self.models.values().collect()
    }

    // ── Built-in model registration ─────────────────

    fn register_builtin_models(&mut self) {
        // ── COMPOSITION ──
        self.register(ModelDescriptor {
            id: "comp.zeng2019".to_string(),
            name: "Zeng et al. 2019 Mass-Radius".to_string(),
            version: "2.0.0".to_string(),
            category: ModelCategory::Composition,
            domain: ModelDomain {
                mass_earth_min: 0.01,
                mass_earth_max: 20.0,
                radius_earth_min: 0.3,
                radius_earth_max: 4.0,
                temp_k_min: 50.0,
                temp_k_max: 3000.0,
                planet_types: vec!["sub-earth".into(), "rocky".into(), "super-earth".into()],
                caveats: vec![
                    "Not valid for gas/ice giants".into(),
                    "Assumes 2-layer (core+mantle) structure".into(),
                ],
            },
            citations: vec![Citation {
                key: "zeng2019".to_string(),
                authors: "Zeng, Li, et al.".to_string(),
                title: "Growth model interpretation of planet size distribution".to_string(),
                journal: "PNAS".to_string(),
                year: 2019,
                doi: Some("10.1073/pnas.1812905116".to_string()),
            }],
            inputs: vec![
                ParamDescriptor { name: "mass_earth".into(), unit: "M⊕".into(), description: "Planet mass".into(), range_min: Some(0.01), range_max: Some(20.0) },
                ParamDescriptor { name: "radius_earth".into(), unit: "R⊕".into(), description: "Planet radius".into(), range_min: Some(0.3), range_max: Some(4.0) },
            ],
            outputs: vec![
                ParamDescriptor { name: "iron_fraction".into(), unit: "".into(), description: "Iron core mass fraction".into(), range_min: Some(0.0), range_max: Some(1.0) },
                ParamDescriptor { name: "silicate_fraction".into(), unit: "".into(), description: "Silicate mantle mass fraction".into(), range_min: Some(0.0), range_max: Some(1.0) },
            ],
            validation_targets: vec![
                ValidationTarget { body_name: "Earth".into(), parameter: "iron_fraction".into(), observed_value: 0.325, observed_uncertainty: 0.02, unit: "".into() },
                ValidationTarget { body_name: "Earth".into(), parameter: "silicate_fraction".into(), observed_value: 0.675, observed_uncertainty: 0.02, unit: "".into() },
                ValidationTarget { body_name: "Mars".into(), parameter: "iron_fraction".into(), observed_value: 0.26, observed_uncertainty: 0.04, unit: "".into() },
                ValidationTarget { body_name: "Mercury".into(), parameter: "iron_fraction".into(), observed_value: 0.68, observed_uncertainty: 0.05, unit: "".into() },
            ],
        });

        self.register(ModelDescriptor {
            id: "comp.giant_envelope".to_string(),
            name: "Giant Planet Envelope Model".to_string(),
            version: "1.0.0".to_string(),
            category: ModelCategory::Composition,
            domain: ModelDomain {
                mass_earth_min: 5.0,
                mass_earth_max: 15000.0,
                radius_earth_min: 2.0,
                radius_earth_max: 25.0,
                temp_k_min: 30.0,
                temp_k_max: 5000.0,
                planet_types: vec!["neptune-like".into(), "gas-giant".into(), "super-jupiter".into()],
                caveats: vec!["Simplified envelope structure".into()],
            },
            citations: vec![Citation {
                key: "fortney2007".to_string(),
                authors: "Fortney, J.J., Marley, M.S., Barnes, J.W.".to_string(),
                title: "Planetary radii across cool jovian worlds".to_string(),
                journal: "ApJ".to_string(),
                year: 2007,
                doi: Some("10.1086/512120".to_string()),
            }],
            inputs: vec![
                ParamDescriptor { name: "mass_earth".into(), unit: "M⊕".into(), description: "Planet mass".into(), range_min: Some(5.0), range_max: Some(15000.0) },
                ParamDescriptor { name: "radius_earth".into(), unit: "R⊕".into(), description: "Planet radius".into(), range_min: Some(2.0), range_max: Some(25.0) },
            ],
            outputs: vec![
                ParamDescriptor { name: "h_he_fraction".into(), unit: "".into(), description: "H/He envelope fraction".into(), range_min: Some(0.0), range_max: Some(1.0) },
                ParamDescriptor { name: "z_metals".into(), unit: "".into(), description: "Heavy element (metal) enrichment".into(), range_min: Some(0.0), range_max: Some(1.0) },
            ],
            validation_targets: vec![
                ValidationTarget { body_name: "Jupiter".into(), parameter: "h_he_fraction".into(), observed_value: 0.735, observed_uncertainty: 0.02, unit: "".into() },
                ValidationTarget { body_name: "Saturn".into(), parameter: "h_he_fraction".into(), observed_value: 0.715, observed_uncertainty: 0.04, unit: "".into() },
                ValidationTarget { body_name: "Neptune".into(), parameter: "h_he_fraction".into(), observed_value: 0.15, observed_uncertainty: 0.05, unit: "".into() },
            ],
        });

        // ── INTERIOR STRUCTURE ──
        self.register(ModelDescriptor {
            id: "interior.4layer".to_string(),
            name: "4-Layer Interior Structure".to_string(),
            version: "1.0.0".to_string(),
            category: ModelCategory::Interior,
            domain: ModelDomain {
                mass_earth_min: 0.01,
                mass_earth_max: 20.0,
                radius_earth_min: 0.3,
                radius_earth_max: 4.0,
                temp_k_min: 50.0,
                temp_k_max: 3000.0,
                planet_types: vec!["sub-earth".into(), "rocky".into(), "super-earth".into()],
                caveats: vec![
                    "Assumes spherical symmetry".into(),
                    "EOS uncertainties at ultra-high pressures (>1 TPa)".into(),
                ],
            },
            citations: vec![
                Citation { key: "valencia2006".to_string(), authors: "Valencia, D., O'Connell, R.J., Sasselov, D.".to_string(), title: "Internal structure of massive terrestrial planets".to_string(), journal: "Icarus".to_string(), year: 2006, doi: Some("10.1016/j.icarus.2005.11.021".to_string()) },
                Citation { key: "seager2007".to_string(), authors: "Seager, S., et al.".to_string(), title: "Mass-radius relationships for solid exoplanets".to_string(), journal: "ApJ".to_string(), year: 2007, doi: Some("10.1086/521346".to_string()) },
            ],
            inputs: vec![
                ParamDescriptor { name: "mass_earth".into(), unit: "M⊕".into(), description: "Total planet mass".into(), range_min: Some(0.01), range_max: Some(20.0) },
                ParamDescriptor { name: "iron_fraction".into(), unit: "".into(), description: "Core mass fraction".into(), range_min: Some(0.0), range_max: Some(0.8) },
            ],
            outputs: vec![
                ParamDescriptor { name: "core_radius_fraction".into(), unit: "".into(), description: "Core radius / total radius".into(), range_min: Some(0.0), range_max: Some(0.8) },
                ParamDescriptor { name: "cmb_pressure_gpa".into(), unit: "GPa".into(), description: "Core-mantle boundary pressure".into(), range_min: None, range_max: None },
                ParamDescriptor { name: "central_pressure_gpa".into(), unit: "GPa".into(), description: "Central pressure".into(), range_min: None, range_max: None },
            ],
            validation_targets: vec![
                ValidationTarget { body_name: "Earth".into(), parameter: "core_radius_fraction".into(), observed_value: 0.546, observed_uncertainty: 0.005, unit: "".into() },
                ValidationTarget { body_name: "Earth".into(), parameter: "cmb_pressure_gpa".into(), observed_value: 135.0, observed_uncertainty: 5.0, unit: "GPa".into() },
                ValidationTarget { body_name: "Earth".into(), parameter: "central_pressure_gpa".into(), observed_value: 364.0, observed_uncertainty: 10.0, unit: "GPa".into() },
            ],
        });

        // ── ATMOSPHERE ──
        self.register(ModelDescriptor {
            id: "atm.radiative_convective.v1".to_string(),
            name: "Radiative-Convective Equilibrium".to_string(),
            version: "1.0.0".to_string(),
            category: ModelCategory::Atmosphere,
            domain: ModelDomain {
                mass_earth_min: 0.05,
                mass_earth_max: 20.0,
                radius_earth_min: 0.3,
                radius_earth_max: 4.0,
                temp_k_min: 150.0,
                temp_k_max: 800.0,
                planet_types: vec!["rocky".into(), "super-earth".into()],
                caveats: vec![
                    "Simplified k-coefficient absorption (grey + window model)".into(),
                    "Stable only for 'habitable' temperature range".into(),
                    "Per VPL/atmos CLIMA: exercise caution outside Earth-like regime".into(),
                ],
            },
            citations: vec![
                Citation { key: "pierrehumbert2010".to_string(), authors: "Pierrehumbert, R.T.".to_string(), title: "Principles of Planetary Climate".to_string(), journal: "Cambridge University Press".to_string(), year: 2010, doi: None },
                Citation { key: "kopparapu2013".to_string(), authors: "Kopparapu, R.K., et al.".to_string(), title: "Habitable zones around main-sequence stars: new estimates".to_string(), journal: "ApJ".to_string(), year: 2013, doi: Some("10.1088/0004-637X/765/2/131".to_string()) },
                Citation { key: "wordsworth2013".to_string(), authors: "Wordsworth, R., Pierrehumbert, R.".to_string(), title: "Hydrogen-nitrogen greenhouse warming in Earth's early atmosphere".to_string(), journal: "Science".to_string(), year: 2013, doi: Some("10.1126/science.1225759".to_string()) },
            ],
            inputs: vec![
                ParamDescriptor { name: "stellar_flux".into(), unit: "W/m²".into(), description: "Top-of-atmosphere flux".into(), range_min: Some(50.0), range_max: Some(5000.0) },
                ParamDescriptor { name: "surface_pressure".into(), unit: "bar".into(), description: "Total surface pressure".into(), range_min: Some(0.001), range_max: Some(300.0) },
                ParamDescriptor { name: "co2_mixing_ratio".into(), unit: "".into(), description: "CO₂ volume mixing ratio".into(), range_min: Some(0.0), range_max: Some(1.0) },
                ParamDescriptor { name: "h2o_mixing_ratio".into(), unit: "".into(), description: "H₂O volume mixing ratio".into(), range_min: Some(0.0), range_max: Some(0.1) },
            ],
            outputs: vec![
                ParamDescriptor { name: "surface_temp_k".into(), unit: "K".into(), description: "Surface temperature".into(), range_min: Some(150.0), range_max: Some(800.0) },
                ParamDescriptor { name: "tropopause_temp_k".into(), unit: "K".into(), description: "Tropopause temperature".into(), range_min: None, range_max: None },
                ParamDescriptor { name: "olr".into(), unit: "W/m²".into(), description: "Outgoing longwave radiation".into(), range_min: None, range_max: None },
            ],
            validation_targets: vec![
                ValidationTarget { body_name: "Earth".into(), parameter: "surface_temp_k".into(), observed_value: 288.0, observed_uncertainty: 2.0, unit: "K".into() },
                ValidationTarget { body_name: "Venus".into(), parameter: "surface_temp_k".into(), observed_value: 737.0, observed_uncertainty: 5.0, unit: "K".into() },
                ValidationTarget { body_name: "Mars".into(), parameter: "surface_temp_k".into(), observed_value: 210.0, observed_uncertainty: 5.0, unit: "K".into() },
            ],
        });

        // ── CLIMATE ──
        self.register(ModelDescriptor {
            id: "climate.energy_balance".to_string(),
            name: "Energy Balance Climate Model".to_string(),
            version: "1.0.0".to_string(),
            category: ModelCategory::Climate,
            domain: ModelDomain {
                mass_earth_min: 0.1,
                mass_earth_max: 10.0,
                radius_earth_min: 0.5,
                radius_earth_max: 3.0,
                temp_k_min: 100.0,
                temp_k_max: 1000.0,
                planet_types: vec!["rocky".into(), "super-earth".into()],
                caveats: vec![
                    "1D global mean — no latitudinal transport".into(),
                    "Ice-albedo feedback simplified".into(),
                ],
            },
            citations: vec![
                Citation { key: "williams1997".to_string(), authors: "Williams, D.M., Kasting, J.F.".to_string(), title: "Habitable planets with high obliquities".to_string(), journal: "Icarus".to_string(), year: 1997, doi: Some("10.1006/icar.1996.5531".to_string()) },
            ],
            inputs: vec![
                ParamDescriptor { name: "stellar_luminosity".into(), unit: "L☉".into(), description: "Host star luminosity".into(), range_min: Some(0.001), range_max: Some(100.0) },
                ParamDescriptor { name: "semi_major_axis_au".into(), unit: "AU".into(), description: "Orbital distance".into(), range_min: Some(0.01), range_max: Some(100.0) },
                ParamDescriptor { name: "obliquity_deg".into(), unit: "°".into(), description: "Axial tilt".into(), range_min: Some(0.0), range_max: Some(90.0) },
            ],
            outputs: vec![
                ParamDescriptor { name: "global_mean_temp_k".into(), unit: "K".into(), description: "Global mean surface temperature".into(), range_min: None, range_max: None },
                ParamDescriptor { name: "ice_line_deg".into(), unit: "°".into(), description: "Latitude of permanent ice line".into(), range_min: Some(0.0), range_max: Some(90.0) },
            ],
            validation_targets: vec![
                ValidationTarget { body_name: "Earth".into(), parameter: "global_mean_temp_k".into(), observed_value: 288.0, observed_uncertainty: 2.0, unit: "K".into() },
                ValidationTarget { body_name: "Earth".into(), parameter: "ice_line_deg".into(), observed_value: 70.0, observed_uncertainty: 5.0, unit: "°".into() },
            ],
        });

        // ── GEOLOGY ──
        self.register(ModelDescriptor {
            id: "geo.tectonic_regime.v1".to_string(),
            name: "Tectonic Regime Classification".to_string(),
            version: "1.0.0".to_string(),
            category: ModelCategory::Geology,
            domain: ModelDomain {
                mass_earth_min: 0.01,
                mass_earth_max: 10.0,
                radius_earth_min: 0.2,
                radius_earth_max: 3.5,
                temp_k_min: 50.0,
                temp_k_max: 1500.0,
                planet_types: vec!["sub-earth".into(), "rocky".into(), "super-earth".into()],
                caveats: vec![
                    "Plate tectonics initiation criteria remain debated".into(),
                    "Super-Earth tectonic regime uncertain (Valencia vs O'Neill debate)".into(),
                ],
            },
            citations: vec![
                Citation { key: "valencia2007".to_string(), authors: "Valencia, D., O'Connell, R.J., Sasselov, D.D.".to_string(), title: "Inevitability of plate tectonics on super-Earths".to_string(), journal: "ApJ".to_string(), year: 2007, doi: Some("10.1086/509781".to_string()) },
                Citation { key: "oneill2007".to_string(), authors: "O'Neill, C., Lenardic, A.".to_string(), title: "Geological consequences of super-sized Earths".to_string(), journal: "GRL".to_string(), year: 2007, doi: Some("10.1029/2007GL030598".to_string()) },
                Citation { key: "stamenovic2012".to_string(), authors: "Stamenković, V., et al.".to_string(), title: "The influence of pressure-dependent viscosity on mantle convection".to_string(), journal: "ApJ".to_string(), year: 2012, doi: Some("10.1088/0004-637X/748/1/41".to_string()) },
            ],
            inputs: vec![
                ParamDescriptor { name: "mass_earth".into(), unit: "M⊕".into(), description: "Planet mass".into(), range_min: Some(0.01), range_max: Some(10.0) },
                ParamDescriptor { name: "age_gyr".into(), unit: "Gyr".into(), description: "System age".into(), range_min: Some(0.1), range_max: Some(13.0) },
            ],
            outputs: vec![
                ParamDescriptor { name: "tectonic_regime".into(), unit: "".into(), description: "StagnantLid|MobileLid|Episodic|None".into(), range_min: None, range_max: None },
                ParamDescriptor { name: "heat_flux".into(), unit: "mW/m²".into(), description: "Surface heat flux".into(), range_min: Some(0.0), range_max: None },
            ],
            validation_targets: vec![
                ValidationTarget { body_name: "Earth".into(), parameter: "heat_flux".into(), observed_value: 87.0, observed_uncertainty: 5.0, unit: "mW/m²".into() },
                ValidationTarget { body_name: "Venus".into(), parameter: "heat_flux".into(), observed_value: 20.0, observed_uncertainty: 10.0, unit: "mW/m²".into() },
            ],
        });
    }
}

// ── Module-level convenience functions ──────────────

/// Access the global model registry (initializes on first call).
pub fn registry() -> &'static ModelRegistry {
    ModelRegistry::global()
}

/// Get the full model manifest as serializable JSON.
pub fn manifest() -> serde_json::Value {
    let reg = ModelRegistry::global();
    let models: Vec<_> = reg.manifest();
    serde_json::to_value(models).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_registry_initializes() {
        let reg = ModelRegistry::global();
        assert!(reg.models.len() >= 5);
    }

    #[test]
    fn test_category_lookup() {
        let reg = ModelRegistry::global();
        let atm_models = reg.models_for_category(ModelCategory::Atmosphere);
        assert!(!atm_models.is_empty());
    }

    #[test]
    fn test_applicability_earth() {
        let reg = ModelRegistry::global();
        let comp = reg.get("comp.zeng2019").unwrap();
        let result = comp.check_applicability(Some(1.0), Some(1.0), Some(288.0), "rocky");
        assert!(result.applicable);
        assert!(result.confidence > 0.9);
    }

    #[test]
    fn test_applicability_outside_domain() {
        let reg = ModelRegistry::global();
        let comp = reg.get("comp.zeng2019").unwrap();
        let result = comp.check_applicability(Some(318.0), Some(11.2), Some(165.0), "gas-giant");
        assert!(!result.applicable); // gas-giant not in domain
    }

    #[test]
    fn test_best_model_selection() {
        let reg = ModelRegistry::global();
        let best = reg.select_best(
            ModelCategory::Composition,
            Some(1.0),
            Some(1.0),
            Some(288.0),
            "rocky",
        );
        assert!(best.is_some());
        assert_eq!(best.unwrap().0.id, "comp.zeng2019");
    }
}
