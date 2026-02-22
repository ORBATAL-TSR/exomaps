# Quick Reference — ExoMaps Phase 06 & 07

## ⚡ ONE-COMMAND SETUP (Recommended)

**For first-time setup or after structure changes:**

```bash
cd /home/tsr/Projects/exomaps

# Option 1: Full Docker setup (PostgreSQL + Redis in containers)
bash scripts/setup.sh --docker

# Option 2: Local PostgreSQL (if already installed)
bash scripts/setup.sh --local

# Option 3: Both Docker and local services
bash scripts/setup.sh --all
```

This automatically:
- ✓ Detects available services (PostgreSQL, Redis, Flask)
- ✓ Generates `.env.auto` with correct hosts
- ✓ Starts Docker containers if needed
- ✓ Applies database migrations
- ✓ Installs Python dependencies

**Then proceed to "Launch Web Interfaces" below.**

## ✅ Verify Services Are Running

```bash
# Quick health check
bash scripts/health_check.sh

# Should show ✓ for PostgreSQL (at minimum)
# Should show ✓ for Redis (optional)
# Should show ✓ for Flask (when running)
```

## 🚀 Launch Web Interfaces

```bash
# Navigate to project directory and start Flask
cd /home/tsr/Projects/exomaps
python src/app/app.py

# Then visit in browser:
http://localhost:5000/starfield      # 3D star map
http://localhost:5000/simulation     # Simulation control
http://localhost:5000/               # Home page
```

## 🔧 Common Development Tasks

```bash
# Install dependencies
make install-locked

# Check code quality
make lint && make format && make type-check

# Run simulation test
make test-phase04

# Full CI locally
make full-test

# See all available commands
make help
```

## 📊 API Endpoints

### Read (All Personas)
```bash
curl http://localhost:5000/api/world/systems
curl http://localhost:5000/api/persona
```

### Admin Only
```bash
curl -H "Cookie: session=<token>" \
  http://localhost:5000/api/simulation/sim_001/snapshot

curl -X POST http://localhost:5000/api/simulation/sim_001/pause
curl -X POST http://localhost:5000/api/simulation/sim_001/step?interval=10
```

## 🎯 Key Personas

| Persona | Access | Use Case |
|---------|--------|----------|
| `admin` | All endpoints | Full control |
| `sim_owner` | Simulation control | Run & manage simulations |
| `observer_guest` | Read snapshots | View-only observer |
| `general_user` | World systems | Browse systems |
| `data_curator` | Validation details | Data quality review |

Set session person via `/login?persona=admin` (for demo)

## 📝 Code Locations

| Task | File |
|------|------|
| Simulation engine | `dbs/simulation_core.py` |
| Economy/politics | `dbs/economy_politics.py` |
| Logging setup | `dbs/logging_setup.py` |
| Star map viewer | `src/app/static/js/exomaps/starfield-viewer.js` |
| Control dashboard | `src/app/templates/simulation_control.html` |
| API endpoints | `src/app/app.py` (lines 650–800+) |
| CI workflows | `.github/workflows/*.yml` |

## 🐛 Troubleshooting

**Services not found or connections failing?**
```bash
# Auto-detect and fix configuration
bash scripts/health_check.sh --fix-env

# Check what was detected and auto-generated
cat .env.auto

# If services still unavailable, start them
bash scripts/setup.sh --docker
```

**See comprehensive troubleshooting:**
```bash
# Open detailed guide with solutions for common issues
cat TROUBLESHOOTING.md
```

**Flask app won't start:**
```bash
# Check dependencies and configuration
make install-locked
python -m pip list
python --version  # Should be 3.9+

# Verify services are available
bash scripts/health_check.sh

# Check for import errors
python -c "from src.app.app import app; print('✓ Imports OK')"
```

**Starfield viewer shows blank:**
```bash
# Check Three.js is loaded
curl http://localhost:5000/starfield | grep -i three.js

# Verify API returns systems
curl http://localhost:5000/api/world/systems | head -20

# Check browser console (F12) for JS errors
```

**Run integration test suite:**
```bash
# Verify all components work together
bash scripts/integration_test.sh
```

## 📚 Documentation

- `TROUBLESHOOTING.md` — **Start here for any issues** (service discovery, configuration, remediation)
- `DEVELOPMENT.md` — Full setup & features guide
- `SESSION_COMPLETE.md` — Detailed deliverables
- `00_plan/ZZ_EXECUTION_BACKLOG.MD` — Architecture docs
- `Makefile` — Run `make help` for all shortcuts

---

**Last Updated:** Feb 21, 2026 | **Status:** ✅ Complete
