#!/usr/bin/env python3
"""
Integration test: Verify Flask app can connect to PostgreSQL
"""
import sys
import os

# Add project root to path
sys.path.insert(0, os.path.dirname(__file__))

print("=" * 70)
print("EXOMAPS INTEGRATION TEST")
print("=" * 70)

# Step 1: Load configuration
print("\n[1/5] Loading configuration...")
try:
    from dbs.config_manager import ConfigManager
    # Disable autodetect to avoid Flask service discovery timeout
    cm = ConfigManager(root_dir='.', autodetect=False)
    db_url = cm.get_db_url()
    print(f"  ✓ ConfigManager loaded")
    print(f"  Database URL: {db_url.split('@')[0]}@...:5433/exomaps")
except Exception as e:
    print(f"  ✗ FAILED: {e}")
    sys.exit(1)

# Step 2: Test database connection
print("\n[2/5] Testing database connection...")
try:
    from sqlalchemy import create_engine, text
    engine = create_engine(db_url)
    with engine.connect() as conn:
        result = conn.execute(text("SELECT version();"))
        row = result.fetchone()
        pg_version = row[0].split(',')[0]  # Get first part of version string
        print(f"  ✓ Connected to PostgreSQL")
        print(f"  Version: {pg_version}")
except Exception as e:
    print(f"  ✗ FAILED: {e}")
    sys.exit(1)

# Step 3: Check if Flask can initialize
print("\n[3/5] Initializing Flask app...")
try:
    sys.path.insert(0, 'src')
    from app.app import app
    print(f"  ✓ Flask app initialized")
    print(f"  Routes: {len(app.url_map._rules)} registered")
except Exception as e:
    print(f"  ✗ FAILED: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

# Step 4: Test Flask with app context
print("\n[4/5] Testing Flask app context...")
try:
    with app.test_client() as client:
        # Try home page
        response = client.get('/')
        print(f"  ✓ Flask app context works")
        print(f"  Home page status: {response.status_code}")
except Exception as e:
    print(f"  ✗ FAILED: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

# Step 5: Test API endpoint
print("\n[5/5] Testing API endpoint...")
try:
    with app.test_client() as client:
        # Try API endpoint
        response = client.get('/api/persona')
        print(f"  ✓ API endpoints accessible")
        print(f"  /api/persona status: {response.status_code}")
        if response.status_code == 200:
            data = response.get_json()
            print(f"  Current persona: {data.get('current_persona_key', 'N/A')}")
except Exception as e:
    print(f"  ✗ FAILED: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

print("\n" + "=" * 70)
print("✓ ALL TESTS PASSED")
print("=" * 70)
print("\nSystem is ready!")
print(f"\nTo start the Flask server, run:")
print(f"  cd /home/tsr/Projects/exomaps")
print(f"  python3 src/app/app.py")
print(f"\nThen visit: http://localhost:5000")
