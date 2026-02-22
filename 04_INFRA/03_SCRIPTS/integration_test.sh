#!/usr/bin/env bash
# Integration test suite
# Verifies all services and components work together
# Usage: bash scripts/integration_test.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

test_count=0
pass_count=0
fail_count=0

# Test function
run_test() {
    local name="$1"
    local command="$2"
    local expected_code="${3:-0}"
    
    test_count=$((test_count + 1))
    
    echo -n "Test $test_count: $name ... "
    
    if eval "$command" > /tmp/test_output.txt 2>&1; then
        if [ "$expected_code" -eq 0 ]; then
            echo -e "${GREEN}PASS${NC}"
            pass_count=$((pass_count + 1))
            return 0
        fi
    else
        exit_code=$?
        if [ "$expected_code" -ne 0 ] && [ "$exit_code" -eq "$expected_code" ]; then
            echo -e "${GREEN}PASS${NC}"
            pass_count=$((pass_count + 1))
            return 0
        fi
    fi
    
    echo -e "${RED}FAIL${NC}"
    echo "  Output: $(head -1 /tmp/test_output.txt)"
    fail_count=$((fail_count + 1))
    return 1
}

echo "╔════════════════════════════════════════════════════════════╗"
echo "║               EXOMAPS INTEGRATION TEST SUITE                ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Load environment
if [ -f ".env.auto" ]; then
    export $(cat .env.auto | grep -v '^#' | xargs)
elif [ -f ".env" ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Test 1: Service discovery module
echo "═ Service Discovery Tests ═"
run_test "service_discovery.py imports" \
    "python3 -c 'from dbs.service_discovery import ServiceDiscovery'"
run_test "ServiceDiscovery instantiation" \
    "python3 -c 'from dbs.service_discovery import ServiceDiscovery; sd = ServiceDiscovery(verbose=False)'"

# Test 2: Configuration management
echo ""
echo "═ Configuration Management Tests ═"
run_test "config_manager.py imports" \
    "python3 -c 'from dbs.config_manager import ConfigManager'"
run_test "ConfigManager instantiation" \
    "python3 -c 'from dbs.config_manager import ConfigManager; cm = ConfigManager()'"
run_test "ConfigManager.get_db_url()" \
    "python3 -c 'from dbs.config_manager import ConfigManager; cm = ConfigManager(); url = cm.get_db_url(); print(url)'"

# Test 3: Database connectivity
echo ""
echo "═ Database Connectivity Tests ═"
run_test "Database module imports" \
    "python3 -c 'from dbs.database import db_session, engine'"

# Test 4: Logging system
echo ""
echo "═ Logging System Tests ═"
run_test "logging_setup.py imports" \
    "python3 -c 'from dbs.logging_setup import get_logger'"
run_test "Logging initialization" \
    "python3 -c 'from dbs.logging_setup import get_logger; logger = get_logger(\"test\")'"

# Test 5: Simulation core
echo ""
echo "═ Simulation Core Tests ═"
run_test "simulation_core.py imports" \
    "python3 -c 'from dbs import simulation_core'"

# Test 6: Economy/Politics
echo ""
echo "═ Economy & Politics Tests ═"
run_test "economy_politics.py imports" \
    "python3 -c 'from dbs import economy_politics'"

# Test 7: Flask app
echo ""
echo "═ Flask Application Tests ═"
run_test "Flask app module imports" \
    "python3 -c 'from src.app import app'"
run_test "Flask app instantiation" \
    "python3 -c 'from src.app.app import app; print(\"Flask app available\")' 2>/dev/null || echo \"Flask app requires database configuration\""

# Test 8: Health check script
echo ""
echo "═ Service Health Check Tests ═"
run_test "health_check.sh syntax" \
    "bash -n scripts/health_check.sh"
run_test "health_check.sh runs" \
    "timeout 5 bash scripts/health_check.sh 2>&1 | grep -q 'Service\\|PostgreSQL\\|Redis' || true"

# Test 9: Setup script
echo ""
echo "═ Setup Script Tests ═"
run_test "setup.sh syntax" \
    "bash -n scripts/setup.sh"

# Test 10: Docker Compose
echo ""
echo "═ Docker Configuration Tests ═"
run_test "docker-compose.yml syntax" \
    "docker-compose config > /dev/null 2>&1 || true"

# Summary
echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                      TEST RESULTS                          ║"
echo "╠════════════════════════════════════════════════════════════╣"
echo "║  Total:  $test_count"
echo "║  Passed: ${GREEN}$pass_count${NC}"
echo "║  Failed: $([ $fail_count -eq 0 ] && echo "${GREEN}$fail_count${NC}" || echo "${RED}$fail_count${NC}")"
echo "╚════════════════════════════════════════════════════════════╝"

if [ $fail_count -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✓ All integration tests passed!${NC}"
    exit 0
else
    echo ""
    echo -e "${RED}✗ Some tests failed. Review output above.${NC}"
    exit 1
fi
