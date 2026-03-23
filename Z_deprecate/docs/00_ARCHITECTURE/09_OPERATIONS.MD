# 09 — Operations, Deployment & Release Cadence

## Deployment Topology (Initial)
- Simulation/API server container.
- Database container.
- Optional worker container for heavy pipeline jobs.
- Web client served from app service/static hosting.

## Modernization-Aware Operations
- Run legacy and modernized modules side-by-side during transition windows.
- Use feature flags and staged rollout for refactored pipeline/simulation components.
- Maintain rollback to previous container image and previous `world_build_id`.
- Track modernization KPIs in release checks (startup reliability, run duration, error rates).

## Cheap-First Cloud Hosting Strategy
- Keep always-on services small (API + DB baseline footprint).
- Schedule heavy pipeline/inference jobs as ephemeral workers.
- Push static web assets and snapshot artifacts to low-cost object storage + CDN.
- Apply lifecycle policies to archive/delete stale artifacts and snapshots.
- Enforce monthly spend alerts and release-gate checks for cost drift.

## Pipeline Cadence
- On initial deployment: full build.
- Scheduled: monthly or quarterly refresh.
- Event-triggered: major astronomy release or inference model update.

## Release Types
- **Data Release**: new world build from source updates.
- **Model Release**: inference logic upgrade and build regeneration.
- **Simulation Release**: mechanics balancing and performance updates.
- **Client Release**: visualization/UX improvements.
- **Modernization Release**: internal refactors with behavior parity checks.
- **Infrastructure Release**: cloud topology, deployment, and cost-control changes.

## Rollback Strategy
- Keep previous `world_build_id` active-ready.
- Immutable snapshots for each published build.
- Fast switch-back if validation fails post-release.

## Operational Tooling
- Job runner + status dashboard.
- Build comparison reports.
- Simulation health metrics and profiling hooks.
- Disaster recovery backups for DB + snapshot storage.

## Security & Safety
- Role-based control for simulation mutation endpoints.
- Read-only public endpoints where needed.
- Input validation and rate limits for client APIs.
