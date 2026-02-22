#!/bin/bash
# Phase 02 Pipeline Orchestrator
# ==============================
# Transforms Phase 01 catalog (RA/Dec/parallax) to Cartesian (X/Y/Z) coordinates
# Applies sanity checks and persists nearby neighborhoods

set -e

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║ Phase 02 — 3D Coordinate Engine Pipeline              ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════╝${NC}"

# 1. Validate environment
echo -e "\n${YELLOW}[1/5]${NC} Validating environment..."

REQUIRED_VARS="POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB POSTGRES_HOST POSTGRES_PORT APPUSER APPPASS"
for var in $REQUIRED_VARS; do
    if [ -z "${!var}" ]; then
        echo -e "${RED}ERROR: ${var} is not set${NC}"
        exit 1
    fi
done

echo -e "${GREEN}✓ All environment variables present${NC}"

# 2. Connect to database and check Phase 01 completion
echo -e "\n${YELLOW}[2/5]${NC} Checking Phase 01 completion status..."

PHASE01_CHECK=$(
    PGPASSWORD=$POSTGRES_PASSWORD psql \
        -h $POSTGRES_HOST \
        -p $POSTGRES_PORT \
        -U $POSTGRES_USER \
        -d $POSTGRES_DB \
        -t -c "
            SELECT COUNT(*) FROM dm_galaxy.stars WHERE parallax_mas > 0 AND parallax_error_mas < 0.2;
        " 2>&1 || echo "0"
)

if [ -z "$PHASE01_CHECK" ] || [ "$PHASE01_CHECK" == "0" ]; then
    echo -e "${RED}ERROR: Phase 01 appears incomplete (no valid stars with parallax found)${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Phase 01 data found: ${PHASE01_CHECK} stars with reliable parallax${NC}"

# 3. Apply Phase 02 schema migration
echo -e "\n${YELLOW}[3/5]${NC} Applying Phase 02 schema migration..."

MIGRATION_FILE="dbs/ddl/migrations/003_phase02_coordinate_engine.sql"

if [ ! -f "$MIGRATION_FILE" ]; then
    echo -e "${RED}ERROR: Migration file not found: ${MIGRATION_FILE}${NC}"
    exit 1
fi

PGPASSWORD=$POSTGRES_PASSWORD psql \
    -h $POSTGRES_HOST \
    -p $POSTGRES_PORT \
    -U $POSTGRES_USER \
    -d $POSTGRES_DB \
    -f "$MIGRATION_FILE" \
    > /tmp/phase02_migration.log 2>&1

if [ $? -ne 0 ]; then
    echo -e "${RED}ERROR: Migration failed. See log:${NC}"
    cat /tmp/phase02_migration.log
    exit 1
fi

echo -e "${GREEN}✓ Phase 02 schema migration applied successfully${NC}"

# 4. Run Phase 02 coordinate transforms
echo -e "\n${YELLOW}[4/5]${NC} Running coordinate transforms (RA/Dec/parallax → X/Y/Z)..."

python3 << 'EOF'
import sys
import logging
sys.path.insert(0, 'dbs')

from database import _build_db_engine
from fetch_db.coordinate_transforms import transform_catalog, persist_xyz_to_database
import uuid
from datetime import datetime

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

# Build engine
engine = _build_db_engine()
if not engine:
    logger.error("Failed to build database engine")
    sys.exit(1)

# Run transforms
with engine.begin() as connection:
    result = transform_catalog(connection)
    
    if result['failed_count'] > 0:
        logger.warning(f"Transform had {result['failed_count']} failures")
    
    # Persist to database
    run_id = f"phase02_{uuid.uuid4().hex[:8]}"
    persist_result = persist_xyz_to_database(connection, result['transformed'], run_id)
    
    if not persist_result['success']:
        logger.error(f"Failed to persist: {persist_result.get('error')}")
        sys.exit(1)
    
    # Log summary
    print(result['summary'])
    print(f"\nRun ID: {run_id}")
    print(f"Rows persisted: {persist_result['rows_written']}")

EOF

PYTHON_EXIT=$?
if [ $PYTHON_EXIT -ne 0 ]; then
    echo -e "${RED}ERROR: Python transform script failed (exit code: $PYTHON_EXIT)${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Coordinate transforms completed and persisted${NC}"

# 5. Generate Phase 02 QA report
echo -e "\n${YELLOW}[5/5]${NC} Generating Phase 02 QA report..."

QA_REPORT=$(
    PGPASSWORD=$POSTGRES_PASSWORD psql \
        -h $POSTGRES_HOST \
        -p $POSTGRES_PORT \
        -U $POSTGRES_USER \
        -d $POSTGRES_DB \
        -t -c "
            SELECT 
                'Phase 02 QA Report' as title,
                (SELECT COUNT(*) FROM dm_galaxy.stars_xyz WHERE sanity_pass = true) as passed_sanity,
                (SELECT COUNT(*) FROM dm_galaxy.stars_xyz WHERE sanity_pass = false) as failed_sanity,
                (SELECT COUNT(*) FROM dm_galaxy.stars_xyz WHERE is_nearby = true) as nearby_stars,
                (SELECT ROUND(AVG(distance_ly)::numeric, 2) FROM dm_galaxy.stars_xyz WHERE is_nearby = true) as mean_distance_ly,
                (SELECT ROUND(MAX(distance_ly)::numeric, 2) FROM dm_galaxy.stars_xyz WHERE is_nearby = true) as max_distance_ly,
                (SELECT ROUND(MAX(uncertainty_pc)::numeric, 2) FROM dm_galaxy.stars_xyz) as max_uncertainty_pc
            UNION ALL
            SELECT 
                'Known Star Validation' as title,
                (SELECT COUNT(*) FROM dm_galaxy.stars_xyz WHERE main_id ILIKE '%Alpha%Centauri%') as alpha_centauri,
                (SELECT COUNT(*) FROM dm_galaxy.stars_xyz WHERE main_id ILIKE '%Sirius%') as sirius,
                (SELECT COUNT(*) FROM dm_galaxy.stars_xyz WHERE main_id ILIKE '%Barnard%') as barnard,
                NULL as mean_distance_ly,
                NULL as max_distance_ly,
                NULL as max_uncertainty_pc;
        " 2>&1
)

echo -e "${GREEN}${QA_REPORT}${NC}"

echo -e "\n${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║ Phase 02 Pipeline Complete ✓                          ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════╝${NC}"
