# OMICRON Renderer

This is the skeleton for the new Rust-native renderer for ExoMaps.

## Goals
- Ultra-realistic, physically-based rendering
- All shaders and geometry in Rust (wgpu/Vulkan)
- Full procedural planet/star/nebula generation
- Realistic orbital mechanics, belts, and atmospheres
- Minimal UI shell (egui/Tauri)

## Architecture
- `src/renderer.rs`: Core rendering pipeline
- `src/shaders/`: WGSL/GLSL shaders for all objects
- `src/geometry/`: Mesh generation (QuadSphere, belts, rings)
- `src/simulation/`: World/planet/star generation
- `src/ui/`: Overlay, controls, info panels

## References
- [wgpu](https://github.com/gfx-rs/wgpu)
- [bevy](https://bevyengine.org/)
- [vulkan](https://www.vulkan.org/)
- [egui](https://github.com/emilk/egui)
- [tauri](https://tauri.app/)

## Scope
- Follow ExoMaps realism plan: limb brightening, granulation, corona, belts, atmospheres, procedural detail
- Performance: GPU-first, multi-threaded, adaptive LOD
- Accuracy: All physical and visual effects match scientific realism

---

Start with `src/renderer.rs` and `src/shaders/star.wgsl` for the star pipeline.