# 08 — Data Governance, Provenance & Validation

## Provenance Requirements
Every entity/field should trace to:
- Source dataset and release version.
- Transformation function version.
- Inference model version + seed (if generated).

## Validation Layers
1. **Schema Validation**: type/unit/range checks.
2. **Cross-source Consistency**: conflict detection and adjudication.
3. **Physical Plausibility**: impossible orbits and invalid distances flagged.
4. **Simulation Readiness**: complete minimum fields for downstream runtime.

## Confidence Modeling
- Composite confidence score from:
  - Source trust level.
  - Data completeness.
  - Model uncertainty.
- Confidence class used for UI display and simulation weighting.

## Governance Policies
- Immutable raw source archive.
- Reproducible build manifests.
- Controlled model updates with benchmark comparisons.
- Explicit deprecation and supersession policy for world builds.

## Observability
- Run-level metrics:
  - Records ingested/merged/rejected.
  - Inference acceptance/rejection rates.
  - Build diff magnitude.
- Alerting thresholds for anomalous changes.

## Human-in-the-Loop
- Curator review queue for high-impact uncertain systems.
- Override mechanism with audit logs.
- Notes and rationale attached to manual decisions.
