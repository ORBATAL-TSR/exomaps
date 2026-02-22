# Quick Start Guide - ExoMaps Development

## Two Configuration Modes

### Mode 1: Local PostgreSQL (--dblocal) [Requires Setup]

```bash
# First: Create database as postgres user
sudo -u postgres createdb exomaps

# Then: Run Flask
cd /home/tsr/Projects/exomaps
bash run.sh --dblocal
```

The script will:
- ✓ Check PostgreSQL 17.8 is running
- ✓ Verify exomaps database exists
- ✓ Set up POSTGRES_* environment variables
- ✓ Start Flask on http://localhost:5000

**Semantic Versions:**
- PostgreSQL: 17.8 (system installed)
- Compatible: 14.0+

---

### Mode 2: Docker PostgreSQL (--dbcontainer) [Recommended]

```bash
# Start Docker containers
docker-compose up -d db redis

# Run Flask with Docker DB
cd /home/tsr/Projects/exomaps
bash run.sh --dbcontainer
```

The script will:
- ✓ Check Docker is available
- ✓ Start/verify PostgreSQL 14-alpine container
- ✓ Wait for database readiness
- ✓ Set up POSTGRES_* environment variables
- ✓ Start Flask on http://localhost:5000

**Semantic Versions:**
- PostgreSQL: 14-alpine (pinned in docker-compose.yml)
- Compatible: 14.0 - 14.x only

---

## Current Status

✅ Flask app: Running and accessible  
✅ API endpoints: Responding (tested /api/persona)  
✅ Database connection: Support for both modes implemented  
⏳ Local DB setup: Requires one-time `sudo -u postgres createdb exomaps`  

---

## Testing

### Test Flask Response
```bash
curl http://localhost:5000/api/persona | jq .
```

Should return:
```json
{
  "current_persona_key": "general_user",
  "available_personas": [...]
}
```

### Test Database (once running)
```bash
curl http://localhost:5000/phase01/qa
```

Should show QA dashboard (once data is loaded)

---

## Files Created/Modified

- **run.sh** - Startup script with DB mode selection
- **DEV_ENV.md** - Detailed documentation
- **src/app/app.py** - Updated database connection logic (Unix socket + TCP support)

---

## Environment Variables Summary

| Variable | Local | Docker |
|----------|-------|--------|
| POSTGRES_HOST | localhost | 127.0.0.1 |
| POSTGRES_PORT | 5432 | 5433 |
| POSTGRES_USER | postgres | postgres |
| POSTGRES_PASSWORD | (empty) | <YOUR_PG_PASSWORD> |
| POSTGRES_DB | exomaps | exomaps |

---

## Troubleshooting

**SQL Connection error on page load:**
1. Check which mode you're using
2. For local: Run `sudo -u postgres createdb exomaps`
3. For docker: Run `docker-compose up -d db redis`

**Port conflicts:**
- Local: PostgreSQL uses 5432
- Docker: PostgreSQL uses 5433 (mapped from container 5432)
- Flask: Uses 5000

**Permission denied:**
- Local mode needs `sudo -u postgres` for database creation first
- Docker mode handles everything automatically
