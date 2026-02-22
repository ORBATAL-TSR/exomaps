#!/bin/bash
# ExoMaps Development Server Launcher
# Supports: --dblocal (PostgreSQL 17.8 on host) or --dbcontainer (PostgreSQL 14 in Docker)

set -e

DB_MODE="${1:---dblocal}"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}ExoMaps Development Server${NC}"
echo -e "${BLUE}========================================${NC}"

# Function to check local PostgreSQL
check_local_postgres() {
    echo -e "${YELLOW}[LOCAL MODE] Checking PostgreSQL...${NC}"
    
    if ! command -v pg_isready &> /dev/null; then
        echo -e "${RED}✗ PostgreSQL client tools not found${NC}"
        echo "  Install with: apt-get install postgresql-client"
        exit 1
    fi
    
    if ! pg_isready -U postgres -h localhost &> /dev/null; then
        echo -e "${RED}✗ PostgreSQL not running on localhost:5432${NC}"
        echo "  Start with: sudo service postgresql start"
        exit 1
    fi
    
    echo -e "${GREEN}✓ PostgreSQL 17.8 running on localhost:5432${NC}"
    
    # Check if exomaps database exists
    if ! psql -U postgres -d exomaps -c "SELECT 1" &> /dev/null 2>&1; then
        echo -e "${YELLOW}⚠ Database 'exomaps' not found, creating...${NC}"
        if command -v sudo &> /dev/null && sudo -n true &> /dev/null; then
            # Can use sudo without password
            sudo -u postgres createdb exomaps 2>/dev/null && {
                echo -e "${GREEN}✓ Database 'exomaps' created (via sudo)${NC}"
            } || echo -e "${RED}⚠ Could not auto-create with sudo${NC}"
        else
            # Try direct createdb (may fail)
            createdb -U postgres exomaps 2>/dev/null && {
                echo -e "${GREEN}✓ Database 'exomaps' created${NC}"
            } || echo -e "${YELLOW}⚠ Database creation skipped. Create manually with:${NC}"
            echo -e "${YELLOW}    sudo -u postgres createdb exomaps${NC}"
        fi
    else
        echo -e "${GREEN}✓ Database 'exomaps' exists${NC}"
    fi
}

# Function to check Docker PostgreSQL
check_docker_postgres() {
    echo -e "${YELLOW}[DOCKER MODE] Checking Docker services...${NC}"
    
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}✗ Docker not found${NC}"
        echo "  Install Docker or use --dblocal mode"
        exit 1
    fi
    
    if ! docker ps -q > /dev/null 2>&1; then
        echo -e "${RED}✗ Docker daemon not running${NC}"
        exit 1
    fi
    
    # Check if containers exist and are running
    if ! docker ps | grep -q exomaps-db; then
        echo -e "${YELLOW}⚠ PostgreSQL container not running, starting...${NC}"
        cd "$PROJECT_ROOT"
        docker-compose up -d db redis
        sleep 5
    fi
    
    # Wait for PostgreSQL to be ready
    echo -e "${YELLOW}Waiting for PostgreSQL...${NC}"
    for i in {1..30}; do
        if docker exec exomaps-db pg_isready -U postgres &> /dev/null 2>&1; then
            echo -e "${GREEN}✓ PostgreSQL 14-alpine ready on 127.0.0.1:5433${NC}"
            return 0
        fi
        echo -n "."
        sleep 1
    done
    
    echo -e "${RED}✗ Timeout waiting for PostgreSQL${NC}"
    exit 1
}

# Parse command line arguments
case "$DB_MODE" in
    --dblocal)
        check_local_postgres
        export DB_MODE="local"
        export POSTGRES_HOST="localhost"
        export POSTGRES_PORT="5432"
        export POSTGRES_USER="postgres"
        export POSTGRES_PASSWORD=""
        export POSTGRES_DB="exomaps"
        ;;
    --dbcontainer)
        check_docker_postgres
        export DB_MODE="docker"
        export POSTGRES_HOST="127.0.0.1"
        export POSTGRES_PORT="5433"
        export POSTGRES_USER="postgres"
        export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"
        export POSTGRES_DB="exomaps"
        ;;
    *)
        echo -e "${RED}Unknown mode: $DB_MODE${NC}"
        echo "Usage: $0 [--dblocal|--dbcontainer]"
        echo ""
        echo "  --dblocal     Use local PostgreSQL 17.8 (default)"
        echo "  --dbcontainer Use PostgreSQL 14 in Docker"
        exit 1
        ;;
esac

# Set Flask environment
export FLASK_ENV="${FLASK_ENV:-development}"
export FLASK_HOST="${FLASK_HOST:-0.0.0.0}"
export FLASK_PORT="${FLASK_PORT:-5000}"

echo ""
echo -e "${BLUE}Configuration:${NC}"
echo "  Mode:     $DB_MODE"
echo "  Host:     $POSTGRES_HOST:$POSTGRES_PORT"
echo "  Database: $POSTGRES_DB"
echo "  Flask:    http://127.0.0.1:$FLASK_PORT"
echo ""

# Start Flask app
echo -e "${GREEN}Starting Flask application...${NC}"
cd "$PROJECT_ROOT"
exec python3 src/app/app.py
