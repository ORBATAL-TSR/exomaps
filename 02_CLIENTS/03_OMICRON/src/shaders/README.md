# OMICRON Shaders

All star, planet, belt, nebula, and atmosphere shaders are written in WGSL or GLSL and compiled in Rust.

- `star.wgsl`: Limb brightening, granulation, streamer rays, corona
- `planet.wgsl`: Cook-Torrance PBR, subsurface scattering, procedural detail
- `belt.wgsl`: Particle rendering, density, color variation
- `atmosphere.wgsl`: Rayleigh/Mie scattering, volumetric clouds

Add new shaders as needed for realism and performance.