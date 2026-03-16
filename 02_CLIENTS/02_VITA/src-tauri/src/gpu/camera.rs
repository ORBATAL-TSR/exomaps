//! Orbital camera for the native planet renderer.
//!
//! Provides an orbital camera that rotates around a target point,
//! computing view and projection matrices for the WGSL shader.

use bytemuck::{Pod, Zeroable};

/// Camera uniform data — matches WGSL `Camera` struct.
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct CameraUniform {
    pub view: [[f32; 4]; 4],
    pub projection: [[f32; 4]; 4],
    pub model: [[f32; 4]; 4],
    pub camera_pos: [f32; 3],
    pub _pad0: f32,
}

/// Planet parameter uniform — matches WGSL `PlanetParams` struct.
#[repr(C)]
#[derive(Copy, Clone, Debug, Pod, Zeroable)]
pub struct PlanetParamsUniform {
    pub sun_direction: [f32; 3],
    pub sun_intensity: f32,
    pub sun_color: [f32; 3],
    pub ocean_level: f32,
    pub atmosphere_color: [f32; 3],
    pub atmosphere_thickness: f32,
    pub planet_radius: f32,
    pub displacement_scale: f32,
    pub time_of_day: f32,
    pub _pad1: f32,
}

/// Orbital camera state.
pub struct OrbitalCamera {
    /// Horizontal angle in radians (around Y axis)
    pub azimuth: f32,
    /// Vertical angle in radians (above/below equator, clamped -89°..89°)
    pub elevation: f32,
    /// Distance from target (center of planet)
    pub distance: f32,
    /// Field of view in degrees
    pub fov_deg: f32,
    /// Planet rotation angle (slow auto-rotation)
    pub planet_rotation: f32,
}

impl Default for OrbitalCamera {
    fn default() -> Self {
        Self {
            azimuth: 0.0,
            elevation: 0.2,   // slight tilt above equator
            distance: 3.0,
            fov_deg: 45.0,
            planet_rotation: 0.0,
        }
    }
}

impl OrbitalCamera {
    /// Compute camera position from orbital parameters.
    pub fn position(&self) -> [f32; 3] {
        let cos_elev = self.elevation.cos();
        let sin_elev = self.elevation.sin();
        let cos_azim = self.azimuth.cos();
        let sin_azim = self.azimuth.sin();

        [
            self.distance * cos_elev * sin_azim,
            self.distance * sin_elev,
            self.distance * cos_elev * cos_azim,
        ]
    }

    /// Build the camera uniform for the shader.
    pub fn build_uniform(&self, aspect: f32) -> CameraUniform {
        let eye = self.position();
        let target = [0.0f32, 0.0, 0.0];
        let up = [0.0f32, 1.0, 0.0];

        let view = look_at(eye, target, up);
        let projection = perspective(self.fov_deg.to_radians(), aspect, 0.01, 100.0);
        let model = rotation_y(self.planet_rotation);

        CameraUniform {
            view,
            projection,
            model,
            camera_pos: eye,
            _pad0: 0.0,
        }
    }
}

/// Teff (K) → approximate RGB [0,1].
pub fn teff_to_color(teff: f64) -> [f32; 3] {
    let t = teff / 100.0;

    let r = if t <= 66.0 {
        1.0
    } else {
        1.292936 * (t - 60.0).powf(-0.1332047592)
    };

    let g = if t <= 66.0 {
        0.39008157 * t.ln() - 0.63184144
    } else {
        1.129890 * (t - 60.0).powf(-0.0755148492)
    };

    let b = if t >= 66.0 {
        1.0
    } else if t <= 19.0 {
        0.0
    } else {
        0.54320680 * (t - 10.0).ln() - 1.19625408
    };

    [
        r.clamp(0.0, 1.0) as f32,
        g.clamp(0.0, 1.0) as f32,
        b.clamp(0.0, 1.0) as f32,
    ]
}

// ── Matrix math (no external dependency needed) ──

/// Look-at view matrix (right-handed).
fn look_at(eye: [f32; 3], target: [f32; 3], up: [f32; 3]) -> [[f32; 4]; 4] {
    let f = normalize(sub(target, eye));
    let s = normalize(cross(f, up));
    let u = cross(s, f);

    [
        [s[0], u[0], -f[0], 0.0],
        [s[1], u[1], -f[1], 0.0],
        [s[2], u[2], -f[2], 0.0],
        [-dot(s, eye), -dot(u, eye), dot(f, eye), 1.0],
    ]
}

/// Perspective projection matrix (right-handed, zero-to-one depth).
fn perspective(fov_rad: f32, aspect: f32, near: f32, far: f32) -> [[f32; 4]; 4] {
    let f = 1.0 / (fov_rad / 2.0).tan();
    let range_inv = 1.0 / (near - far);

    [
        [f / aspect, 0.0, 0.0, 0.0],
        [0.0, f, 0.0, 0.0],
        [0.0, 0.0, far * range_inv, -1.0],
        [0.0, 0.0, near * far * range_inv, 0.0],
    ]
}

/// Rotation matrix around Y axis.
fn rotation_y(angle: f32) -> [[f32; 4]; 4] {
    let c = angle.cos();
    let s = angle.sin();
    [
        [c, 0.0, s, 0.0],
        [0.0, 1.0, 0.0, 0.0],
        [-s, 0.0, c, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ]
}

fn sub(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn normalize(v: [f32; 3]) -> [f32; 3] {
    let len = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    if len < 1e-10 {
        return [0.0, 0.0, 1.0];
    }
    [v[0] / len, v[1] / len, v[2] / len]
}
