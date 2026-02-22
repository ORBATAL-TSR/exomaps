# 05 — Simulation Engine Plan

## Core Simulation Loop
- Hybrid architecture:
  - Discrete ticks for economy/logistics/population.
  - Event queue for major incidents (founding, schism, crisis, war trigger).
- Adjustable time rate from weeks to decades per step.

## Domain Modules
### Population & Colonization
- Colony suitability from system profile.
- Migration pressure from crowded/wealthy/unstable worlds.
- Colony lifecycle: outpost -> settlement -> mature world.

### Logistics & Ships (SFTL)
- Transit times constrained by propulsion model.
- Fleet types: colony ships, cargo, patrol, exploration.
- Route optimization under long travel and sparse refuel nodes.

### Economy
- Resource extraction by planet/belt class.
- Production chains and bottlenecks.
- Price gradients across interstellar distance and delay.

### Politics
- Polities with governance tendencies.
- Influence propagation through trade, culture, and force projection.
- Alliance/conflict tension as a dynamic scalar.

### Strategic Events
- Supply collapse.
- Independence movements.
- Frontier rush.
- Treaty formation and bloc emergence.

## User Control & Gamification
- Start scenario presets (e.g., "Early Expansion", "Fragmented Earth", "Corporate Frontier").
- Player role modes:
  - Central planner.
  - Faction leader.
  - Neutral observer with intervention tools.
- Rule sliders:
  - Propulsion improvement rate.
  - Governance cohesion.
  - Resource scarcity.

## Determinism & Replayability
- Deterministic simulation per seed and rule-set.
- Save/load snapshots at interval boundaries.
- Timeline rewind for what-if analysis.

## Performance Targets (Initial)
- Support thousands of active interstellar routes.
- Support hundreds of populated systems in late-game runs.
- Keep step latency low enough for interactive control at medium speed.
