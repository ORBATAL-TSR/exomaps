//! Scene: collections of GPU-ready instance data for stars and planets.

use crate::renderer::gpu::GpuContext;
use wgpu::util::DeviceExt;

// ─── StarInstance ─────────────────────────────────────────────────────────────

/// Per-star GPU instance, uploaded as a vertex buffer.
/// Fields mirror the star shader's instance attributes.
#[repr(C)]
#[derive(Copy, Clone, Debug, bytemuck::Pod, bytemuck::Zeroable)]
pub struct StarInstance {
    pub position:     [f32; 3],  // parsecs XYZ
    pub teff:         f32,       // effective temperature (K)
    pub luminosity:   f32,       // solar luminosities
    pub radius:       f32,       // solar radii
    pub multiplicity: f32,       // 1=single 2=binary 3=triple
    pub confidence:   f32,       // 0-1 (1=observed, 0=inferred)
    pub planet_count: f32,       // known planet count
    pub _pad:         [f32; 3],  // align to 16 bytes
}

impl StarInstance {
    pub const ATTRIBS: [wgpu::VertexAttribute; 7] = wgpu::vertex_attr_array![
        0 => Float32x3,  // position
        1 => Float32,    // teff
        2 => Float32,    // luminosity
        3 => Float32,    // radius
        4 => Float32,    // multiplicity
        5 => Float32,    // confidence
        6 => Float32,    // planet_count
    ];

    pub fn layout() -> wgpu::VertexBufferLayout<'static> {
        wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<Self>() as wgpu::BufferAddress,
            step_mode:    wgpu::VertexStepMode::Instance,
            attributes:   &Self::ATTRIBS,
        }
    }
}

// ─── LaneInstance ────────────────────────────────────────────────────────────

/// One star-to-star lane, rendered as a screen-space billboard quad.
/// Stride = 32 bytes. Locations 0 and 1 consumed by the starlane pipeline.
#[repr(C)]
#[derive(Copy, Clone, Debug, bytemuck::Pod, bytemuck::Zeroable)]
pub struct LaneInstance {
    pub pos_a: [f32; 4],  // xyz + pad
    pub pos_b: [f32; 4],  // xyz + pad
}

// ─── PlanetInstance ───────────────────────────────────────────────────────────

/// Per-planet GPU instance.
#[repr(C)]
#[derive(Copy, Clone, Debug, bytemuck::Pod, bytemuck::Zeroable)]
pub struct PlanetInstance {
    pub position:    [f32; 3],   // world-space XYZ
    pub planet_type: f32,        // 0=sub-earth … 5=super-jupiter
    pub temperature: f32,        // surface temperature (K)
    pub radius:      f32,        // earth radii
    pub seed:        f32,        // per-planet deterministic hash
    pub in_hz:       f32,        // 1.0 = inside habitable zone
    pub confidence:  f32,        // 0-1
    pub _pad:        [f32; 2],
}

impl PlanetInstance {
    pub const ATTRIBS: [wgpu::VertexAttribute; 7] = wgpu::vertex_attr_array![
        0 => Float32x3,  // position
        1 => Float32,    // planet_type
        2 => Float32,    // temperature
        3 => Float32,    // radius
        4 => Float32,    // seed
        5 => Float32,    // in_hz
        6 => Float32,    // confidence
    ];

    pub fn layout() -> wgpu::VertexBufferLayout<'static> {
        wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<Self>() as wgpu::BufferAddress,
            step_mode:    wgpu::VertexStepMode::Instance,
            attributes:   &Self::ATTRIBS,
        }
    }
}

// ─── Scene ────────────────────────────────────────────────────────────────────

pub struct Scene {
    pub stars:        Vec<StarInstance>,
    pub lanes:        Vec<LaneInstance>,
    pub planets:      Vec<PlanetInstance>,

    pub star_buf:     Option<wgpu::Buffer>,
    pub lane_buf:     Option<wgpu::Buffer>,
    pub planet_buf:   Option<wgpu::Buffer>,

    dirty: bool,
}

impl Scene {
    pub fn new() -> Self {
        Self {
            stars:      Vec::new(),
            lanes:      Vec::new(),
            planets:    Vec::new(),
            star_buf:   None,
            lane_buf:   None,
            planet_buf: None,
            dirty:      false,
        }
    }

    pub fn set_stars(&mut self, stars: Vec<StarInstance>) {
        self.stars = stars;
        self.dirty = true;
    }

    pub fn set_lanes(&mut self, lanes: Vec<LaneInstance>) {
        self.lanes = lanes;
        self.dirty = true;
    }

    pub fn set_planets(&mut self, planets: Vec<PlanetInstance>) {
        self.planets = planets;
        self.dirty = true;
    }

    /// Upload all dirty CPU data to GPU buffers.
    pub fn flush(&mut self, ctx: &GpuContext) {
        if !self.dirty { return; }

        let make_buf = |device: &wgpu::Device, label: &str, data: &[u8]| {
            device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label:    Some(label),
                contents: data,
                usage:    wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            })
        };

        if !self.stars.is_empty() {
            self.star_buf = Some(make_buf(
                &ctx.device, "star_instances",
                bytemuck::cast_slice(&self.stars),
            ));
        }
        if !self.lanes.is_empty() {
            self.lane_buf = Some(make_buf(
                &ctx.device, "lane_instances",
                bytemuck::cast_slice(&self.lanes),
            ));
        }
        if !self.planets.is_empty() {
            self.planet_buf = Some(make_buf(
                &ctx.device, "planet_instances",
                bytemuck::cast_slice(&self.planets),
            ));
        }

        self.dirty = false;
    }
}
