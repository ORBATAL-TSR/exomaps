# 07 — Game Client Roadmap (Post-Web)

## Goal
Develop a high-fidelity client that reuses the same simulation backbone while offering deeper interaction, immersion, and performance.

## Functional Priorities
- Advanced camera navigation and smooth large-scale traversal.
- Tactical overlays (routes, chokepoints, contested zones).
- Direct intervention tools tied to player role.
- Better fleet and colony management interfaces.

## Technical Priorities
- Streaming world chunks and LOD-managed rendering.
- GPU-friendly representation of large stellar scenes.
- Efficient interpolation between simulation snapshots.
- Input and UI frameworks suited for complex controls.

## Shared Core with Web
- Shared API contracts.
- Shared entity schemas and confidence semantics.
- Shared scenario definitions and seeds.

## Distinctive Game Additions
- Richer feedback loops and mission-like objectives.
- Event-driven narrative framing (human diaspora arcs).
- Optional diegetic interfaces for faction command.

## Development Strategy
- Keep web client as source-of-truth for correctness.
- Use game client for control depth and rendering sophistication.
- Add features only when the simulation model can support meaningful outcomes.
