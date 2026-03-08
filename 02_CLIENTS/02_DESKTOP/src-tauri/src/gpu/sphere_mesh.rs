//! Procedural sphere mesh generation for the native wgpu planet renderer.
//!
//! Generates a UV sphere with:
//!   - Position (vec3), Normal (vec3), UV (vec2), Tangent (vec4)
//!   - Configurable resolution (stacks × slices)
//!   - Proper seams and poles

use bytemuck::{Pod, Zeroable};

/// A single vertex for the render pipeline.
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct Vertex {
    pub position: [f32; 3],
    pub normal: [f32; 3],
    pub uv: [f32; 2],
    pub tangent: [f32; 4],
}

impl Vertex {
    /// wgpu vertex buffer layout — matches WGSL VertexInput
    pub fn layout() -> wgpu::VertexBufferLayout<'static> {
        static ATTRS: &[wgpu::VertexAttribute] = &[
            // @location(0) position: vec3<f32>
            wgpu::VertexAttribute {
                format: wgpu::VertexFormat::Float32x3,
                offset: 0,
                shader_location: 0,
            },
            // @location(1) normal: vec3<f32>
            wgpu::VertexAttribute {
                format: wgpu::VertexFormat::Float32x3,
                offset: 12,
                shader_location: 1,
            },
            // @location(2) uv: vec2<f32>
            wgpu::VertexAttribute {
                format: wgpu::VertexFormat::Float32x2,
                offset: 24,
                shader_location: 2,
            },
            // @location(3) tangent: vec4<f32>
            wgpu::VertexAttribute {
                format: wgpu::VertexFormat::Float32x4,
                offset: 32,
                shader_location: 3,
            },
        ];

        wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<Vertex>() as u64,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: ATTRS,
        }
    }
}

/// Generated sphere mesh data.
pub struct SphereMesh {
    pub vertices: Vec<Vertex>,
    pub indices: Vec<u32>,
}

/// Generate a UV sphere with the given radius and resolution.
///
/// - `stacks`: number of latitude rings (recommended: 64)
/// - `slices`: number of longitude segments (recommended: 128)
pub fn generate_uv_sphere(radius: f32, stacks: u32, slices: u32) -> SphereMesh {
    let mut vertices = Vec::with_capacity(((stacks + 1) * (slices + 1)) as usize);
    let mut indices = Vec::with_capacity((stacks * slices * 6) as usize);

    let pi = std::f32::consts::PI;
    let two_pi = 2.0 * pi;

    for i in 0..=stacks {
        let phi = pi * (i as f32) / (stacks as f32); // 0 (north pole) → π (south pole)
        let sin_phi = phi.sin();
        let cos_phi = phi.cos();

        for j in 0..=slices {
            let theta = two_pi * (j as f32) / (slices as f32); // 0 → 2π
            let sin_theta = theta.sin();
            let cos_theta = theta.cos();

            // Position on unit sphere, scaled by radius
            let x = cos_theta * sin_phi;
            let y = cos_phi;
            let z = sin_theta * sin_phi;

            let nx = x;
            let ny = y;
            let nz = z;

            // UV: directly matches the equirectangular texture layout.
            //   u = theta/(2π) = col/width   (longitude [0,1])
            //   v = phi/π     = row/height   (colatitude [0,1], north→south)
            // The seam at j=0/j=slices (theta=0/2π) has duplicate vertices
            // with u=0 and u=1, so GPU interpolation is artifact-free.
            let u = (j as f32) / (slices as f32);
            let v = (i as f32) / (stacks as f32);

            // Tangent: partial derivative w.r.t. theta (longitude / increasing u)
            let tx = -sin_theta;
            let ty = 0.0;
            let tz = cos_theta;
            let tangent_len = (tx * tx + ty * ty + tz * tz).sqrt().max(1e-6);

            vertices.push(Vertex {
                position: [x * radius, y * radius, z * radius],
                normal: [nx, ny, nz],
                uv: [u, v],
                tangent: [tx / tangent_len, ty / tangent_len, tz / tangent_len, 1.0],
            });
        }
    }

    // Triangle indices (two triangles per quad)
    for i in 0..stacks {
        for j in 0..slices {
            let row0 = i * (slices + 1);
            let row1 = (i + 1) * (slices + 1);

            let a = row0 + j;
            let b = row1 + j;
            let c = row1 + j + 1;
            let d = row0 + j + 1;

            // Skip degenerate triangles at poles
            if i != 0 {
                indices.push(a);
                indices.push(b);
                indices.push(d);
            }
            if i != stacks - 1 {
                indices.push(d);
                indices.push(b);
                indices.push(c);
            }
        }
    }

    SphereMesh { vertices, indices }
}

/// Create wgpu vertex and index buffers from mesh data.
pub fn create_buffers(device: &wgpu::Device, mesh: &SphereMesh) -> (wgpu::Buffer, wgpu::Buffer, u32) {
    use wgpu::util::DeviceExt;

    let vertex_buf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("Planet Sphere Vertex Buffer"),
        contents: bytemuck::cast_slice(&mesh.vertices),
        usage: wgpu::BufferUsages::VERTEX,
    });

    let index_buf = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("Planet Sphere Index Buffer"),
        contents: bytemuck::cast_slice(&mesh.indices),
        usage: wgpu::BufferUsages::INDEX,
    });

    (vertex_buf, index_buf, mesh.indices.len() as u32)
}
