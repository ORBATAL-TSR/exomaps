//! Renderer: orchestrates GPU context, surface, camera, scene, and render graph.

pub mod camera;
pub mod gpu;
pub mod graph;
pub mod passes;
pub mod scene;

use std::sync::Arc;
use winit::{dpi::PhysicalSize, window::Window};

use camera::Camera;
use gpu::{GpuContext, SurfaceState};
use graph::{FrameContext, RenderGraph};
use passes::{ClearPass, CoronaPass, FocusGlowPass, GalaxyBgPass, StarFieldPass, StarlanePass, DistanceRingPass, StarPass, VignettePass};
use scene::Scene;

use crate::simulation::{generate_star_catalog, build_starlanes};

// ─── State ────────────────────────────────────────────────────────────────────

/// Top-level render state. Created once, lives for the application lifetime.
pub struct State {
    window: Arc<Window>,
    ctx:    GpuContext,
    surf:   SurfaceState,

    pub camera: Camera,
    scene:  Scene,
    graph:  RenderGraph,

    frame_time: std::time::Instant,
}

impl State {
    pub async fn new(window: Arc<Window>) -> Self {
        let gpu::GpuInit { ctx, surf } = gpu::init(Arc::clone(&window)).await;

        let size   = window.inner_size();
        let camera = Camera::new(size.width as f32 / size.height.max(1) as f32);

        // ── Seed scene: synthetic 1796-star catalog + K-NN starlane graph.
        // Phase 3 will replace this with a live API fetch from the gateway.
        let stars  = generate_star_catalog(1796, 42);
        let lanes  = build_starlanes(&stars, 4, 4.5);   // k=4 neighbours, max 4.5 pc
        let mut scene = Scene::new();
        scene.set_stars(stars);
        scene.set_lanes(lanes);

        let surface_format = surf.config.format;
        let mut graph = RenderGraph::new();
        // Pass order: clear → galaxy background → starlanes → rings → stars → focus star
        graph.add(ClearPass::new());
        graph.add(GalaxyBgPass::new(&ctx, surface_format));
        graph.add(StarlanePass::new(&ctx, surface_format));
        graph.add(DistanceRingPass::new(&ctx, surface_format));
        graph.add(StarFieldPass::new(&ctx, surface_format));
        graph.add(StarPass::new(&ctx, surface_format));       // focus-star sphere (Sol)
        graph.add(CoronaPass::new(&ctx, surface_format));    // corona shell at 1.5× radius
        graph.add(FocusGlowPass::new(&ctx, surface_format)); // #17 soft lens glow billboard
        graph.add(VignettePass::new(&ctx, surface_format));  // #25 cinematic corner darkening

        Self {
            window,
            ctx,
            surf,
            camera,
            scene,
            graph,
            frame_time: std::time::Instant::now(),
        }
    }

    // ── Window events ─────────────────────────────────────────────────────────

    pub fn resize(&mut self, size: PhysicalSize<u32>) {
        if size.width == 0 || size.height == 0 { return; }
        self.surf.resize(&self.ctx, size.width, size.height);
        self.camera.resize(size.width as f32 / size.height as f32);
        self.graph.resize(&self.ctx, size.width, size.height);
    }

    pub fn reconfigure(&self) {
        self.surf.reconfigure(&self.ctx);
    }

    pub fn request_redraw(&self) {
        self.window.request_redraw();
    }

    // ── Per-frame ─────────────────────────────────────────────────────────────

    pub fn update(&mut self) {
        let dt = self.frame_time.elapsed().as_secs_f32();
        self.frame_time = std::time::Instant::now();

        self.camera.update(dt);   // #14 damping, #15 auto-orbit, #16 zoom momentum
        self.scene.flush(&self.ctx);
    }

    pub fn render(&mut self) -> Result<(), wgpu::SurfaceError> {
        let surface_texture = self.surf.get_current_texture()?;
        let color_view = surface_texture
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());

        let frame = FrameContext {
            color_view: &color_view,
            depth_view: &self.surf.depth_view,
            width:  self.surf.config.width,
            height: self.surf.config.height,
        };

        self.graph.run(&self.ctx, &self.scene, &self.camera, &frame);

        surface_texture.present();
        Ok(())
    }
}

