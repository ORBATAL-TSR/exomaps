# 06 — Data Governance, Provenance & Validation

## Overview

ExoMaps blends real astronomical observations with model-generated inferences and simulation outputs. Rigorous data governance ensures that users, curators, and downstream systems can always answer: **Where did this data come from? How confident should I be? Can I reproduce it?**

---

## Provenance Model

### Field-Level Lineage

Every entity field traces to its origin through a provenance chain:

```
Raw Source File → Ingestion Adapter → Staging Table → Validation Gate
    → Canonical Table → Inference Model → Simulation Input
```

| Provenance Field | Type | Example | Stored On |
|-----------------|------|---------|-----------|
| `source_catalog` | text | `nasa_exoplanet_archive` | Every raw + canonical record |
| `source_release` | text | `2026-01-15_PS` | Source manifest |
| `source_checksum` | text | `sha256:a1b2c3...` | Source manifest |
| `adapter_version` | text | `v2.1.0` | Ingestion run manifest |
| `transform_version` | text | `v1.3.0` | Transform run manifest |
| `inference_model_version` | text | `v1.2.0` | Inferred entities |
| `inference_seed` | bigint | `48291037` | Inferred entities |
| `inference_method` | text | `orbital_lane_spacing` | Inferred entities |
| `world_build_id` | uuid | `wb_20260221_001` | All canonical + inferred entities |
| `pipeline_run_id` | uuid | `run_20260221_143000` | Run-level manifest |

### Run Manifest

Each pipeline execution produces a manifest containing:

```json
{
  "run_id": "run_20260221_143000",
  "world_build_id": "wb_20260221_001",
  "started_at": "2026-02-21T14:30:00Z",
  "completed_at": "2026-02-21T14:35:22Z",
  "sources": [
    {"name": "EXOPLANETS_01.csv", "checksum": "sha256:...", "release": "2026-01-15"},
    {"name": "SIMBAD_01.csv", "checksum": "sha256:...", "release": "2026-01-20"}
  ],
  "adapter_versions": {"nasa_ea": "v2.1.0", "simbad": "v1.4.0"},
  "inference_model_version": "v1.2.0",
  "inference_seed": 48291037,
  "migration_version": "005",
  "validation_summary": {"passed": 4823, "warned": 12, "failed": 3, "quarantined": 3}
}
```

---

## Validation Framework

### Validation Layers

| Layer | When | What | Action on Failure |
|-------|------|------|-------------------|
| **L1: Schema Validation** | Ingestion | Type, unit, range checks per column | Quarantine row |
| **L2: Cross-Source Consistency** | Post-merge | Conflicting values for same entity across catalogs | Flag + adjudicate |
| **L3: Physical Plausibility** | Post-transform | Impossible orbits, invalid distances, negative masses | Quarantine + alert |
| **L4: Coordinate Sanity** | Post-coordinate transform | Distance bounds, parallax round-trip, outlier detection | Quarantine + alert |
| **L5: Inference Stability** | Post-inference | Overlapping orbits, resonance conflicts, AMD violation | Reject inference |
| **L6: Simulation Readiness** | Pre-simulation | Minimum fields present for downstream runtime | Exclude from sim |
| **L7: Reference Validation** | Post-build | Known-good distances (Alpha Centauri, Sirius, etc.) | Fail build if ΔLY > tolerance |

### Validation Rules (Examples)

| Rule ID | Layer | Check | Threshold | Severity |
|---------|-------|-------|-----------|----------|
| V001 | L1 | Right ascension in [0, 360) degrees | Exact | FAIL |
| V002 | L1 | Declination in [-90, 90] degrees | Exact | FAIL |
| V003 | L1 | Parallax > 0 for included stars | > 0 mas | FAIL |
| V004 | L1 | Stellar mass > 0 if provided | > 0 M☉ | WARN |
| V005 | L3 | Planet SMA > stellar radius | Physical | FAIL |
| V006 | L3 | Planet period consistent with SMA (Kepler's 3rd) | ±20% | WARN |
| V007 | L4 | Computed distance < 110 LY (inclusion boundary) | ≤ 110 LY | FAIL |
| V008 | L4 | Parallax round-trip error < 1% | < 1% | WARN |
| V009 | L5 | No crossing orbits in inferred system | Boolean | FAIL |
| V010 | L7 | Alpha Centauri distance = 4.37 ± 0.05 LY | ± 0.05 | FAIL |
| V011 | L7 | Sirius distance = 8.60 ± 0.10 LY | ± 0.10 | FAIL |
| V012 | L7 | Barnard's Star distance = 5.96 ± 0.05 LY | ± 0.05 | FAIL |

### Quarantine System

Rows that fail validation are moved to quarantine tables:

| Table | Purpose |
|-------|---------|
| `stg_quarantine.failed_stars` | Stars failing L1–L4 checks |
| `stg_quarantine.failed_planets` | Planets failing L1–L5 checks |
| `stg_quarantine.failed_inferences` | Inferred objects failing L5 stability |

Each quarantine record includes:
- `rule_id`: Which validation rule was violated
- `reason_code`: Machine-readable failure category
- `details_json`: Specific field values that caused failure
- `severity`: WARN or FAIL
- `quarantined_at`: Timestamp
- `reviewed`: Boolean (curator has seen this)
- `resolution`: null | accepted | rejected | corrected

---

## Confidence Model

### Confidence Tiers (Summary)

| Tier | Label | Score Range | Criteria |
|------|-------|-------------|----------|
| T1 | Observed-Confirmed | 0.85–1.00 | Published, peer-reviewed detection |
| T2 | Observed-Candidate | 0.50–0.84 | Unconfirmed detection with statistical support |
| T3 | Inferred | 0.20–0.69 | Model-generated from partial data |
| T4 | Simulated-Decorative | 0.00–0.19 | Gameplay flavor, no scientific basis |

### Confidence in UI

| Tier | Map Icon | Detail Panel | Filtering |
|------|----------|-------------|-----------|
| T1 | Solid marker, full color | Full data, green confidence badge | Always shown by default |
| T2 | Dashed outline | Partial data, yellow badge, source notes | Toggleable layer |
| T3 | Ghost/transparent marker | Inferred tag, model version, seed shown | Off by default |
| T4 | Faint dot (if shown) | "Decorative" disclaimer | Off by default |

### Confidence in Simulation

| Tier | Simulation Weight | Effect |
|------|------------------|--------|
| T1 | 1.0 | Full contribution to population, economy, routes |
| T2 | 0.5–0.9 | Partial contribution; lower colonization priority |
| T3 | 0.2–0.7 | Available for exploration; reduced starting resources |
| T4 | 0.0–0.1 | Visual only; no simulation impact |

---

## Governance Policies

### Data Immutability
- **Raw source files are never modified.** Archived with checksum on ingest.
- **Canonical records are append-only** within a world build. Updates create new world_build_id.
- **Quarantine records persist** until explicitly reviewed and resolved.

### Reproducibility
- Every pipeline run has a deterministic manifest.
- Same (sources + adapter_versions + inference_seed + model_version) = same output.
- Build manifests archived indefinitely.

### Model Updates
- **Minor version** (v1.1 → v1.2): Parameter tuning, no structural change. Benchmark comparison required.
- **Major version** (v1.x → v2.0): Structural change to inference logic. Full regression test + curator review.
- **Deprecation**: Previous model version archived; diff report published.

### Retention & Archival

| Data | Retention | Archive Policy |
|------|-----------|---------------|
| Raw source files | Indefinite | Immutable archive, checksummed |
| World builds | Last 10 + any marked "pinned" | Older builds archived to cold storage |
| Simulation snapshots | Last 50 per campaign | Older snapshots compressed |
| Quarantine records | Until reviewed + 90 days | Purged after resolution period |
| Run manifests | Indefinite | Part of audit trail |
| Pipeline logs | 30 days active, 1 year archive | Rotated, compressed |

---

## Observability & Metrics

### Pipeline Run Metrics

| Metric | Purpose | Alert Threshold |
|--------|---------|----------------|
| `records_ingested` | Total rows loaded from sources | Δ > 20% from previous run |
| `records_merged` | Successfully cross-matched | < 80% of ingested |
| `records_quarantined` | Failed validation | > 5% of ingested |
| `records_inferred` | Generated by inference | Δ > 30% from previous run |
| `inference_rejection_rate` | Stability-rejected inferences | > 40% of attempts |
| `build_diff_magnitude` | Changed entities vs previous build | > 10% triggers review |
| `build_duration_seconds` | Pipeline wall-clock time | > 2× previous run |

### Data Quality Dashboard (DataQAPage)

| Panel | Content |
|-------|---------|
| Run summary | Pass/warn/fail counts by validation layer |
| Source manifest | File checksums, dates, adapter versions |
| Quarantine browser | Filterable list with reason codes, severity |
| Reference validation | Known-star distance checks with pass/fail |
| Build diff | Added/changed/removed entities since last build |
| Trend charts | Quality metrics over last 10 runs |

---

## Human-in-the-Loop

### Curator Review Queue
- High-impact uncertain systems (habitable zone planets at T2/T3) flagged for review.
- Quarantine records with severity WARN surfaced for decision.
- Curator can: accept (promote to canonical), reject (permanent exclude), correct (manual override).

### Override Mechanism
- Manual overrides require text rationale.
- All overrides logged in audit table with curator ID and timestamp.
- Overrides survive re-runs unless explicitly revoked.

### Review Priority

| Priority | Trigger | Example |
|----------|---------|---------|
| P0 (Urgent) | Reference validation failure | Alpha Centauri distance wrong |
| P1 (High) | HZ planet at T2 confidence | Candidate in Tau Ceti HZ |
| P2 (Medium) | Quarantine with WARN severity | Missing mass but otherwise valid |
| P3 (Low) | Minor parameter conflict | Slight eccentricity disagreement |

---

## Cross-References

| Topic | Document |
|-------|----------|
| Confidence tier definitions | `02_ASTROPHYSICAL_MODELING.MD` |
| Database schemas | `03_DATA/02_SCHEMAS/` |
| Migration scripts | `03_DATA/03_MIGRATIONS/` |
| Validation implementation | `01_SERVICES/02_PIPELINE/01_INGEST/` |
| QA dashboard | `02_CLIENTS/01_WEB/src/pages/DataQAPage.tsx` |
