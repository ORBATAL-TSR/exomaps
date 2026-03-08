//! GPU module — wgpu-based rendering and compute for planet generation.
//!
//! Includes SIMD-optimized CPU fallback kernels for batch texture generation.

pub mod compute;
pub mod renderer;
pub mod shared_memory;
pub mod simd_kernels;
pub mod terrain;
pub mod benchmark;
pub mod camera;
pub mod sphere_mesh;
pub mod planet_render;
pub mod planet_viewport;

use serde::{Deserialize, Serialize};

/// GPU adapter information exposed to the frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpuInfo {
    pub name: String,
    pub backend: String,
    pub device_type: String,
    pub driver: String,
    pub features: Vec<String>,
    pub max_texture_size: u32,
    pub max_compute_workgroup_size: [u32; 3],
}
