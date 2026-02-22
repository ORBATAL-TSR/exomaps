# 14 — Cloud Hosting & Cost Strategy (Cheap-by-Design)

## Objectives
- Move from local/legacy deployment to cloud-hosted operation.
- Keep monthly cost low in early phases.
- Preserve a clean path to scale later without re-platforming.

## Workload Profile Split
- **Always-on light services**:
  - API + simulation control plane (can be low-resource by default).
  - Database.
- **Burst workloads**:
  - Pipeline ingestion/transforms.
  - Inference/world-build generation.
- **Static/distributed assets**:
  - Web UI bundle and cached snapshots.

## Cost-Control Principles
- Scale to zero for non-critical services.
- Use scheduled jobs for heavy pipeline runs.
- Precompute expensive artifacts (snapshots, map tiles/projections).
- Keep DB small and indexed; archive old run artifacts.
- Prefer managed basics only where operational savings outweigh cost.

## Reference Low-Cost Architecture
1. **Container App/Web Service (small instance)**
   - Hosts API and simulation controller.
2. **Managed PostgreSQL (small tier) or self-hosted small VM DB (phase-dependent)**
   - Start with smallest reliable tier; monitor I/O and storage growth.
3. **Object Storage**
   - Store pipeline artifacts, snapshots, static outputs.
4. **Scheduled Worker Jobs**
   - Trigger periodic world build; shut down when complete.
5. **CDN/Static Hosting**
   - Serve web frontend cheaply with caching.

## Provider-Agnostic Deployment Pattern
- Docker images built in CI.
- Environment-specific configs (dev/staging/prod).
- IaC templates for repeatable provisioning.
- One-click rollback to prior image and world build.

## Migration Plan

### Step H0 — Readiness
- Standardize Dockerfiles and health endpoints.
- Externalize config/secrets from code.

### Step H1 — Staging Cloud
- Deploy API + DB + storage in staging.
- Run first full pipeline in cloud and compare outputs.

### Step H2 — Production Cutover
- Enable production with conservative traffic and manual pipeline trigger.
- Keep local fallback for one release cycle.

### Step H3 — Cost Optimization Loop
- Add budget alerts and monthly spend report.
- Tune instance sizes based on real usage.
- Move burst tasks to scheduled/ephemeral runners.

## Cheap-First Tactics
- Single-region deployment initially.
- Small compute tier + vertical scale before horizontal.
- Cache heavy read endpoints aggressively.
- Snapshot simulation states to reduce hot compute.
- Pause or downscale non-essential environments off-hours.

## Cost Risks to Watch
- DB storage and IOPS creep from event history.
- Egress costs from heavy map payloads.
- Idle compute waste from always-on workers.
- Excessive snapshot retention without lifecycle policies.

## Practical Budget Guardrails
- Define target monthly envelopes by stage (dev/staging/prod).
- Set hard alerts at 50%, 80%, and 100% of budget.
- Weekly review of top 5 cost drivers and remediation actions.

## Reliability on a Budget
- Prioritize backups and restore tests over expensive HA at first.
- Use graceful degradation (reduced detail modes) during load spikes.
- Keep clear incident runbooks for service restart and rollback.

## Exit Criteria
- Stable cloud-hosted API and web experience.
- Pipeline can run on schedule without manual intervention.
- Monthly costs predictable and within defined budget envelope.
- Clear path to scale if simulation adoption grows.
