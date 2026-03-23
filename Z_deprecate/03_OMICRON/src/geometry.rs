//! OMICRON Geometry — QuadSphere with correct normals + UVs
//! 6-face cube subdivided and normalized to unit sphere.

use bytemuck::{Pod, Zeroable};
use wgpu;

#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable)]
pub struct Vertex {
    pub position: [f32; 3],
    pub normal:   [f32; 3],
    pub uv:       [f32; 2],
}

impl Vertex {
    pub fn layout() -> wgpu::VertexBufferLayout<'static> {
        wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<Vertex>() as u64,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &[
                wgpu::VertexAttribute { offset: 0,  shader_location: 0, format: wgpu::VertexFormat::Float32x3 },
                wgpu::VertexAttribute { offset: 12, shader_location: 1, format: wgpu::VertexFormat::Float32x3 },
                wgpu::VertexAttribute { offset: 24, shader_location: 2, format: wgpu::VertexFormat::Float32x2 },
            ],
        }
    }
}

pub struct QuadSphere {
    pub vertices: Vec<Vertex>,
    pub indices:  Vec<u32>,
}

impl QuadSphere {
    /// `resolution`: subdivisions per cube face edge (64 = ~24k verts per face)
    pub fn new(resolution: u32) -> Self {
        let mut vertices = Vec::new();
        let mut indices  = Vec::new();

        // Six face directions: +X, -X, +Y, -Y, +Z, -Z
        let faces: [([f32;3], [f32;3], [f32;3]); 6] = [
            // (forward, right, up)
            ([ 1.0,  0.0,  0.0], [ 0.0,  0.0, -1.0], [ 0.0,  1.0,  0.0]),
            ([-1.0,  0.0,  0.0], [ 0.0,  0.0,  1.0], [ 0.0,  1.0,  0.0]),
            ([ 0.0,  1.0,  0.0], [ 1.0,  0.0,  0.0], [ 0.0,  0.0, -1.0]),
            ([ 0.0, -1.0,  0.0], [ 1.0,  0.0,  0.0], [ 0.0,  0.0,  1.0]),
            ([ 0.0,  0.0,  1.0], [ 1.0,  0.0,  0.0], [ 0.0,  1.0,  0.0]),
            ([ 0.0,  0.0, -1.0], [-1.0,  0.0,  0.0], [ 0.0,  1.0,  0.0]),
        ];

        for (fwd, right, up) in &faces {
            let base = vertices.len() as u32;
            let n = resolution + 1;

            for row in 0..=resolution {
                for col in 0..=resolution {
                    let t = row as f32 / resolution as f32;
                    let s = col as f32 / resolution as f32;
                    // Map [0,1]x[0,1] to [-1,1]x[-1,1] on the cube face
                    let a = (s * 2.0 - 1.0);
                    let b = (t * 2.0 - 1.0);

                    let px = fwd[0] + a * right[0] + b * up[0];
                    let py = fwd[1] + a * right[1] + b * up[1];
                    let pz = fwd[2] + a * right[2] + b * up[2];

                    // Normalize to sphere
                    let len = (px*px + py*py + pz*pz).sqrt();
                    let nx = px / len;
                    let ny = py / len;
                    let nz = pz / len;

                    let u = 0.5 + ny.atan2(nx) / (2.0 * std::f32::consts::PI);
                    let v = 0.5 - nz.asin() / std::f32::consts::PI;

                    vertices.push(Vertex {
                        position: [nx, ny, nz],
                        normal:   [nx, ny, nz],
                        uv:       [u, v],
                    });
                }
            }

            // Indices for this face
            for row in 0..resolution {
                for col in 0..resolution {
                    let tl = base + row * n + col;
                    let tr = tl + 1;
                    let bl = tl + n;
                    let br = bl + 1;
                    indices.extend_from_slice(&[tl, bl, tr, tr, bl, br]);
                }
            }
        }

        Self { vertices, indices }
    }
}

/// Unit quad in XY-plane. Billboarding is done in the vertex shader (rotate to face camera).
pub fn build_billboard() -> (Vec<Vertex>, Vec<u32>) {
    let verts = vec![
        Vertex { position: [-1.0, -1.0, 0.0], normal: [0.0, 0.0, 1.0], uv: [0.0, 1.0] },
        Vertex { position: [ 1.0, -1.0, 0.0], normal: [0.0, 0.0, 1.0], uv: [1.0, 1.0] },
        Vertex { position: [ 1.0,  1.0, 0.0], normal: [0.0, 0.0, 1.0], uv: [1.0, 0.0] },
        Vertex { position: [-1.0,  1.0, 0.0], normal: [0.0, 0.0, 1.0], uv: [0.0, 0.0] },
    ];
    (verts, vec![0, 1, 2, 0, 2, 3])
}

/// Instanced belt particle position buffer (future use)
pub fn build_belt_particles(count: usize, inner_au: f32, outer_au: f32) -> Vec<[f32; 4]> {
    use std::f32::consts::TAU;
    (0..count).map(|i| {
        let angle  = (i as f32 / count as f32) * TAU + (i as f32 * 0.618).fract() * TAU;
        let r      = inner_au + (i as f32 * 0.31415).fract() * (outer_au - inner_au);
        let height = ((i as f32 * 1.41421).fract() - 0.5) * 0.1 * r;
        [r * angle.cos(), r * angle.sin(), height, 1.0]
    }).collect()
}
