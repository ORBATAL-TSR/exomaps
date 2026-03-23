//! GPU core: context (adapter/device/queue) + surface state with depth buffer.

use std::sync::Arc;
use winit::window::Window;

// ─── GpuContext ────────────────────────────────────────────────────────────────

/// Owns the wgpu adapter, device, and queue. Shared (via reference) by all passes.
pub struct GpuContext {
    pub adapter: wgpu::Adapter,
    pub device:  wgpu::Device,
    pub queue:   wgpu::Queue,
}

// ─── SurfaceState ─────────────────────────────────────────────────────────────

pub const DEPTH_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;

/// Owns the wgpu surface, swapchain config, and depth texture.
pub struct SurfaceState {
    surface:    wgpu::Surface<'static>,
    pub config: wgpu::SurfaceConfiguration,
    _depth_tex: wgpu::Texture,
    pub depth_view: wgpu::TextureView,
}

impl SurfaceState {
    /// Assemble from an already-configured surface + its config.
    /// Call after `surface.configure(device, config)`.
    pub fn from_parts(
        surface: wgpu::Surface<'static>,
        config:  wgpu::SurfaceConfiguration,
        device:  &wgpu::Device,
    ) -> Self {
        let (_depth_tex, depth_view) =
            Self::make_depth(device, config.width, config.height);
        Self { surface, config, _depth_tex, depth_view }
    }

    pub fn resize(&mut self, ctx: &GpuContext, width: u32, height: u32) {
        self.config.width  = width.max(1);
        self.config.height = height.max(1);
        self.surface.configure(&ctx.device, &self.config);
        (self._depth_tex, self.depth_view) =
            Self::make_depth(&ctx.device, self.config.width, self.config.height);
    }

    pub fn get_current_texture(&self) -> Result<wgpu::SurfaceTexture, wgpu::SurfaceError> {
        self.surface.get_current_texture()
    }

    pub fn reconfigure(&self, ctx: &GpuContext) {
        self.surface.configure(&ctx.device, &self.config);
    }

    fn make_depth(device: &wgpu::Device, w: u32, h: u32) -> (wgpu::Texture, wgpu::TextureView) {
        let tex = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Depth"),
            size: wgpu::Extent3d {
                width:  w.max(1),
                height: h.max(1),
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count:    1,
            dimension:       wgpu::TextureDimension::D2,
            format:          DEPTH_FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                 | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let view = tex.create_view(&wgpu::TextureViewDescriptor::default());
        (tex, view)
    }
}

// ─── Full initialization (called from State::new) ─────────────────────────────

pub struct GpuInit {
    pub ctx:  GpuContext,
    pub surf: SurfaceState,
}

/// Create instance, adapter, device, queue, and configured surface in one step.
pub async fn init(window: Arc<Window>) -> GpuInit {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::all(),
        ..Default::default()
    });

    // Arc<Window> → Surface<'static>
    let surface: wgpu::Surface<'static> = instance
        .create_surface(Arc::clone(&window))
        .expect("Failed to create wgpu surface");

    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions {
            power_preference:       wgpu::PowerPreference::HighPerformance,
            compatible_surface:     Some(&surface),
            force_fallback_adapter: false,
        })
        .await
        .expect("No suitable GPU adapter");

    let (device, queue) = adapter
        .request_device(&wgpu::DeviceDescriptor {
            label: Some("OMICRON"),
            ..Default::default()
        }, None)
        .await
        .expect("Failed to create device");

    // Pick sRGB surface format
    let caps   = surface.get_capabilities(&adapter);
    let format = caps.formats.iter().copied()
        .find(|f| f.is_srgb())
        .unwrap_or(caps.formats[0]);

    let size = window.inner_size();
    let config = wgpu::SurfaceConfiguration {
        usage:    wgpu::TextureUsages::RENDER_ATTACHMENT,
        format,
        width:    size.width.max(1),
        height:   size.height.max(1),
        present_mode: wgpu::PresentMode::AutoVsync,
        alpha_mode:   caps.alpha_modes[0],
        view_formats: vec![],
        desired_maximum_frame_latency: 2,
    };
    surface.configure(&device, &config);

    let ctx  = GpuContext { adapter, device, queue };
    let surf = SurfaceState::from_parts(surface, config, &ctx.device);

    GpuInit { ctx, surf }
}
