//! Simulation module — physics-based planet property inference.
//!
//! Organized by scientific domain, each with a formal model registry entry.
//! Inspired by VPL/atmos architecture (coupled model iteration)
//! and OpenSpace module system (registry + extensibility).
//!
//! ## World Generation Pipeline
//!
//! The `world_gen_pipeline` orchestrates a 10-stage generation sequence:
//!   1. System context (stellar parameters)
//!   2. Body origin & formation history
//!   3. Bulk composition (EOS solver)
//!   4. Mass / radius / interior structure
//!   5. Thermal & atmospheric evolution
//!   6. Surface state (geology + tectonics)
//!   7. Multi-axis classification (10 axes)
//!   8. Moon system generation
//!   9. Render profile assembly
//!  10. Colonization assessment

// ── Core scientific modules ─────────────────────────
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

// ── World body model & classification ───────────────
pub mod classification;
pub mod world_body;

// ── Generation pipeline & sub-generators ────────────
pub mod world_gen_pipeline;
pub mod formation_history;
pub mod moon_generator;
pub mod render_profile_builder;
pub mod colonization_profile;
