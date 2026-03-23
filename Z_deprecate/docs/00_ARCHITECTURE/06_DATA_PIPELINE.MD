# 03 — Data Pipeline Design

## Pipeline Goals
- Maintain an up-to-date nearby-star world model (<=100 LY).
- Maximize real observational fidelity while gracefully handling sparse data.
- Produce reproducible outputs suitable for simulation and visualization.

## Pipeline Stages
### Stage A: Source Acquisition
- Pull/download source datasets (catalog-specific adapters).
- Record source metadata: release date, version, checksum.
- Store immutable raw files in a source archive.

### Stage B: Staging Parse
- Parse CSV/API payloads into staging tables.
- Normalize units and basic types.
- Reject malformed records into quarantine tables for review.

### Stage C: Canonicalization
- Cross-match stars and planets across sources.
- Resolve IDs to canonical internal IDs.
- Merge conflicting fields via priority + confidence policy.

### Stage D: Coordinate Transformation
- Convert RA/Dec/parallax/distance into Cartesian X,Y,Z.
- Standardize frame/epoch assumptions and store transform metadata.
- Keep uncertainty envelopes where available.

### Stage E: Nearby Filter
- Apply <=100 LY filter (with margin rules for uncertainty).
- Keep optional outer ring buffer (e.g., 100–110 LY) for context.

### Stage F: Inference Preparation
- Derive system features required by inference models.
- Build training priors and class buckets by stellar type.

### Stage G: System Completion Generation
- Generate inferred planets and belts for incomplete systems.
- Validate orbital spacing/stability heuristics.
- Emit confidence + method tags.

### Stage H: World Build Materialization
- Assemble final world graph build.
- Generate summary stats and change report versus previous build.
- Publish build as `world_build_id` for simulation and clients.

## Orchestration
- Trigger types:
  - Initial bootstrap.
  - Scheduled periodic.
  - Manual after major source/model update.
- Directed acyclic job flow with resumable checkpoints.

## Quality Gates
- Duplicate identity rate threshold.
- Coordinate conversion sanity checks.
- Minimum schema completeness thresholds.
- Inference plausibility checks (reject physically implausible outputs).

## Deliverables Per Run
- Canonical DB update.
- Versioned world build.
- Diff report.
- QA report.
- Run manifest with model and source versions.
