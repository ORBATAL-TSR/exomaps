# ExoMaps Docs

```
05_DOCS/
├── 01_ARCHITECTURE/
│   ├── SYSTEM_OVERVIEW.md    Stack, directory layout, data flow, launch commands
│   └── BACKEND.md            API endpoints, personas/RBAC, pipeline phases, DB schemas
├── 02_RENDERER/
│   ├── PIPELINE.md           File map, render sequence, uniform reference, perf notes
│   ├── SHADERS.md            Noise library, zone system, shader gotchas, OrreryComponents exports
│   └── WORLD_TAXONOMY.md     Planet type table, zone role distribution, texture library
├── 03_GAME/
│   ├── VISION.md             Arrival moment, design pillars, claiming mechanic, sponsors, victory
│   ├── MECHANICS.md          Resources, production chains, ships, colony, terraforming, conflict
│   ├── LOGISTICS.md          Railroad Tycoon-style fleet: vehicle classes, routes, cargo tiers, interstellar trade
│   └── FACTIONS.md           Faction origins (splinter/rival/spinoff), relationship states, leader traits
├── USER_STORIES/
│   ├── 01_MISSION_ARCHITECT.md   AI mission planner — pre-departure wave sequencing, what to bring, bootstrap logic
│   ├── 02_THE_ARRIVAL.md         First human commander — decel burn ends, what the robots built, first decisions
│   └── 03_THE_ROUTE.md           Freight barge captain, year 84 — cascade failure, faction geometry, middle game feel
├── 04_BUILDPLANS/
│   ├── DESIGN_SPEC.md            Full game design spec — data models, rules, formulas, UI requirements (10 systems)
│   ├── ECONOMY_AND_MECHANICS.md  Value theory, currency, supply/demand, node/route economics, labor, tech tree, time model, crises
│   ├── UI_UX_STRATEGY.md         Full UI strategy — spatial nav, overlay system, node interiors by type, route editor, alerts, panels
│   └── ROADMAP.md                Current state, near-term priorities, feature backlog, OMICRON parked state
└── 05_OPS/
    ├── SETUP.md              Quick start, DB setup, env vars, pipeline, build, common issues
    └── LAN_SERVER.md         07_LOCALRUN setup, systemd service, Caddy/Gunicorn config
```

## Quick Reference

| I need to... | Go to |
|-------------|-------|
| Understand the codebase layout | `01_ARCHITECTURE/SYSTEM_OVERVIEW.md` |
| Look up an API endpoint | `01_ARCHITECTURE/BACKEND.md` |
| Work on a shader or add a uniform | `02_RENDERER/PIPELINE.md` + `SHADERS.md` |
| Add/modify a planet type | `02_RENDERER/WORLD_TAXONOMY.md` |
| Understand what's exported from OrreryComponents | `02_RENDERER/SHADERS.md` (last section) |
| Understand the game design | `03_GAME/VISION.md` |
| Design the logistics / fleet system | `03_GAME/LOGISTICS.md` |
| Design faction behaviour | `03_GAME/FACTIONS.md` |
| See what's next to build | `04_BUILDPLANS/ROADMAP.md` |
| Set up dev environment | `05_OPS/SETUP.md` |
| Fix LAN serving issues | `05_OPS/LAN_SERVER.md` |

## Active Client

`02_CLIENT/VITA/` — Tauri + React Three Fiber. Only client in active development.
Everything else is in `Z_deprecate/`.
