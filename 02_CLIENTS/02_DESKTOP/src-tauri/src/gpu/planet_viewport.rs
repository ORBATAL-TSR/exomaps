//! Native GPU planet viewport — direct wgpu surface rendering.
//!
//! Renders PBR planets directly to a native OS window surface.
//! No WebGL, no canvas, no base64 — zero-overhead GPU presentation.
//!
//! Architecture:
//!   - Dedicated thread with winit event loop
//!   - wgpu Vulkan surface rendering (no CPU readback)
//!   - Channel-based commands from Tauri IPC
//!   - Mouse orbit + scroll zoom handled natively
//!
//! This is the standard pattern used by Bevy, Veloren, rend3, and
//! every other serious Rust game engine.

use std::sync::{mpsc, Arc, OnceLock};

use winit::application::ApplicationHandler;
use winit::dpi::LogicalSize;
use winit::event::{ElementState, MouseButton, MouseScrollDelta, WindowEvent};
use winit::event_loop::{ActiveEventLoop, EventLoop, EventLoopProxy};
use winit::window::{Window, WindowId};

#[cfg(target_os = "linux")]
use winit::platform::x11::EventLoopBuilderExtX11;

type UserEvent = ();

use super::camera::{CameraUniform, OrbitalCamera, PlanetParamsUniform, teff_to_color};
use super::sphere_mesh::{self, Vertex};

// ═══════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════

/// Commands sent from the Tauri thread to the viewport thread.
pub enum ViewportCommand {
    /// Upload raw RGBA planet textures to the GPU.
    UploadTextures {
        planet_key: String,
        albedo: Vec<u8>,
        heightmap: Vec<u8>,
        normal: Vec<u8>,
        pbr: Vec<u8>,
        resolution: u32,
    },
    /// Update rendering parameters (star, atmosphere, ocean).
    UpdateParams {
        star_teff: f64,
        star_luminosity: f64,
        ocean_level: f32,
        atmosphere_color: [f32; 3],
        atmosphere_thickness: f32,
    },
    /// Set window title.
    SetTitle(String),
    /// Show and focus the window.
    Focus,
    /// Hide the window (keeps thread alive).
    Hide,
    /// Reposition the viewport window to overlay a specific screen rectangle.
    /// Coordinates are in physical (pixel) screen coordinates.
    Reposition {
        x: i32,
        y: i32,
        width: u32,
        height: u32,
    },
}

struct ViewportHandle {
    tx: mpsc::Sender<ViewportCommand>,
    proxy: EventLoopProxy<UserEvent>,
}

static HANDLE: OnceLock<ViewportHandle> = OnceLock::new();

/// Ensure the viewport thread is running. Idempotent — spawns only once.
pub fn ensure_running() {
    if HANDLE.get().is_some() {
        return;
    }

    let (tx, rx) = mpsc::channel();
    // The EventLoop must be created on the viewport thread (it's !Send on Linux).
    // We receive the EventLoopProxy back via a oneshot channel.
    let (proxy_tx, proxy_rx) = mpsc::channel::<EventLoopProxy<UserEvent>>();

    std::thread::Builder::new()
        .name("planet-viewport".into())
        .spawn(move || {
            let mut builder = EventLoop::<UserEvent>::with_user_event();

            // On Linux, winit panics if EventLoop is created on a non-main thread
            // unless we explicitly opt in via the platform extension.
            #[cfg(target_os = "linux")]
            builder.with_any_thread(true);

            let event_loop: EventLoop<UserEvent> = builder
                .build()
                .expect("Failed to create winit event loop");
            let proxy = event_loop.create_proxy();
            let _ = proxy_tx.send(proxy);

            if let Err(e) = run_viewport_loop(event_loop, rx) {
                log::error!("[Viewport] Event loop failed: {}", e);
            }
        })
        .expect("Failed to spawn viewport thread");

    // Wait for the proxy from the viewport thread
    let proxy = proxy_rx.recv().expect("Failed to get event loop proxy");
    let _ = HANDLE.set(ViewportHandle { tx, proxy });

    log::info!("[Viewport] Native planet viewport thread spawned");
}

/// Send a command to the viewport, waking the event loop.
pub fn send(cmd: ViewportCommand) -> Result<(), String> {
    let h = HANDLE.get().ok_or("Viewport not running")?;
    h.tx.send(cmd).map_err(|e| format!("Viewport channel: {}", e))?;
    let _ = h.proxy.send_event(()); // Wake the winit event loop
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════
// Internal State
// ═══════════════════════════════════════════════════════════════════

struct ViewportState {
    window: Arc<Window>,
    visible: bool,

    // GPU core
    device: wgpu::Device,
    queue: wgpu::Queue,
    surface: wgpu::Surface<'static>,
    surface_config: wgpu::SurfaceConfiguration,
    surface_format: wgpu::TextureFormat,

    // Pipelines
    surface_pipeline: wgpu::RenderPipeline,
    atmosphere_pipeline: wgpu::RenderPipeline,

    // Mesh
    vertex_buffer: wgpu::Buffer,
    index_buffer: wgpu::Buffer,
    num_indices: u32,
    atmos_vertex_buffer: wgpu::Buffer,
    atmos_index_buffer: wgpu::Buffer,
    atmos_num_indices: u32,

    // Uniforms
    camera_buffer: wgpu::Buffer,
    params_buffer: wgpu::Buffer,
    camera_bind_group: wgpu::BindGroup,
    texture_layout: wgpu::BindGroupLayout,

    // Size-dependent
    msaa_view: wgpu::TextureView,
    depth_view: wgpu::TextureView,

    // Planet
    texture_bind_group: Option<wgpu::BindGroup>,

    // Camera
    camera: OrbitalCamera,

    // Render params
    star_teff: f64,
    star_luminosity: f64,
    ocean_level: f32,
    atmosphere_color: [f32; 3],
    atmosphere_thickness: f32,

    // Input
    dragging: bool,
    last_mouse: (f64, f64),

    // Timing
    last_frame: std::time::Instant,
    frame_count: u32,
    fps_timer: std::time::Instant,
}

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

fn create_msaa_view(device: &wgpu::Device, w: u32, h: u32, format: wgpu::TextureFormat) -> wgpu::TextureView {
    device.create_texture(&wgpu::TextureDescriptor {
        label: Some("MSAA Color"),
        size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 4,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
        view_formats: &[],
    }).create_view(&Default::default())
}

fn create_depth_view(device: &wgpu::Device, w: u32, h: u32) -> wgpu::TextureView {
    device.create_texture(&wgpu::TextureDescriptor {
        label: Some("Depth"),
        size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 4,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Depth32Float,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
        view_formats: &[],
    }).create_view(&Default::default())
}

// ═══════════════════════════════════════════════════════════════════
// GPU Initialization
// ═══════════════════════════════════════════════════════════════════

impl ViewportState {
    fn new(window: Arc<Window>) -> Result<Self, Box<dyn std::error::Error>> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::VULKAN,
            ..Default::default()
        });

        let surface = instance.create_surface(window.clone())?;

        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: Some(&surface),
            force_fallback_adapter: false,
        })).ok_or("No compatible GPU adapter")?;

        log::info!("[Viewport] Adapter: {} ({:?})", adapter.get_info().name, adapter.get_info().backend);

        let (device, queue) = pollster::block_on(adapter.request_device(
            &wgpu::DeviceDescriptor {
                label: Some("Planet Viewport"),
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::default(),
                memory_hints: Default::default(),
            },
            None,
        ))?;

        // ── Surface config ──
        let caps = surface.get_capabilities(&adapter);
        let surface_format = caps.formats.iter()
            .find(|f| f.is_srgb())
            .copied()
            .unwrap_or(caps.formats[0]);

        let size = window.inner_size();
        let (w, h) = (size.width.max(1), size.height.max(1));

        let surface_config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format: surface_format,
            width: w,
            height: h,
            present_mode: wgpu::PresentMode::AutoVsync,
            alpha_mode: caps.alpha_modes[0],
            view_formats: vec![],
            desired_maximum_frame_latency: 2,
        };
        surface.configure(&device, &surface_config);

        // ── Shader ──
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Planet PBR Shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("shaders/planet.wgsl").into()),
        });

        // ── Bind group layouts ──
        let camera_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Camera Layout"),
            entries: &[
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

        let texture_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Texture Layout"),
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

        // ── Render pipelines ──
        let surface_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Planet Surface"),
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
                    format: surface_format,
                    blend: Some(wgpu::BlendState::REPLACE),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: Some(wgpu::Face::Back),
                polygon_mode: wgpu::PolygonMode::Fill,
                ..Default::default()
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format: wgpu::TextureFormat::Depth32Float,
                depth_write_enabled: true,
                depth_compare: wgpu::CompareFunction::Less,
                stencil: wgpu::StencilState::default(),
                bias: wgpu::DepthBiasState::default(),
            }),
            multisample: wgpu::MultisampleState { count: 4, mask: !0, alpha_to_coverage_enabled: false },
            multiview: None,
            cache: None,
        });

        let atmosphere_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Atmosphere Shell"),
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
                    format: surface_format,
                    blend: Some(wgpu::BlendState {
                        color: wgpu::BlendComponent {
                            src_factor: wgpu::BlendFactor::SrcAlpha,
                            dst_factor: wgpu::BlendFactor::One,
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
                cull_mode: Some(wgpu::Face::Front),
                polygon_mode: wgpu::PolygonMode::Fill,
                ..Default::default()
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format: wgpu::TextureFormat::Depth32Float,
                depth_write_enabled: false,
                depth_compare: wgpu::CompareFunction::Less,
                stencil: wgpu::StencilState::default(),
                bias: wgpu::DepthBiasState::default(),
            }),
            multisample: wgpu::MultisampleState { count: 4, mask: !0, alpha_to_coverage_enabled: false },
            multiview: None,
            cache: None,
        });

        // ── Meshes ──
        let mesh = sphere_mesh::generate_uv_sphere(1.0, 96, 192);
        let (vertex_buffer, index_buffer, num_indices) = sphere_mesh::create_buffers(&device, &mesh);

        let atmos_mesh = sphere_mesh::generate_uv_sphere(1.05, 48, 96);
        let (atmos_vertex_buffer, atmos_index_buffer, atmos_num_indices) =
            sphere_mesh::create_buffers(&device, &atmos_mesh);

        // ── Uniform buffers ──
        let camera_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Camera Uniform"),
            size: std::mem::size_of::<CameraUniform>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let params_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("Planet Params Uniform"),
            size: std::mem::size_of::<PlanetParamsUniform>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let camera_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Camera Bind Group"),
            layout: &camera_layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: camera_buffer.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 1, resource: params_buffer.as_entire_binding() },
            ],
        });

        // ── Size-dependent resources ──
        let msaa_view = create_msaa_view(&device, w, h, surface_format);
        let depth_view = create_depth_view(&device, w, h);

        let now = std::time::Instant::now();

        Ok(Self {
            window,
            visible: false,
            device,
            queue,
            surface,
            surface_config,
            surface_format,
            surface_pipeline,
            atmosphere_pipeline,
            vertex_buffer,
            index_buffer,
            num_indices,
            atmos_vertex_buffer,
            atmos_index_buffer,
            atmos_num_indices,
            camera_buffer,
            params_buffer,
            camera_bind_group,
            texture_layout,
            msaa_view,
            depth_view,
            texture_bind_group: None,
            camera: OrbitalCamera::default(),
            star_teff: 5778.0,
            star_luminosity: 1.0,
            ocean_level: 0.4,
            atmosphere_color: [0.3, 0.5, 0.9],
            atmosphere_thickness: 0.5,
            dragging: false,
            last_mouse: (0.0, 0.0),
            last_frame: now,
            frame_count: 0,
            fps_timer: now,
        })
    }

    // ── Resize ──

    fn resize(&mut self, w: u32, h: u32) {
        if w == 0 || h == 0 { return; }
        self.surface_config.width = w;
        self.surface_config.height = h;
        self.surface.configure(&self.device, &self.surface_config);
        self.msaa_view = create_msaa_view(&self.device, w, h, self.surface_format);
        self.depth_view = create_depth_view(&self.device, w, h);
    }

    // ── Texture upload ──

    fn upload_textures(
        &mut self,
        planet_key: &str,
        albedo: &[u8],
        heightmap: &[u8],
        normal: &[u8],
        pbr: &[u8],
        resolution: u32,
    ) {
        let mk = |label: &str, data: &[u8]| -> wgpu::Texture {
            let tex = self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some(label),
                size: wgpu::Extent3d { width: resolution, height: resolution, depth_or_array_layers: 1 },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8UnormSrgb,
                usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                view_formats: &[],
            });
            self.queue.write_texture(
                wgpu::ImageCopyTexture { texture: &tex, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
                data,
                wgpu::ImageDataLayout { offset: 0, bytes_per_row: Some(resolution * 4), rows_per_image: Some(resolution) },
                wgpu::Extent3d { width: resolution, height: resolution, depth_or_array_layers: 1 },
            );
            tex
        };

        let a = mk("Albedo", albedo);
        let h = mk("Heightmap", heightmap);
        let n = mk("Normal", normal);
        let p = mk("PBR", pbr);

        let sampler = self.device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("Planet Sampler"),
            address_mode_u: wgpu::AddressMode::Repeat,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });

        self.texture_bind_group = Some(self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Planet Textures"),
            layout: &self.texture_layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&a.create_view(&Default::default())) },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(&h.create_view(&Default::default())) },
                wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::TextureView(&n.create_view(&Default::default())) },
                wgpu::BindGroupEntry { binding: 3, resource: wgpu::BindingResource::TextureView(&p.create_view(&Default::default())) },
                wgpu::BindGroupEntry { binding: 4, resource: wgpu::BindingResource::Sampler(&sampler) },
            ],
        }));

        log::info!("[Viewport] Textures uploaded: {} ({}x{})", planet_key, resolution, resolution);
    }

    // ── Render one frame ──

    fn render(&mut self) {
        let tex_bg = match &self.texture_bind_group {
            Some(bg) => bg,
            None => return, // No textures yet — nothing to render
        };

        let output = match self.surface.get_current_texture() {
            Ok(t) => t,
            Err(wgpu::SurfaceError::Lost | wgpu::SurfaceError::Outdated) => {
                let (w, h) = (self.surface_config.width, self.surface_config.height);
                self.resize(w, h);
                return;
            }
            Err(e) => {
                log::warn!("[Viewport] Surface error: {:?}", e);
                return;
            }
        };

        let surface_view = output.texture.create_view(&Default::default());

        // Update camera
        let (w, h) = (self.surface_config.width, self.surface_config.height);
        let aspect = w as f32 / h as f32;
        let cam_uniform = self.camera.build_uniform(aspect);
        self.queue.write_buffer(&self.camera_buffer, 0, bytemuck::bytes_of(&cam_uniform));

        // Update planet params
        let sun_color = teff_to_color(self.star_teff);
        let params = PlanetParamsUniform {
            sun_direction: [0.577, 0.333, 0.577],
            sun_intensity: self.star_luminosity as f32,
            sun_color,
            ocean_level: self.ocean_level,
            atmosphere_color: self.atmosphere_color,
            atmosphere_thickness: self.atmosphere_thickness,
            planet_radius: 1.0,
            displacement_scale: 0.02,
            time_of_day: 0.0,
            _pad1: 0.0,
        };
        self.queue.write_buffer(&self.params_buffer, 0, bytemuck::bytes_of(&params));

        // ── Encode render pass ──
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("Frame Encoder"),
        });

        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Planet Pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &self.msaa_view,
                    resolve_target: Some(&surface_view), // MSAA resolves to swapchain
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color { r: 0.024, g: 0.039, b: 0.071, a: 1.0 }),
                        store: wgpu::StoreOp::Discard, // MSAA buffer discarded after resolve
                    },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &self.depth_view,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(1.0),
                        store: wgpu::StoreOp::Discard,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: None,
                occlusion_query_set: None,
            });

            // Draw planet surface
            pass.set_pipeline(&self.surface_pipeline);
            pass.set_bind_group(0, &self.camera_bind_group, &[]);
            pass.set_bind_group(1, tex_bg, &[]);
            pass.set_vertex_buffer(0, self.vertex_buffer.slice(..));
            pass.set_index_buffer(self.index_buffer.slice(..), wgpu::IndexFormat::Uint32);
            pass.draw_indexed(0..self.num_indices, 0, 0..1);

            // Draw atmosphere shell
            if self.atmosphere_thickness > 0.01 {
                pass.set_pipeline(&self.atmosphere_pipeline);
                pass.set_bind_group(0, &self.camera_bind_group, &[]);
                pass.set_bind_group(1, tex_bg, &[]);
                pass.set_vertex_buffer(0, self.atmos_vertex_buffer.slice(..));
                pass.set_index_buffer(self.atmos_index_buffer.slice(..), wgpu::IndexFormat::Uint32);
                pass.draw_indexed(0..self.atmos_num_indices, 0, 0..1);
            }
        }

        self.queue.submit(std::iter::once(encoder.finish()));
        output.present(); // → GPU swapchain. Done. No readback.

        // FPS counter (displayed in title bar)
        self.frame_count += 1;
        let elapsed = self.fps_timer.elapsed().as_secs_f64();
        if elapsed >= 1.0 {
            let fps = (self.frame_count as f64 / elapsed).round() as u32;
            let title = self.window.title();
            let base_title = title.split(" (").next().unwrap_or(&title);
            self.window.set_title(&format!("{} ({} fps)", base_title, fps));
            self.frame_count = 0;
            self.fps_timer = std::time::Instant::now();
        }
    }
}

// ═══════════════════════════════════════════════════════════════════
// ApplicationHandler — winit event loop
// ═══════════════════════════════════════════════════════════════════

struct ViewportApp {
    rx: mpsc::Receiver<ViewportCommand>,
    state: Option<ViewportState>,
}

impl ApplicationHandler<UserEvent> for ViewportApp {
    fn user_event(&mut self, _event_loop: &ActiveEventLoop, _event: UserEvent) {
        // Wake-up event from proxy.send_event(()) — commands processed in about_to_wait
    }

    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.state.is_some() { return; }

        let attrs = Window::default_attributes()
            .with_title("ExoMaps — Planet Viewport")
            .with_inner_size(LogicalSize::new(900.0, 700.0))
            .with_visible(false)
            .with_decorations(false);

        let window = match event_loop.create_window(attrs) {
            Ok(w) => Arc::new(w),
            Err(e) => {
                log::error!("[Viewport] Failed to create window: {}", e);
                event_loop.exit();
                return;
            }
        };

        match ViewportState::new(window) {
            Ok(s) => {
                log::info!("[Viewport] GPU pipeline initialized ({:?} format)", s.surface_format);
                self.state = Some(s);
            }
            Err(e) => {
                log::error!("[Viewport] GPU init failed: {}", e);
                event_loop.exit();
            }
        }
    }

    fn about_to_wait(&mut self, _event_loop: &ActiveEventLoop) {
        let state = match &mut self.state { Some(s) => s, None => return };

        // Process all queued commands
        while let Ok(cmd) = self.rx.try_recv() {
            match cmd {
                ViewportCommand::UploadTextures { planet_key, albedo, heightmap, normal, pbr, resolution } => {
                    state.upload_textures(&planet_key, &albedo, &heightmap, &normal, &pbr, resolution);
                }
                ViewportCommand::UpdateParams { star_teff, star_luminosity, ocean_level, atmosphere_color, atmosphere_thickness } => {
                    state.star_teff = star_teff;
                    state.star_luminosity = star_luminosity;
                    state.ocean_level = ocean_level;
                    state.atmosphere_color = atmosphere_color;
                    state.atmosphere_thickness = atmosphere_thickness;
                }
                ViewportCommand::SetTitle(t) => {
                    state.window.set_title(&t);
                }
                ViewportCommand::Focus => {
                    state.window.set_visible(true);
                    state.window.focus_window();
                    state.visible = true;
                    state.last_frame = std::time::Instant::now();
                    state.fps_timer = std::time::Instant::now();
                    state.frame_count = 0;
                }
                ViewportCommand::Hide => {
                    state.window.set_visible(false);
                    state.visible = false;
                }
                ViewportCommand::Reposition { x, y, width, height } => {
                    use winit::dpi::{PhysicalPosition, PhysicalSize};
                    if width > 0 && height > 0 {
                        let _ = state.window.request_inner_size(PhysicalSize::new(width, height));
                        state.window.set_outer_position(PhysicalPosition::new(x, y));
                        if !state.visible {
                            state.window.set_visible(true);
                            state.visible = true;
                            state.last_frame = std::time::Instant::now();
                            state.fps_timer = std::time::Instant::now();
                            state.frame_count = 0;
                        }
                    }
                }
            }
        }

        // Request continuous redraws when visible
        if state.visible {
            state.window.request_redraw();
        }
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        let state = match &mut self.state { Some(s) => s, None => return };

        match event {
            WindowEvent::CloseRequested => {
                state.window.set_visible(false);
                state.visible = false;
                // Don't exit — just hide. Thread stays alive for reuse.
            }

            WindowEvent::Resized(new_size) => {
                state.resize(new_size.width, new_size.height);
            }

            WindowEvent::RedrawRequested => {
                if !state.visible { return; }

                // Animation: auto-rotate planet
                let now = std::time::Instant::now();
                let dt = now.duration_since(state.last_frame).as_secs_f32();
                state.last_frame = now;

                if !state.dragging {
                    state.camera.planet_rotation += dt * 0.15;
                }

                state.render();
            }

            // ── Mouse orbit ──
            WindowEvent::MouseInput { state: btn_state, button: MouseButton::Left, .. } => {
                state.dragging = btn_state == ElementState::Pressed;
            }

            WindowEvent::CursorMoved { position, .. } => {
                if state.dragging {
                    let dx = position.x - state.last_mouse.0;
                    let dy = position.y - state.last_mouse.1;
                    state.camera.azimuth += dx as f32 * 0.005;
                    state.camera.elevation = (state.camera.elevation + dy as f32 * 0.005).clamp(-1.5, 1.5);
                }
                state.last_mouse = (position.x, position.y);
            }

            // ── Scroll zoom ──
            WindowEvent::MouseWheel { delta, .. } => {
                let scroll = match delta {
                    MouseScrollDelta::LineDelta(_, y) => y as f64,
                    MouseScrollDelta::PixelDelta(pos) => pos.y * 0.01,
                };
                state.camera.distance = (state.camera.distance - scroll as f32 * 0.3).clamp(1.5, 10.0);
            }

            _ => {}
        }
    }
}

// ═══════════════════════════════════════════════════════════════════
// Event loop entry point (runs on dedicated thread)
// ═══════════════════════════════════════════════════════════════════

fn run_viewport_loop(
    event_loop: EventLoop<UserEvent>,
    rx: mpsc::Receiver<ViewportCommand>,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut app = ViewportApp { rx, state: None };
    event_loop.run_app(&mut app)?;
    Ok(())
}
