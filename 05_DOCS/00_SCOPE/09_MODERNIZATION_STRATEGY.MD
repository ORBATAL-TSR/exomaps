# 13 — Legacy Modernization Strategy

## Why Modernize First-Class
The current codebase has historical value and working domain logic. The strategy is to modernize without rewrite-risk by preserving behavior, introducing guardrails, and migrating in vertical slices.

## Guiding Principles
- Keep existing behavior stable while refactoring internals.
- Prefer strangler-pattern migration over big-bang rewrites.
- Add tests around legacy behavior before changing core logic.
- Enforce consistent tooling, typing, and observability.

## Current-State Challenges (Typical Legacy Signals)
- Mixed responsibilities across ingestion, API, and UI code.
- Inconsistent dependency/version management.
- Limited automated testing and CI validation.
- Older front-end asset patterns and bundling assumptions.
- Deployment setup optimized for local use, not cloud ops.

## Target Modern Architecture Shape
- Clear package boundaries:
  - ingestion
  - transform
  - inference
  - simulation
  - api
  - ui
- Standardized interfaces between modules.
- Typed contracts for core data objects.
- Environment-based configuration and secrets management.

## Modernization Phases

### Phase M1 — Baseline Safety Net
- Add smoke tests for pipeline and app startup.
- Add golden dataset tests for a small fixed astronomical sample.
- Introduce CI pipeline for lint + tests + container build checks.
- Outcome: safe refactoring baseline.

### Phase M2 — Dependency and Build Hygiene
- Pin dependency versions and remove deprecated packages.
- Consolidate Python requirements with lock strategy.
- Normalize Node/webpack tooling and scripts.
- Outcome: repeatable build and fewer environment drifts.

### Phase M3 — Internal Modularization
- Split legacy modules by responsibility.
- Introduce service-layer boundaries and data-access abstraction.
- Move direct DB logic out of route/controller layers.
- Outcome: maintainable architecture with testable seams.

### Phase M4 — Data Contracts and Type Safety
- Add schema validation at boundaries (ingest, API, simulation input).
- Introduce typed DTOs/models where practical.
- Add confidence/provenance invariants as contract checks.
- Outcome: fewer silent data regressions.

### Phase M5 — Observability and Ops Maturity
- Structured logging with correlation IDs.
- Metrics for pipeline throughput and simulation tick latency.
- Error tracking and release health dashboards.
- Outcome: measurable reliability and easier debugging.

### Phase M6 — Front-end Incremental Modernization
- Keep existing UI operational while migrating high-value panels.
- Add component and state management conventions.
- Improve map rendering performance and data loading strategy.
- Outcome: improved UX/performance without a full front-end rewrite.

## Refactoring Safety Techniques
- Branch-by-abstraction for critical paths.
- Feature flags for newly modernized modules.
- Side-by-side output comparison (legacy vs modern transform modules).
- Rollback-ready deploy process.

## Recommended Tech Direction (Conservative)
- Keep Python backend core, modernize framework boundaries and tests.
- Keep existing DB choice, improve migration discipline.
- Evolve front-end gradually; avoid immediate framework migration unless ROI is clear.
- Container-first local dev parity with cloud.

## Team Process Changes
- Define coding standards and architecture decision records.
- Require tests for any refactor touching data transforms.
- Enforce PR templates with risk and rollback notes.

## Modernization Success Metrics
- Build reproducibility >95% across developer machines and CI.
- Reduction in regression incidents per release.
- Faster lead time for changes in pipeline modules.
- Lower mean time to diagnose production issues.
