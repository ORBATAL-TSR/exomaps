# 10 — Implementation Phases

## Phase 0: Foundations
- Finalize canonical schema and confidence model.
- Implement source adapters already present in repo.
- Stand up reproducible local pipeline execution.
- Add baseline smoke tests and CI checks before major refactors.

## Phase 1: Scientific Core MVP
- Build nearby-star + exoplanet canonical world (observed/candidate only).
- Implement coordinate conversion pipeline and QA checks.
- Publish first `world_build_id` and simple map endpoint.

## Phase 2: Inference Layer MVP
- Add inferred planets/belts with deterministic generation.
- Add inference QA and confidence tagging.
- Expose observed vs inferred toggles in API payloads.

## Phase 3: Simulation MVP
- Implement population, logistics, economy baseline loops.
- Add basic polity influence and event framework.
- Enable time controls and save/load snapshots.

## Phase 4: Web Strategy Console
- Deliver map layers, system drill-down, and timeline controls.
- Add simulation control panel and key metric dashboards.

## Phase 5: Balancing & Scale
- Tune simulation for late-run stability and performance.
- Improve route optimization and political model behavior.
- Add scenario presets and rule sliders.

## Phase 6: Game Client Track
- Build optimized rendering pipeline against stable APIs.
- Add deeper control surfaces and richer scenario interactions.

## Phase 7: Legacy Modernization Completion
- Finish modularization of legacy code boundaries.
- Enforce typed contracts across ingestion, inference, simulation, and APIs.
- Complete observability baseline (logs, metrics, dashboards).

## Phase 8: Cloud Migration & Cost Optimization
- Promote staging deployment pattern to production.
- Implement scheduled burst workers for heavy jobs.
- Add budget alerts, retention policies, and monthly cost tuning loop.

## Exit Criteria by Phase
Each phase should define:
- Functional acceptance tests.
- Data quality thresholds.
- Performance benchmarks.
- Known risk list and mitigation status.
- Cost envelope targets and rollback readiness.
