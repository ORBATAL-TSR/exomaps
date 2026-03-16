//! Arcball orbit camera with smooth damping, zoom momentum, and auto-orbit.
//!
//! Controls:
//!   Left drag  → orbit (arcball)
//!   Scroll     → zoom (log-scale with momentum)
//!
//! Enhancements:
//!   #14 Angular velocity damping  — smooth deceleration after drag release
//!   #15 Auto-orbit                — slow idle rotation after IDLE_SECS
//!   #16 Zoom momentum             — zoom glides to a stop after scroll

use glam::{Mat4, Vec3};

const DRAG_DECAY:  f32 = 0.88;
const ZOOM_DECAY:  f32 = 0.82;
const IDLE_SECS:   f32 = 8.0;
const ORBIT_SPEED: f32 = 0.0025;

// ─── Camera ───────────────────────────────────────────────────────────────────

pub struct Camera {
    pub eye:    Vec3,
    pub target: Vec3,
    pub up:     Vec3,

    pub fovy_rad: f32,
    pub aspect:   f32,
    pub near:     f32,
    pub far:      f32,

    drag_active: bool,
    drag_last:   (f32, f32),

    radius: f32,
    theta:  f32,
    phi:    f32,

    // #14 — angular velocity, decays after release
    vel_theta: f32,
    vel_phi:   f32,

    // #15 — idle timer for auto-orbit
    idle_secs: f32,

    // #16 — zoom momentum
    zoom_vel: f32,
}

impl Camera {
    pub fn new(aspect: f32) -> Self {
        let eye    = Vec3::new(0.0, 8.0, 50.0);
        let target = Vec3::ZERO;
        let delta  = eye - target;
        let radius = delta.length();
        let theta  = delta.z.atan2(delta.x);
        let phi    = (delta.y / radius).asin();

        Self {
            eye, target, up: Vec3::Y,
            fovy_rad: std::f32::consts::FRAC_PI_4,
            aspect,
            near: 0.01,
            far:  5000.0,
            drag_active: false,
            drag_last:   (0.0, 0.0),
            radius, theta, phi,
            vel_theta: 0.0,
            vel_phi:   0.0,
            idle_secs: 0.0,
            zoom_vel:  0.0,
        }
    }

    // ── Matrices ──────────────────────────────────────────────────────────────

    pub fn view(&self) -> Mat4 {
        Mat4::look_at_rh(self.eye, self.target, self.up)
    }

    pub fn proj(&self) -> Mat4 {
        Mat4::perspective_rh(self.fovy_rad, self.aspect, self.near, self.far)
    }

    pub fn view_proj(&self) -> Mat4 {
        self.proj() * self.view()
    }

    pub fn as_uniform(&self) -> CameraUniform {
        CameraUniform {
            view_proj: self.view_proj().to_cols_array_2d(),
            eye:       self.eye.to_array(),
            _pad:      0.0,
        }
    }

    // ── #14 / #15 / #16 — Per-frame physics update ───────────────────────────

    pub fn update(&mut self, dt: f32) {
        let mut moving = false;

        // #14 Angular momentum decay
        if self.vel_theta.abs() > 1e-5 || self.vel_phi.abs() > 1e-5 {
            self.theta    += self.vel_theta;
            self.phi      += self.vel_phi;
            self.vel_theta *= DRAG_DECAY;
            self.vel_phi   *= DRAG_DECAY;
            self.clamp_phi();
            self.sync_eye();
            moving = true;
        }

        // #16 Zoom momentum decay
        if self.zoom_vel.abs() > 1e-5 {
            self.radius   *= 1.0 - self.zoom_vel;
            self.radius    = self.radius.clamp(0.1, 2000.0);
            self.zoom_vel *= ZOOM_DECAY;
            self.sync_eye();
            moving = true;
        }

        // #15 Auto-orbit idle tracking
        if moving || self.drag_active {
            self.idle_secs = 0.0;
        } else {
            self.idle_secs += dt;
        }

        if self.idle_secs > IDLE_SECS {
            self.theta += ORBIT_SPEED;
            self.sync_eye();
        }
    }

    // ── Input handlers ────────────────────────────────────────────────────────

    pub fn begin_drag(&mut self) {
        self.drag_active = true;
        self.idle_secs   = 0.0;
        self.vel_theta   = 0.0;
        self.vel_phi     = 0.0;
    }

    pub fn end_drag(&mut self) {
        self.drag_active = false;
    }

    pub fn mouse_move(&mut self, x: f32, y: f32) {
        if !self.drag_active {
            self.drag_last = (x, y);
            return;
        }
        let dx = x - self.drag_last.0;
        let dy = y - self.drag_last.1;
        self.drag_last = (x, y);

        // #14 Store as velocity so decay kicks in after release
        self.vel_theta  = -dx * 0.005;
        self.vel_phi    =  dy * 0.005;

        self.theta     += self.vel_theta;
        self.phi       += self.vel_phi;
        self.clamp_phi();
        self.sync_eye();
        self.idle_secs  = 0.0;
    }

    pub fn zoom(&mut self, scroll: f32) {
        // #16 Accumulate zoom velocity — scroll adds momentum
        self.zoom_vel  += scroll * 0.10;
        self.zoom_vel   = self.zoom_vel.clamp(-0.40, 0.40);
        self.idle_secs  = 0.0;
    }

    pub fn resize(&mut self, aspect: f32) {
        self.aspect = aspect;
    }

    fn clamp_phi(&mut self) {
        self.phi = self.phi.clamp(
            -std::f32::consts::FRAC_PI_2 + 0.05,
             std::f32::consts::FRAC_PI_2 - 0.05,
        );
    }

    fn sync_eye(&mut self) {
        let cp  = self.phi.cos();
        self.eye = self.target + Vec3::new(
            self.radius * cp * self.theta.cos(),
            self.radius * self.phi.sin(),
            self.radius * cp * self.theta.sin(),
        );
    }
}

// ─── GPU uniform ──────────────────────────────────────────────────────────────

#[repr(C)]
#[derive(Copy, Clone, Debug, bytemuck::Pod, bytemuck::Zeroable)]
pub struct CameraUniform {
    pub view_proj: [[f32; 4]; 4],
    pub eye:       [f32; 3],
    pub _pad:      f32,
}
