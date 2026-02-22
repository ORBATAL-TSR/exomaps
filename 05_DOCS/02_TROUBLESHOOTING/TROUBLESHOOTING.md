# TROUBLESHOOTING GUIDE

This guide helps diagnose and resolve common issues when running exomaps with mixed Docker/local services.

## Quick Diagnosis

**Before anything else, run:**
```bash
bash scripts/health_check.sh
```

This will show:
- ✓ Services that are available and ready
- ✗ Services that are unavailable
- ⚠ Optional services not running

## Common Issues

### PostgreSQL Connection Refused

**Error:**
```
psycopg2.OperationalError: connection to server at "127.0.0.1", port 5432 failed: Connection refused
```

**Diagnosis:**
```bash
# Check if PostgreSQL is running locally
systemctl status postgresql

# Check if Docker PostgreSQL is running
docker ps | grep -i postgres

# Check which interfaces PostgreSQL is listening on
bash scripts/health_check.sh
```

**Solutions:**

**Option 1: Use Docker PostgreSQL (Recommended)**
```bash
bash scripts/setup.sh --docker
```
This will:
- Start PostgreSQL in a Docker container
- Auto-detect and save configuration to .env.auto
- Apply database migrations

**Option 2: Use Local PostgreSQL**
```bash
# Ensure PostgreSQL is running
sudo systemctl start postgresql

# Auto-detect local installation
bash scripts/health_check.sh --fix-env

# Verify connection
psql -U postgres -h 127.0.0.1 -c "SELECT version();"
```

**Option 3: Mixed Setup (Docker + Local Services)**
```bash
# Start only Docker PostgreSQL
docker-compose up -d db

# Auto-detect everything
bash scripts/health_check.sh --fix-env

# Run health check again to verify
bash scripts/health_check.sh
```

### Services Not Found After Fresh Start

**Symptoms:**
- Scripts can't find PostgreSQL or Redis
- All services show ✗ in health check

**Solution:**
```bash
# Generate auto-detection file
bash scripts/health_check.sh --fix-env

# If services aren't running, start them
bash scripts/setup.sh --docker

# Verify all services are available
bash scripts/health_check.sh
```

### Localhost vs <YOUR_LAN_IP> Connectivity Issues

**Problem:**
- Connecting from host machine: `127.0.0.1`
- Connecting from Docker containers: `db` (internal DNS)
- Connecting from LAN: `<YOUR_LAN_IP>`

**The ConfigManager handles this automatically**, but if you're manually setting environment:

```bash
# For local/host access
export POSTGRES_HOST=127.0.0.1

# For Docker internal access
export POSTGRES_HOST=db

# For LAN access from other machines
export POSTGRES_HOST=<YOUR_LAN_IP>
```

Health check auto-detects the correct interface:
```bash
bash scripts/health_check.sh --fix-env
```

### Database Already Exists

**Error:**
```
ERROR:  database "exomaps" already exists
```

**Solution:**
Migrations are idempotent, but if you want to reset:

```bash
# Drop and recreate database
psql -U postgres -c "DROP DATABASE IF EXISTS exomaps;"
psql -U postgres -c "CREATE DATABASE exomaps OWNER appuser;"

# Re-apply migrations
bash scripts/setup.sh --docker
```

Or manually:
```bash
export $(cat .env.auto | xargs)
python3 dbs/schema_migrator.py
```

### Redis Connection Issues

**Diagnosis:**
```bash
# Check Redis status
bash scripts/health_check.sh | grep -A2 "Redis"

# If not running
docker-compose up -d redis
```

**Note:** Redis is optional. If not running, the system will function but without caching.

### Flask Server Not Starting

**Error:**
```
ERROR: Address already in use
```

**Solution:**
```bash
# Find what's using port 5000
lsof -i :5000

# Kill the process
kill -9 <PID>

# Or use a different port
export FLASK_PORT=5001
python src/app/app.py
```

## Debug Mode

### Enable Verbose Service Discovery

```bash
python3 -c "
from dbs.service_discovery import ServiceDiscovery
sd = ServiceDiscovery(verbose=True)
sd.diagnose()
"
```

### Check Configuration Loaded

```bash
python3 -c "
from dbs.config_manager import ConfigManager
cm = ConfigManager()
cm.print_summary()
"
```

### Test Database Connection

```bash
python3 -c "
from dbs.config_manager import ConfigManager
from dbs.database import Database

cm = ConfigManager()
db = Database()
result = db.execute('SELECT version();')
print('Connected! PostgreSQL:', result[0][0])
"
```

### Check Docker Network

```bash
# Verify Docker network exists
docker network inspect exomaps_backend

# Check container IPs
docker inspect exomaps-db --format='{{.NetworkSettings.Networks}}'

# Test DNS resolution from container
docker exec exomaps-web ping db
```

## Running Phases with Auto-Configuration

All phase scripts now auto-detect services:

```bash
# Auto-detect and run Phase 1
bash scripts/run_phase.sh 1

# Auto-detect and run Phase 4
bash scripts/run_phase.sh 4
```

This handles:
- Loading correct environment variables
- Detecting which services are available
- Using .env.auto if present, else .env, else defaults
- Proper error reporting

## Integration Testing

```bash
# Run full integration test suite
bash scripts/integration_test.sh
```

This verifies:
- Service discovery module works
- Configuration manager works
- Database connectivity available
- Simulation core instantiates
- Flask app creates
- All dependencies importable

## Advanced: Manual Configuration

If auto-detection doesn't work, create `.env` manually:

```bash
# Required for PostgreSQL
export POSTGRES_USER=postgres
export POSTGRES_PASSWORD=<YOUR_PG_PASSWORD>
export POSTGRES_DB=exomaps
export POSTGRES_HOST=127.0.0.1        # or 'db' for Docker, or '<YOUR_LAN_IP>' for LAN
export POSTGRES_PORT=5432

# For application user
export APPUSER=appuser
export APPPASS=<YOUR_APP_PASSWORD>

# Optional: Redis
export REDIS_HOST=127.0.0.1
export REDIS_PORT=6379
```

Then use ConfigManager in your code:
```python
from dbs.config_manager import ConfigManager

cm = ConfigManager()
db_url = cm.get_db_url()
redis_url = cm.get_redis_url()  # Returns None if Redis unavailable
```

## Getting More Help

**Check logs:**
```bash
# Flask app logs
tail -f /tmp/exomaps.log

# Docker container logs
docker-compose logs -f db   # PostgreSQL
docker-compose logs -f redis # Redis
docker-compose logs -f web   # Flask app
```

**Run diagnostic:**
```bash
bash scripts/health_check.sh

# With verbose output and auto-fix
bash scripts/health_check.sh --fix-env --start-services
```

**Environment inspection:**
```bash
# Show all loaded configuration
python3 -c "from dbs.config_manager import ConfigManager; ConfigManager().print_summary()"

# Show service discovery results
python3 -c "from dbs.service_discovery import ServiceDiscovery; ServiceDiscovery(verbose=True).diagnose()"
```
