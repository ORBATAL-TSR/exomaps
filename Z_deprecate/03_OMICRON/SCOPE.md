# OMICRON Renderer Scope

## Realism Requirements
- Physically-based rendering for all objects
- Limb brightening, granulation, streamer rays, analytic corona for stars
- Cook-Torrance PBR, subsurface scattering, procedural detail for planets
- Realistic belts, nebulae, atmospheres (Rayleigh/Mie scattering)
- Full procedural generation: noise, tectonics, volcanism, erosion, ocean, biomes, albedo, normals, heightmap
- Accurate orbital mechanics, resonance chains, belt structure

## Performance Requirements
- All rendering, geometry, and shaders in Rust (wgpu/Vulkan)
- GPU-first, multi-threaded, adaptive LOD
- 4K textures, 64-bit floating point, real-time procedural generation

## UI Requirements
- Minimal shell (egui/Tauri) for overlays, controls, info panels
- Direct input: mouse, keyboard, gamepad
- Windowing: cross-platform, all rendering in Rust

## References
- wgpu, bevy, vulkan, egui, tauri

---

All code and architecture must be accurate to this scope. Expand as needed for realism and performance.