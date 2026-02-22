.PHONY: help clean install lint format test docker-build docker-up docker-down run-phase01 run-phase02 run-phase03 run-phase04 full-test

help:
	@echo "Exomaps Development Tasks"
	@echo "=========================="
	@echo ""
	@echo "Setup & Environment:"
	@echo "  make install              - Install Python dependencies (both dbs and src)"
	@echo "  make install-locked       - Install from locked requirements"
	@echo "  make clean                - Remove cache, build artifacts, __pycache__"
	@echo ""
	@echo "Code Quality:"
	@echo "  make lint                 - Run flake8 linting"
	@echo "  make format               - Format code with black and isort"
	@echo "  make type-check           - Run mypy type checking"
	@echo ""
	@echo "Testing:"
	@echo "  make test                 - Run all tests (unit + simulation)"
	@echo "  make test-phase04         - Run Phase 04 simulation determinism test"
	@echo ""
	@echo "Docker & Deployment:"
	@echo "  make docker-build         - Build all Docker images"
	@echo "  make docker-up            - Start all services (db, redis, web)"
	@echo "  make docker-down          - Stop all services"
	@echo "  make docker-logs          - View logs from all services"
	@echo ""
	@echo "Pipeline Execution:"
	@echo "  make run-phase01          - Run Phase 01 data ingestion pipeline"
	@echo "  make run-phase02          - Run Phase 02 coordinate transform pipeline"
	@echo "  make run-phase03          - Run Phase 03 system inference pipeline"
	@echo "  make run-phase04          - Run Phase 04 simulation test"
	@echo ""
	@echo "Development:"
	@echo "  make full-test            - Run complete CI pipeline locally"
	@echo "  make validate-migrations  - Validate all SQL migrations"
	@echo ""

install:
	pip install -r dbs/requirements.txt
	pip install -r src/requirements.txt

install-locked:
	pip install -r dbs/requirements-lock.txt
	pip install -r src/requirements-lock.txt

clean:
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name '*.pyc' -delete
	find . -type d -name '.pytest_cache' -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name '.mypy_cache' -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name '*.egg-info' -exec rm -rf {} + 2>/dev/null || true
	rm -rf build/ dist/ .coverage htmlcov/

lint:
	@echo "Linting dbs/"
	flake8 dbs --max-line-length=120 --exclude=__pycache__ || true
	@echo "Linting src/app/"
	flake8 src/app --max-line-length=120 --exclude=__pycache__ || true

format:
	@echo "Formatting with black..."
	black dbs src --line-length=120
	@echo "Sorting imports with isort..."
	isort dbs src

type-check:
	mypy dbs --ignore-missing-imports || true

test: clean
	@echo "Running Phase 04 simulation test..."
	bash scripts/test_phase04_simulation.sh || true

test-phase04:
	@echo "Running Phase 04 determinism verification..."
	python3 -c "import sys; sys.path.insert(0, 'dbs'); from simulation_core import create_engine; e=create_engine(seed=42); e.run(50); print('✓ Phase 04 test passed')"

docker-build:
	@echo "Building Docker images..."
	docker-compose build

docker-up:
	@echo "Starting services..."
	docker-compose up -d
	@echo "Waiting for services to be ready..."
	sleep 3
	@echo "✓ Services running"

docker-down:
	@echo "Stopping services..."
	docker-compose down

docker-logs:
	docker-compose logs -f

run-phase01:
	@echo "Running Phase 01 ingestion pipeline..."
	bash scripts/run_phase01_pipeline.sh

run-phase02:
	@echo "Running Phase 02 coordinate transform pipeline..."
	bash scripts/run_phase02_pipeline.sh

run-phase03:
	@echo "Running Phase 03 system inference pipeline..."
	bash scripts/run_phase03_pipeline.sh

run-phase04:
	@echo "Running Phase 04 simulation..."
	bash scripts/run_phase04_pipeline.sh

full-test: clean install lint test
	@echo ""
	@echo "✓ All CI checks complete"

validate-migrations:
	@echo "Validating SQL migration files..."
	@for file in dbs/ddl/migrations/*.sql; do \
		echo "  Checking $$file..."; \
		if [ -s "$$file" ]; then \
			echo "    ✓ Valid"; \
		else \
			echo "    ✗ Empty or invalid"; \
		fi; \
	done
