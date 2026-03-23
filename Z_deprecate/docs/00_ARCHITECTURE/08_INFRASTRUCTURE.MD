# 05 — Infrastructure & Deployment

## Overview

`04_INFRA/` houses everything needed to build, deploy, and operate the platform.

```
04_INFRA/
├── 01_DOCKER/          Docker Compose for local dev + staging
├── 02_CI_CD/           GitHub Actions workflows (planned)
├── 03_SCRIPTS/         Shell automation for pipeline, health, testing
└── 04_TERRAFORM/       Cloud IaC (planned)
```

---

## Local Development Stack

```
┌─────────────────────────────────────────────────┐
│              Developer Machine                   │
│                                                  │
│  ┌────────────┐  ┌────────────┐                 │
│  │ PostgreSQL  │  │   Redis    │  (planned)      │
│  │  port 5432  │  │ port 6379  │                 │
│  │  peer auth  │  └────────────┘                 │
│  └─────┬──────┘                                  │
│        │                                         │
│  ┌─────▼──────────────────────────────────────┐  │
│  │ python3 01_SERVICES/01_GATEWAY/app.py      │  │
│  │ Flask → port 5000                          │  │
│  │ Serves: /api/* + React SPA at /            │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │ cd 02_CLIENTS/01_WEB && npm start          │  │
│  │ React dev server → port 3000 (optional)    │  │
│  │ Proxies /api → localhost:5000              │  │
│  └────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### Quick Start

```bash
# 1. Database (already running as system service)
psql -d exomaps -c "SELECT 1;"

# 2. Backend
cd /path/to/exomaps
POSTGRES_USER=tsr POSTGRES_HOST= POSTGRES_DB=exomaps \
  python3 01_SERVICES/01_GATEWAY/app.py

# 3. Frontend (for development with hot reload)
cd 02_CLIENTS/01_WEB
npm install --legacy-peer-deps
npm start

# 4. Frontend (for production — Flask serves the build)
cd 02_CLIENTS/01_WEB
npm run build
# Then just access http://localhost:5000/
```

---

## Docker Compose (Containerized)

For environments without a local Postgres:

```yaml
# 04_INFRA/01_DOCKER/docker-compose.yml
services:
  db:
    image: postgres:17
    ports: ["5432:5432"]

  gateway:
    build: ../../01_SERVICES/01_GATEWAY
    ports: ["5000:5000"]
    depends_on: [db]

  # Future services:
  # world-engine:
  #   build: ../../01_SERVICES/03_WORLD_ENGINE
  # messaging:
  #   build: ../../01_SERVICES/04_MESSAGING
  # redis:
  #   image: redis:7
```

---

## Shell Scripts (04_INFRA/03_SCRIPTS/)

| Script | Purpose |
|--------|---------|
| `run_phase01_pipeline.sh` | Run Phase 01 ingest |
| `run_phase02_pipeline.sh` | Run Phase 02 transform |
| `run_phase03_pipeline.sh` | Run Phase 03 inference |
| `test_phase04_simulation.sh` | Test Phase 04 sim engine |
| `health_check.sh` | Verify Postgres + Flask + data |
| `integration_test.sh` | End-to-end API tests |
| `launch_updated_web.sh` | Rebuild client + restart server |
| `setup.sh` | First-time environment setup |

---

## Production Deployment (Planned)

### Target: AWS

```
┌───────────────────────────────────────────────────────────┐
│                        AWS VPC                             │
│                                                            │
│  ┌──────────┐     ┌──────────┐     ┌──────────────────┐  │
│  │ ALB      │────▶│ ECS /    │────▶│ RDS PostgreSQL   │  │
│  │ (HTTPS)  │     │ Fargate  │     │ db.t3.micro      │  │
│  └──────────┘     │ Gateway  │     └──────────────────┘  │
│                    └──────────┘                            │
│  ┌──────────┐     ┌──────────┐     ┌──────────────────┐  │
│  │CloudFront│────▶│ S3 bucket│     │ SQS queues       │  │
│  │(CDN)     │     │ React    │     │ pipeline.*       │  │
│  └──────────┘     │ build    │     │ simulation.*     │  │
│                    └──────────┘     └──────────────────┘  │
│                                                            │
│  ┌──────────────────┐     ┌──────────────────────────┐   │
│  │ ECS Worker       │     │ ElastiCache Redis        │   │
│  │ Pipeline tasks   │     │ Session + Socket.IO      │   │
│  └──────────────────┘     └──────────────────────────┘   │
└───────────────────────────────────────────────────────────┘
```

### Cost Estimate (Low-Traffic)

| Service | Spec | Monthly |
|---------|------|---------|
| ECS Fargate (Gateway) | 0.25 vCPU / 512 MB | ~$10 |
| RDS PostgreSQL | db.t3.micro | ~$15 |
| S3 + CloudFront | Static hosting | ~$2 |
| SQS | Low volume | ~$0 |
| **Total** | | **~$27/mo** |

---

## CI/CD (Planned — GitHub Actions)

```yaml
# .github/workflows/deploy.yml
on:
  push:
    branches: [main]

jobs:
  test:
    - Run Python tests
    - Run TypeScript type checks
    - Run integration tests against test DB

  build:
    - npm run build (React SPA)
    - docker build (Gateway image)

  deploy:
    - Push to ECR
    - Update ECS service
    - Upload React build to S3
    - Invalidate CloudFront cache
```
