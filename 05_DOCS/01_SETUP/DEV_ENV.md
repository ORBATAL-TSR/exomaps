# ExoMaps Development Environment Configuration

## Semantic Versioning

### Installed Versions
- **PostgreSQL**: 17.8 (Debian build)
- **Python**: 3.13
- **Flask**: 2.x (pinned in requirements)
- **SQLAlchemy**: 2.x (pinned in requirements)

### Docker Versions (if using --dbcontainer)
- **PostgreSQL**: 14-alpine (see docker-compose.yml)
- Compatible with codebase v2.x.x+

---

## Development Mode Selection

### Option 1: Local PostgreSQL (--dblocal)
**Use installed PostgreSQL 17.8 on host machine**

```bash
cd /home/tsr/Projects/exomaps
python3 src/app/app.py --dblocal
```

**Connection Details:**
- Host: localhost (Unix socket at /var/run/postgresql)
- Port: 5432
- Database: exomaps
- User: postgres (requires peer/trust auth)

**Pros:**
- No Docker overhead
- Direct system integration
- Consistent with system Python version

**Cons:**
- Requires PostgreSQL 17.8+ installed
- Must manage auth manually

---

### Option 2: Docker PostgreSQL (--dbcontainer)
**Use PostgreSQL 14 in Docker container**

```bash
cd /home/tsr/Projects/exomaps
docker-compose up -d db redis
python3 src/app/app.py --dbcontainer
```

**Connection Details:**
- Host: 127.0.0.1:5433 (mapped from container's 5432)
- Database: exomaps
- User: postgres
- Password: <YOUR_PG_PASSWORD>

**Pros:**
- Isolated environment
- Version pinned to 14-alpine
- Easy cleanup/reset

**Cons:**
- Requires Docker
- Slower than local
- Version mismatch with system PostgreSQL

---

## Configuration Files

### .env.local (Local PostgreSQL)
```
DB_MODE=local
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=
POSTGRES_DB=exomaps
FLASK_ENV=development
```

### .env.docker (Docker PostgreSQL)
```
DB_MODE=docker
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5433
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<YOUR_PG_PASSWORD>
POSTGRES_DB=exomaps
FLASK_ENV=development
```

---

## Quick Start

### First Time Setup

1. **Check PostgreSQL version:**
   ```bash
   psql --version
   pg_isready -U postgres -h localhost
   ```

2. **Create exomaps database:**
   ```bash
   createdb -U postgres exomaps
   ```

3. **Run integration test:**
   ```bash
   python3 test_integration.py --db-mode local
   ```

### Start Flask Dev Server

```bash
# Using local PostgreSQL (preferred for development)
python3 src/app/app.py --dblocal

# OR using Docker
docker-compose up -d db redis
python3 src/app/app.py --dbcontainer
```

### Access Application

- Home: http://localhost:5000
- Network: http://<YOUR_LAN_IP>:5000
- API: http://localhost:5000/api/persona

---

## Troubleshooting

### "SQL Connection Error" on Page Load

**Problem:** Page shows "Database not connected"

**Solution - Local Mode:**
```bash
# Create database if missing
createdb -U postgres exomaps

# Verify connection
psql -U postgres -d exomaps -c "SELECT 1"
```

**Solution - Docker Mode:**
```bash
# Start containers
docker-compose up -d db redis

# Wait for PostgreSQL to be ready
sleep 5
docker exec exomaps-db pg_isready -U postgres
```

### Authentication Failed

**Local mode:**
```bash
# Check pg_hba.conf (should have peer or trust auth for local)
sudo -u postgres cat /etc/postgresql/17/main/pg_hba.conf | grep "^local"
```

**Docker mode:**
```bash
# Verify container environment
docker exec exomaps-db env | grep POSTGRES
```

### Version Incompatibility

**If using PostgreSQL 17.8 with codebase expecting 14.x:**
- Minor version differences (17.x vs 14.x) are compatible for basic operations
- Use `--dblocal` only if you have PostgreSQL 14+
- For exact version matching, use `--dbcontainer` (14-alpine)
