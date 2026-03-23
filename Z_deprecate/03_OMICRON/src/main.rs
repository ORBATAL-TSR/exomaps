//! OMICRON — entry point
//! Boots a winit window and hands control to the renderer.

mod geometry;
mod renderer;
mod simulation;
mod ui;

use std::sync::Arc;
use winit::{
    event::{Event, WindowEvent, ElementState, MouseButton},
    event_loop::{ControlFlow, EventLoop},
    window::WindowBuilder,
};

fn main() {
    env_logger::init();
    let event_loop = EventLoop::new().unwrap();
    // Arc<Window> lets renderer own the surface with 'static lifetime
    let window = Arc::new(
        WindowBuilder::new()
            .with_title("OMICRON")
            .with_inner_size(winit::dpi::PhysicalSize::new(1920u32, 1080u32))
            .with_maximized(true)
            .build(&event_loop)
            .unwrap(),
    );

    let mut state = pollster::block_on(renderer::State::new(Arc::clone(&window)));

    event_loop.run(move |event, elwt| {
        elwt.set_control_flow(ControlFlow::Poll);
        match event {
            Event::WindowEvent { event, .. } => match event {
                WindowEvent::CloseRequested => elwt.exit(),
                WindowEvent::Resized(size) => state.resize(size),
                WindowEvent::RedrawRequested => {
                    state.update();
                    match state.render() {
                        Ok(_) => {}
                        Err(wgpu::SurfaceError::Lost) => state.reconfigure(),
                        Err(wgpu::SurfaceError::OutOfMemory) => elwt.exit(),
                        Err(e) => log::error!("render error: {:?}", e),
                    }
                }
                WindowEvent::MouseInput { state: ElementState::Pressed, button: MouseButton::Left, .. } => {
                    state.camera.begin_drag();
                }
                WindowEvent::MouseInput { state: ElementState::Released, button: MouseButton::Left, .. } => {
                    state.camera.end_drag();
                }
                WindowEvent::CursorMoved { position, .. } => {
                    state.camera.mouse_move(position.x as f32, position.y as f32);
                }
                WindowEvent::MouseWheel { delta, .. } => {
                    let scroll = match delta {
                        winit::event::MouseScrollDelta::LineDelta(_, y) => y,
                        winit::event::MouseScrollDelta::PixelDelta(p) => p.y as f32 * 0.01,
                    };
                    state.camera.zoom(scroll);
                }
                _ => {}
            },
            Event::AboutToWait => state.request_redraw(),
            _ => {}
        }
    }).unwrap();
}
