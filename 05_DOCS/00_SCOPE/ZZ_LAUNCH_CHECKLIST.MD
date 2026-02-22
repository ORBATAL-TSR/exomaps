# ZZ — Updated Web App Launch Checklist

## 1) Environment Variables

### DB for pipeline (dbs)
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`
- `POSTGRES_HOST` (default `127.0.0.1`)
- `POSTGRES_PORT` (default `5432`)
- `APPUSER` (default `appuser`)
- `APPPASS` (default `<YOUR_APP_PASSWORD>`)

### DB for web app (src)
- `DBUSER`
- `DBPASS`
- `DBNAME`
- `DBHOST` (default `127.0.0.1`)
- `DBPORT` (default `5432`)
- `PORT` (default `5000`)

## 2) Run Phase 01 Pipeline + Checks

```bash
bash scripts/run_phase01_pipeline.sh
```

Expected output includes a final `run_id=<uuid>`.

## 3) Launch Updated Web App

```bash
bash scripts/launch_updated_web.sh
```

Open:
- `http://127.0.0.1:5000/`
- `http://127.0.0.1:5000/phase01/qa`
- `http://127.0.0.1:5000/phase01/qa.json`

## 4) Interactive QA Flow
- In `/phase01/qa`, leave Run ID empty to inspect latest run.
- Paste a specific run id to compare runs.
- Check:
  - validation summary by source
  - source manifest status per file
  - quarantine error distribution
  - reference validation results (major-star distance gut checks)

## 5) Coordinate-System Gut Check Rules
Rules are in:
- `dbs/fetch_db/reference_rules.json`

Current rules include reference distances to Sol for:
- Alpha Centauri
- Barnard's Star
- Sirius
- Procyon
- Tau Ceti
- Epsilon Eridani

Extend these rules over time using better source-backed values and tighter tolerances.
