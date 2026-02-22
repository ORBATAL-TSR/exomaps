# 04 — Messaging & Real-Time Architecture

## Overview

`01_SERVICES/04_MESSAGING/` will house the event infrastructure that decouples
services and enables real-time multi-client experiences. This document describes
the planned architecture — implementation follows once the core platform stabilizes.

---

## Three Messaging Patterns

### Pattern 1: WebSocket Relay (Client ↔ Server)

Real-time bidirectional communication for live updates and multiplayer.

```
┌─────────┐     ┌─────────┐     ┌──────────────┐
│ Web App │────▶│         │     │              │
└─────────┘     │         │     │ 03_WORLD_    │
                │ Socket  │────▶│   ENGINE     │
┌─────────┐     │   .IO   │     │ (sim ticks)  │
│ Desktop │────▶│ Server  │     │              │
└─────────┘     │         │     └──────────────┘
                │         │
┌─────────┐     │         │     ┌──────────────┐
│ Mobile  │────▶│         │────▶│ 01_GATEWAY   │
└─────────┘     └─────────┘     │ (cache bust) │
                                └──────────────┘
```

**Channels:**

| Channel | Direction | Payload | Use Case |
|---------|-----------|---------|----------|
| `sim:tick` | Server → Client | `{ tick, delta, events[] }` | Live sim updates |
| `map:cursor` | Client → Server → Clients | `{ userId, x, y, z }` | Multiplayer cursors |
| `map:annotation` | Bidirectional | `{ systemId, text, author }` | Shared bookmarks |
| `data:refreshed` | Server → Client | `{ tables[], rowCounts }` | Pipeline complete |
| `admin:broadcast` | Server → Client | `{ message, severity }` | Announcements |

### Pattern 2: Message Queue (Service ↔ Service)

Asynchronous job processing via Amazon SQS or Redis Streams.

```
┌──────────────┐     ┌────────────────┐     ┌──────────────┐
│ 01_GATEWAY   │────▶│  Message Queue │────▶│ 02_PIPELINE  │
│ POST /api/   │     │  (SQS/Redis)   │     │ (worker)     │
│ pipeline/run │     └────────────────┘     └──────────────┘
└──────────────┘
```

**Queues:**

| Queue | Producer | Consumer | Payload |
|-------|----------|----------|---------|
| `pipeline.ingest` | Gateway | Pipeline worker | `{ phase: 1, sources: [...] }` |
| `pipeline.transform` | Ingest worker | Transform worker | `{ run_id, phase: 2 }` |
| `pipeline.inference` | Transform worker | Inference worker | `{ run_id, phase: 3 }` |
| `simulation.create` | Gateway | World Engine | `{ world_build_id, seed, config }` |
| `simulation.tick` | World Engine | Gateway cache | `{ sim_id, tick, snapshot }` |

**Dead Letter Queues:** Failed messages route to DLQ for inspection and replay.

### Pattern 3: Event Sourcing (Future)

All state mutations stored as immutable, append-only events:

```json
{ "event": "colony.founded", "system": "Proxima Centauri", "tick": 142, "pop": 500 }
{ "event": "trade.route.opened", "from": "Sol", "to": "Alpha Centauri", "tick": 155 }
{ "event": "faction.split", "parent": "UNE", "child": "Centauri Republic", "tick": 200 }
```

**Benefits:**
- Full timeline replay from any point
- Scenario branching (fork at tick N, explore alternatives)
- Multi-player divergent timelines
- Audit trail for every simulation decision

---

## Technology Choices

| Concern | Dev / Local | Production | Notes |
|---------|-------------|------------|-------|
| WebSocket | Socket.IO (Python) | Socket.IO + Redis adapter | Horizontal scaling |
| Message queue | Redis Streams | Amazon SQS | Managed, durable |
| Event store | PostgreSQL (append table) | DynamoDB or EventStoreDB | Event sourcing |
| Pub/Sub | Redis Pub/Sub | Amazon SNS + SQS | Fan-out to multiple consumers |

---

## Multi-App Real-Time Scenarios

### Scenario: Shared Star Map Session

```
User A (web) zooms to Proxima Centauri →
  → WebSocket: { action: "camera.move", target: "Proxima Centauri" }
  → Server relays to session participants
  → User B (desktop) camera auto-follows if "follow mode" enabled
```

### Scenario: Pipeline Completion Notification

```
Pipeline Phase 03 finishes →
  → SQS: { event: "pipeline.complete", phase: 3, stars_updated: 1796 }
  → Gateway receives, invalidates cache
  → WebSocket broadcast: { channel: "data:refreshed" }
  → All connected clients fetch fresh /api/world/systems/full
```

### Scenario: Multiplayer Simulation

```
Sim owner starts 100-tick simulation →
  → SQS: { event: "simulation.tick.batch", from: 0, to: 100 }
  → World Engine processes ticks, emits per-tick events
  → WebSocket streams: { tick: 1, events: [...] }, { tick: 2, events: [...] }
  → Observers see live population counts, colony foundings, trade shifts
```

---

## Implementation Phases

| Phase | Scope | Prerequisite |
|-------|-------|-------------|
| **M1** | Socket.IO in Gateway (sim tick broadcast) | World Engine live |
| **M2** | Redis Streams for pipeline job queue | Redis container |
| **M3** | Multi-client cursor sync | M1 + second client |
| **M4** | Event sourcing for sim mutations | M1 + schema design |
| **M5** | SQS migration for cloud deploy | AWS account + Terraform |
