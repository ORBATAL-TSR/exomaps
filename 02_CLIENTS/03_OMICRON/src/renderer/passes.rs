//! Render passes.
//!
//! ClearPass    — clears color + depth to deep-space black. Always first.
//! StarFieldPass— GPU-instanced billboard sprites for all stars in the scene.
//! StarPass     — QuadSphere focus star with photosphere VFX.
//! PlanetPass   — PBR planet spheres (stub).
//! PostPass     — bloom + tone-map fullscreen quad (stub).

use std::time::Instant;

use wgpu::util::DeviceExt;
use bytemuck::{Pod, Zeroable};

use crate::renderer::{
    camera::{Camera, CameraUniform},
    gpu::{GpuContext, DEPTH_FORMAT},
    graph::{FrameContext, RenderNode},
    scene::{Scene, StarInstance, LaneInstance},
};
use crate::geometry::{QuadSphere, Vertex};
use crate::simulation::{StarParams, star_uniform, StarUniform};

// ─── ClearPass ────────────────────────────────────────────────────────────────

/// Clears the framebuffer to the void of space.
pub struct ClearPass {
    color: wgpu::Color,
}

impl ClearPass {
    pub fn new() -> Self {
        Self {
            // Deep space: near-black with a faint blue tint
            color: wgpu::Color { r: 0.004, g: 0.004, b: 0.012, a: 1.0 },
        }
    }
}

impl RenderNode for ClearPass {
    fn name(&self) -> &'static str { "ClearPass" }

    fn prepare(&mut self, _ctx: &GpuContext, _scene: &Scene, _camera: &Camera) {}

    fn execute(&self, encoder: &mut wgpu::CommandEncoder, frame: &FrameContext<'_>) {
        // A render pass with LoadOp::Clear performs the clear.
        let _pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("ClearPass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view:           frame.color_view,
                resolve_target: None,
                ops: wgpu::Operations {
                    load:  wgpu::LoadOp::Clear(self.color),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view: frame.depth_view,
                depth_ops: Some(wgpu::Operations {
                    load:  wgpu::LoadOp::Clear(1.0),
                    store: wgpu::StoreOp::Store,
                }),
                stencil_ops: None,
            }),
            ..Default::default()
        });
        // pass is dropped here, ending the render pass
    }
}

// ─── StarPass ─────────────────────────────────────────────────────────────────

/// Renders the focus star as a PBR sphere with full VFX:
/// limb darkening · granulation · chromosphere · corona · faculae.
pub struct StarPass {
    pipeline:    wgpu::RenderPipeline,
    vertex_buf:  wgpu::Buffer,
    index_buf:   wgpu::Buffer,
    index_count: u32,
    cam_buf:     wgpu::Buffer,
    star_buf:    wgpu::Buffer,
    bind_group:  wgpu::BindGroup,
    star:        StarParams,
    start:       Instant,   // #18 accurate wall-clock time
}

fn uniform_bgl_entry(binding: u32, vis: wgpu::ShaderStages) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: vis,
        ty: wgpu::BindingType::Buffer {
            ty: wgpu::BufferBindingType::Uniform,
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    }
}

impl StarPass {
    pub fn new(ctx: &GpuContext, surface_format: wgpu::TextureFormat) -> Self {
        let device = &ctx.device;

        // ── Geometry ──────────────────────────────────────────────────────────
        let sphere = QuadSphere::new(64);
        let vertex_buf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label:    Some("star_verts"),
            contents: bytemuck::cast_slice(&sphere.vertices),
            usage:    wgpu::BufferUsages::VERTEX,
        });
        let index_buf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label:    Some("star_idx"),
            contents: bytemuck::cast_slice(&sphere.indices),
            usage:    wgpu::BufferUsages::INDEX,
        });
        let index_count = sphere.indices.len() as u32;

        // ── Uniform buffers ───────────────────────────────────────────────────
        let cam_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label:              Some("star_cam"),
            size:               std::mem::size_of::<CameraUniform>() as u64,
            usage:              wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let star_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label:              Some("star_ub"),
            size:               std::mem::size_of::<StarUniform>() as u64,
            usage:              wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        // ── Bind group ────────────────────────────────────────────────────────
        let both = wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT;
        let bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label:   Some("star_bgl"),
            entries: &[
                uniform_bgl_entry(0, both),
                uniform_bgl_entry(1, both),  // vs_main uses star.radius to scale the sphere
            ],
        });
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label:   Some("star_bg"),
            layout:  &bgl,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: cam_buf.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 1, resource: star_buf.as_entire_binding() },
            ],
        });

        // ── Pipeline ──────────────────────────────────────────────────────────
        let shader = device.create_shader_module(
            wgpu::include_wgsl!("../shaders/star.wgsl")
        );
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label:                Some("star_pl"),
            bind_group_layouts:   &[&bgl],
            push_constant_ranges: &[],
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label:  Some("star_pipe"),
            layout: Some(&layout),
            vertex: wgpu::VertexState {
                module:               &shader,
                entry_point:          "vs_main",
                buffers:              &[Vertex::layout()],
                compilation_options:  Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module:              &shader,
                entry_point:         "fs_main",
                compilation_options: Default::default(),
                targets:             &[Some(wgpu::ColorTargetState {
                    format:     surface_format,
                    blend:      Some(wgpu::BlendState::REPLACE),
                    write_mask: wgpu::ColorWrites::COLOR,  // don't punch alpha on Linux swapchain
                })],
            }),
            primitive: wgpu::PrimitiveState {
                topology:  wgpu::PrimitiveTopology::TriangleList,
                cull_mode: Some(wgpu::Face::Back),
                ..Default::default()
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format:              DEPTH_FORMAT,
                depth_write_enabled: true,
                depth_compare:       wgpu::CompareFunction::Less,
                stencil:             wgpu::StencilState::default(),
                bias:                wgpu::DepthBiasState::default(),
            }),
            multisample: wgpu::MultisampleState::default(),
            multiview:   None,
        });

        Self {
            pipeline, vertex_buf, index_buf, index_count,
            cam_buf, star_buf, bind_group,
            star: StarParams::sol(),
            start: Instant::now(),
        }
    }
}

impl RenderNode for StarPass {
    fn name(&self) -> &'static str { "StarPass" }

    fn prepare(&mut self, ctx: &GpuContext, _scene: &Scene, camera: &Camera) {
        let time = self.start.elapsed().as_secs_f32();  // #18 accurate time

        let cu = camera.as_uniform();
        ctx.queue.write_buffer(&self.cam_buf,  0, bytemuck::bytes_of(&cu));

        let su = star_uniform(&self.star, time);
        ctx.queue.write_buffer(&self.star_buf, 0, bytemuck::bytes_of(&su));
    }

    fn execute(&self, encoder: &mut wgpu::CommandEncoder, frame: &FrameContext<'_>) {
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("StarPass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view:           frame.color_view,
                resolve_target: None,
                ops: wgpu::Operations {
                    load:  wgpu::LoadOp::Load,   // ClearPass already cleared
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view: frame.depth_view,
                depth_ops: Some(wgpu::Operations {
                    load:  wgpu::LoadOp::Load,
                    store: wgpu::StoreOp::Store,
                }),
                stencil_ops: None,
            }),
            ..Default::default()
        });

        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &self.bind_group, &[]);
        pass.set_vertex_buffer(0, self.vertex_buf.slice(..));
        pass.set_index_buffer(self.index_buf.slice(..), wgpu::IndexFormat::Uint32);
        pass.draw_indexed(0..self.index_count, 0, 0..1);
    }
}

// ─── CoronaPass ───────────────────────────────────────────────────────────────

/// Renders the corona shell around the focus star.
/// Sphere at 1.5× stellar radius, additive blend, no depth write.
/// Same bind group layout as StarPass (cam @ 0, star @ 1).
pub struct CoronaPass {
    pipeline   : wgpu::RenderPipeline,
    vertex_buf : wgpu::Buffer,
    index_buf  : wgpu::Buffer,
    index_count: u32,
    cam_buf    : wgpu::Buffer,
    star_buf   : wgpu::Buffer,
    bind_group : wgpu::BindGroup,
    star       : StarParams,
    start      : Instant,   // #18
}

impl CoronaPass {
    pub fn new(ctx: &GpuContext, surface_format: wgpu::TextureFormat) -> Self {
        let device = &ctx.device;

        // ── Geometry (same unit QuadSphere as StarPass — scaled 1.5× in shader) ──
        let sphere = QuadSphere::new(64);
        let vertex_buf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label:    Some("corona_verts"),
            contents: bytemuck::cast_slice(&sphere.vertices),
            usage:    wgpu::BufferUsages::VERTEX,
        });
        let index_buf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label:    Some("corona_idx"),
            contents: bytemuck::cast_slice(&sphere.indices),
            usage:    wgpu::BufferUsages::INDEX,
        });
        let index_count = sphere.indices.len() as u32;

        // ── Uniform buffers ───────────────────────────────────────────────────
        let cam_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label:              Some("corona_cam"),
            size:               std::mem::size_of::<CameraUniform>() as u64,
            usage:              wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let star_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label:              Some("corona_star"),
            size:               std::mem::size_of::<StarUniform>() as u64,
            usage:              wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        // ── Bind group (identical layout to StarPass) ─────────────────────────
        let both = wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT;
        let bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label:   Some("corona_bgl"),
            entries: &[
                uniform_bgl_entry(0, both),
                uniform_bgl_entry(1, both),
            ],
        });
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label:   Some("corona_bg"),
            layout:  &bgl,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: cam_buf.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 1, resource: star_buf.as_entire_binding() },
            ],
        });

        // ── Pipeline — additive blend, no depth write, front faces only ───────
        let shader = device.create_shader_module(
            wgpu::include_wgsl!("../shaders/corona.wgsl")
        );
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label:                Some("corona_pl"),
            bind_group_layouts:   &[&bgl],
            push_constant_ranges: &[],
        });
        let additive = wgpu::BlendState {
            color: wgpu::BlendComponent {
                src_factor: wgpu::BlendFactor::SrcAlpha,
                dst_factor: wgpu::BlendFactor::One,
                operation:  wgpu::BlendOperation::Add,
            },
            alpha: wgpu::BlendComponent::OVER,
        };
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label:  Some("corona_pipe"),
            layout: Some(&layout),
            vertex: wgpu::VertexState {
                module:              &shader,
                entry_point:         "vs_main",
                buffers:             &[Vertex::layout()],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module:              &shader,
                entry_point:         "fs_main",
                compilation_options: Default::default(),
                targets:             &[Some(wgpu::ColorTargetState {
                    format:     surface_format,
                    blend:      Some(additive),
                    write_mask: wgpu::ColorWrites::COLOR,
                })],
            }),
            primitive: wgpu::PrimitiveState {
                topology:  wgpu::PrimitiveTopology::TriangleList,
                cull_mode: Some(wgpu::Face::Back),  // front faces only — Fresnel on near limb
                ..Default::default()
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format:              DEPTH_FORMAT,
                depth_write_enabled: false,          // star sphere wrote depth; we read only
                depth_compare:       wgpu::CompareFunction::LessEqual,
                stencil:             wgpu::StencilState::default(),
                bias:                wgpu::DepthBiasState::default(),
            }),
            multisample: wgpu::MultisampleState::default(),
            multiview:   None,
        });

        Self {
            pipeline, vertex_buf, index_buf, index_count,
            cam_buf, star_buf, bind_group,
            star: StarParams::sol(),
            start: Instant::now(),
        }
    }
}

impl RenderNode for CoronaPass {
    fn name(&self) -> &'static str { "CoronaPass" }

    fn prepare(&mut self, ctx: &GpuContext, _scene: &Scene, camera: &Camera) {
        let time = self.start.elapsed().as_secs_f32();  // #18

        let cu = camera.as_uniform();
        ctx.queue.write_buffer(&self.cam_buf, 0, bytemuck::bytes_of(&cu));

        let su = star_uniform(&self.star, time);
        ctx.queue.write_buffer(&self.star_buf, 0, bytemuck::bytes_of(&su));
    }

    fn execute(&self, encoder: &mut wgpu::CommandEncoder, frame: &FrameContext<'_>) {
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("CoronaPass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view:           frame.color_view,
                resolve_target: None,
                ops: wgpu::Operations {
                    load:  wgpu::LoadOp::Load,
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view: frame.depth_view,
                depth_ops: Some(wgpu::Operations {
                    load:  wgpu::LoadOp::Load,
                    store: wgpu::StoreOp::Store,
                }),
                stencil_ops: None,
            }),
            ..Default::default()
        });

        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &self.bind_group, &[]);
        pass.set_vertex_buffer(0, self.vertex_buf.slice(..));
        pass.set_index_buffer(self.index_buf.slice(..), wgpu::IndexFormat::Uint32);
        pass.draw_indexed(0..self.index_count, 0, 0..1);
    }
}

// ─── StarFieldPass ────────────────────────────────────────────────────────────

/// GPU uniform for the star field — view/proj + camera position + time.
/// Layout must exactly match the WGSL `Globals` struct (80 bytes):
///   mat4x4<f32>  view_proj   @ offset  0  (64 bytes)
///   vec3<f32>    cam_pos     @ offset 64  (12 bytes)
///   f32          time        @ offset 76  ( 4 bytes)
#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable)]
pub struct StarFieldGlobals {
    pub view_proj : [[f32; 4]; 4],
    pub cam_pos   : [f32; 3],
    pub time      : f32,
}

/// Renders all stars in the scene as instanced screen-space billboards.
/// Visual effects: spectral color · twinkling · planet-host breathing pulse ·
/// multiplicity rings · confidence shimmer · distance fog.
pub struct StarFieldPass {
    pipeline      : wgpu::RenderPipeline,
    globals_buf   : wgpu::Buffer,
    bind_group    : wgpu::BindGroup,
    instance_buf  : Option<wgpu::Buffer>,
    instance_count: u32,
    last_count    : usize,   // detect scene changes
    time          : f32,
}

impl StarFieldPass {
    pub fn new(ctx: &GpuContext, surface_format: wgpu::TextureFormat) -> Self {
        let device = &ctx.device;

        // ── Globals uniform buffer ────────────────────────────────────────────
        let globals_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label:              Some("starfield_globals"),
            size:               std::mem::size_of::<StarFieldGlobals>() as u64,
            usage:              wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        // ── Bind group layout ─────────────────────────────────────────────────
        let bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label:   Some("starfield_bgl"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding:    0,
                visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty:                 wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size:   None,
                },
                count: None,
            }],
        });

        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label:   Some("starfield_bg"),
            layout:  &bgl,
            entries: &[wgpu::BindGroupEntry {
                binding:  0,
                resource: globals_buf.as_entire_binding(),
            }],
        });

        // ── Render pipeline ───────────────────────────────────────────────────
        // Instance vertex buffer layout (one entry per star, step_mode=Instance)
        // Mirrors StarInstance fields at locations 0-6.
        let instance_layout = wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<StarInstance>() as wgpu::BufferAddress,
            step_mode:    wgpu::VertexStepMode::Instance,
            attributes:   &wgpu::vertex_attr_array![
                0 => Float32x3,  // position
                1 => Float32,    // teff
                2 => Float32,    // luminosity
                3 => Float32,    // radius
                4 => Float32,    // multiplicity
                5 => Float32,    // confidence
                6 => Float32,    // planet_count
            ],
        };

        let shader = device.create_shader_module(
            wgpu::include_wgsl!("../shaders/starfield.wgsl")
        );
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label:                Some("starfield_layout"),
            bind_group_layouts:   &[&bgl],
            push_constant_ranges: &[],
        });

        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label:  Some("starfield_pipe"),
            layout: Some(&layout),
            vertex: wgpu::VertexState {
                module:              &shader,
                entry_point:         "vs_main",
                compilation_options: Default::default(),
                buffers:             &[instance_layout],
            },
            fragment: Some(wgpu::FragmentState {
                module:              &shader,
                entry_point:         "fs_main",
                compilation_options: Default::default(),
                targets:             &[Some(wgpu::ColorTargetState {
                    format:     surface_format,
                    // Additive: star glows stack on the void.
                    // COLOR only — never write alpha channel: on Linux the
                    // compositor treats swapchain alpha as window transparency.
                    blend: Some(wgpu::BlendState {
                        color: wgpu::BlendComponent {
                            src_factor: wgpu::BlendFactor::SrcAlpha,
                            dst_factor: wgpu::BlendFactor::One,
                            operation:  wgpu::BlendOperation::Add,
                        },
                        alpha: wgpu::BlendComponent::OVER,
                    }),
                    write_mask: wgpu::ColorWrites::COLOR,
                })],
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                ..Default::default()
            },
            // Stars are transparent sprites — read depth but never write it
            depth_stencil: Some(wgpu::DepthStencilState {
                format:              DEPTH_FORMAT,
                depth_write_enabled: false,
                depth_compare:       wgpu::CompareFunction::Always,
                stencil:             wgpu::StencilState::default(),
                bias:                wgpu::DepthBiasState::default(),
            }),
            multisample: wgpu::MultisampleState::default(),
            multiview:   None,
        });

        Self {
            pipeline,
            globals_buf,
            bind_group,
            instance_buf:   None,
            instance_count: 0,
            last_count:     0,
            time:           0.0,
        }
    }
}

impl RenderNode for StarFieldPass {
    fn name(&self) -> &'static str { "StarFieldPass" }

    fn prepare(&mut self, ctx: &GpuContext, scene: &Scene, camera: &Camera) {
        self.time += 1.0 / 60.0;

        // Upload globals
        let cu = camera.as_uniform();
        let globals = StarFieldGlobals {
            view_proj: cu.view_proj,
            cam_pos:   cu.eye,
            time:      self.time,
        };
        ctx.queue.write_buffer(&self.globals_buf, 0, bytemuck::bytes_of(&globals));

        // Rebuild instance buffer only when star list changes
        if !scene.stars.is_empty() && scene.stars.len() != self.last_count {
            self.instance_buf = Some(
                ctx.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label:    Some("starfield_instances"),
                    contents: bytemuck::cast_slice(&scene.stars),
                    usage:    wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
                }),
            );
            self.instance_count = scene.stars.len() as u32;
            self.last_count     = scene.stars.len();
        }
    }

    fn execute(&self, encoder: &mut wgpu::CommandEncoder, frame: &FrameContext<'_>) {
        let Some(ref buf) = self.instance_buf else { return; };
        if self.instance_count == 0 { return; }

        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("StarFieldPass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view:           frame.color_view,
                resolve_target: None,
                ops: wgpu::Operations {
                    load:  wgpu::LoadOp::Load,
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view: frame.depth_view,
                depth_ops: Some(wgpu::Operations {
                    load:  wgpu::LoadOp::Load,
                    store: wgpu::StoreOp::Store,
                }),
                stencil_ops: None,
            }),
            ..Default::default()
        });

        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &self.bind_group, &[]);
        pass.set_vertex_buffer(0, buf.slice(..));
        // 6 vertices per star (two triangles), instance_count stars
        pass.draw(0..6, 0..self.instance_count);
    }
}

// ─── GalaxyBgPass ─────────────────────────────────────────────────────────────

/// Fullscreen procedural Milky Way background.
/// Rendered immediately after the clear, always behind all geometry.
/// Uses inverse view-proj to reconstruct the view ray in the fragment shader.
pub struct GalaxyBgPass {
    pipeline    : wgpu::RenderPipeline,
    globals_buf : wgpu::Buffer,
    bind_group  : wgpu::BindGroup,
    time        : f32,
}

/// 80-byte uniform for galaxy_bg.wgsl (view_proj_inv + cam_pos + time).
#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable)]
pub struct GalaxyBgGlobals {
    pub view_proj_inv : [[f32; 4]; 4],   // 64 bytes
    pub cam_pos       : [f32; 3],        // 12 bytes
    pub time          : f32,             //  4 bytes
}

impl GalaxyBgPass {
    pub fn new(ctx: &GpuContext, surface_format: wgpu::TextureFormat) -> Self {
        let device = &ctx.device;

        let globals_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label:              Some("galaxy_bg_globals"),
            size:               std::mem::size_of::<GalaxyBgGlobals>() as u64,
            usage:              wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label:   Some("galaxy_bg_bgl"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding:    0,
                visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty:                 wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size:   None,
                },
                count: None,
            }],
        });

        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label:   Some("galaxy_bg_bg"),
            layout:  &bgl,
            entries: &[wgpu::BindGroupEntry {
                binding:  0,
                resource: globals_buf.as_entire_binding(),
            }],
        });

        let shader = device.create_shader_module(
            wgpu::include_wgsl!("../shaders/galaxy_bg.wgsl")
        );
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label:                Some("galaxy_bg_layout"),
            bind_group_layouts:   &[&bgl],
            push_constant_ranges: &[],
        });

        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label:  Some("galaxy_bg_pipe"),
            layout: Some(&layout),
            vertex: wgpu::VertexState {
                module:              &shader,
                entry_point:         "vs_main",
                compilation_options: Default::default(),
                buffers:             &[],  // fullscreen triangle — no vertex buffer
            },
            fragment: Some(wgpu::FragmentState {
                module:              &shader,
                entry_point:         "fs_main",
                compilation_options: Default::default(),
                targets:             &[Some(wgpu::ColorTargetState {
                    format:     surface_format,
                    // Replace blend: the background replaces whatever was cleared
                    blend:      Some(wgpu::BlendState::REPLACE),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                ..Default::default()
            },
            // z=1.0 in the vertex shader keeps this behind everything;
            // no depth write so real geometry writes over it normally.
            depth_stencil: Some(wgpu::DepthStencilState {
                format:              DEPTH_FORMAT,
                depth_write_enabled: false,
                depth_compare:       wgpu::CompareFunction::Always,
                stencil:             wgpu::StencilState::default(),
                bias:                wgpu::DepthBiasState::default(),
            }),
            multisample: wgpu::MultisampleState::default(),
            multiview:   None,
        });

        Self { pipeline, globals_buf, bind_group, time: 0.0 }
    }
}

impl RenderNode for GalaxyBgPass {
    fn name(&self) -> &'static str { "GalaxyBgPass" }

    fn prepare(&mut self, ctx: &GpuContext, _scene: &Scene, camera: &Camera) {
        self.time += 1.0 / 60.0;

        // Compute inverse view-proj for ray unprojection in the shader
        let vp_inv = camera.view_proj().inverse().to_cols_array_2d();

        let globals = GalaxyBgGlobals {
            view_proj_inv: vp_inv,
            cam_pos:       camera.eye.to_array(),
            time:          self.time,
        };
        ctx.queue.write_buffer(&self.globals_buf, 0, bytemuck::bytes_of(&globals));
    }

    fn execute(&self, encoder: &mut wgpu::CommandEncoder, frame: &FrameContext<'_>) {
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("GalaxyBgPass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view:           frame.color_view,
                resolve_target: None,
                ops: wgpu::Operations {
                    load:  wgpu::LoadOp::Load,   // ClearPass set the base black
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view: frame.depth_view,
                depth_ops: Some(wgpu::Operations {
                    load:  wgpu::LoadOp::Load,
                    store: wgpu::StoreOp::Store,
                }),
                stencil_ops: None,
            }),
            ..Default::default()
        });

        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &self.bind_group, &[]);
        pass.draw(0..3, 0..1);  // fullscreen triangle: 3 vertices, 1 instance
    }
}

// ─── StarlanePass ─────────────────────────────────────────────────────────────

/// Renders K-NN starlane connections as screen-space ribbon quads.
/// Additive blend, no depth write — glowing energy corridors on the void.
pub struct StarlanePass {
    pipeline      : wgpu::RenderPipeline,
    globals_buf   : wgpu::Buffer,
    bind_group    : wgpu::BindGroup,
    instance_buf  : Option<wgpu::Buffer>,
    instance_count: u32,
    last_count    : usize,
    time          : f32,
}

impl StarlanePass {
    pub fn new(ctx: &GpuContext, surface_format: wgpu::TextureFormat) -> Self {
        let device = &ctx.device;

        // ── Globals uniform (same 80-byte layout as StarFieldPass) ────────────
        let globals_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label:              Some("starlane_globals"),
            size:               std::mem::size_of::<StarFieldGlobals>() as u64,
            usage:              wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label:   Some("starlane_bgl"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding:    0,
                visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty:                 wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size:   None,
                },
                count: None,
            }],
        });

        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label:   Some("starlane_bg"),
            layout:  &bgl,
            entries: &[wgpu::BindGroupEntry {
                binding:  0,
                resource: globals_buf.as_entire_binding(),
            }],
        });

        // ── Instance layout — mirrors LaneInstance { pos_a: [f32;4], pos_b: [f32;4] }
        let instance_layout = wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<LaneInstance>() as wgpu::BufferAddress,
            step_mode:    wgpu::VertexStepMode::Instance,
            attributes:   &wgpu::vertex_attr_array![
                0 => Float32x4,  // pos_a (xyz + pad)
                1 => Float32x4,  // pos_b (xyz + pad)
            ],
        };

        let shader = device.create_shader_module(
            wgpu::include_wgsl!("../shaders/starlane.wgsl")
        );
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label:                Some("starlane_layout"),
            bind_group_layouts:   &[&bgl],
            push_constant_ranges: &[],
        });

        let additive_blend = wgpu::BlendState {
            color: wgpu::BlendComponent {
                src_factor: wgpu::BlendFactor::SrcAlpha,
                dst_factor: wgpu::BlendFactor::One,
                operation:  wgpu::BlendOperation::Add,
            },
            alpha: wgpu::BlendComponent::OVER,
        };

        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label:  Some("starlane_pipe"),
            layout: Some(&layout),
            vertex: wgpu::VertexState {
                module:              &shader,
                entry_point:         "vs_main",
                compilation_options: Default::default(),
                buffers:             &[instance_layout],
            },
            fragment: Some(wgpu::FragmentState {
                module:              &shader,
                entry_point:         "fs_main",
                compilation_options: Default::default(),
                targets:             &[Some(wgpu::ColorTargetState {
                    format:     surface_format,
                    blend:      Some(additive_blend),
                    write_mask: wgpu::ColorWrites::COLOR,   // never touch alpha channel
                })],
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                ..Default::default()
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format:              DEPTH_FORMAT,
                depth_write_enabled: false,
                depth_compare:       wgpu::CompareFunction::Always,
                stencil:             wgpu::StencilState::default(),
                bias:                wgpu::DepthBiasState::default(),
            }),
            multisample: wgpu::MultisampleState::default(),
            multiview:   None,
        });

        Self {
            pipeline, globals_buf, bind_group,
            instance_buf:   None,
            instance_count: 0,
            last_count:     0,
            time:           0.0,
        }
    }
}

impl RenderNode for StarlanePass {
    fn name(&self) -> &'static str { "StarlanePass" }

    fn prepare(&mut self, ctx: &GpuContext, scene: &Scene, camera: &Camera) {
        self.time += 1.0 / 60.0;

        let cu = camera.as_uniform();
        let globals = StarFieldGlobals {
            view_proj: cu.view_proj,
            cam_pos:   cu.eye,
            time:      self.time,
        };
        ctx.queue.write_buffer(&self.globals_buf, 0, bytemuck::bytes_of(&globals));

        if !scene.lanes.is_empty() && scene.lanes.len() != self.last_count {
            self.instance_buf = Some(
                ctx.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label:    Some("starlane_instances"),
                    contents: bytemuck::cast_slice(&scene.lanes),
                    usage:    wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
                }),
            );
            self.instance_count = scene.lanes.len() as u32;
            self.last_count     = scene.lanes.len();
        }
    }

    fn execute(&self, encoder: &mut wgpu::CommandEncoder, frame: &FrameContext<'_>) {
        let Some(ref buf) = self.instance_buf else { return; };
        if self.instance_count == 0 { return; }

        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("StarlanePass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view:           frame.color_view,
                resolve_target: None,
                ops: wgpu::Operations {
                    load:  wgpu::LoadOp::Load,
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view: frame.depth_view,
                depth_ops: Some(wgpu::Operations {
                    load:  wgpu::LoadOp::Load,
                    store: wgpu::StoreOp::Store,
                }),
                stencil_ops: None,
            }),
            ..Default::default()
        });

        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &self.bind_group, &[]);
        pass.set_vertex_buffer(0, buf.slice(..));
        // 6 vertices per lane (two ribbon triangles)
        pass.draw(0..6, 0..self.instance_count);
    }
}

// ─── DistanceRingPass ─────────────────────────────────────────────────────────

/// Dashed XZ-plane rings at 5, 10, 15 pc.  Grid reference for the galactic map.
/// CPU-generated ribbon mesh: each ring is `RING_SEGS` quads (6 verts each).
pub struct DistanceRingPass {
    pipeline    : wgpu::RenderPipeline,
    globals_buf : wgpu::Buffer,
    bind_group  : wgpu::BindGroup,
    vertex_buf  : wgpu::Buffer,
    vertex_count: u32,
    time        : f32,
}

/// One ribbon vertex for the ring mesh.
#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable)]
struct RingVertex {
    world_pos : [f32; 3],
    radius_pc : f32,
    arc_t     : f32,
    side      : f32,
}

impl DistanceRingPass {
    const RING_SEGS: usize = 180;  // segments per ring circle
    const RADII_PC: [f32; 3] = [5.0, 10.0, 15.0];

    pub fn new(ctx: &GpuContext, surface_format: wgpu::TextureFormat) -> Self {
        let device = &ctx.device;

        // ── Build ring ribbon mesh on CPU ─────────────────────────────────────
        let verts = Self::build_ring_mesh();

        let vertex_buf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label:    Some("ring_verts"),
            contents: bytemuck::cast_slice(&verts),
            usage:    wgpu::BufferUsages::VERTEX,
        });
        let vertex_count = verts.len() as u32;

        // ── Globals uniform ───────────────────────────────────────────────────
        let globals_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label:              Some("ring_globals"),
            size:               std::mem::size_of::<StarFieldGlobals>() as u64,
            usage:              wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label:   Some("ring_bgl"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding:    0,
                visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty:                 wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size:   None,
                },
                count: None,
            }],
        });

        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label:   Some("ring_bg"),
            layout:  &bgl,
            entries: &[wgpu::BindGroupEntry {
                binding:  0,
                resource: globals_buf.as_entire_binding(),
            }],
        });

        // ── Vertex buffer layout: RingVertex fields ───────────────────────────
        let vert_layout = wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<RingVertex>() as wgpu::BufferAddress,
            step_mode:    wgpu::VertexStepMode::Vertex,
            attributes:   &wgpu::vertex_attr_array![
                0 => Float32x3,  // world_pos
                1 => Float32,    // radius_pc
                2 => Float32,    // arc_t
                3 => Float32,    // side
            ],
        };

        let shader = device.create_shader_module(
            wgpu::include_wgsl!("../shaders/ring.wgsl")
        );
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label:                Some("ring_layout"),
            bind_group_layouts:   &[&bgl],
            push_constant_ranges: &[],
        });

        let additive_blend = wgpu::BlendState {
            color: wgpu::BlendComponent {
                src_factor: wgpu::BlendFactor::SrcAlpha,
                dst_factor: wgpu::BlendFactor::One,
                operation:  wgpu::BlendOperation::Add,
            },
            alpha: wgpu::BlendComponent::OVER,  // alpha channel never written (ColorWrites::COLOR)
        };

        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label:  Some("ring_pipe"),
            layout: Some(&layout),
            vertex: wgpu::VertexState {
                module:              &shader,
                entry_point:         "vs_main",
                compilation_options: Default::default(),
                buffers:             &[vert_layout],
            },
            fragment: Some(wgpu::FragmentState {
                module:              &shader,
                entry_point:         "fs_main",
                compilation_options: Default::default(),
                targets:             &[Some(wgpu::ColorTargetState {
                    format:     surface_format,
                    blend:      Some(additive_blend),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState {
                topology:   wgpu::PrimitiveTopology::TriangleList,
                cull_mode:  None,  // visible from both sides
                ..Default::default()
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format:              DEPTH_FORMAT,
                depth_write_enabled: false,
                depth_compare:       wgpu::CompareFunction::Always,
                stencil:             wgpu::StencilState::default(),
                bias:                wgpu::DepthBiasState::default(),
            }),
            multisample: wgpu::MultisampleState::default(),
            multiview:   None,
        });

        Self { pipeline, globals_buf, bind_group, vertex_buf, vertex_count, time: 0.0 }
    }

    /// Emit a flat ribbon mesh for all three rings in the XZ plane.
    fn build_ring_mesh() -> Vec<RingVertex> {
        let total_verts = Self::RADII_PC.len() * Self::RING_SEGS * 6;
        let mut verts = Vec::with_capacity(total_verts);

        for &r in &Self::RADII_PC {
            for seg in 0..Self::RING_SEGS {
                let t0 = seg as f32       / Self::RING_SEGS as f32;
                let t1 = (seg + 1) as f32 / Self::RING_SEGS as f32;
                let a0 = t0 * std::f32::consts::TAU;
                let a1 = t1 * std::f32::consts::TAU;

                let p0 = [r * a0.cos(), 0.0, r * a0.sin()];
                let p1 = [r * a1.cos(), 0.0, r * a1.sin()];

                // Quad: p0+, p0-, p1+, p0-, p1-, p1+
                let make = |p: [f32; 3], t: f32, side: f32| RingVertex {
                    world_pos: p,
                    radius_pc: r,
                    arc_t:     t,
                    side,
                };

                verts.push(make(p0,  t0,  1.0));
                verts.push(make(p0,  t0, -1.0));
                verts.push(make(p1,  t1,  1.0));
                verts.push(make(p0,  t0, -1.0));
                verts.push(make(p1,  t1, -1.0));
                verts.push(make(p1,  t1,  1.0));
            }
        }

        verts
    }
}

impl RenderNode for DistanceRingPass {
    fn name(&self) -> &'static str { "DistanceRingPass" }

    fn prepare(&mut self, ctx: &GpuContext, _scene: &Scene, camera: &Camera) {
        self.time += 1.0 / 60.0;

        let cu = camera.as_uniform();
        let globals = StarFieldGlobals {
            view_proj: cu.view_proj,
            cam_pos:   cu.eye,
            time:      self.time,
        };
        ctx.queue.write_buffer(&self.globals_buf, 0, bytemuck::bytes_of(&globals));
    }

    fn execute(&self, encoder: &mut wgpu::CommandEncoder, frame: &FrameContext<'_>) {
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("DistanceRingPass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view:           frame.color_view,
                resolve_target: None,
                ops: wgpu::Operations {
                    load:  wgpu::LoadOp::Load,
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view: frame.depth_view,
                depth_ops: Some(wgpu::Operations {
                    load:  wgpu::LoadOp::Load,
                    store: wgpu::StoreOp::Store,
                }),
                stencil_ops: None,
            }),
            ..Default::default()
        });

        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &self.bind_group, &[]);
        pass.set_vertex_buffer(0, self.vertex_buf.slice(..));
        pass.draw(0..self.vertex_count, 0..1);
    }
}

// ─── FocusGlowPass ────────────────────────────────────────────────────────────

/// #17 — Soft lens-glow billboard behind the focus star.
/// 6-vertex screen-space quad, additive blend, no depth write.
/// Size is computed in the shader to match the star's projected footprint × 4.
pub struct FocusGlowPass {
    pipeline   : wgpu::RenderPipeline,
    cam_buf    : wgpu::Buffer,
    star_buf   : wgpu::Buffer,
    bind_group : wgpu::BindGroup,
    star       : StarParams,
    start      : Instant,
}

impl FocusGlowPass {
    pub fn new(ctx: &GpuContext, surface_format: wgpu::TextureFormat) -> Self {
        let device = &ctx.device;

        let cam_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("glow_cam"), size: std::mem::size_of::<CameraUniform>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let star_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("glow_star"), size: std::mem::size_of::<StarUniform>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let both = wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT;
        let bgl  = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label:   Some("glow_bgl"),
            entries: &[uniform_bgl_entry(0, both), uniform_bgl_entry(1, both)],
        });
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label:   Some("glow_bg"),
            layout:  &bgl,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: cam_buf.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 1, resource: star_buf.as_entire_binding() },
            ],
        });

        let shader = device.create_shader_module(wgpu::include_wgsl!("../shaders/focus_glow.wgsl"));
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("glow_pl"), bind_group_layouts: &[&bgl], push_constant_ranges: &[],
        });
        let additive = wgpu::BlendState {
            color: wgpu::BlendComponent {
                src_factor: wgpu::BlendFactor::SrcAlpha,
                dst_factor: wgpu::BlendFactor::One,
                operation:  wgpu::BlendOperation::Add,
            },
            alpha: wgpu::BlendComponent::OVER,
        };
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label:  Some("glow_pipe"),
            layout: Some(&layout),
            vertex: wgpu::VertexState {
                module: &shader, entry_point: "vs_main",
                buffers: &[], compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader, entry_point: "fs_main",
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: surface_format,
                    blend:  Some(additive),
                    write_mask: wgpu::ColorWrites::COLOR,
                })],
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList, ..Default::default()
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format:              DEPTH_FORMAT,
                depth_write_enabled: false,
                depth_compare:       wgpu::CompareFunction::Always,
                stencil:             wgpu::StencilState::default(),
                bias:                wgpu::DepthBiasState::default(),
            }),
            multisample: wgpu::MultisampleState::default(),
            multiview:   None,
        });

        Self { pipeline, cam_buf, star_buf, bind_group, star: StarParams::sol(), start: Instant::now() }
    }
}

impl RenderNode for FocusGlowPass {
    fn name(&self) -> &'static str { "FocusGlowPass" }

    fn prepare(&mut self, ctx: &GpuContext, _scene: &Scene, camera: &Camera) {
        let time = self.start.elapsed().as_secs_f32();
        ctx.queue.write_buffer(&self.cam_buf,  0, bytemuck::bytes_of(&camera.as_uniform()));
        ctx.queue.write_buffer(&self.star_buf, 0, bytemuck::bytes_of(&star_uniform(&self.star, time)));
    }

    fn execute(&self, encoder: &mut wgpu::CommandEncoder, frame: &FrameContext<'_>) {
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("FocusGlowPass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: frame.color_view, resolve_target: None,
                ops: wgpu::Operations { load: wgpu::LoadOp::Load, store: wgpu::StoreOp::Store },
            })],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view: frame.depth_view,
                depth_ops: Some(wgpu::Operations { load: wgpu::LoadOp::Load, store: wgpu::StoreOp::Store }),
                stencil_ops: None,
            }),
            ..Default::default()
        });
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &self.bind_group, &[]);
        pass.draw(0..6, 0..1);  // 6 verts = one billboard quad (no vertex buffer)
    }
}

// ─── PlanetPass (stub) ────────────────────────────────────────────────────────

/// PBR sphere rendering for close-up planet views.
pub struct PlanetPass;

impl PlanetPass {
    #[allow(dead_code)]
    pub fn new(_ctx: &GpuContext) -> Self { Self }
}

impl RenderNode for PlanetPass {
    fn name(&self) -> &'static str { "PlanetPass" }
    fn prepare(&mut self, _ctx: &GpuContext, _scene: &Scene, _camera: &Camera) {}
    fn execute(&self, _encoder: &mut wgpu::CommandEncoder, _frame: &FrameContext<'_>) {
        // TODO: Cook-Torrance BRDF sphere pass
    }
}

// ─── VignettePass ─────────────────────────────────────────────────────────────

/// #25 — Cinematic corner darkening. Full-screen alpha-blend quad,
/// no bind group needed (pure geometry + fragment math).
pub struct VignettePass {
    pipeline: wgpu::RenderPipeline,
}

impl VignettePass {
    pub fn new(ctx: &GpuContext, surface_format: wgpu::TextureFormat) -> Self {
        let device = &ctx.device;
        let shader = device.create_shader_module(wgpu::include_wgsl!("../shaders/vignette.wgsl"));
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("vig_pl"), bind_group_layouts: &[], push_constant_ranges: &[],
        });
        let alpha_blend = wgpu::BlendState {
            color: wgpu::BlendComponent {
                src_factor: wgpu::BlendFactor::SrcAlpha,
                dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha,
                operation:  wgpu::BlendOperation::Add,
            },
            alpha: wgpu::BlendComponent::OVER,
        };
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label:  Some("vig_pipe"),
            layout: Some(&layout),
            vertex: wgpu::VertexState {
                module: &shader, entry_point: "vs_main",
                buffers: &[], compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader, entry_point: "fs_main",
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: surface_format,
                    blend:  Some(alpha_blend),
                    write_mask: wgpu::ColorWrites::COLOR,
                })],
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList, ..Default::default()
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format:              DEPTH_FORMAT,
                depth_write_enabled: false,
                depth_compare:       wgpu::CompareFunction::Always,
                stencil:             wgpu::StencilState::default(),
                bias:                wgpu::DepthBiasState::default(),
            }),
            multisample: wgpu::MultisampleState::default(),
            multiview:   None,
        });
        Self { pipeline }
    }
}

impl RenderNode for VignettePass {
    fn name(&self) -> &'static str { "VignettePass" }
    fn prepare(&mut self, _ctx: &GpuContext, _scene: &Scene, _camera: &Camera) {}
    fn execute(&self, encoder: &mut wgpu::CommandEncoder, frame: &FrameContext<'_>) {
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("VignettePass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: frame.color_view, resolve_target: None,
                ops: wgpu::Operations { load: wgpu::LoadOp::Load, store: wgpu::StoreOp::Store },
            })],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view: frame.depth_view,
                depth_ops: Some(wgpu::Operations { load: wgpu::LoadOp::Load, store: wgpu::StoreOp::Store }),
                stencil_ops: None,
            }),
            ..Default::default()
        });
        pass.set_pipeline(&self.pipeline);
        pass.draw(0..6, 0..1);
    }
}

// ─── PostPass (stub) ──────────────────────────────────────────────────────────

/// Fullscreen bloom → tone-map → gamma.
pub struct PostPass;

impl PostPass {
    #[allow(dead_code)]
    pub fn new(_ctx: &GpuContext) -> Self { Self }
}

impl RenderNode for PostPass {
    fn name(&self) -> &'static str { "PostPass" }
    fn prepare(&mut self, _ctx: &GpuContext, _scene: &Scene, _camera: &Camera) {}
    fn execute(&self, _encoder: &mut wgpu::CommandEncoder, _frame: &FrameContext<'_>) {
        // TODO: fullscreen quad, bloom threshold → blur → composite, Reinhard HDR
    }
}
