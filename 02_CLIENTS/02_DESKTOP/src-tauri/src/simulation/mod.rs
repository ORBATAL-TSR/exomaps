//! Simulation module — physics-based planet property inference.
//!
//! Organized by scientific domain, each with a formal model registry entry.
//! Inspired by VPL/atmos architecture (coupled model iteration)
//! and OpenSpace module system (registry + extensibility).

pub mod atmosphere;
pub mod atmosphere_v2;
pub mod biomes;
pub mod climate;
pub mod composition;
pub mod composition_v2;
pub mod geology;
pub mod interior;
pub mod model_registry;
pub mod tectonics;
