//! OMICRON UI — egui overlay panels.
//!
//! Camera input handling lives in renderer::camera.
//! This module owns HUD overlays, system info panels, debug readouts.
//! egui integration arrives once the wgpu render graph is stable.

/// Placeholder: info to display in the HUD.
#[derive(Default)]
pub struct UiState {
    pub fps:          f32,
    pub star_count:   usize,
    pub planet_count: usize,
    pub camera_dist:  f32,
}

impl UiState {
    pub fn new() -> Self { Self::default() }
}

// TODO: egui-wgpu RenderPass wired into RenderGraph::PostPass slot.
