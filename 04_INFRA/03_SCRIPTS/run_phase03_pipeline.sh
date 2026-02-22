#!/bin/bash
# Phase 03 Pipeline Orchestrator
# ==============================
# Infers missing planets and belts from Phase 02 nearby stars
# Produces world-build manifest with deterministic reproducibility

set -e

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║ Phase 03 — System Completion Inference Pipeline        ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════╝${NC}"

# 1. Validate environment
echo -e "\n${YELLOW}[1/6]${NC} Validating environment..."

REQUIRED_VARS="POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB POSTGRES_HOST POSTGRES_PORT APPUSER APPPASS"
for var in $REQUIRED_VARS; do
    if [ -z "${!var}" ]; then
        echo -e "${RED}ERROR: ${var} is not set${NC}"
        exit 1
    fi
done

echo -e "${GREEN}✓ All environment variables present${NC}"

# 2. Check Phase 02 completion
echo -e "\n${YELLOW}[2/6]${NC} Checking Phase 02 completion status..."

PHASE02_CHECK=$(
    PGPASSWORD=$POSTGRES_PASSWORD psql \
        -h $POSTGRES_HOST \
        -p $POSTGRES_PORT \
        -U $POSTGRES_USER \
        -d $POSTGRES_DB \
        -t -c "
            SELECT COUNT(*) FROM dm_galaxy.stars_xyz WHERE is_nearby = true;
        " 2>&1 || echo "0"
)

if [ -z "$PHASE02_CHECK" ] || [ "$PHASE02_CHECK" == "0" ]; then
    echo -e "${RED}ERROR: Phase 02 appears incomplete (no nearby stars found)${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Phase 02 data found: ${PHASE02_CHECK} nearby stars available${NC}"

# 3. Apply Phase 03 schema migration
echo -e "\n${YELLOW}[3/6]${NC} Applying Phase 03 schema migration..."

MIGRATION_FILE="dbs/ddl/migrations/004_phase03_inference.sql"

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
    > /tmp/phase03_migration.log 2>&1

if [ $? -ne 0 ]; then
    echo -e "${RED}ERROR: Migration failed. See log:${NC}"
    cat /tmp/phase03_migration.log
    exit 1
fi

echo -e "${GREEN}✓ Phase 03 schema migration applied successfully${NC}"

# 4. Create world build manifest
echo -e "\n${YELLOW}[4/6]${NC} Creating world build manifest..."

BUILD_NAME="wb_$(date +%Y%m%d_%H%M%S)"
SEED="${PHASE03_SEED:-42}"

BUILD_ID=$(
    PGPASSWORD=$POSTGRES_PASSWORD psql \
        -h $POSTGRES_HOST \
        -p $POSTGRES_PORT \
        -U $POSTGRES_USER \
        -d $POSTGRES_DB \
        -t -c "
            INSERT INTO stg_data.world_builds (
                build_name, description, phase03_seed, status
            ) VALUES (
                '$BUILD_NAME',
                'World build from Phase 02 transformation + Phase 03 inference',
                $SEED,
                'active'
            ) RETURNING build_id;
        " 2>&1
)

echo -e "${GREEN}✓ World build created: ${BUILD_NAME} (ID: ${BUILD_ID})${NC}"

# 5. Run Phase 03 inference
echo -e "\n${YELLOW}[5/6]${NC} Running system completion inference (planets + belts)..."

python3 << EOF
import sys
import logging
sys.path.insert(0, 'dbs')

from database import _build_db_engine
from fetch_db.inference_engine import run_inference_pipeline, load_nearby_stars
import uuid
from datetime import datetime

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

# Build engine
engine = _build_db_engine()
if not engine:
    logger.error("Failed to build database engine")
    sys.exit(1)

# Run inference
with engine.begin() as connection:
    # Load stars for inference
    stars_df = load_nearby_stars(connection)
    logger.info(f"Loaded {len(stars_df)} stars for inference")
    
    # Run inference pipeline
    seed = ${SEED}
    result = run_inference_pipeline(connection, seed=seed)
    
    # Log results
    print(result['summary'])
    
    # Persist inferred entities to database
    if len(result['inferred_planets']) > 0:
        result['inferred_planets']['build_id'] = ${BUILD_ID}
        result['inferred_planets']['inference_seed'] = seed
        result['inferred_planets']['inference_version'] = '0.1.0'
        
        # Generate UUIDs
        import uuid
        result['inferred_planets']['planet_uuid'] = result['inferred_planets'].apply(
            lambda r: str(uuid.uuid5(uuid.NAMESPACE_DNS, f"{r['main_id']}_planet_{r.get('inferred_planet_id', 'unknown')}")),
            axis=1
        )
        
        result['inferred_planets'].to_sql(
            'inferred_planets',
            connection,
            schema='dm_galaxy',
            if_exists='append',
            index=False,
            method='multi'
        )
        logger.info(f"Persisted {len(result['inferred_planets'])} inferred planets")
    
    if len(result['inferred_belts']) > 0:
        result['inferred_belts']['build_id'] = ${BUILD_ID}
        result['inferred_belts']['inference_seed'] = seed
        result['inferred_belts']['inference_version'] = '0.1.0'
        
        # Generate UUIDs
        result['inferred_belts']['belt_uuid'] = result['inferred_belts'].apply(
            lambda r: str(uuid.uuid5(uuid.NAMESPACE_DNS, f"{r['main_id']}_belt_{r.get('inferred_belt_id', 'unknown')}")),
            axis=1
        )
        
        result['inferred_belts'].to_sql(
            'inferred_belts',
            connection,
            schema='dm_galaxy',
            if_exists='append',
            index=False,
            method='multi'
        )
        logger.info(f"Persisted {len(result['inferred_belts'])} inferred belts")

EOF

PYTHON_EXIT=$?
if [ $PYTHON_EXIT -ne 0 ]; then
    echo -e "${RED}ERROR: Python inference script failed (exit code: $PYTHON_EXIT)${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Inference completed and persisted${NC}"

# 6. Generate Phase 03 QA report
echo -e "\n${YELLOW}[6/6]${NC} Generating Phase 03 QA report..."

QA_REPORT=$(
    PGPASSWORD=$POSTGRES_PASSWORD psql \
        -h $POSTGRES_HOST \
        -p $POSTGRES_PORT \
        -U $POSTGRES_USER \
        -d $POSTGRES_DB \
        -t -c "
            SELECT
                'Phase 03 Inference Results' as report_title,
                (SELECT COUNT(*) FROM dm_galaxy.inferred_planets WHERE build_id = ${BUILD_ID}) as total_inferred_planets,
                (SELECT COUNT(*) FROM dm_galaxy.inferred_belts WHERE build_id = ${BUILD_ID}) as total_inferred_belts,
                (SELECT COUNT(DISTINCT main_id) FROM dm_galaxy.inferred_planets WHERE build_id = ${BUILD_ID}) as systems_with_planets,
                (SELECT COUNT(DISTINCT main_id) FROM dm_galaxy.inferred_belts WHERE build_id = ${BUILD_ID}) as systems_with_belts,
                (SELECT COUNT(*) FROM dm_galaxy.inferred_planets WHERE build_id = ${BUILD_ID} AND planet_type LIKE '%habitable%') as habitable_planets;
        " 2>&1
)

echo -e "${GREEN}${QA_REPORT}${NC}"

echo -e "\n${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║ Phase 03 Pipeline Complete ✓                          ║${NC}"
echo -e "${BLUE}║ World Build: ${BUILD_NAME}                           ${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════╝${NC}"
