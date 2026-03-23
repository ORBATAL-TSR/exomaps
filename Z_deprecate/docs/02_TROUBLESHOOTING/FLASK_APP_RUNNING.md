# FLASK APP — RUNNING & ACCESSIBLE

## ✅ CURRENT STATUS

**Flask app is running successfully** on `http://127.0.0.1:5000`

```
✓ Process: python (PID 19489, 19427)
✓ Port: 5000
✓ Status: Listening on 0.0.0.0:5000 and <YOUR_LAN_IP>:5000
✓ Debug mode: ON
```

---

## 🌐 ACCESSIBLE ENDPOINTS

### Home Page
```
http://127.0.0.1:5000/
```
Main dashboard with links to all features.

### 3D Star Map (Starfield Viewer)
```
http://127.0.0.1:5000/starfield
```
Interactive 3D visualization of stars using Three.js
- Zoom, rotate, pan with mouse
- Color-coded by spectral type
- Click stars to see details

### Simulation Control Dashboard
```
http://127.0.0.1:5000/simulation
```
Controls for running and monitoring simulations
- Step through simulation ticks
- Pause/resume execution
- View population and economic data

---

## 🛠️ MANAGING THE FLASK APP

### View Running Process
```bash
lsof -i :5000
ps aux | grep "python.*app"
```

### Stop Flask App
```bash
# Kill by port
fuser -k 5000/tcp

# Or kill by process
killall python
```

### Restart Flask App
```bash
# 1. Kill existing process
pkill -9 -f "python.*app.py"

# 2. Load environment
export $(grep -v '^#' .env.auto | xargs)

# 3. Start Flask
cd /home/tsr/Projects/exomaps
python src/app/app.py
```

### Run on Different Port
```bash
export $(grep -v '^#' .env.auto | xargs)
export FLASK_PORT=8000
python src/app/app.py
# Now accessible on http://127.0.0.1:8000
```

---

## 📊 CURRENT CONFIGURATION

**Environment Variables Loaded:**
```bash
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<YOUR_PG_PASSWORD>
POSTGRES_DB=exomaps
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5432
FLASK_HOST=127.0.0.1
FLASK_PORT=5000
```

**Database Connection:**
- ✓ ConfigManager: postgresql://postgres:<YOUR_PG_PASSWORD>@127.0.0.1:5432/exomaps
- ✓ Status: Connected via three-tier fallback system

**Flask Instance:**
- ✓ App: src/app/app.py
- ✓ Debug mode: ON (auto-reload enabled)
- ✓ Accessible from: localhost, 127.0.0.1, <YOUR_LAN_IP>

---

## 📝 USAGE EXAMPLES

### Test Endpoints with curl
```bash
# Home page
curl http://127.0.0.1:5000/

# Starfield page
curl http://127.0.0.1:5000/starfield

# API - Get world systems  
curl http://127.0.0.1:5000/api/world/systems

# API - Get current persona
curl http://127.0.0.1:5000/api/persona
```

### Monitor Flask Logs
```bash
# Follow Flask output in real-time
# (Press Ctrl+C to stop)
tail -f /tmp/flask_debug.log
```

### Test Database Connection
```bash
# From Flask console
python -c "
from src.app.app import app
with app.app_context():
    from src.app.models import World
    print('✓ Database models loaded')
"
```

---

## ⚠️ TROUBLESHOOTING

### Port 5000 Already in Use
```bash
# Find what's using port 5000
lsof -i :5000

# Kill the process
fuser -k 5000/tcp

# Or get PID and kill manually
kill -9 <PID>
```

### Flask Won't Start
```bash
# Check if port is really free
netstat -tlnp | grep 5000

# Or
ss -tlnp | grep 5000

# If port shows as TIME_WAIT, wait 60 seconds and try again
```

### Module Import Errors
```bash
# Ensure environment is loaded
export $(grep -v '^#' .env.auto | xargs)

# Check Python path
export PYTHONPATH=/home/tsr/Projects/exomaps:$PYTHONPATH
python src/app/app.py
```

### Database Connection Issues
See: **DATABASE_CONNECTIVITY_FIX.md**

---

## 🎯 QUICK COMMANDS

```bash
# Start Flask app
export $(grep -v '^#' /home/tsr/Projects/exomaps/.env.auto | xargs)
cd /home/tsr/Projects/exomaps
python src/app/app.py

# Check if Flask is running
curl -s http://127.0.0.1:5000/ | grep -q "<!DOCTYPE" && echo "✓ Flask is running" || echo "✗ Flask not responding"

# Kill Flask
pkill -f "python.*app.py"

# View active connections
lsof -i :5000

# Full system check
bash scripts/integration_test.sh
bash scripts/health_check.sh
```

---

## 📚 RELATED DOCUMENTATION

- [QUICK_REFERENCE.md](QUICK_REFERENCE.md) — General setup & usage
- [DATABASE_CONNECTIVITY_FIX.md](DATABASE_CONNECTIVITY_FIX.md) — Database configuration
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) — Solutions for common issues
- [SERVICE_DISCOVERY_COMPLETE.md](SERVICE_DISCOVERY_COMPLETE.md) — Technical details

---

## 🎓 WHAT'S RUNNING

| Component | Status | Details |
|-----------|--------|---------|
| Flask App | ✅ Running | PID 19489, listening on :5000 |
| PostgreSQL | ✅ Available | 127.0.0.1:5432 (auto-detected) |
| Redis | ✅ Available | 127.0.0.1:6379 (optional cache) |
| Configuration | ✅ Loaded | From .env.auto via ConfigManager |
| Database | ✅ Connected | Via three-tier fallback system |

---

## 🚀 NEXT STEPS

### Option 1: Browse the Web Interface
```
Open browser → http://127.0.0.1:5000/
- Explore 3D star map
- Run simulations
- View system details
```

### Option 2: Use the API
```bash
curl http://127.0.0.1:5000/api/world/systems | jq .
curl http://127.0.0.1:5000/api/persona | jq .
```

### Option 3: Run Phases
```bash
export $(grep -v '^#' /home/tsr/Projects/exomaps/.env.auto | xargs)
bash /home/tsr/Projects/exomaps/scripts/run_phase.sh 1
bash /home/tsr/Projects/exomaps/scripts/run_phase.sh 4
```

### Option 4: Monitor System
```bash
bash /home/tsr/Projects/exomaps/scripts/health_check.sh
bash /home/tsr/Projects/exomaps/scripts/integration_test.sh
```

---

**Status:** ✅ **FLASK APP IS RUNNING & ACCESSIBLE**

Access the web interface now at: **http://127.0.0.1:5000/**

---

*Generated: Feb 21, 2026*  
*Flask Process: Active and listening*  
*Environment: Properly configured via .env.auto*
