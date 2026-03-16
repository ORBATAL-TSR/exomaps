//! Render graph: ordered list of passes executed each frame.
//!
//! Design is intentionally simple — a linear list, not a DAG.
//! Each node gets a prepare() call (CPU: update uniforms/buffers),
//! then an execute() call (GPU: record commands into the shared encoder).
//! Add async compute / DAG scheduling later when it's needed.

use crate::renderer::{
    camera::Camera,
    gpu::GpuContext,
    scene::Scene,
};

// ─── FrameContext ─────────────────────────────────────────────────────────────

/// Per-frame transient data passed to every node's execute().
pub struct FrameContext<'a> {
    pub color_view: &'a wgpu::TextureView,
    pub depth_view: &'a wgpu::TextureView,
    pub width:      u32,
    pub height:     u32,
}

// ─── RenderNode trait ─────────────────────────────────────────────────────────

pub trait RenderNode {
    fn name(&self) -> &'static str;

    /// CPU-side preparation: write uniforms, update instance buffers, etc.
    fn prepare(&mut self, ctx: &GpuContext, scene: &Scene, camera: &Camera);

    /// GPU-side: record render/compute commands into the encoder.
    fn execute(&self, encoder: &mut wgpu::CommandEncoder, frame: &FrameContext<'_>);

    /// Called on window resize so passes can rebuild size-dependent resources.
    fn resize(&mut self, ctx: &GpuContext, width: u32, height: u32) {
        let _ = (ctx, width, height);
    }
}

// ─── RenderGraph ──────────────────────────────────────────────────────────────

pub struct RenderGraph {
    nodes: Vec<Box<dyn RenderNode>>,
}

impl RenderGraph {
    pub fn new() -> Self {
        Self { nodes: Vec::new() }
    }

    pub fn add<N: RenderNode + 'static>(&mut self, node: N) {
        self.nodes.push(Box::new(node));
    }

    pub fn resize(&mut self, ctx: &GpuContext, width: u32, height: u32) {
        for node in &mut self.nodes {
            node.resize(ctx, width, height);
        }
    }

    /// Run all nodes: prepare then execute, then submit.
    pub fn run(
        &mut self,
        ctx:    &GpuContext,
        scene:  &Scene,
        camera: &Camera,
        frame:  &FrameContext<'_>,
    ) {
        let mut encoder = ctx.device.create_command_encoder(
            &wgpu::CommandEncoderDescriptor { label: Some("Frame") },
        );

        for node in &mut self.nodes {
            node.prepare(ctx, scene, camera);
            node.execute(&mut encoder, frame);
        }

        ctx.queue.submit(std::iter::once(encoder.finish()));
    }
}
