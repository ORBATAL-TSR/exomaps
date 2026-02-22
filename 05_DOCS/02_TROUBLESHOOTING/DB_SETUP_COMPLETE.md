# FIXED: Local PostgreSQL Configuration

## Issue Resolved
Database connection error was due to:
- Trying to connect as `postgres` user (doesn't have peer auth)
- Using TCP instead of Unix socket

## Solution Implemented
✅ Created PostgreSQL user `tsr` (matches your system user)
✅ Created database `exomaps` with proper permissions
✅ Updated Flask app to use Unix socket + peer authentication
✅ Flask automatically detects when to use Unix socket vs TCP

## Database Setup Status
```
User:     tsr (with CREATEDB privileges)
Database: exomaps (owned by tsr)
Connection: Unix socket /var/run/postgresql
Auth:  Peer (no password needed)
```

## Instructions to Start Flask

**Option 1: Direct (Simplest)**
```bash
cd /home/tsr/Projects/exomaps
python3 src/app/app.py
```
- Flask will:
  - Detect localhost + no password
  - Use Unix socket automatically
  - Connect as current user (tsr)
  - Be ready at `http://localhost:5000`

**Option 2: Using run.sh with --dblocal**
```bash
cd /home/tsr/Projects/exomaps
bash run.sh --dblocal
```
- Checks PostgreSQL is running
- Verifies database exists
- Sets up environment variables
- Starts Flask

**Option 3: Docker (if Docker available)**
```bash
cd /home/tsr/Projects/exomaps
docker-compose up -d db redis
bash run.sh --dbcontainer
```
- Starts PostgreSQL in Docker
- Uses port 5433
- Flask at `http://localhost:5000`

## How It Works Now

### Environment Variables (Optional - Detected Automatically)
```bash
POSTGRES_USER=tsr
POSTGRES_PASSWORD=        # Empty = Unix socket peer auth
POSTGRES_DB=exomaps
POSTGRES_HOST=localhost   # Triggers Unix socket
POSTGRES_PORT=5432
```

### Connection Logic
```python
# localhost + no password → Uses Unix socket
postgresql+psycopg2:///exomaps

# 127.0.0.1 + no password → Uses Unix socket  
postgresql+psycopg2:///exomaps

# Any host + password → Uses TCP
postgresql+psycopg2://user:pass@host:port/db

# Explicit Unix socket path
postgresql+psycopg2:///exomaps?host=/var/run/postgresql
```

## Test It

```bash
# Start Flask
python3 src/app/app.py

# In another terminal, test:
curl http://localhost:5000/api/persona
curl http://localhost:5000/
```

## Troubleshooting

**"Peer authentication failed"**
- Means Flask is trying to connect as wrong user
- Solution: Restart Flask to force environment reload
- Or: `pkill -f app.py && python3 src/app/app.py`

**"Database does not exist"**
- Check database: `sudo -u postgres psql -l | grep exomaps`
- Create if missing: `sudo -u postgres createdb exomaps`

**Still connection errors**
- Check Flask logs for the connection URI being used
- Verify user `tsr` exists: `sudo -u postgres psql -c "\du" | grep tsr`
- Verify database: `sudo -u postgres psql -c "\l" | grep exomaps`

## Files Modified
- `src/app/app.py` - Enhanced `_build_db_engine()` with Unix socket support
- `run.sh` - Startup script for both modes (local and Docker)

## Semantic Versioning
- **PostgreSQL**: 17.8 (your system)
- **Compatibility**: 14.0+ (minor version differences OK for basic SQL)
