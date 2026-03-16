//! Native wgpu planet renderer — renders PBR planets directly on the GPU.
//!
//! This bypasses WebGL entirely. The rendering pipeline:
//!   1. Upload planet textures (albedo, heightmap, normal, PBR) as wgpu textures
//!   2. Render a UV sphere with the WGSL PBR shader to an offscreen texture
//!   3. Read back the rendered frame and encode as PNG/JPEG
//!   4. Send the final composited image to the webview for display
//!
//! The webview just displays an <img> — no Three.js, no WebGL needed for planets.

use std::sync::OnceLock;
use tokio::sync::Mutex;

use super::camera::{CameraUniform, OrbitalCamera, PlanetParamsUniform, teff_to_color};
use super::sphere_mesh::{self, Vertex};

/// Global planet renderer state.
static RENDERER: OnceLock<Mutex<Option<PlanetRenderer>>> = OnceLock::new();

/// Cached planet texture set (already uploaded to GPU).
pub struct PlanetTextures {
    pub albedo: wgpu::Texture,
    pub heightmap: wgpu::Texture,
    pub normal: wgpu::Texture,
    pub pbr: wgpu::Texture,
    pub bind_group: wgpu::BindGroup,
}

/// Cached offscreen render targets — reused across frames when size is unchanged.
struct CachedRenderTargets {
    width: u32,
    height: u32,
    msaa_view: wgpu::TextureView,
    resolve_texture: wgpu::Texture,
    resolve_view: wgpu::TextureView,
    depth_view: wgpu::TextureView,
    staging_buffer: wgpu::Buffer,
    padded_row: u32,
}

/// Parameters for rendering a frame.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RenderRequest {
    /// Camera orbit azimuth (radians)
    pub azimuth: f32,
    /// Camera orbit elevation (radians)
    pub elevation: f32,
    /// Camera distance from center
    pub distance: f32,
    /// Output width in pixels
    pub width: u32,
    /// Output height in pixels
    pub height: u32,
    /// Planet rotation angle (radians)
    pub planet_rotation: f32,
    /// Star effective temperature (K)
    pub star_teff: f64,
    /// Star luminosity (L_sun)
    pub star_luminosity: f64,
    /// Sun direction (normalized)
    pub sun_direction: [f32; 3],
    /// Ocean level threshold (0-1)
    pub ocean_level: f32,
    /// Atmosphere Rayleigh color
    pub atmosphere_color: [f32; 3],
    /// Atmosphere optical thickness (0-1)
    pub atmosphere_thickness: f32,
}

impl Default for RenderRequest {
    fn default() -> Self {
        Self {
            azimuth: 0.0,
            elevation: 0.2,
            distance: 3.0,
            width: 800,
            height: 600,
            planet_rotation: 0.0,
            star_teff: 5778.0,
            star_luminosity: 1.0,
            sun_direction: [0.577, 0.577, 0.577],
            ocean_level: 0.4,
            atmosphere_color: [0.3, 0.5, 0.9],
            atmosphere_thickness: 0.5,
        }
    }
}

/// The native planet renderer.
struct PlanetRenderer {
    device: wgpu::Device,
    queue: wgpu::Queue,

    // Render pipelines
    surface_pipeline: wgpu::RenderPipeline,
    atmosphere_pipeline: wgpu::RenderPipeline,

    // Bind group layouts
    camera_layout: wgpu::BindGroupLayout,
    texture_layout: wgpu::BindGroupLayout,

    // Sphere mesh
    vertex_buffer: wgpu::Buffer,
    index_buffer: wgpu::Buffer,
    num_indices: u32,

    // Atmosphere shell mesh (slightly larger sphere)
    atmos_vertex_buffer: wgpu::Buffer,
    atmos_index_buffer: wgpu::Buffer,
    atmos_num_indices: u32,

    // Current planet textures (uploaded to GPU)
    current_textures: Option<PlanetTextures>,
    current_planet_key: String,

    // Camera uniform buffer
    camera_buffer: wgpu::Buffer,
    params_buffer: wgpu::Buffer,
    camera_bind_group: wgpu::BindGroup,

    // Cached offscreen render targets (reused when size unchanged)
    cached_targets: Option<CachedRenderTargets>,
}

/// Initialize the native planet renderer.
/// Must be called AFTER gpu::renderer::initialize_gpu().
pub async fn initialize(
    device: wgpu::Device,
    queue: wgpu::Queue,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let renderer = PlanetRenderer::new(device, queue)?;

    let _ = RENDERER.set(Mutex::new(Some(renderer)));
    log::info!("[NativeRenderer] Planet render pipeline initialized");

    Ok(())
}

/// Upload planet textures to the GPU for rendering.
/// Call this after generate_planet_textures_v2 completes.
pub async fn upload_textures(
    planet_key: &str,
    albedo_rgba: &[u8],
    heightmap_rgba: &[u8],
    normal_rgba: &[u8],
    pbr_rgba: &[u8],
    resolution: u32,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mutex = RENDERER.get().ok_or("Native renderer not initialized")?;
    let mut guard = mutex.lock().await;
    let renderer = guard.as_mut().ok_or("Renderer state is None")?;

    renderer.upload_textures(planet_key, albedo_rgba, heightmap_rgba, normal_rgba, pbr_rgba, resolution)?;
    log::info!("[NativeRenderer] Textures uploaded for {} ({}x{})", planet_key, resolution, resolution);

    Ok(())
}

/// Render a single frame and return the RGBA pixel data.
pub async fn render_frame(
    req: &RenderRequest,
) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
    let mutex = RENDERER.get().ok_or("Native renderer not initialized")?;
    let mut guard = mutex.lock().await;
    let renderer = guard.as_mut().ok_or("Renderer state is None")?;

    renderer.render(req).await
}

/// Render a frame and encode as PNG base64 (slow — use raw_b64 for real-time).
pub async fn render_frame_png_b64(
    req: &RenderRequest,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let rgba = render_frame(req).await?;

    // Encode as PNG
    use image::{ImageBuffer, Rgba};
    use std::io::Cursor;

    let img: ImageBuffer<Rgba<u8>, _> =
        ImageBuffer::from_raw(req.width, req.height, rgba)
            .ok_or("Failed to create image buffer")?;

    let mut buf = Cursor::new(Vec::new());
    img.write_to(&mut buf, image::ImageFormat::Png)?;

    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(buf.into_inner()))
}

/// Render a frame and return raw RGBA pixels as base64 (fast — no PNG encoding).
pub async fn render_frame_raw_b64(
    req: &RenderRequest,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let rgba = render_frame(req).await?;
    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(&rgba))
}

/// Check if textures are loaded for a given planet key.
pub async fn has_textures(planet_key: &str) -> bool {
    if let Some(mutex) = RENDERER.get() {
        if let Ok(guard) = mutex.try_lock() {
            if let Some(renderer) = guard.as_ref() {
                return renderer.current_planet_key == planet_key;
            }
        }
    }
    false
}

// ── Renderer Implementation ──

impl PlanetRenderer {
    fn new(
        device: wgpu::Device,
        queue: wgpu::Queue,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        // Load WGSL shader
        let shader_src = include_str!("shaders/planet.wgsl");
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Planet PBR Shader"),
            source: wgpu::ShaderSource::Wgsl(shader_src.into()),
        });

        // ── Bind group layouts ──

        // Group 0: Camera + Params uniforms
        let camera_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Camera Bind Group Layout"),
            entries: &[
                // Camera uniform
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                // Planet params uniform
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });

        // Group 1: Textures + Sampler
        let texture_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Texture Bind Group Layout"),
            entries: &[
                // Albedo
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT | wgpu::ShaderStages::VERTEX,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                // Heightmap
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT | wgpu::ShaderStages::VERTEX,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                // Normal
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                // PBR
                wgpu::BindGroupLayoutEntry {
                    binding: 3,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                // Sampler
                wgpu::BindGroupLayoutEntry {
                    binding: 4,
                    visibility: wgpu::ShaderStages::FRAGMENT | wgpu::ShaderStages::VERTEX,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Planet Pipeline Layout"),
            bind_group_layouts: &[&camera_layout, &texture_layout],
            push_constant_ranges: &[],
        });

        // ── Surface render pipeline ──
        let surface_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Planet Surface Pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                buffers: &[Vertex::layout()],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: wgpu::TextureFormat::Rgba8UnormSrgb,
                    blend: Some(wgpu::BlendState::REPLACE),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                strip_index_format: None,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: Some(wgpu::Face::Back),
                polygon_mode: wgpu::PolygonMode::Fill,
                unclipped_depth: false,
                conservative: false,
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format: wgpu::TextureFormat::Depth32Float,
                depth_write_enabled: true,
                depth_compare: wgpu::CompareFunction::Less,
                stencil: wgpu::StencilState::default(),
                bias: wgpu::DepthBiasState::default(),
            }),
            multisample: wgpu::MultisampleState {
                count: 4, // 4x MSAA
                mask: !0,
                alpha_to_coverage_enabled: false,
            },
            multiview: None,
            cache: None,
        });

        // ── Atmosphere shell pipeline (transparent, back-face, additive) ──
        let atmosphere_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Atmosphere Shell Pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_atmosphere"),
                buffers: &[Vertex::layout()],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_atmosphere"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: wgpu::TextureFormat::Rgba8UnormSrgb,
                    blend: Some(wgpu::BlendState {
                        color: wgpu::BlendComponent {
                            src_factor: wgpu::BlendFactor::SrcAlpha,
                            dst_factor: wgpu::BlendFactor::One, // Additive
                            operation: wgpu::BlendOperation::Add,
                        },
                        alpha: wgpu::BlendComponent {
                            src_factor: wgpu::BlendFactor::Zero,
                            dst_factor: wgpu::BlendFactor::One,
                            operation: wgpu::BlendOperation::Add,
                        },
                    }),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: Some(wgpu::Face::Front), // Render back faces for atmosphere
                polygon_mode: wgpu::PolygonMode::Fill,
                ..Default::default()
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format: wgpu::TextureFormat::Depth32Float,
                depth_write_enabled: false, // Don't write depth for transparent
                depth_compare: wgpu::CompareFunction::Less,
                stencil: wgpu::StencilState::default(),
                bias: wgpu::DepthBiasState::default(),
            }),
            multisample: wgpu::MultisampleState {
                count: 4,
                mask: !0,
                alpha_to_coverage_enabled: false,
            },
            multiview: None,
            cache: None,
        });

        // ── Sphere mesh ──
        let mesh = sphere_mesh::generate_uv_sphere(1.0, 96, 192);
        let (vertex_buffer, index_buffer, num_indices) =
            sphere_mesh::create_buffers(&device, &mesh);

        // Atmosphere shell (5% larger)
        let atmos_mesh = sphere_mesh::generate_uv_sphere(1.05, 48, 96);
        let (atmos_vertex_buffer, atmos_index_buffer, atmos_num_indices) =
            sphere_mesh::create_buffers(&device, &atmos_mesh);

        // ── Uniform buffers ──
        let camera_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Camera Uniform Buffer"),
            size: std::mem::size_of::<CameraUniform>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let params_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Planet Params Uniform Buffer"),
            size: std::mem::size_of::<PlanetParamsUniform>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let camera_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Camera Bind Group"),
            layout: &camera_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: camera_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: params_buffer.as_entire_binding(),
                },
            ],
        });

        Ok(Self {
            device,
            queue,
            surface_pipeline,
            atmosphere_pipeline,
            camera_layout,
            texture_layout,
            vertex_buffer,
            index_buffer,
            num_indices,
            atmos_vertex_buffer,
            atmos_index_buffer,
            atmos_num_indices,
            current_textures: None,
            current_planet_key: String::new(),
            camera_buffer,
            params_buffer,
            camera_bind_group,
            cached_targets: None,
        })
    }

    /// Upload RGBA texture data as wgpu textures.
    fn upload_textures(
        &mut self,
        planet_key: &str,
        albedo_rgba: &[u8],
        heightmap_rgba: &[u8],
        normal_rgba: &[u8],
        pbr_rgba: &[u8],
        resolution: u32,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let create_tex = |label: &str, data: &[u8]| -> wgpu::Texture {
            let tex = self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some(label),
                size: wgpu::Extent3d {
                    width: resolution,
                    height: resolution,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8UnormSrgb,
                usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                view_formats: &[],
            });

            self.queue.write_texture(
                wgpu::ImageCopyTexture {
                    texture: &tex,
                    mip_level: 0,
                    origin: wgpu::Origin3d::ZERO,
                    aspect: wgpu::TextureAspect::All,
                },
                data,
                wgpu::ImageDataLayout {
                    offset: 0,
                    bytes_per_row: Some(resolution * 4),
                    rows_per_image: Some(resolution),
                },
                wgpu::Extent3d {
                    width: resolution,
                    height: resolution,
                    depth_or_array_layers: 1,
                },
            );

            tex
        };

        let albedo = create_tex("Planet Albedo", albedo_rgba);
        let heightmap = create_tex("Planet Heightmap", heightmap_rgba);
        let normal = create_tex("Planet Normal", normal_rgba);
        let pbr = create_tex("Planet PBR", pbr_rgba);

        // Create texture views
        let albedo_view = albedo.create_view(&Default::default());
        let heightmap_view = heightmap.create_view(&Default::default());
        let normal_view = normal.create_view(&Default::default());
        let pbr_view = pbr.create_view(&Default::default());

        // Create sampler (linear + mipmapped)
        let sampler = self.device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("Planet Texture Sampler"),
            address_mode_u: wgpu::AddressMode::Repeat,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });

        // Create bind group
        let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Planet Texture Bind Group"),
            layout: &self.texture_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&albedo_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&heightmap_view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::TextureView(&normal_view),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: wgpu::BindingResource::TextureView(&pbr_view),
                },
                wgpu::BindGroupEntry {
                    binding: 4,
                    resource: wgpu::BindingResource::Sampler(&sampler),
                },
            ],
        });

        self.current_textures = Some(PlanetTextures {
            albedo,
            heightmap,
            normal,
            pbr,
            bind_group,
        });
        self.current_planet_key = planet_key.to_string();

        Ok(())
    }

/// Ensure offscreen render targets exist at the given size.
    /// Only recreates GPU resources when the output dimensions change.
    fn ensure_render_targets(&mut self, width: u32, height: u32) {
        if let Some(ref t) = self.cached_targets {
            if t.width == width && t.height == height {
                return; // Already allocated at this size
            }
        }

        let bytes_per_pixel = 4u32;
        let unpadded_row = width * bytes_per_pixel;
        let padded_row = (unpadded_row + 255) & !255;

        let msaa_texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("MSAA Color Target"),
            size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 4,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8UnormSrgb,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        });

        let resolve_texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Resolve Color Target"),
            size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8UnormSrgb,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });

        let depth_texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Depth Buffer"),
            size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 4,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Depth32Float,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        });

        let staging_buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Render Readback Buffer"),
            size: (padded_row * height) as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });

        let msaa_view = msaa_texture.create_view(&Default::default());
        let resolve_view = resolve_texture.create_view(&Default::default());
        let depth_view = depth_texture.create_view(&Default::default());

        self.cached_targets = Some(CachedRenderTargets {
            width,
            height,
            msaa_view,
            resolve_texture,
            resolve_view,
            depth_view,
            staging_buffer,
            padded_row,
        });

        log::info!("[NativeRenderer] Render targets allocated {}x{} (padded_row={})", width, height, padded_row);
    }

    /// Render a single frame to an RGBA buffer.
    /// Uses cached render targets to avoid per-frame GPU allocation overhead.
    async fn render(
        &mut self,
        req: &RenderRequest,
    ) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
        if self.current_textures.is_none() {
            return Err("No textures loaded — call upload_textures first".into());
        }

        let width = req.width.max(64);
        let height = req.height.max(64);

        // Ensure render targets are allocated (only recreates on size change)
        self.ensure_render_targets(width, height);

        // Update camera uniform
        let cam = OrbitalCamera {
            azimuth: req.azimuth,
            elevation: req.elevation,
            distance: req.distance,
            fov_deg: 45.0,
            planet_rotation: req.planet_rotation,
        };
        let aspect = width as f32 / height as f32;
        let cam_uniform = cam.build_uniform(aspect);
        self.queue.write_buffer(&self.camera_buffer, 0, bytemuck::bytes_of(&cam_uniform));

        // Update planet params
        let sun_color = teff_to_color(req.star_teff);
        let params = PlanetParamsUniform {
            sun_direction: req.sun_direction,
            sun_intensity: req.star_luminosity as f32,
            sun_color,
            ocean_level: req.ocean_level,
            atmosphere_color: req.atmosphere_color,
            atmosphere_thickness: req.atmosphere_thickness,
            planet_radius: 1.0,
            displacement_scale: 0.02,
            time_of_day: 0.0,
            _pad1: 0.0,
        };
        self.queue.write_buffer(&self.params_buffer, 0, bytemuck::bytes_of(&params));

        // Borrow cached targets and textures for this frame
        let targets = self.cached_targets.as_ref().unwrap();
        let textures = self.current_textures.as_ref().unwrap();

        // ── Encode render commands ──
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("Planet Render Encoder"),
        });

        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Planet Render Pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &targets.msaa_view,
                    resolve_target: Some(&targets.resolve_view),
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: 0.024, g: 0.039, b: 0.071, a: 1.0,
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &targets.depth_view,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(1.0),
                        store: wgpu::StoreOp::Store,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: None,
                occlusion_query_set: None,
            });

            // ── Draw planet surface ──
            pass.set_pipeline(&self.surface_pipeline);
            pass.set_bind_group(0, &self.camera_bind_group, &[]);
            pass.set_bind_group(1, &textures.bind_group, &[]);
            pass.set_vertex_buffer(0, self.vertex_buffer.slice(..));
            pass.set_index_buffer(self.index_buffer.slice(..), wgpu::IndexFormat::Uint32);
            pass.draw_indexed(0..self.num_indices, 0, 0..1);

            // ── Draw atmosphere shell ──
            if req.atmosphere_thickness > 0.01 {
                pass.set_pipeline(&self.atmosphere_pipeline);
                pass.set_bind_group(0, &self.camera_bind_group, &[]);
                pass.set_bind_group(1, &textures.bind_group, &[]);
                pass.set_vertex_buffer(0, self.atmos_vertex_buffer.slice(..));
                pass.set_index_buffer(self.atmos_index_buffer.slice(..), wgpu::IndexFormat::Uint32);
                pass.draw_indexed(0..self.atmos_num_indices, 0, 0..1);
            }
        }

        // ── Copy to staging buffer and read back ──
        encoder.copy_texture_to_buffer(
            wgpu::ImageCopyTexture {
                texture: &targets.resolve_texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::ImageCopyBuffer {
                buffer: &targets.staging_buffer,
                layout: wgpu::ImageDataLayout {
                    offset: 0,
                    bytes_per_row: Some(targets.padded_row),
                    rows_per_image: Some(height),
                },
            },
            wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
        );

        self.queue.submit(std::iter::once(encoder.finish()));

        // Map staging buffer
        let buffer_slice = targets.staging_buffer.slice(..);
        let (tx, rx) = tokio::sync::oneshot::channel();
        buffer_slice.map_async(wgpu::MapMode::Read, move |result| {
            let _ = tx.send(result);
        });
        self.device.poll(wgpu::Maintain::Wait);
        rx.await??;

        // Copy out RGBA data, removing row padding
        let mapped = buffer_slice.get_mapped_range();
        let padded_row = targets.padded_row;
        let mut rgba = Vec::with_capacity((width * height * 4) as usize);
        for y in 0..height {
            let start = (y * padded_row) as usize;
            let end = start + (width * 4) as usize;
            rgba.extend_from_slice(&mapped[start..end]);
        }
        drop(mapped);
        targets.staging_buffer.unmap();

        Ok(rgba)
    }
}
