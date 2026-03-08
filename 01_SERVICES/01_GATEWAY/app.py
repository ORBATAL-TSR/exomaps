import os
import math
import hashlib
import secrets
import pandas as pd
import mimetypes
import logging

from flask import (
    Flask, render_template, request, jsonify, session,
    redirect, url_for, send_from_directory
)

try:
    from flask_cors import CORS
except Exception:
    CORS = None

try:
    from flask_socketio import SocketIO, emit
except Exception:
    SocketIO = None
    emit = None

try:
    from flask_webpack import Webpack
except Exception:
    Webpack = None

try:
    from redis import Redis
except Exception:
    Redis = None

# from flask_migrate import Migrate
# from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError

logger = logging.getLogger(__name__)

DEMO_PERSONAS = {
    'admin': {
        'label': 'Admin',
        'description': 'Full control over data, simulation, and operational settings.',
        'menus': ['System Health', 'Run Pipeline', 'Reference Rules', 'User Modes', 'Audit Logs']
    },
    'sim_owner': {
        'label': 'Sim Owner',
        'description': 'Owns scenario configuration, run controls, and balancing parameters.',
        'menus': ['Scenario Config', 'Simulation Controls', 'Timeline', 'KPI Dashboard']
    },
    'general_user': {
        'label': 'General User',
        'description': 'Explores systems, trends, and maps with read-only tools.',
        'menus': ['Overview', 'Star Systems', 'Reference Checks']
    },
    'data_curator': {
        'label': 'Data Curator',
        'description': 'Reviews source quality, quarantines, and provenance consistency.',
        'menus': ['Source Manifest', 'Quarantine Queue', 'Validation Summary', 'Provenance']
    },
    'science_analyst': {
        'label': 'Science Analyst',
        'description': 'Validates astro assumptions, coordinate models, and inference plausibility.',
        'menus': ['Distance Rules', 'Coordinate QA', 'Inference Diagnostics']
    },
    'ops_engineer': {
        'label': 'Ops Engineer',
        'description': 'Monitors jobs, infra health, cost profile, and deployment status.',
        'menus': ['Run History', 'Job Status', 'Error Trends', 'Cost Monitor']
    },
    'narrative_designer': {
        'label': 'Narrative Designer',
        'description': 'Designs faction arcs, event framing, and campaign setup presets.',
        'menus': ['Faction Context', 'Event Seeds', 'Campaign Presets']
    },
    'observer_guest': {
        'label': 'Observer Guest',
        'description': 'Minimal public-safe read mode for demos and stakeholder reviews.',
        'menus': ['Public Overview', 'Latest Run Snapshot']
    }
}


# ── Project root & SPA build path ──
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_CLIENT_BUILD = os.path.join(_PROJECT_ROOT, '02_CLIENTS', '01_WEB', 'build')

app = Flask(
    __name__,
    template_folder='templates',
    static_folder=None,            # disable default; SPA catch-all serves React build
)
app.secret_key = os.environ.get('FLASK_SECRET_KEY') or secrets.token_hex(32)

params = {
    'DEBUG': os.environ.get('FLASK_DEBUG', 'false').lower() in ('true', '1', 'yes'),
    'WEBPACK_MANIFEST_PATH': './build/manifest.json'
}

app.config.update(params)

# CORS — allow React dev server (port 3000) in development
if CORS is not None:
    CORS(app, supports_credentials=True, origins=['http://localhost:3000', 'http://127.0.0.1:3000'])

if SocketIO is not None:
    socket_ = SocketIO(app, async_mode='threading')
else:
    socket_ = None

if Webpack is not None:
    webpack = Webpack()
    webpack.init_app(app)

mimetypes.add_type('application/javascript', '.mjs')

# ── Campaign / Exploration blueprint ──
from campaigns import campaigns_bp
app.register_blueprint(campaigns_bp)

# ── World Engine proxy blueprint ──
from world_engine_proxy import engine_bp
app.register_blueprint(engine_bp)

# ── Module-level caches for star systems and planet data ──
_systems_cache = None          # list of star-system dicts (populated on first request)
_planet_cache = {}             # main_id → list of planet dicts (observed + inferred)
_belt_cache = {}               # main_id → list of belt dicts (inferred)

def _build_db_engine():
    """
    Build SQLAlchemy engine with support for:
    - Local PostgreSQL (Unix socket, peer authentication)
    - Docker PostgreSQL (TCP, password authentication)
    - ConfigManager auto-detection
    """
    # Try POSTGRES_* environment variables (set by run.sh or manually)
    dbuser = os.environ.get('POSTGRES_USER', 'postgres')
    dbpass = os.environ.get('POSTGRES_PASSWORD', '')  # Empty for local/peer auth
    dbhost = os.environ.get('POSTGRES_HOST', 'localhost')
    dbname = os.environ.get('POSTGRES_DB', 'exomaps')
    dbport = os.environ.get('POSTGRES_PORT', '5432')
    
    logger.info(f'DB Config: host={dbhost}, port={dbport}, db={dbname}, user={dbuser}, has_password={bool(dbpass)}')
    
    # Determine connection type
    if dbhost.startswith('/'):
        # Unix socket path provided explicitly
        if dbpass:
            database_uri = f'postgresql+psycopg2://{dbuser}:{dbpass}@/{dbname}?host={dbhost}'
        else:
            database_uri = f'postgresql+psycopg2://{dbuser}@/{dbname}?host={dbhost}'
        logger.info(f'Using Unix socket: {dbhost}')
    elif not dbpass and dbhost in ('localhost', '127.0.0.1'):
        # Local connection without password -> use Unix socket
        # Unix socket is typically at /var/run/postgresql
        # Don't specify user - let PostgreSQL use peer auth
        database_uri = f'postgresql+psycopg2:///{dbname}'
        logger.info(f'Using Unix socket (peer auth) for {dbhost}')
    else:
        # TCP connection (Docker or remote PostgreSQL with password)
        if dbpass:
            database_uri = f'postgresql+psycopg2://{dbuser}:{dbpass}@{dbhost}:{dbport}/{dbname}'
        else:
            database_uri = f'postgresql+psycopg2://{dbuser}@{dbhost}:{dbport}/{dbname}'
        logger.info(f'Using TCP connection: {dbhost}:{dbport}')
    
    logger.info(f'Connection URI: {database_uri.split("@")[0] if "@" in database_uri else database_uri.split("/")[0]}@...')
    
    try:
        engine = create_engine(
            database_uri,
            pool_size=5,
            max_overflow=10,
            pool_recycle=1800,   # recycle connections after 30 min
            pool_pre_ping=True,  # verify connections before checkout
        )
        # Test the connection
        with engine.connect() as conn:
            conn.execute(text('SELECT 1'))
        logger.info(f'✓ Database connected: {dbname}')
        return engine
    except Exception as exc:
        logger.error(f'✗ Failed to connect to database: {exc}')
        return None


def _build_db_engine_legacy():
    """Legacy database engine builder (fallback)"""
    # Try ConfigManager first (uses .env.auto with auto-detected services)
    try:
        import sys
        sys.path.insert(0, os.path.join(_PROJECT_ROOT, '01_SERVICES', '02_PIPELINE', 'SHARED'))
        from config_manager import ConfigManager
        config = ConfigManager()
        database_uri = config.get_db_url()
        if database_uri:
            try:
                return create_engine(database_uri)
            except Exception as exc:
                logger.warning(f'Failed to connect via ConfigManager: {exc}')
    except (ImportError, Exception) as e:
        logger.debug(f'ConfigManager unavailable: {e}')
    
    # Fallback: Try DBUSER/DBPASS/DBNAME environment variables (legacy)
    dbuser = os.environ.get('DBUSER')
    dbpass = os.environ.get('DBPASS')
    dbhost = os.environ.get('DBHOST', '127.0.0.1')
    dbname = os.environ.get('DBNAME')
    dbport = os.environ.get('DBPORT', '5432')
    
    if all([dbuser, dbpass, dbname]):
        database_uri = 'postgresql+psycopg2://{dbuser}:{dbpass}@{dbhost}:{dbport}/{dbname}'.format(
            dbuser=dbuser,
            dbpass=dbpass,
            dbhost=dbhost,
            dbname=dbname,
            dbport=dbport
        )
        try:
            return create_engine(database_uri)
        except Exception as exc:
            logger.warning(f'Failed to connect with DBUSER/DBPASS: {exc}')
    
    logger.warning('DB configuration incomplete. Running web app without DB-backed data.')
    return None

db = _build_db_engine()

# Expose engine to Blueprints via app.config so they can use current_app
app.config['DB_ENGINE'] = db


def _db_status():
    if db is None:
        return {'configured': False, 'connected': False, 'message': 'DB env vars not configured'}

    try:
        with db.begin() as connection:
            connection.exec_driver_sql('SELECT 1')
        return {'configured': True, 'connected': True, 'message': 'Connected'}
    except Exception as exc:
        return {'configured': True, 'connected': False, 'message': str(exc)}


def _get_current_persona_key():
    role = request.args.get('persona') or session.get('demo_persona', 'general_user')
    if role not in DEMO_PERSONAS:
        role = 'general_user'
    session['demo_persona'] = role
    return role


@app.context_processor
def inject_persona_context():
    current_role_key = session.get('demo_persona', 'general_user')
    if current_role_key not in DEMO_PERSONAS:
        current_role_key = 'general_user'

    persona_options = [
        {'key': key, 'label': value['label']}
        for key, value in DEMO_PERSONAS.items()
    ]

    return {
        'current_persona_key': current_role_key,
        'current_persona': DEMO_PERSONAS[current_role_key],
        'persona_options': persona_options
    }


@app.route('/demo/persona')
def set_demo_persona():
    role = request.args.get('role', 'general_user')
    if role not in DEMO_PERSONAS:
        role = 'general_user'
    session['demo_persona'] = role
    target = request.args.get('next') or url_for('home')
    return redirect(target)


# tpath = '/code/src/app/templates'
# app = Flask(__name__, template_folder='./templates')

# Old Jinja home route replaced by SPA — dashboard data available via /api/phase01/snapshot
@app.route('/legacy-home')
def legacy_home():
    """Preserved for reference; the actual '/' now serves the React SPA."""
    return redirect('/')

# flask stuff
@app.route("/viewer")
def viewer():
    return render_template("viewer.html")

@app.route("/gui")
def gui():
    scene_data = [{'foo': [1, 2, 3, 4], 'fee': 'hello'}]
    return render_template("gui.html")

@app.route("/starfield")
def starfield():
    """Interactive 3D star map viewer - Phase 06 MVP"""
    _get_current_persona_key()
    db_status = _db_status()
    
    # Count available systems
    systems_count = 0
    if db_status['connected']:
        try:
            df = pd.read_sql(
                "SELECT COUNT(*) as cnt FROM dm_galaxy.stars_xyz WHERE distance_ly <= 100.0 LIMIT 1",
                _get_db_session()
            )
            systems_count = int(df.iloc[0]['cnt']) if len(df) > 0 else 0
        except Exception:
            systems_count = 0
    
    return render_template(
        "starfield.html",
        db_ready=db_status['connected'],
        systems_count=systems_count,
        db_status=db_status
    )

@app.route("/simulation")
def simulation_control():
    """Simulation control panel - Phase 05 v2"""
    _get_current_persona_key()
    current_role = session.get('demo_persona', 'general_user')
    
    # Check if user has permission to control simulations
    allowed_roles = ['admin', 'sim_owner']
    if current_role not in allowed_roles:
        return render_template(
            'error.html',
            error_title='Access Denied',
            error_message=f'Simulation control requires one of: {", ".join(allowed_roles)}',
            status_code=403
        ), 403
    
    return render_template(
        "simulation_control.html",
        current_persona=current_role,
        available_simulations=list(_active_simulations.keys())
    )


def _safe_read_sql(query, params=None):
    try:
        return pd.read_sql_query(query, con=db, params=params)
    except Exception:
        return pd.DataFrame()


def _resolve_target_run_id(run_id):
    if run_id:
        return run_id

    latest_run_df = _safe_read_sql(
        """
        SELECT run_id
        FROM stg_data.ingest_runs
        ORDER BY started_at DESC
        LIMIT 1
        """
    )
    if latest_run_df.empty:
        return None
    return str(latest_run_df.iloc[0]['run_id'])


def _phase01_snapshot(run_id):
    db_status = _db_status()
    if not db_status['connected']:
        return {
            'run_id': None,
            'db_status': db_status,
            'runs': [],
            'validation_summary': [],
            'source_manifest': [],
            'quarantine_top_errors': [],
            'reference_results': []
        }

    resolved_run_id = _resolve_target_run_id(run_id)
    if resolved_run_id is None:
        return {
            'run_id': None,
            'db_status': db_status,
            'runs': [],
            'validation_summary': [],
            'source_manifest': [],
            'quarantine_top_errors': [],
            'reference_results': []
        }

    runs_df = _safe_read_sql(
        """
        SELECT
            run_id,
            run_name,
            status,
            started_at,
            finished_at,
            notes
        FROM stg_data.ingest_runs
        ORDER BY started_at DESC
        LIMIT 20
        """
    )

    validation_df = _safe_read_sql(
        """
        SELECT
            source_name,
            total_rows,
            accepted_rows,
            quarantined_rows,
            warning_count,
            fail_count,
            gate_status,
            created_at
        FROM stg_data.validation_summary
        WHERE run_id = %(run_id)s
        ORDER BY source_name
        """,
        {'run_id': resolved_run_id}
    )

    manifest_df = _safe_read_sql(
        """
        SELECT
            source_name,
            file_name,
            row_count,
            status,
            adapter_version,
            ingested_at
        FROM stg_data.source_manifest
        WHERE run_id = %(run_id)s
        ORDER BY file_name
        """,
        {'run_id': resolved_run_id}
    )

    quarantine_df = _safe_read_sql(
        """
        SELECT
            error_code,
            COUNT(*) AS error_count
        FROM stg_data.validation_quarantine
        WHERE run_id = %(run_id)s
        GROUP BY error_code
        ORDER BY error_count DESC, error_code ASC
        LIMIT 30
        """,
        {'run_id': resolved_run_id}
    )

    reference_df = _safe_read_sql(
        """
        SELECT
            rule_key,
            source_main_id,
            observed_value,
            expected_value,
            absolute_error,
            tolerance,
            status,
            checked_at
        FROM stg_data.reference_validation_results
        WHERE run_id = %(run_id)s OR run_id IS NULL
        ORDER BY checked_at DESC
        LIMIT 50
        """,
        {'run_id': resolved_run_id}
    )

    return {
        'run_id': resolved_run_id,
        'db_status': db_status,
        'runs': runs_df.to_dict(orient='records'),
        'validation_summary': validation_df.to_dict(orient='records'),
        'source_manifest': manifest_df.to_dict(orient='records'),
        'quarantine_top_errors': quarantine_df.to_dict(orient='records'),
        'reference_results': reference_df.to_dict(orient='records')
    }


@app.route('/phase01/qa')
def phase01_qa():
    _get_current_persona_key()
    run_id = request.args.get('run_id')
    snapshot = _phase01_snapshot(run_id)

    run_options = [
        {
            'run_id': str(row.get('run_id')),
            'status': row.get('status'),
            'started_at': row.get('started_at')
        }
        for row in snapshot.get('runs', [])
    ]

    table_runs = pd.DataFrame(snapshot['runs']).to_html(index=False, classes='table table-striped') if snapshot['runs'] else '<p>No runs found.</p>'
    table_validation = pd.DataFrame(snapshot['validation_summary']).to_html(index=False, classes='table table-striped') if snapshot['validation_summary'] else '<p>No validation summary rows.</p>'
    table_manifest = pd.DataFrame(snapshot['source_manifest']).to_html(index=False, classes='table table-striped') if snapshot['source_manifest'] else '<p>No manifest rows.</p>'
    table_quarantine = pd.DataFrame(snapshot['quarantine_top_errors']).to_html(index=False, classes='table table-striped') if snapshot['quarantine_top_errors'] else '<p>No quarantine rows.</p>'
    table_reference = pd.DataFrame(snapshot['reference_results']).to_html(index=False, classes='table table-striped') if snapshot['reference_results'] else '<p>No reference checks found.</p>'

    return render_template(
        'phase01_qa.html',
        run_id=snapshot['run_id'],
        db_status=snapshot.get('db_status', {}),
        run_options=run_options,
        table_runs=table_runs,
        table_validation=table_validation,
        table_manifest=table_manifest,
        table_quarantine=table_quarantine,
        table_reference=table_reference
    )


@app.route('/phase01/qa.json')
def phase01_qa_json():
    run_id = request.args.get('run_id')
    return jsonify(_phase01_snapshot(run_id))

if socket_ is not None and emit is not None:
    @socket_.on('message', namespace='/starmap')
    def handle_message(msg):
        if db is None:
            return

        try:
            df = pd.read_sql_query(
                """
                SELECT
                    name_code,
                    size,
                    r,
                    g,
                    b,
                    x,
                    y,
                    z
                FROM dm_galaxy.star_render_info
                ORDER BY distance ASC
                LIMIT 100
                """,
                con=db
            )
        except SQLAlchemyError:
            return

        if msg == 'connected':
            emit('from_flask', 'received!', broadcast=True)
            for _, row in df.iterrows():
                emit('make_star', row.tolist(), broadcast=True)

        # emit('run_buffer', 'stars', broadcast=True)

# @socket_.on('my_event', namespace='/starmap')
# @socket_.route('/starmap')
# def echo_socket(ws):
#     while True:
#         message = ws.receive()
#         ws.send(message[::-1])


# ============================================================
# ROLE-PROTECTED API ENDPOINTS (Phase 05)
# ============================================================

def require_role(*allowed_roles):
    """
    Decorator: restrict endpoint access to specified personas.
    
    Usage:
        @require_role('admin', 'ops_engineer')
        def protected_endpoint():
            ...
    """
    from functools import wraps
    
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            current_role = session.get('demo_persona', 'general_user')
            if current_role not in allowed_roles:
                return jsonify({
                    'error': 'Access denied',
                    'required_role': allowed_roles,
                    'current_role': current_role
                }), 403
            return func(*args, **kwargs)
        return wrapper
    return decorator


@app.route('/api/health')
def api_health():
    """System health check for the React frontend."""
    db_status = _db_status()
    current_role = session.get('demo_persona', 'general_user')
    return jsonify({
        'db_status': db_status,
        'persona': current_role,
        'routes_count': len([rule.rule for rule in app.url_map.iter_rules()]),
    })


@app.route('/api/world/systems/xyz')
def api_world_systems_xyz():
    """
    GET /api/world/systems/xyz

    Return star systems with full XYZ coordinates for 3D rendering.
    """
    current_role = session.get('demo_persona', 'general_user')

    db_status = _db_status()
    if not db_status['connected']:
        return jsonify({'error': 'Database not connected'}), 503

    query = """
    SELECT
        main_id,
        x_pc,
        y_pc,
        z_pc,
        distance_ly,
        CASE WHEN sanity_pass THEN 'observed' ELSE 'inferred' END as source,
        uncertainty_pc as confidence_bound
    FROM dm_galaxy.stars_xyz
    WHERE distance_ly <= 100.0
    ORDER BY distance_ly ASC
    LIMIT 2000
    """

    try:
        db_session = _get_db_session()
        if not db_session:
            return jsonify({'error': 'Database not available'}), 503

        df = pd.read_sql(query, db_session)
        return jsonify({
            'systems': df.to_dict(orient='records'),
            'total_count': len(df),
            'persona': current_role
        })
    except Exception as e:
        logger.error(f"API error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/world/systems')
def api_world_systems():
    """
    GET /api/world/systems
    
    Retrieve list of star systems within 100 LY.
    Response filtered by persona permissions.
    
    Allowed: all personas
    Response: {systems: [{main_id, distance_ly, confidence, inferred}]}
    """
    current_role = session.get('demo_persona', 'general_user')
    
    db_status = _db_status()
    if not db_status['connected']:
        return jsonify({'error': 'Database not connected'}), 503
    
    query = """
    SELECT
        main_id,
        distance_ly,
        CASE
            WHEN sanity_pass THEN 'observed'
            ELSE 'inferred'
        END as source,
        uncertainty_pc as confidence_bound
    FROM dm_galaxy.stars_xyz
    WHERE distance_ly <= 100.0
    ORDER BY distance_ly ASC
    LIMIT 500
    """
    
    try:
        db_session = _get_db_session()
        if not db_session:
            return jsonify({'error': 'Database not available'}), 503
        
        df = pd.read_sql(query, db_session)
        
        # Filter based on persona
        if current_role in ('observer_guest',):
            # Hide confidence bounds for observer guest
            df = df.drop('confidence_bound', axis=1)
        
        return jsonify({
            'systems': df.to_dict(orient='records'),
            'total_count': len(df),
            'persona': current_role
        })
    except Exception as e:
        logger.error(f"API error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/world/confidence')
@require_role('admin', 'science_analyst', 'data_curator')
def api_world_confidence():
    """
    GET /api/world/confidence
    
    Retrieve confidence/uncertainty metadata for all systems.
    
    Allowed: admin, science_analyst, data_curator
    Response: {confidence_data: [{main_id, uncertainty_pc, sanity_pass}]}
    """
    query = """
    SELECT
        main_id,
        distance_ly,
        uncertainty_pc,
        sanity_pass,
        parallax_mas
    FROM dm_galaxy.stars_xyz
    WHERE distance_ly <= 100.0
    ORDER BY uncertainty_pc DESC
    """
    
    try:
        db_session = _get_db_session()
        if not db_session:
            return jsonify({'error': 'Database not available'}), 503
        
        df = pd.read_sql(query, db_session)
        
        return jsonify({
            'confidence_data': df.to_dict(orient='records'),
            'total_count': len(df),
            'high_uncertainty_threshold_pc': 2.0
        })
    except Exception as e:
        logger.error(f"API error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/runs/manifest')
@require_role('admin', 'ops_engineer', 'data_curator')
def api_runs_manifest():
    """
    GET /api/runs/manifest
    
    Retrieve run history and manifest data (Phase 01, 02, etc).
    
    Allowed: admin, ops_engineer, data_curator
    Response: {runs: [{run_id, status, started_at, manifest_data}]}
    """
    limit = request.args.get('limit', 50, type=int)
    
    query = """
    SELECT
        run_id,
        run_name,
        status,
        started_at,
        finished_at,
        notes
    FROM stg_data.ingest_runs
    ORDER BY started_at DESC
    LIMIT %s
    """
    
    try:
        db_session = _get_db_session()
        if not db_session:
            return jsonify({'error': 'Database not available'}), 503
        
        df = pd.read_sql(query, db_session, params=[limit])
        
        return jsonify({
            'runs': df.to_dict(orient='records'),
            'total_returned': len(df),
            'limit': limit
        })
    except Exception as e:
        logger.error(f"API error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/runs/validation/<run_id>')
@require_role('admin', 'data_curator', 'ops_engineer')
def api_runs_validation(run_id):
    """
    GET /api/runs/validation/<run_id>
    
    Retrieve validation summary for a specific run.
    
    Allowed: admin, data_curator, ops_engineer
    Response: {validation_summary: [{source_name, accepted_rows, quarantined_rows}]}
    """
    query = """
    SELECT
        source_name,
        total_rows,
        accepted_rows,
        quarantined_rows,
        gate_status,
        created_at
    FROM stg_data.validation_summary
    WHERE run_id = %s
    ORDER BY source_name
    """
    
    try:
        db_session = _get_db_session()
        if not db_session:
            return jsonify({'error': 'Database not available'}), 503
        
        df = pd.read_sql(query, db_session, params=[run_id])
        
        return jsonify({
            'run_id': run_id,
            'validation_summary': df.to_dict(orient='records'),
            'total_sources': len(df)
        })
    except Exception as e:
        logger.error(f"API error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/persona')
def api_persona():
    """
    GET /api/persona
    
    Return current persona info and available personas for switching.
    
    Response: {
        current_persona_key: str,
        current_persona: dict,
        available_personas: list
    }
    """
    current_role = session.get('demo_persona', 'general_user')
    
    persona_list = [
        {'key': key, 'label': value['label']}
        for key, value in DEMO_PERSONAS.items()
    ]
    
    return jsonify({
        'current_persona_key': current_role,
        'current_persona': DEMO_PERSONAS.get(current_role, DEMO_PERSONAS['general_user']),
        'available_personas': persona_list
    })


# Simulation runtime singleton - Phase 05 v2
_active_simulations = {}  # run_id -> SimulationEngine instance


@app.route('/api/simulation/<run_id>/snapshot')
@require_role('admin', 'sim_owner', 'observer_guest')
def api_simulation_snapshot(run_id):
    """
    GET /api/simulation/<run_id>/snapshot
    
    Get current simulation state snapshot (tick, population, events).
    
    Allowed: admin, sim_owner, observer_guest
    Response: {snapshot: {...}, status: str}
    """
    if run_id not in _active_simulations:
        return jsonify({'error': 'Simulation not found', 'run_id': run_id}), 404
    
    try:
        engine = _active_simulations[run_id]
        snap = engine.snapshot()
        return jsonify({
            'snapshot': snap.to_dict(),
            'status': 'success'
        })
    except Exception as e:
        logger.error(f"Snapshot error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/simulation/<run_id>/events')
@require_role('admin', 'sim_owner', 'observer_guest')
def api_simulation_events(run_id):
    """
    GET /api/simulation/<run_id>/events?limit=20&after_tick=0
    
    Get event log with optional pagination.
    
    Allowed: admin, sim_owner, observer_guest
    Query params:
      limit: max events to return (default 20)
      after_tick: only events after this tick (default 0)
    
    Response: {events: [...], total_count: int}
    """
    if run_id not in _active_simulations:
        return jsonify({'error': 'Simulation not found'}), 404
    
    try:
        limit = int(request.args.get('limit', 20))
        after_tick = int(request.args.get('after_tick', 0))
        
        engine = _active_simulations[run_id]
        
        # Filter events by tick
        events = [e for e in engine.event_log if isinstance(e, dict) and e.get('tick', 0) > after_tick]
        
        return jsonify({
            'run_id': run_id,
            'events': events[-limit:],
            'total_count': len(events),
            'current_tick': engine.tick
        })
    except Exception as e:
        logger.error(f"Events error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/simulation/<run_id>/pause', methods=['POST'])
@require_role('admin', 'sim_owner')
def api_simulation_pause(run_id):
    """
    POST /api/simulation/<run_id>/pause
    
    Pause a running simulation.
    
    Allowed: admin, sim_owner
    Response: {status: str, run_id: str, tick: int}
    """
    if run_id not in _active_simulations:
        return jsonify({'error': 'Simulation not found'}), 404
    
    try:
        engine = _active_simulations[run_id]
        engine.pause()
        return jsonify({
            'status': 'paused',
            'run_id': run_id,
            'tick': engine.tick
        })
    except Exception as e:
        logger.error(f"Pause error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/simulation/<run_id>/resume', methods=['POST'])
@require_role('admin', 'sim_owner')
def api_simulation_resume(run_id):
    """
    POST /api/simulation/<run_id>/resume
    
    Resume a paused simulation.
    
    Allowed: admin, sim_owner
    Response: {status: str, run_id: str, tick: int}
    """
    if run_id not in _active_simulations:
        return jsonify({'error': 'Simulation not found'}), 404
    
    try:
        engine = _active_simulations[run_id]
        engine.resume()
        return jsonify({
            'status': 'running',
            'run_id': run_id,
            'tick': engine.tick
        })
    except Exception as e:
        logger.error(f"Resume error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/simulation/<run_id>/step', methods=['POST'])
@require_role('admin', 'sim_owner')
def api_simulation_step(run_id):
    """
    POST /api/simulation/<run_id>/step?interval=10
    
    Execute N ticks and return updated snapshot.
    
    Allowed: admin, sim_owner
    Query params:
      interval: number of ticks to execute (default 1, max 1000)
    
    Response: {snapshot: {...}, ticks_executed: int}
    """
    if run_id not in _active_simulations:
        return jsonify({'error': 'Simulation not found'}), 404
    
    try:
        interval = min(int(request.args.get('interval', 1)), 1000)
        
        engine = _active_simulations[run_id]
        start_tick = engine.tick
        engine.run(max_ticks=interval)
        
        snap = engine.snapshot()
        return jsonify({
            'snapshot': snap.to_dict(),
            'ticks_executed': engine.tick - start_tick,
            'status': 'success'
        })
    except Exception as e:
        logger.error(f"Step error: {e}")
        return jsonify({'error': str(e)}), 500


# Helper function to get DB session (fallback for API endpoints)
def _get_db_session():
    """Get active DB connection or None if unavailable."""
    try:
        engine = _build_db_engine()
        if engine:
            return engine.connect()
    except Exception:
        pass
    return None


# ── Enriched 3-D render payload ──────────────────────────────────

# Harvard spectral class → approximate Teff (K)
_SPECTRAL_TEFF = {
    'O': 35000, 'B': 18000, 'A': 8500, 'F': 6750,
    'G': 5600,  'K': 4450,  'M': 3200, 'L': 1800,
    'T': 1200,  'Y': 500,   'D': 10000, 'W': 50000,
    'C': 3000,  'S': 3200,  'P': 3500,
}

# SIMBAD otype codes that flag multiplicity
_MULTI_OTYPES = {'**', 'SB*', 'EB*', 'El*', 'bL*', 'WU*'}


@app.route('/api/world/systems/full')
def api_world_systems_full():
    """
    GET /api/world/systems/full

    Full render payload: XYZ + spectral type + multiplicity + planet count.
    Combines dm_galaxy.stars_xyz with EXOPLANETS data for a complete picture.
    Falls back to CSV data if database tables are empty.
    """
    current_role = session.get('demo_persona', 'general_user')
    db_status = _db_status()

    systems = []
    actual_source = 'csv_fallback'

    # ── Try database first ──
    if db_status['connected']:
        try:
            conn = _get_db_session()
            if conn:
                df = pd.read_sql("""
                    SELECT main_id, x_pc, y_pc, z_pc, distance_ly,
                           sanity_pass, uncertainty_pc
                    FROM dm_galaxy.stars_xyz
                    WHERE distance_ly <= 100.0
                    ORDER BY distance_ly ASC LIMIT 2000
                """, conn)
                if len(df) > 0:
                    actual_source = 'database'
                    for _, row in df.iterrows():
                        systems.append({
                            'main_id': row['main_id'],
                            'x': float(row['x_pc']) if row['x_pc'] else 0,
                            'y': float(row['y_pc']) if row['y_pc'] else 0,
                            'z': float(row['z_pc']) if row['z_pc'] else 0,
                            'distance_ly': float(row['distance_ly'] or 0),
                            'spectral_class': 'G',
                            'teff': 5600,
                            'luminosity': 1.0,
                            'multiplicity': 1,
                            'planet_count': 0,
                            'confidence': 'observed' if row['sanity_pass'] else 'inferred',
                        })
                conn.close()
        except Exception as e:
            logger.warning(f"DB query failed, falling back to CSV: {e}")

    # ── Fallback: read directly from CSV files ──
    if not systems:
        systems, planets, belts = _load_systems_from_csv()
        actual_source = 'csv_fallback'
        # Populate module-level caches
        global _systems_cache, _planet_cache, _belt_cache
        _systems_cache = systems
        _planet_cache = planets
        _belt_cache = belts

    return jsonify({
        'systems': systems,
        'total_count': len(systems),
        'persona': current_role,
        'source': actual_source
    })


# ── Planet classification & inference helpers ──────────────────────

# Extended 22-type planet taxonomy (see PHASE0_SYSTEMS_AND_FLOTILLA.MD §A2)
_PLANET_TYPE_DEFS = {
    'hot-jupiter':   {'mass': (100, 3000), 'radius': (10, 20),  'tag': 'giant'},
    'warm-neptune':  {'mass': (10, 50),    'radius': (3, 6),    'tag': 'giant'},
    'mini-neptune':  {'mass': (5, 15),     'radius': (2, 4),    'tag': 'giant'},
    'sub-neptune':   {'mass': (2, 10),     'radius': (1.5, 3.5),'tag': 'volatile'},
    'super-earth':   {'mass': (1.5, 10),   'radius': (1.2, 2.0),'tag': 'rocky'},
    'earth-like':    {'mass': (0.5, 2.0),  'radius': (0.8, 1.3),'tag': 'rocky'},
    'eyeball-world': {'mass': (0.5, 5.0),  'radius': (0.8, 1.8),'tag': 'exotic'},
    'ocean-world':   {'mass': (1, 8),      'radius': (1.0, 2.5),'tag': 'exotic'},
    'desert-world':  {'mass': (0.3, 3.0),  'radius': (0.7, 1.5),'tag': 'rocky'},
    'lava-world':    {'mass': (0.1, 5.0),  'radius': (0.5, 1.8),'tag': 'exotic'},
    'carbon-planet': {'mass': (0.5, 10),   'radius': (0.8, 2.0),'tag': 'exotic'},
    'iron-planet':   {'mass': (0.5, 5.0),  'radius': (0.5, 1.2),'tag': 'rocky'},
    'ice-dwarf':     {'mass': (0.001, 0.1),'radius': (0.1, 0.5),'tag': 'dwarf'},
    'hycean':        {'mass': (2, 10),     'radius': (1.5, 3.0),'tag': 'exotic'},
    'chthonian':     {'mass': (5, 50),     'radius': (1.5, 4.0),'tag': 'exotic'},
    'rogue-capture': {'mass': (0.5, 500),  'radius': (0.5, 12), 'tag': 'exotic'},
    'trojan-world':  {'mass': (0.01, 1.0), 'radius': (0.3, 1.0),'tag': 'dwarf'},
    'sub-earth':     {'mass': (0.01, 0.5), 'radius': (0.2, 0.8),'tag': 'dwarf'},
    'rocky':         {'mass': (0.3, 2.0),  'radius': (0.7, 1.2),'tag': 'rocky'},
    'neptune-like':  {'mass': (10, 50),    'radius': (3, 5),    'tag': 'giant'},
    'gas-giant':     {'mass': (50, 3000),  'radius': (8, 15),   'tag': 'giant'},
    'super-jupiter': {'mass': (3000, 13000),'radius': (10, 15), 'tag': 'giant'},
}


def _classify_planet_type(mass_earth, radius_earth, sma_au):
    """Classify planet type from mass/radius/SMA with extended taxonomy."""
    if mass_earth is not None:
        if mass_earth < 0.1:
            return 'sub-earth'
        elif mass_earth < 0.5:
            return 'sub-earth'
        elif mass_earth < 2.0:
            return 'rocky'
        elif mass_earth < 10.0:
            return 'super-earth'
        elif mass_earth < 50.0:
            return 'neptune-like'
        elif mass_earth < 500.0:
            return 'gas-giant'
        else:
            return 'super-jupiter'
    if radius_earth is not None:
        if radius_earth < 0.8:
            return 'sub-earth'
        elif radius_earth < 1.2:
            return 'rocky'
        elif radius_earth < 2.5:
            return 'super-earth'
        elif radius_earth < 6.0:
            return 'neptune-like'
        else:
            return 'gas-giant'
    return 'unknown'


def _refine_planet_type(base_type, mass_e, sma_au, temp_k, hz_in, hz_out,
                        spectral_class, rng, exotic_weight=1.0):
    """Apply sub-type refinement: eyeball, lava, ocean, hycean, etc.

    Takes the base type from band selection and upgrades it to an exotic
    type when physical conditions warrant it.  exotic_weight multiplies
    the probability of exotic outcomes (from world-rules).
    """
    # Tidally locked eyeball worlds: M-dwarf HZ planets
    if (base_type in ('rocky', 'super-earth', 'earth-like')
            and spectral_class == 'M' and hz_in <= sma_au <= hz_out):
        if rng.random() < 0.55 * exotic_weight:
            return 'eyeball-world'

    # Lava worlds: very hot, close-in
    if temp_k > 1500 and base_type in ('rocky', 'super-earth', 'sub-earth'):
        if rng.random() < 0.7 * exotic_weight:
            return 'lava-world'

    # Hot Jupiters: gas giants very close in AND actually irradiated
    # Must receive significant stellar flux (temp > 700 K) — cold gas
    # giants near faint stars are just regular gas/super-jupiters
    if base_type in ('gas-giant', 'super-jupiter') and sma_au < 0.15 and temp_k > 700:
        return 'hot-jupiter'

    # Ocean worlds: HZ super-earths with high volatile fraction
    if base_type in ('super-earth', 'earth-like') and hz_in * 0.8 <= sma_au <= hz_out * 1.3:
        if rng.random() < 0.20 * exotic_weight:
            return 'ocean-world'

    # Hycean worlds: larger super-earths in warm zone
    if base_type == 'super-earth' and mass_e > 3.0 and hz_in * 0.5 <= sma_au <= hz_out * 2.0:
        if rng.random() < 0.12 * exotic_weight:
            return 'hycean'

    # Desert worlds: inner HZ edge, medium mass
    if base_type in ('rocky', 'earth-like') and sma_au < hz_in * 1.1 and sma_au > hz_in * 0.5:
        if rng.random() < 0.15 * exotic_weight:
            return 'desert-world'

    # Iron planets: very dense, close-in
    if base_type in ('rocky', 'sub-earth') and sma_au < 0.3 and mass_e < 3.0:
        if rng.random() < 0.10 * exotic_weight:
            return 'iron-planet'

    # Carbon planets: rare — carbon-rich chemical budget
    if base_type in ('rocky', 'super-earth') and rng.random() < 0.03 * exotic_weight:
        return 'carbon-planet'

    # Warm neptunes
    if base_type == 'neptune-like' and sma_au < 1.0:
        if rng.random() < 0.3:
            return 'warm-neptune'

    # Mini-neptunes: lighter neptunes
    if base_type == 'neptune-like' and mass_e < 20:
        if rng.random() < 0.25:
            return 'mini-neptune'

    # Sub-neptunes: puffy, hydrogen-rich
    if base_type == 'super-earth' and mass_e > 3.0:
        if rng.random() < 0.15:
            return 'sub-neptune'

    # Earth-like upgrade for HZ rocky worlds
    if base_type == 'rocky' and hz_in <= sma_au <= hz_out and 0.5 <= mass_e <= 2.0:
        if rng.random() < 0.3 * exotic_weight:
            return 'earth-like'

    return base_type


def _deterministic_seed(name: str) -> int:
    """Produce an int seed from a star name — fully deterministic."""
    return int(hashlib.md5(name.encode()).hexdigest()[:8], 16)


# ── Habitable-zone boundaries (scaled by sqrt(luminosity)) ────────
_HZ_INNER_BASE = 0.95   # AU for L=1
_HZ_OUTER_BASE = 1.37

def _hz_bounds(luminosity: float):
    """Return (inner_au, outer_au) for the habitable zone."""
    lum = max(luminosity, 0.0001)
    s = math.sqrt(lum)
    return round(_HZ_INNER_BASE * s, 4), round(_HZ_OUTER_BASE * s, 4)


# ── Inline inference engine (no DB dependency) ─────────────────────

_INF_STELLAR_PRIORS = {
    'O': {'planet_prob': 0.15, 'belt_prob': 0.40, 'avg_planets': 2.0},
    'B': {'planet_prob': 0.25, 'belt_prob': 0.50, 'avg_planets': 3.0},
    'A': {'planet_prob': 0.40, 'belt_prob': 0.60, 'avg_planets': 4.0},
    'F': {'planet_prob': 0.85, 'belt_prob': 0.90, 'avg_planets': 6.5},
    'G': {'planet_prob': 0.90, 'belt_prob': 0.95, 'avg_planets': 8.0},
    'K': {'planet_prob': 0.85, 'belt_prob': 0.90, 'avg_planets': 7.0},
    'M': {'planet_prob': 0.80, 'belt_prob': 0.80, 'avg_planets': 5.5},
    'L': {'planet_prob': 0.30, 'belt_prob': 0.40, 'avg_planets': 2.0},
    'T': {'planet_prob': 0.15, 'belt_prob': 0.25, 'avg_planets': 1.0},
}

import random as _random


def _infer_planets_for_star(main_id, spectral_class, luminosity, star_mass=None):
    """Generate inferred planets with extended 22-type taxonomy.

    Features:
      - 10 orbital bands scaled by luminosity
      - Exotic type refinement (eyeball, lava, ocean, hycean, etc.)
      - Tidal locking detection for M-dwarf HZ planets
      - Sub-type flags (tidally_locked, terminator_habitable, subsurface_ocean, etc.)
      - Resonance chain detection between adjacent planet pairs
    """
    rng = _random.Random(_deterministic_seed(main_id))
    prior = _INF_STELLAR_PRIORS.get(spectral_class, _INF_STELLAR_PRIORS['G'])

    if rng.random() > prior['planet_prob']:
        return []

    num = max(2, round(rng.gauss(prior['avg_planets'], 1.5)))
    num = min(num, 12)

    lum = max(luminosity, 0.0001)
    lum_scale = math.sqrt(lum)
    hz_in, hz_out = _hz_bounds(luminosity)

    # Orbital bands scaled by luminosity — 10 bands
    bands = [
        (0.02 * lum_scale, 0.1 * lum_scale,  ['sub-earth', 'rocky'],               0.01, 0.8,   0.3, 0.9),
        (0.1 * lum_scale,  0.4 * lum_scale,  ['rocky', 'sub-earth'],               0.05, 1.5,   0.4, 1.2),
        (0.4 * lum_scale,  hz_in * 0.9,      ['rocky', 'super-earth'],             0.3,  3.0,   0.7, 1.5),
        (hz_in * 0.7,      hz_in,            ['rocky', 'super-earth', 'earth-like'], 0.5, 3.0,  0.8, 1.6),
        (hz_in,            hz_out,           ['rocky', 'super-earth', 'earth-like'], 0.5, 4.0,  0.9, 1.8),
        (hz_out,           hz_out * 2.0,     ['super-earth', 'neptune-like'],       3.0, 20.0,  1.5, 4.5),
        (hz_out * 2.0,     4.0 * lum_scale,  ['neptune-like', 'super-earth'],       5.0, 30.0,  2.0, 5.0),
        (3.0 * lum_scale,  8.0 * lum_scale,  ['gas-giant', 'super-jupiter'],       50.0, 800.0, 5.0, 14.0),
        (8.0 * lum_scale,  18.0 * lum_scale, ['gas-giant', 'neptune-like'],        20.0, 400.0, 3.5, 11.0),
        (18.0 * lum_scale, 40.0 * lum_scale, ['neptune-like', 'gas-giant'],         8.0, 150.0, 2.5, 8.0),
    ]

    used_sma = []
    inferred = []
    band_order = list(range(len(bands)))
    rng.shuffle(band_order)

    for i in range(num):
        if i >= len(band_order):
            break
        bi = band_order[i]
        inner, outer, type_choices, m_lo, m_hi, r_lo, r_hi = bands[bi]
        if inner >= outer:
            continue
        sma = round(rng.uniform(inner, outer), 4)

        if any(abs(sma - u) < 0.1 * lum_scale for u in used_sma):
            continue
        used_sma.append(sma)

        base_type = rng.choice(type_choices)
        mass_e = round(rng.uniform(m_lo, m_hi), 3)
        rad_e = round(rng.uniform(r_lo, r_hi), 3)
        period = round(365.25 * (sma ** 1.5) / max(math.sqrt(star_mass or 1.0), 0.1), 2)
        ecc = round(rng.uniform(0, 0.15 if sma < 2 else 0.35), 3)
        temp_k = round(278.5 * (lum ** 0.25) / math.sqrt(max(sma, 0.01)), 1)

        # ── Exotic type refinement ──
        ptype = _refine_planet_type(
            base_type, mass_e, sma, temp_k, hz_in, hz_out,
            spectral_class, rng, exotic_weight=1.0,
        )

        # Adjust mass/radius to match refined type
        tdef = _PLANET_TYPE_DEFS.get(ptype)
        if tdef and ptype != base_type:
            mass_e = round(rng.uniform(*tdef['mass']), 3)
            rad_e = round(rng.uniform(*tdef['radius']), 3)
            # Recompute temp if mass changed the orbit dynamics
            temp_k = round(278.5 * (lum ** 0.25) / math.sqrt(max(sma, 0.01)), 1)

        # ── Sub-type flags ──
        sub_flags = []
        tidally_locked = False

        # Tidal locking: close-in planets around M/K dwarfs
        tidal_lock_radius = 0.3 * lum_scale  # rough tidal locking radius
        if spectral_class in ('M', 'K') and sma < tidal_lock_radius:
            tidally_locked = True
            sub_flags.append('tidally_locked')
            if hz_in <= sma <= hz_out:
                sub_flags.append('terminator_habitable')

        if ptype == 'eyeball-world':
            sub_flags.append('permanent_dayside')
            sub_flags.append('ice_nightside')

        if ptype == 'ocean-world':
            sub_flags.append('global_ocean')
            if mass_e > 3.0:
                sub_flags.append('high_pressure_ice_mantle')

        if ptype == 'lava-world':
            sub_flags.append('magma_ocean')
            sub_flags.append('silicate_atmosphere')

        if ptype == 'hycean':
            sub_flags.append('hydrogen_envelope')
            sub_flags.append('deep_ocean')

        if ptype == 'carbon-planet':
            sub_flags.append('graphite_surface')
            sub_flags.append('diamond_mantle')

        if ptype == 'iron-planet':
            sub_flags.append('stripped_mantle')
            sub_flags.append('metallic_surface')

        if ptype in ('gas-giant', 'super-jupiter', 'hot-jupiter'):
            if rng.random() < 0.6:
                sub_flags.append('banded_atmosphere')
            if rng.random() < 0.2:
                sub_flags.append('great_storm')

        if hz_in <= sma <= hz_out and ptype in ('rocky', 'super-earth', 'earth-like'):
            sub_flags.append('habitable_zone')
            if rng.random() < 0.3:
                sub_flags.append('possible_biosignatures')

        # ── Spin-orbit resonance ──
        # Tidally locked worlds: most are 1:1, some show 3:2 (Mercury-like) if ecc > 0.1
        spin_orbit = None
        rotation_period_days = None
        if tidally_locked:
            if ecc > 0.1 and rng.random() < 0.35:
                spin_orbit = '3:2'
                rotation_period_days = round(period * 2 / 3, 3)
                sub_flags.append('spin_orbit_3_2')
            else:
                spin_orbit = '1:1'
                rotation_period_days = round(period, 3)
                sub_flags.append('spin_orbit_1_1')
        else:
            # Free rotation — estimate from mass/age
            # Larger planets tend to rotate faster (conservation of angular momentum)
            base_rot = 24.0  # Earth hours
            if ptype in ('gas-giant', 'super-jupiter', 'hot-jupiter'):
                base_rot = 8 + rng.uniform(0, 6)
            elif ptype in ('neptune-like', 'warm-neptune', 'mini-neptune', 'sub-neptune'):
                base_rot = 14 + rng.uniform(0, 8)
            elif mass_e > 5:
                base_rot = 12 + rng.uniform(0, 8)
            elif mass_e > 1:
                base_rot = 18 + rng.uniform(0, 12)
            else:
                base_rot = 24 + rng.uniform(-8, 40)
            rotation_period_days = round(base_rot / 24.0, 4)

        # ── Temperature distribution model ──
        # Estimate atmospheric thickness from planet type
        _atm_est = 0.8 if ptype in ('gas-giant','super-jupiter','hot-jupiter',
                   'neptune-like','warm-neptune','mini-neptune','sub-neptune') else \
                   0.6 if ptype in ('earth-like','hycean','ocean-world') else \
                   0.3 if ptype in ('super-earth','rocky') and mass_e > 0.5 and temp_k < 700 else \
                   0.05
        temp_distribution = _compute_temp_distribution(
            temp_k, tidally_locked, spin_orbit, ptype, mass_e,
            _atm_est, ecc, rng
        ) if temp_k else None

        # ── Mineral / element abundances ──
        _met = 0.0  # default solar metallicity for inferred
        mineral_abundance = _compute_mineral_abundance(
            ptype, mass_e, rad_e, temp_k, sma, _met, rng
        )

        letter = chr(ord('b') + len(inferred))
        planet_name = f"{main_id} {letter} (inferred)"

        inferred.append({
            'planet_name': planet_name,
            'planet_status': 'Inferred',
            'mass_earth': mass_e,
            'mass_source': 'inferred',
            'radius_earth': rad_e,
            'semi_major_axis_au': sma,
            'orbital_period_days': period,
            'eccentricity': ecc,
            'inclination_deg': round(rng.gauss(0, 3.0), 2),
            'temp_calculated_k': temp_k,
            'temp_measured_k': None,
            'geometric_albedo': None,
            'detection_type': None,
            'molecules': None,
            'discovered': None,
            'planet_type': ptype,
            'sub_type_flags': sub_flags,
            'tidally_locked': tidally_locked,
            'spin_orbit_resonance': spin_orbit,
            'rotation_period_days': rotation_period_days,
            'temp_distribution': temp_distribution,
            'mineral_abundance': mineral_abundance,
            'confidence': 'inferred',
            'moons': [],
            'ring_system': None,
        })

    # Sort by SMA
    inferred.sort(key=lambda p: p['semi_major_axis_au'] or 999)

    # ── Resonance chain detection ──
    _detect_resonance_chains(inferred, rng)

    # ── Ring system generation ──
    for p in inferred:
        p['ring_system'] = _generate_ring_system(p, rng)

    return inferred


def _compute_temp_distribution(temp_k, tidally_locked, spin_orbit, ptype, mass_e, atm_thick, ecc, rng):
    """Compute realistic temperature distribution across the planet surface.

    Returns dict with substellar, antistellar, terminator, polar temps,
    day/night contrast, heat transport efficiency, and storm systems.

    Physics:
    - Tidally locked 1:1: extreme day/night contrast (modulated by atm thickness)
    - Tidally locked 3:2: pseudo-resonance creates hot longitudes
    - Free rotators: normal equator-to-pole gradient
    - Thick atmospheres redistribute heat (Venus-like)
    - Gas giants: internal heat dominates
    """
    is_gas = ptype in ('gas-giant', 'super-jupiter', 'hot-jupiter',
                       'neptune-like', 'warm-neptune', 'mini-neptune', 'sub-neptune')

    # Atmospheric heat redistribution factor (0 = no redistribution, 1 = uniform)
    if is_gas:
        atm_factor = 0.80 + rng.uniform(0, 0.15)  # gas giants redistribute well
    elif atm_thick > 0.8:
        atm_factor = 0.70 + atm_thick * 0.1  # Venus-like thick atmosphere
    elif atm_thick > 0.3:
        atm_factor = 0.25 + atm_thick * 0.3
    else:
        atm_factor = max(0.02, atm_thick * 0.12)  # airless = almost no redistribution

    if tidally_locked and spin_orbit == '1:1':
        # Synchronous rotation — permanent day/night
        substellar_t = round(temp_k * (1.3 - atm_factor * 0.35), 1)
        antistellar_t = round(temp_k * (0.15 + atm_factor * 0.65), 1)
        terminator_t = round((substellar_t + antistellar_t) * 0.47, 1)
        polar_t = round(antistellar_t * 0.85 + terminator_t * 0.15, 1)
        # Central storm (substellar convection cell)
        storm = {
            'type': 'substellar_vortex',
            'latitude_deg': 0,
            'longitude_deg': 0,  # substellar point
            'diameter_deg': round(25 + mass_e * 8 + atm_factor * 20, 1),
            'intensity': round(min(1.0, 0.4 + atm_factor * 0.5 + mass_e * 0.05), 3),
            'wind_speed_ms': round(50 + atm_factor * 200 + (substellar_t - antistellar_t) * 0.3, 1),
        }
        return {
            'substellar_k': substellar_t,
            'antistellar_k': antistellar_t,
            'terminator_k': terminator_t,
            'polar_k': polar_t,
            'day_night_contrast': round(substellar_t - antistellar_t, 1),
            'heat_redistribution': round(atm_factor, 3),
            'pattern': 'eyeball',
            'storms': [storm],
        }

    elif tidally_locked and spin_orbit == '3:2':
        # Mercury-like: two hot longitudes, eccentric orbit heating
        hot_long_t = round(temp_k * (1.15 - atm_factor * 0.2), 1)
        cold_long_t = round(temp_k * (0.55 + atm_factor * 0.25), 1)
        mean_t = round((hot_long_t + cold_long_t) / 2, 1)
        return {
            'hot_longitude_k': hot_long_t,
            'cold_longitude_k': cold_long_t,
            'mean_k': mean_t,
            'day_night_contrast': round(hot_long_t - cold_long_t, 1),
            'heat_redistribution': round(atm_factor, 3),
            'pattern': 'mercury_resonance',
            'storms': [],
        }

    else:
        # Free rotator — equator to pole gradient
        equator_t = round(temp_k * 1.05, 1)
        polar_t = round(temp_k * (0.55 + atm_factor * 0.30), 1)

        storms = []
        if is_gas:
            # Gas giants: internal heat + Coriolis → banded storms
            internal_heat = 15 + mass_e * 0.5  # K from internal heat
            equator_t = round(equator_t + internal_heat, 1)
            n_storms = rng.randint(1, 4)
            for si in range(n_storms):
                lat = rng.uniform(-60, 60)
                storms.append({
                    'type': 'anticyclonic_vortex' if rng.random() > 0.3 else 'cyclonic_band',
                    'latitude_deg': round(lat, 1),
                    'longitude_deg': round(rng.uniform(0, 360), 1),
                    'diameter_deg': round(rng.uniform(8, 35), 1),
                    'intensity': round(rng.uniform(0.3, 1.0), 3),
                    'wind_speed_ms': round(rng.uniform(100, 600), 1),
                })
        elif atm_thick > 0.3 and temp_k > 200:
            # Rocky/ocean with atmosphere may have cyclones
            if rng.random() < 0.4:
                storms.append({
                    'type': 'tropical_cyclone',
                    'latitude_deg': round(rng.uniform(-30, 30), 1),
                    'longitude_deg': round(rng.uniform(0, 360), 1),
                    'diameter_deg': round(rng.uniform(3, 12), 1),
                    'intensity': round(rng.uniform(0.2, 0.7), 3),
                    'wind_speed_ms': round(rng.uniform(30, 180), 1),
                })

        return {
            'equator_k': equator_t,
            'polar_k': polar_t,
            'day_night_contrast': round(equator_t * (0.12 - atm_factor * 0.08), 1),
            'heat_redistribution': round(atm_factor, 3),
            'pattern': 'banded' if is_gas else 'latitudinal',
            'storms': storms,
        }


def _compute_mineral_abundance(ptype, mass_e, rad_e, temp_k, sma, metallicity, rng):
    """Compute element/mineral abundance for a planet.

    Modeled after real planetary geochemistry:
    - KREEP (K, REE, P) — enriched in late-stage igneous differentiation
    - Siderophiles (Fe, Ni, Co, PGMs) — concentrated in cores
    - Lithophiles (Si, Al, Ca, Na, K) — in crusts/mantles
    - Chalcophiles (Cu, Zn, S) — in sulfide ores
    - Volatiles (H₂O, CO₂, NH₃, CH₄) — distance-dependent
    - Atmophiles (N, noble gases) — mass-dependent retention

    Returns dict with element abundances (mass fraction), KREEP index,
    and notable deposits.
    """
    is_gas = ptype in ('gas-giant', 'super-jupiter', 'hot-jupiter',
                       'neptune-like', 'warm-neptune', 'mini-neptune', 'sub-neptune')
    met = metallicity if metallicity else 0.0
    met_factor = 10 ** met  # solar = 1.0, high met = enriched

    if is_gas:
        # Gas giants: H/He dominated, some metals in core
        return {
            'class': 'gas_envelope',
            'hydrogen_pct': round(73 + rng.uniform(0, 12), 1),
            'helium_pct': round(24 + rng.uniform(-3, 4), 1),
            'metals_pct': round(rng.uniform(0.5, 3.0) * met_factor, 2),
            'water_ice_pct': round(rng.uniform(0.01, 0.5) * (1 if sma > 2 else 0.1), 3),
            'ammonia_pct': round(rng.uniform(0.001, 0.1), 4),
            'methane_pct': round(rng.uniform(0.01, 0.3), 4),
            'core_metals': {
                'iron_pct': round(rng.uniform(5, 25) * met_factor, 1),
                'silicate_pct': round(rng.uniform(20, 50), 1),
                'water_pct': round(rng.uniform(10, 40), 1),
            },
            'kreep_index': 0,
            'mining_viability': 'none',
            'notable': ['atmospheric_helium3'] if rng.random() < 0.3 else [],
        }
    elif ptype in ('neptune-like', 'warm-neptune', 'mini-neptune', 'sub-neptune'):
        return {
            'class': 'ice_gas_envelope',
            'water_ice_pct': round(rng.uniform(30, 60), 1),
            'hydrogen_pct': round(rng.uniform(10, 25), 1),
            'helium_pct': round(rng.uniform(5, 15), 1),
            'ammonia_pct': round(rng.uniform(2, 10), 1),
            'methane_pct': round(rng.uniform(1, 8), 1),
            'rock_pct': round(rng.uniform(15, 30) * met_factor, 1),
            'kreep_index': 0,
            'mining_viability': 'low',
            'notable': [],
        }

    # ── Solid worlds ──
    density = mass_e / max(rad_e ** 3, 0.001)  # relative to Earth

    # Iron/nickel core fraction (siderophile concentration)
    if ptype == 'iron-planet':
        iron_pct = round(60 + rng.uniform(0, 20), 1)
        nickel_pct = round(5 + rng.uniform(0, 8), 1)
    elif ptype in ('rocky', 'earth-like', 'super-earth'):
        iron_pct = round(28 + density * 5 + rng.uniform(-5, 8) * met_factor, 1)
        nickel_pct = round(1.5 + rng.uniform(0, 2) * met_factor, 1)
    elif ptype == 'carbon-planet':
        iron_pct = round(15 + rng.uniform(0, 10), 1)
        nickel_pct = round(1 + rng.uniform(0, 2), 1)
    else:
        iron_pct = round(20 + rng.uniform(-8, 15) * met_factor, 1)
        nickel_pct = round(1 + rng.uniform(0, 3), 1)

    # Silicates (mantle)
    silicate_pct = round(max(5, 100 - iron_pct - nickel_pct - rng.uniform(5, 20)), 1)

    # KREEP — enriched in differentiated bodies (like lunar mare basalts)
    # Higher in geologically active or recently differentiated worlds
    kreep_base = 0.05 if mass_e < 0.01 else 0.15 if mass_e < 0.1 else 0.35
    if temp_k > 500:
        kreep_base *= 1.3  # thermal processing concentrates incompatibles
    kreep_index = round(min(1.0, kreep_base * met_factor * rng.uniform(0.6, 1.5)), 3)

    # Volatiles — distance from star
    frost_line = 2.7  # AU, rough water ice line
    if sma > frost_line:
        water_ice_pct = round(rng.uniform(10, 45) * min(sma / frost_line, 3), 1)
        co2_ice_pct = round(rng.uniform(1, 8), 1)
        nh3_pct = round(rng.uniform(0.1, 3), 2)
    elif sma > frost_line * 0.5:
        water_ice_pct = round(rng.uniform(0.5, 8), 2)
        co2_ice_pct = round(rng.uniform(0.1, 2), 2)
        nh3_pct = round(rng.uniform(0.01, 0.3), 3)
    else:
        water_ice_pct = round(rng.uniform(0.001, 0.5), 3)
        co2_ice_pct = round(rng.uniform(0, 0.3), 3)
        nh3_pct = 0.0

    # Special compositions
    if ptype == 'ocean-world' or ptype == 'hycean':
        water_ice_pct = round(max(water_ice_pct, 40 + rng.uniform(0, 30)), 1)

    if ptype == 'ice-dwarf':
        water_ice_pct = round(max(water_ice_pct, 50 + rng.uniform(0, 30)), 1)
        silicate_pct = round(max(5, silicate_pct * 0.3), 1)

    # Trace metals & strategic minerals
    copper_ppm = round(rng.uniform(20, 120) * met_factor, 1)
    titanium_ppm = round(rng.uniform(3000, 8000) * met_factor, 0)
    aluminum_pct = round(rng.uniform(6, 10) * met_factor, 2)
    uranium_ppb = round(rng.uniform(10, 80) * met_factor * kreep_index, 1)
    thorium_ppb = round(rng.uniform(30, 200) * met_factor * kreep_index, 1)
    rare_earth_ppm = round(rng.uniform(50, 300) * met_factor * kreep_index, 1)
    platinum_group_ppb = round(rng.uniform(1, 20) * met_factor * density, 1)

    # Carbon planet specials
    if ptype == 'carbon-planet':
        carbon_pct = round(30 + rng.uniform(0, 25), 1)
        silicate_pct = round(max(5, silicate_pct - carbon_pct), 1)
    else:
        carbon_pct = round(rng.uniform(0.01, 0.5), 3)

    # Mining viability assessment
    if is_gas:
        viability = 'none'
    elif ptype in ('lava-world',) and temp_k > 1500:
        viability = 'extreme_hazard'
    elif ptype == 'iron-planet':
        viability = 'excellent_metals'
    elif ptype == 'carbon-planet':
        viability = 'excellent_carbon'
    elif kreep_index > 0.5 and iron_pct > 25:
        viability = 'high'
    elif water_ice_pct > 20:
        viability = 'strategic_water'
    elif rare_earth_ppm > 200:
        viability = 'strategic_rare_earth'
    else:
        viability = 'moderate' if iron_pct > 20 else 'low'

    notable = []
    if platinum_group_ppb > 10:
        notable.append('pgm_deposits')
    if rare_earth_ppm > 200:
        notable.append('rare_earth_enriched')
    if uranium_ppb > 50:
        notable.append('fissile_deposits')
    if water_ice_pct > 30:
        notable.append('water_rich')
    if ptype == 'carbon-planet':
        notable.append('diamond_mantle')
    if kreep_index > 0.6:
        notable.append('kreep_terrane')

    return {
        'class': 'solid_differentiated' if density > 0.7 else 'solid_primitive',
        'iron_pct': min(iron_pct, 80),
        'nickel_pct': min(nickel_pct, 15),
        'silicate_pct': min(silicate_pct, 70),
        'aluminum_pct': aluminum_pct,
        'carbon_pct': carbon_pct,
        'water_ice_pct': min(water_ice_pct, 80),
        'co2_ice_pct': co2_ice_pct,
        'ammonia_pct': nh3_pct,
        'copper_ppm': copper_ppm,
        'titanium_ppm': titanium_ppm,
        'uranium_ppb': uranium_ppb,
        'thorium_ppb': thorium_ppb,
        'rare_earth_ppm': rare_earth_ppm,
        'platinum_group_ppb': platinum_group_ppb,
        'kreep_index': kreep_index,
        'mining_viability': viability,
        'notable': notable,
    }


def _enrich_planet_physics(planet, star_spec_class, star_luminosity, rng=None):
    """Enrich any planet dict with tidal lock, temp distribution, and mineral abundance
    data. Works for both observed and inferred planets."""
    import random as _rmod
    if rng is None:
        rng = _rmod.Random(hash(planet.get('planet_name', '')) & 0xFFFFFFFF)

    sma = planet.get('semi_major_axis_au') or 1.0
    ecc = planet.get('eccentricity') or 0.0
    mass_e = planet.get('mass_earth')
    temp_k = planet.get('temp_calculated_k') or 288
    p_type = planet.get('planet_type', 'rocky')
    period_days = planet.get('orbital_period_days')
    luminosity = star_luminosity if star_luminosity else 1.0

    # ── Tidal lock determination ──
    if 'tidally_locked' not in planet or planet.get('tidally_locked') is None:
        spc = (star_spec_class or 'G')[0].upper()
        # Tidal lock radius depends primarily on stellar mass (which correlates
        # with spectral class) and system age. M-dwarfs lock planets out to
        # ~0.3-0.5 AU over Gyr timescales.
        tidal_lock_radius = 0.0
        if spc == 'M':
            tidal_lock_radius = 0.40  # Most M-dwarf close-in planets are locked
        elif spc == 'K':
            tidal_lock_radius = 0.15
        elif spc == 'G':
            tidal_lock_radius = 0.06
        elif spc == 'F':
            tidal_lock_radius = 0.03
        planet['tidally_locked'] = bool(sma < tidal_lock_radius)

    # ── Spin-orbit resonance ──
    if 'spin_orbit_resonance' not in planet or planet.get('spin_orbit_resonance') is None:
        if planet['tidally_locked']:
            if ecc > 0.1 and rng.random() < 0.35:
                planet['spin_orbit_resonance'] = '3:2'
            else:
                planet['spin_orbit_resonance'] = '1:1'
        else:
            planet['spin_orbit_resonance'] = None

    # ── Rotation period ──
    if 'rotation_period_days' not in planet or planet.get('rotation_period_days') is None:
        if planet['tidally_locked'] and period_days:
            ratio = planet['spin_orbit_resonance']
            if ratio == '3:2':
                planet['rotation_period_days'] = round(period_days * (2.0 / 3.0), 3)
            else:
                planet['rotation_period_days'] = round(period_days, 3)
        else:
            # Estimate free rotation from type
            GAS = {'gas-giant', 'hot-jupiter', 'warm-neptune', 'cold-giant', 'super-jupiter'}
            ICE = {'ice-giant', 'mini-neptune'}
            if p_type in GAS:
                planet['rotation_period_days'] = round(rng.uniform(0.33, 0.58), 3)
            elif p_type in ICE:
                planet['rotation_period_days'] = round(rng.uniform(0.5, 0.75), 3)
            elif mass_e and mass_e > 5:
                planet['rotation_period_days'] = round(rng.uniform(0.6, 1.8), 3)
            else:
                planet['rotation_period_days'] = round(rng.uniform(0.8, 2.5), 3)

    # ── Temperature distribution ──
    if 'temp_distribution' not in planet or not planet.get('temp_distribution'):
        # Estimate atmosphere thickness for heat redistribution
        GAS = {'gas-giant', 'hot-jupiter', 'warm-neptune', 'cold-giant', 'super-jupiter'}
        ICE = {'ice-giant', 'mini-neptune'}
        THICK = {'earth-like', 'super-earth', 'ocean-world', 'hycean'}
        if p_type in GAS:
            atm_est = 0.8
        elif p_type in ICE:
            atm_est = 0.7
        elif p_type in THICK:
            atm_est = 0.55
        elif p_type in {'rocky', 'lava-world'}:
            atm_est = 0.15
        else:
            atm_est = 0.05
        planet['temp_distribution'] = _compute_temp_distribution(
            temp_k, planet['tidally_locked'], planet['spin_orbit_resonance'],
            p_type, mass_e or 1.0, atm_est, ecc, rng
        )

    # ── Mineral abundance ──
    if 'mineral_abundance' not in planet or not planet.get('mineral_abundance'):
        radius_e = planet.get('radius_earth') or 1.0
        planet['mineral_abundance'] = _compute_mineral_abundance(
            p_type, mass_e or 1.0, radius_e, temp_k, sma or 1.0, 0.0, rng
        )


def _detect_resonance_chains(planets, rng):
    """Detect and optionally snap near-resonant adjacent planet pairs.

    Checks period ratios for 2:1, 3:2, 4:3, 5:3, 5:2 resonances.
    If a pair is close to resonance, snap them with 30% probability.
    """
    resonance_ratios = [
        (2.0, 1.0, '2:1'), (3.0, 2.0, '3:2'), (4.0, 3.0, '4:3'),
        (5.0, 3.0, '5:3'), (5.0, 2.0, '5:2'),
    ]
    for i in range(len(planets) - 1):
        p_inner = planets[i]
        p_outer = planets[i + 1]
        per_i = p_inner.get('orbital_period_days') or 1
        per_o = p_outer.get('orbital_period_days') or 1
        if per_i <= 0:
            continue
        ratio = per_o / per_i

        for p, q, label in resonance_ratios:
            ideal = p / q
            if abs(ratio - ideal) / ideal < 0.08:  # within 8%
                # Mark resonance
                p_inner.setdefault('resonances', []).append({
                    'partner': p_outer['planet_name'],
                    'ratio': label,
                    'role': 'inner',
                })
                p_outer.setdefault('resonances', []).append({
                    'partner': p_inner['planet_name'],
                    'ratio': label,
                    'role': 'outer',
                })
                # Snap to exact resonance 30% of the time
                if rng.random() < 0.30:
                    p_outer['orbital_period_days'] = round(per_i * ideal, 2)
                    # Recompute SMA from snapped period: a = (P^2 * M)^(1/3)
                    new_per_yr = p_outer['orbital_period_days'] / 365.25
                    p_outer['semi_major_axis_au'] = round(new_per_yr ** (2.0/3.0), 4)
                    p_outer.setdefault('sub_type_flags', []).append('resonance_locked')
                # Enhanced tidal heating on inner body
                p_inner.setdefault('sub_type_flags', []).append('resonance_tidal_heating')
                break


def _generate_ring_system(planet_rec, rng):
    """Generate a ring system for a planet based on its type and orbit."""
    ptype = planet_rec.get('planet_type', '')
    mass = planet_rec.get('mass_earth', 0)
    sma = planet_rec.get('semi_major_axis_au', 1.0)
    rad_e = planet_rec.get('radius_earth', 1.0)

    # Determine ring probability
    if ptype in ('gas-giant', 'super-jupiter'):
        prob = 0.80 if sma > 1.0 else 0.10
    elif ptype in ('neptune-like', 'warm-neptune', 'mini-neptune'):
        prob = 0.60
    elif ptype == 'super-earth' and mass > 3.0:
        prob = 0.05
    elif ptype in ('rocky', 'earth-like'):
        prob = 0.02
    else:
        prob = 0.0

    if rng.random() > prob:
        return None

    # Ring extent: 1.2–3.0 Roche limits from planet center
    roche_limit_re = 2.46 * rad_e  # Roche limit in Earth radii (rough)
    inner_re = round(roche_limit_re * rng.uniform(0.5, 0.8), 2)
    outer_re = round(roche_limit_re * rng.uniform(1.5, 3.0), 2)

    # Number of major ring bands
    n_rings = rng.randint(2, 5) if ptype in ('gas-giant', 'super-jupiter') else rng.randint(1, 3)

    rings = []
    gap_positions = []
    ring_extent = outer_re - inner_re
    step = ring_extent / (n_rings + 1)

    for r in range(n_rings):
        r_inner = round(inner_re + r * step, 2)
        r_outer = round(inner_re + (r + 1) * step, 2)
        # Composition: inner rings rocky, outer rings icy
        frac = (r_inner - inner_re) / max(ring_extent, 0.01)
        comp = 'rocky' if frac < 0.4 else 'icy' if frac > 0.7 else 'mixed'
        rings.append({
            'name': chr(ord('A') + r),
            'inner_radius_re': r_inner,
            'outer_radius_re': r_outer,
            'composition': comp,
            'optical_depth': round(rng.uniform(0.1, 2.0), 2),
        })
        if r < n_rings - 1:
            gap_positions.append({
                'name': f"Gap {r+1}",
                'position_re': round(r_outer + step * 0.1, 2),
                'width_re': round(step * rng.uniform(0.05, 0.2), 3),
            })

    # Shepherd moons: 1-3 tiny moons embedded in ring gaps
    shepherds = []
    n_shep = rng.randint(1, min(3, len(gap_positions) + 1))
    for s in range(n_shep):
        s_pos = rng.uniform(inner_re, outer_re)
        shepherds.append({
            'name': f"Shepherd-{s+1}",
            'orbital_radius_re': round(s_pos, 2),
            'diameter_km': round(rng.uniform(5, 80), 1),
        })

    return {
        'inner_radius_re': inner_re,
        'outer_radius_re': outer_re,
        'ring_count': n_rings,
        'rings': rings,
        'gaps': gap_positions,
        'shepherd_moons': shepherds,
        'total_mass_fraction': round(rng.uniform(1e-8, 1e-4), 10),
    }


# ── Belt generation with resonance gaps, families, Trojans ─────────

def _infer_belts_for_star(main_id, spectral_class, luminosity, planets=None):
    """Generate asteroid/debris belts with resonance structure.

    Improvements over v1:
      - Kirkwood-style resonance gaps computed from nearest gas giant
      - Asteroid family clusters (collisional families)
      - Trojan swarms at L4/L5 of gas giants
      - Ice dwarf population in scattered disc
    """
    rng = _random.Random(_deterministic_seed(main_id) + 7919)
    prior = _INF_STELLAR_PRIORS.get(spectral_class, _INF_STELLAR_PRIORS['G'])

    if rng.random() > prior['belt_prob']:
        return []

    lum_scale = math.sqrt(max(luminosity, 0.0001))
    belts = []
    planets = planets or []

    # Find gas giants for resonance gap calculation
    giants = [p for p in planets
              if p.get('planet_type') in ('gas-giant', 'super-jupiter', 'hot-jupiter')]
    giant_sma = [g.get('semi_major_axis_au') or g.get('pl_orbsmax') or 5.0 for g in giants]

    # ── Inner rocky-asteroid belt (2.2-3.2 AU analog) ──
    if rng.random() < 0.90:
        inner = round(1.5 * lum_scale, 2)
        outer = round(3.2 * lum_scale, 2)
        gaps = _compute_resonance_gaps(inner, outer, giant_sma, rng)
        families = _generate_families(main_id, 'inner', inner, outer, rng)
        belts.append({
            'belt_id': f"{main_id}_belt_inner",
            'belt_type': 'rocky-asteroid',
            'inner_radius_au': inner,
            'outer_radius_au': outer,
            'estimated_bodies': rng.randint(50000, 500000),
            'confidence': 'inferred',
            'resonance_gaps': gaps,
            'families': families,
            'major_asteroids': _generate_asteroids(main_id, 'inner', inner, outer, rng, gaps),
        })

    # ── Outer icy belt (Kuiper-belt analog) ──
    if rng.random() < 0.90:
        inner = round(20.0 * lum_scale, 2)
        outer = round(50.0 * lum_scale, 2)
        gaps = _compute_resonance_gaps(inner, outer, giant_sma, rng)
        families = _generate_families(main_id, 'kuiper', inner, outer, rng, icy=True)
        belts.append({
            'belt_id': f"{main_id}_belt_outer",
            'belt_type': 'icy-kuiper',
            'inner_radius_au': inner,
            'outer_radius_au': outer,
            'estimated_bodies': rng.randint(100000, 1000000),
            'confidence': 'inferred',
            'resonance_gaps': gaps,
            'families': families,
            'major_asteroids': _generate_asteroids(main_id, 'outer', inner, outer, rng, gaps),
            'ice_dwarfs': _generate_ice_dwarfs(main_id, inner, outer, rng),
        })

    # ── Hilda/Hungaria analog belt ──
    if rng.random() < 0.50:
        inner2 = round(0.8 * lum_scale, 2)
        outer2 = round(1.4 * lum_scale, 2)
        belts.append({
            'belt_id': f"{main_id}_belt_hilda",
            'belt_type': 'rocky-asteroid',
            'inner_radius_au': inner2,
            'outer_radius_au': outer2,
            'estimated_bodies': rng.randint(10000, 100000),
            'confidence': 'inferred',
            'resonance_gaps': [],
            'families': [],
            'major_asteroids': _generate_asteroids(main_id, 'hilda', inner2, outer2, rng),
        })

    # ── Scattered disc (beyond Kuiper) ──
    if rng.random() < 0.40:
        inner3 = round(50.0 * lum_scale, 2)
        outer3 = round(150.0 * lum_scale, 2)
        belts.append({
            'belt_id': f"{main_id}_belt_scattered",
            'belt_type': 'scattered-disc',
            'inner_radius_au': inner3,
            'outer_radius_au': outer3,
            'estimated_bodies': rng.randint(50000, 500000),
            'confidence': 'inferred',
            'resonance_gaps': [],
            'families': [],
            'major_asteroids': _generate_asteroids(main_id, 'scattered', inner3, outer3, rng),
            'ice_dwarfs': _generate_ice_dwarfs(main_id, inner3, outer3, rng, count_range=(1, 4)),
        })

    # ── Trojan swarms for gas giants ──
    trojans = _generate_trojans(main_id, planets, rng)
    if trojans:
        belts.extend(trojans)

    return belts


def _compute_resonance_gaps(belt_inner, belt_outer, giant_sma_list, rng):
    """Compute Kirkwood-style resonance gaps from nearby gas giants.

    For each giant, compute mean-motion resonance positions:
      a_res = a_giant × (p/q)^(2/3)
    If the position falls within the belt, create a gap.
    """
    resonances = [
        (4, 1, 'narrow'), (3, 1, 'wide'), (5, 2, 'moderate'),
        (7, 3, 'narrow'), (2, 1, 'wide'), (5, 3, 'narrow'),
    ]
    gaps = []

    for a_giant in giant_sma_list:
        if a_giant is None or a_giant <= 0:
            continue
        for p, q, width_class in resonances:
            a_res = a_giant * (q / p) ** (2.0 / 3.0)
            if belt_inner < a_res < belt_outer:
                width_map = {'narrow': 0.02, 'moderate': 0.05, 'wide': 0.08}
                base_width = width_map.get(width_class, 0.03)
                gaps.append({
                    'resonance': f"{p}:{q}",
                    'position_au': round(a_res, 3),
                    'width_au': round(base_width * (belt_outer - belt_inner), 3),
                    'width_class': width_class,
                    'shaping_planet_sma': round(a_giant, 3),
                })

    return gaps


def _generate_families(main_id, belt_tag, inner_au, outer_au, rng, icy=False):
    """Generate collisional asteroid family clusters within a belt."""
    n_families = rng.randint(1, 4)
    family_types = (
        [('carbonaceous', 'C'), ('basaltic', 'V'), ('metallic', 'M'), ('icy', 'D')]
        if icy else
        [('carbonaceous', 'C'), ('basaltic', 'V'), ('metallic', 'M'), ('siliceous', 'S')]
    )
    families = []
    for f in range(n_families):
        ftype, spec = rng.choice(family_types)
        center = round(rng.uniform(inner_au, outer_au), 3)
        spread = round(rng.uniform(0.03, 0.08), 3)
        parent_diam = round(rng.uniform(100, 600), 1)
        member_count = rng.randint(80, 500)
        families.append({
            'name': f"{main_id}-{belt_tag[0].upper()}F{f+1}",
            'family_type': ftype,
            'spectral_class': spec,
            'center_au': center,
            'spread_au': spread,
            'parent_diameter_km': parent_diam,
            'member_count': member_count,
        })
    return families


def _generate_asteroids(main_id, belt_tag, inner_au, outer_au, rng, gaps=None):
    """Generate major asteroid bodies, avoiding resonance gaps."""
    n = rng.randint(8, 25)
    classes = ['C', 'S', 'M', 'C', 'C', 'S', 'C', 'B', 'D']
    asteroids = []
    gap_zones = [(g['position_au'] - g['width_au']/2, g['position_au'] + g['width_au']/2)
                 for g in (gaps or [])]

    for j in range(n):
        # Pick SMA, retry if in a gap
        for _attempt in range(5):
            sma = round(rng.uniform(inner_au, outer_au), 3)
            in_gap = any(lo <= sma <= hi for lo, hi in gap_zones)
            if not in_gap:
                break

        diameter_km = round(rng.uniform(50, 500) if j < 3 else rng.uniform(10, 150), 1)
        ecc = round(rng.uniform(0.01, 0.3), 3)
        inc = round(rng.gauss(0, 8.0), 2)
        asteroids.append({
            'name': f"{main_id} {belt_tag[0].upper()}{j+1:02d}",
            'semi_major_axis_au': sma,
            'diameter_km': diameter_km,
            'eccentricity': ecc,
            'inclination_deg': inc,
            'spectral_class': rng.choice(classes),
            'confidence': 'inferred',
        })
    asteroids.sort(key=lambda a: a['diameter_km'], reverse=True)
    return asteroids


def _generate_ice_dwarfs(main_id, inner_au, outer_au, rng, count_range=(3, 8)):
    """Generate Pluto-class ice dwarf objects within a belt/disc region."""
    n = rng.randint(*count_range)
    dwarfs = []
    for i in range(n):
        mass = round(rng.uniform(0.001, 0.05), 4)
        radius = round(mass ** 0.27, 3) if mass > 0 else 0.1
        sma = round(rng.uniform(inner_au, outer_au), 2)
        ecc = round(rng.uniform(0.05, 0.45), 3)
        inc = round(abs(rng.gauss(0, 15.0)), 2)
        # Surface composition: N2 ice, methane frost, tholins
        surfaces = ['nitrogen-ice', 'methane-frost', 'tholin-dark', 'water-ice', 'co-ice']
        dwarfs.append({
            'name': f"{main_id} KBO-{i+1}",
            'planet_type': 'ice-dwarf',
            'mass_earth': mass,
            'radius_earth': radius,
            'semi_major_axis_au': sma,
            'eccentricity': ecc,
            'inclination_deg': inc,
            'surface_type': rng.choice(surfaces),
            'diameter_km': round(radius * 12742, 0),  # Re = 6371 km
            'has_companion': rng.random() < 0.15,  # binary ice dwarfs like Pluto-Charon
            'confidence': 'inferred',
        })
    dwarfs.sort(key=lambda d: d['mass_earth'], reverse=True)
    return dwarfs


def _generate_trojans(main_id, planets, rng):
    """Generate Trojan swarms at L4/L5 for gas giants."""
    trojans = []
    for p in planets:
        ptype = p.get('planet_type', '')
        sma = p.get('semi_major_axis_au') or p.get('pl_orbsmax') or 0
        if ptype not in ('gas-giant', 'super-jupiter') or not sma or sma < 1.0:
            continue
        if rng.random() > 0.70:  # 70% of gas giants have Trojans
            continue

        pname = p.get('planet_name') or p.get('pl_name') or 'unknown'
        n_bodies = rng.randint(200, 5000)
        for lagrange in ['L4', 'L5']:
            base_angle = 60.0 if lagrange == 'L4' else -60.0
            trojans.append({
                'belt_id': f"{main_id}_{pname.split()[-1]}_{lagrange}",
                'belt_type': 'trojan-swarm',
                'lagrange_point': lagrange,
                'parent_planet': pname,
                'parent_sma_au': sma,
                'angular_offset_deg': base_angle,
                'angular_spread_deg': round(rng.uniform(10, 20), 1),
                'inclination_spread_deg': round(rng.uniform(10, 25), 1),
                'estimated_bodies': n_bodies,
                'inner_radius_au': round(sma * 0.92, 2),
                'outer_radius_au': round(sma * 1.08, 2),
                'confidence': 'inferred',
                'major_asteroids': [],
            })
    return trojans


# ── Moon generation with 8-type taxonomy ──────────────────────────

_MOON_TYPE_RULES = {
    # (moon_type, conditions_func, probability_boost)
    'volcanic':         lambda k, n, ptype, sma, mass: k == 0 and ptype in ('gas-giant', 'super-jupiter'),
    'ice-shell':        lambda k, n, ptype, sma, mass: k in (1, 2) and ptype in ('gas-giant', 'super-jupiter', 'neptune-like'),
    'atmosphere-moon':  lambda k, n, ptype, sma, mass: mass > 0.01 and sma > 3.0,
    'ocean-moon':       lambda k, n, ptype, sma, mass: k in (1, 2, 3) and sma > 2.0,
    'cratered-airless': lambda k, n, ptype, sma, mass: True,  # default fallback
    'captured-irregular': lambda k, n, ptype, sma, mass: k >= n - 2 and n > 3,
    'shepherd':         lambda k, n, ptype, sma, mass: mass < 0.0001,
    'binary-moon':      lambda k, n, ptype, sma, mass: False,  # rare, handled specially
}


def _classify_moon_type(k, n_total, parent_type, parent_sma, moon_mass, rng):
    """Assign a moon type based on orbital position and parent planet."""
    # Innermost moon of gas giant: volcanic (Io analog)
    if k == 0 and parent_type in ('gas-giant', 'super-jupiter') and rng.random() < 0.65:
        return 'volcanic'

    # Second/third moon of gas giant: ice-shell (Europa/Enceladus analog)
    if k in (1, 2) and parent_type in ('gas-giant', 'super-jupiter') and rng.random() < 0.55:
        return 'ice-shell'

    # Large moon far from star: atmosphere (Titan analog)
    if moon_mass > 0.01 and parent_sma > 4.0 and rng.random() < 0.20:
        return 'atmosphere-moon'

    # Mid-orbit moons: ocean moon (subsurface)
    if k in (1, 2, 3) and parent_sma > 2.0 and parent_type in ('gas-giant', 'super-jupiter', 'neptune-like'):
        if rng.random() < 0.30:
            return 'ocean-moon'

    # Outer irregular moons: captured
    if k >= n_total - 2 and n_total > 4 and rng.random() < 0.40:
        return 'captured-irregular'

    # Very tiny moons: shepherd type
    if moon_mass < 0.0001 and rng.random() < 0.30:
        return 'shepherd'

    # Binary moon: very rare
    if rng.random() < 0.03:
        return 'binary-moon'

    # Default
    return 'cratered-airless'


def _infer_moons_for_planet(planet_rec, star_name, rng):
    """Generate moons with 8-type classification and tidal heating.

    Moon types: volcanic, ice-shell, atmosphere-moon, ocean-moon,
    cratered-airless, captured-irregular, shepherd, binary-moon.
    """
    ptype = planet_rec.get('planet_type', 'unknown')
    mass = planet_rec.get('mass_earth') or 0
    sma_planet = planet_rec.get('semi_major_axis_au') or 1.0

    if ptype in ('sub-earth', 'ice-dwarf') or mass < 0.05:
        return

    # Moon count by planet type
    if ptype == 'super-jupiter':
        n = rng.randint(8, 20)
    elif ptype in ('gas-giant', 'hot-jupiter'):
        n = rng.randint(4, 16) if ptype == 'gas-giant' else rng.randint(0, 3)
    elif ptype in ('neptune-like', 'warm-neptune', 'mini-neptune'):
        n = rng.randint(2, 8)
    elif ptype in ('super-earth', 'hycean', 'sub-neptune'):
        n = rng.randint(0, 3)
    elif ptype in ('rocky', 'earth-like', 'eyeball-world', 'ocean-world', 'desert-world'):
        n = rng.randint(0, 2) if rng.random() < 0.6 else 0
    elif ptype == 'lava-world':
        n = 0  # too close to star
    elif ptype in ('iron-planet', 'carbon-planet', 'chthonian'):
        n = rng.randint(0, 1)
    else:
        n = 1 if rng.random() < 0.35 else 0

    moons = []
    for k in range(n):
        hill_frac = rng.uniform(0.002, 0.02)
        moon_orbit_au = round(sma_planet * hill_frac * (k + 1), 6)

        # Moon mass
        if ptype in ('gas-giant', 'super-jupiter', 'neptune-like', 'warm-neptune', 'mini-neptune'):
            moon_mass_frac = rng.uniform(0.0001, 0.02)
        else:
            moon_mass_frac = rng.uniform(0.001, 0.05)
        moon_mass = round(mass * moon_mass_frac, 4)
        moon_radius = round(moon_mass ** 0.27 if moon_mass > 0 else 0.1, 3)

        # Classify moon type
        moon_type = _classify_moon_type(k, n, ptype, sma_planet, moon_mass, rng)

        # Tidal heating estimate (0-1 scale)
        tidal_heating = 0.0
        if k < 3 and ptype in ('gas-giant', 'super-jupiter'):
            # Closer moons get more tidal heating (Io is ~0.9)
            tidal_heating = round(max(0, 0.9 - k * 0.35) * rng.uniform(0.6, 1.0), 2)

        # Sub-type flags for moons
        moon_flags = []
        if moon_type == 'volcanic':
            moon_flags.extend(['sulfur_eruptions', 'lava_lakes', 'tidal_flexing'])
        elif moon_type == 'ice-shell':
            moon_flags.extend(['subsurface_ocean', 'cracked_ice', 'possible_geysers'])
        elif moon_type == 'atmosphere-moon':
            moon_flags.extend(['thick_haze', 'hydrocarbon_lakes', 'cryogenic_surface'])
        elif moon_type == 'ocean-moon':
            moon_flags.extend(['subsurface_ocean', 'rocky_interior'])
        elif moon_type == 'captured-irregular':
            moon_flags.extend(['retrograde_orbit', 'high_inclination', 'irregular_shape'])
        elif moon_type == 'binary-moon':
            moon_flags.extend(['tidally_locked_pair', 'shared_barycenter'])

        # Orbital properties for irregular captured moons
        if moon_type == 'captured-irregular':
            ecc = round(rng.uniform(0.2, 0.5), 3)
            inc = round(rng.uniform(30, 170), 1)  # possibly retrograde
        else:
            ecc = round(rng.uniform(0.0, 0.05), 3)
            inc = round(rng.gauss(0, 2.0), 1)

        letter = chr(ord('a') + k) if k < 26 else str(k)
        moons.append({
            'moon_name': f"{planet_rec['planet_name']} {letter}",
            'orbital_radius_au': moon_orbit_au,
            'mass_earth': moon_mass,
            'radius_earth': moon_radius,
            'moon_type': moon_type,
            'tidal_heating': tidal_heating,
            'eccentricity': ecc,
            'inclination_deg': inc,
            'sub_type_flags': moon_flags,
            'confidence': 'inferred',
        })
    planet_rec['moons'] = moons


# ── Sol's planetary system (hardcoded, authoritative) ─────────────

_SOL_PLANETS = [
    {'planet_name': 'Mercury', 'planet_status': 'Confirmed', 'mass_earth': 0.055, 'mass_source': 'true_mass',
     'radius_earth': 0.383, 'semi_major_axis_au': 0.387, 'orbital_period_days': 87.97, 'eccentricity': 0.206,
     'inclination_deg': 7.0, 'temp_calculated_k': 440, 'temp_measured_k': 440, 'geometric_albedo': 0.142,
     'detection_type': 'Direct', 'molecules': None, 'discovered': 'Antiquity',
     'planet_type': 'iron-planet', 'sub_type_flags': ['stripped_mantle', 'metallic_surface', 'tidally_locked'],
     'tidally_locked': True, 'confidence': 'observed', 'moons': [], 'ring_system': None},
    {'planet_name': 'Venus', 'planet_status': 'Confirmed', 'mass_earth': 0.815, 'mass_source': 'true_mass',
     'radius_earth': 0.949, 'semi_major_axis_au': 0.723, 'orbital_period_days': 224.7, 'eccentricity': 0.007,
     'inclination_deg': 3.4, 'temp_calculated_k': 737, 'temp_measured_k': 737, 'geometric_albedo': 0.689,
     'detection_type': 'Direct', 'molecules': 'CO2, N2, SO2', 'discovered': 'Antiquity',
     'planet_type': 'rocky', 'sub_type_flags': ['thick_atmosphere', 'greenhouse_runaway'],
     'tidally_locked': False, 'confidence': 'observed', 'moons': [], 'ring_system': None},
    {'planet_name': 'Earth', 'planet_status': 'Confirmed', 'mass_earth': 1.0, 'mass_source': 'true_mass',
     'radius_earth': 1.0, 'semi_major_axis_au': 1.0, 'orbital_period_days': 365.25, 'eccentricity': 0.017,
     'inclination_deg': 0.0, 'temp_calculated_k': 288, 'temp_measured_k': 288, 'geometric_albedo': 0.367,
     'detection_type': 'Direct', 'molecules': 'N2, O2, Ar, CO2, H2O', 'discovered': 'Antiquity',
     'planet_type': 'earth-like', 'sub_type_flags': ['habitable_zone', 'possible_biosignatures', 'plate_tectonics', 'global_ocean'],
     'tidally_locked': False, 'confidence': 'observed', 'ring_system': None,
     'moons': [{'moon_name': 'Moon', 'orbital_radius_au': 0.00257, 'mass_earth': 0.0123, 'radius_earth': 0.273,
                'moon_type': 'cratered-airless', 'tidal_heating': 0.0, 'eccentricity': 0.0549, 'inclination_deg': 5.15,
                'sub_type_flags': ['synchronous_rotation', 'impact_origin'], 'confidence': 'observed'}]},
    {'planet_name': 'Mars', 'planet_status': 'Confirmed', 'mass_earth': 0.107, 'mass_source': 'true_mass',
     'radius_earth': 0.532, 'semi_major_axis_au': 1.524, 'orbital_period_days': 687.0, 'eccentricity': 0.093,
     'inclination_deg': 1.85, 'temp_calculated_k': 210, 'temp_measured_k': 210, 'geometric_albedo': 0.170,
     'detection_type': 'Direct', 'molecules': 'CO2, N2, Ar', 'discovered': 'Antiquity',
     'planet_type': 'desert-world', 'sub_type_flags': ['thin_atmosphere', 'ancient_ocean', 'polar_ice_caps'],
     'tidally_locked': False, 'confidence': 'observed', 'ring_system': None,
     'moons': [
         {'moon_name': 'Phobos', 'orbital_radius_au': 0.0000627, 'mass_earth': 0.0000000018, 'radius_earth': 0.00175,
          'moon_type': 'captured-irregular', 'tidal_heating': 0.0, 'eccentricity': 0.015, 'inclination_deg': 1.08,
          'sub_type_flags': ['irregular_shape', 'tidally_decaying'], 'confidence': 'observed'},
         {'moon_name': 'Deimos', 'orbital_radius_au': 0.000157, 'mass_earth': 0.00000000025, 'radius_earth': 0.00098,
          'moon_type': 'captured-irregular', 'tidal_heating': 0.0, 'eccentricity': 0.0002, 'inclination_deg': 1.79,
          'sub_type_flags': ['irregular_shape'], 'confidence': 'observed'},
     ]},
    {'planet_name': 'Jupiter', 'planet_status': 'Confirmed', 'mass_earth': 317.83, 'mass_source': 'true_mass',
     'radius_earth': 11.209, 'semi_major_axis_au': 5.203, 'orbital_period_days': 4332.59, 'eccentricity': 0.049,
     'inclination_deg': 1.31, 'temp_calculated_k': 165, 'temp_measured_k': 165, 'geometric_albedo': 0.538,
     'detection_type': 'Direct', 'molecules': 'H2, He, CH4, NH3', 'discovered': 'Antiquity',
     'planet_type': 'gas-giant', 'sub_type_flags': ['banded_atmosphere', 'great_storm', 'magnetic_giant'],
     'tidally_locked': False, 'confidence': 'observed',
     'ring_system': {'inner_radius_re': 12.0, 'outer_radius_re': 22.0, 'ring_count': 3,
                     'rings': [{'name': 'Halo', 'inner_radius_re': 12.0, 'outer_radius_re': 14.5, 'composition': 'rocky', 'optical_depth': 0.01},
                               {'name': 'Main', 'inner_radius_re': 14.5, 'outer_radius_re': 18.0, 'composition': 'rocky', 'optical_depth': 0.05},
                               {'name': 'Gossamer', 'inner_radius_re': 18.0, 'outer_radius_re': 22.0, 'composition': 'rocky', 'optical_depth': 0.001}],
                     'gaps': [], 'shepherd_moons': [], 'total_mass_fraction': 1e-9},
     'moons': [
         {'moon_name': 'Io', 'orbital_radius_au': 0.00282, 'mass_earth': 0.015, 'radius_earth': 0.286,
          'moon_type': 'volcanic', 'tidal_heating': 0.90, 'eccentricity': 0.004, 'inclination_deg': 0.04,
          'sub_type_flags': ['sulfur_eruptions', 'lava_lakes', 'tidal_flexing', 'resonance_tidal_heating'], 'confidence': 'observed'},
         {'moon_name': 'Europa', 'orbital_radius_au': 0.00449, 'mass_earth': 0.008, 'radius_earth': 0.245,
          'moon_type': 'ice-shell', 'tidal_heating': 0.55, 'eccentricity': 0.009, 'inclination_deg': 0.47,
          'sub_type_flags': ['subsurface_ocean', 'cracked_ice', 'possible_geysers', 'possible_biosignatures'], 'confidence': 'observed'},
         {'moon_name': 'Ganymede', 'orbital_radius_au': 0.00716, 'mass_earth': 0.025, 'radius_earth': 0.413,
          'moon_type': 'ice-shell', 'tidal_heating': 0.15, 'eccentricity': 0.001, 'inclination_deg': 0.18,
          'sub_type_flags': ['subsurface_ocean', 'magnetic_field', 'largest_moon'], 'confidence': 'observed'},
         {'moon_name': 'Callisto', 'orbital_radius_au': 0.01259, 'mass_earth': 0.018, 'radius_earth': 0.378,
          'moon_type': 'cratered-airless', 'tidal_heating': 0.0, 'eccentricity': 0.007, 'inclination_deg': 0.19,
          'sub_type_flags': ['heavily_cratered', 'undifferentiated'], 'confidence': 'observed'},
     ],
     'resonances': [{'partner': 'Saturn', 'ratio': '5:2', 'role': 'inner'}]},
    {'planet_name': 'Saturn', 'planet_status': 'Confirmed', 'mass_earth': 95.16, 'mass_source': 'true_mass',
     'radius_earth': 9.449, 'semi_major_axis_au': 9.537, 'orbital_period_days': 10759.2, 'eccentricity': 0.057,
     'inclination_deg': 2.49, 'temp_calculated_k': 134, 'temp_measured_k': 134, 'geometric_albedo': 0.499,
     'detection_type': 'Direct', 'molecules': 'H2, He, CH4', 'discovered': 'Antiquity',
     'planet_type': 'gas-giant', 'sub_type_flags': ['banded_atmosphere', 'ring_king'],
     'tidally_locked': False, 'confidence': 'observed',
     'ring_system': {'inner_radius_re': 10.0, 'outer_radius_re': 24.0, 'ring_count': 5,
                     'rings': [{'name': 'D', 'inner_radius_re': 10.0, 'outer_radius_re': 11.5, 'composition': 'icy', 'optical_depth': 0.01},
                               {'name': 'C', 'inner_radius_re': 11.5, 'outer_radius_re': 14.0, 'composition': 'icy', 'optical_depth': 0.1},
                               {'name': 'B', 'inner_radius_re': 14.5, 'outer_radius_re': 17.5, 'composition': 'icy', 'optical_depth': 1.5},
                               {'name': 'A', 'inner_radius_re': 18.0, 'outer_radius_re': 21.0, 'composition': 'icy', 'optical_depth': 0.6},
                               {'name': 'F', 'inner_radius_re': 21.2, 'outer_radius_re': 21.5, 'composition': 'icy', 'optical_depth': 0.2}],
                     'gaps': [{'name': 'Cassini Division', 'position_re': 17.5, 'width_re': 0.5},
                              {'name': 'Encke Gap', 'position_re': 20.3, 'width_re': 0.05}],
                     'shepherd_moons': [{'name': 'Pan', 'orbital_radius_re': 20.3, 'diameter_km': 28.2},
                                        {'name': 'Prometheus', 'orbital_radius_re': 21.2, 'diameter_km': 86.2}],
                     'total_mass_fraction': 4e-8},
     'moons': [
         {'moon_name': 'Titan', 'orbital_radius_au': 0.00817, 'mass_earth': 0.0225, 'radius_earth': 0.404,
          'moon_type': 'atmosphere-moon', 'tidal_heating': 0.05, 'eccentricity': 0.029, 'inclination_deg': 0.35,
          'sub_type_flags': ['thick_haze', 'hydrocarbon_lakes', 'cryogenic_surface', 'nitrogen_atmosphere'], 'confidence': 'observed'},
         {'moon_name': 'Enceladus', 'orbital_radius_au': 0.00159, 'mass_earth': 0.000018, 'radius_earth': 0.0396,
          'moon_type': 'ice-shell', 'tidal_heating': 0.65, 'eccentricity': 0.005, 'inclination_deg': 0.02,
          'sub_type_flags': ['subsurface_ocean', 'cracked_ice', 'possible_geysers', 'possible_biosignatures'], 'confidence': 'observed'},
         {'moon_name': 'Mimas', 'orbital_radius_au': 0.00124, 'mass_earth': 0.0000063, 'radius_earth': 0.0311,
          'moon_type': 'cratered-airless', 'tidal_heating': 0.0, 'eccentricity': 0.020, 'inclination_deg': 1.57,
          'sub_type_flags': ['heavily_cratered', 'death_star_crater'], 'confidence': 'observed'},
         {'moon_name': 'Rhea', 'orbital_radius_au': 0.00352, 'mass_earth': 0.000387, 'radius_earth': 0.120,
          'moon_type': 'cratered-airless', 'tidal_heating': 0.0, 'eccentricity': 0.001, 'inclination_deg': 0.35,
          'sub_type_flags': ['heavily_cratered', 'tenuous_ring'], 'confidence': 'observed'},
     ],
     'resonances': [{'partner': 'Jupiter', 'ratio': '5:2', 'role': 'outer'}]},
    {'planet_name': 'Uranus', 'planet_status': 'Confirmed', 'mass_earth': 14.54, 'mass_source': 'true_mass',
     'radius_earth': 4.007, 'semi_major_axis_au': 19.191, 'orbital_period_days': 30688.5, 'eccentricity': 0.047,
     'inclination_deg': 0.77, 'temp_calculated_k': 76, 'temp_measured_k': 76, 'geometric_albedo': 0.488,
     'detection_type': 'Direct', 'molecules': 'H2, He, CH4', 'discovered': '1781',
     'planet_type': 'neptune-like', 'sub_type_flags': ['extreme_axial_tilt', 'retrograde_rotation'],
     'tidally_locked': False, 'confidence': 'observed',
     'ring_system': {'inner_radius_re': 5.0, 'outer_radius_re': 12.5, 'ring_count': 4,
                     'rings': [{'name': '6-5-4', 'inner_radius_re': 5.0, 'outer_radius_re': 6.5, 'composition': 'rocky', 'optical_depth': 0.3},
                               {'name': 'Alpha-Beta', 'inner_radius_re': 6.5, 'outer_radius_re': 8.0, 'composition': 'rocky', 'optical_depth': 0.4},
                               {'name': 'Eta-Gamma-Delta', 'inner_radius_re': 8.0, 'outer_radius_re': 10.0, 'composition': 'mixed', 'optical_depth': 0.3},
                               {'name': 'Epsilon', 'inner_radius_re': 10.0, 'outer_radius_re': 12.5, 'composition': 'rocky', 'optical_depth': 0.8}],
                     'gaps': [], 'shepherd_moons': [{'name': 'Cordelia', 'orbital_radius_re': 10.0, 'diameter_km': 40.2},
                                                     {'name': 'Ophelia', 'orbital_radius_re': 12.5, 'diameter_km': 42.8}],
                     'total_mass_fraction': 1e-8},
     'moons': [
         {'moon_name': 'Titania', 'orbital_radius_au': 0.00291, 'mass_earth': 0.00059, 'radius_earth': 0.124,
          'moon_type': 'ice-shell', 'tidal_heating': 0.05, 'eccentricity': 0.001, 'inclination_deg': 0.08,
          'sub_type_flags': ['cracked_ice', 'largest_uranian_moon'], 'confidence': 'observed'},
         {'moon_name': 'Oberon', 'orbital_radius_au': 0.00390, 'mass_earth': 0.00051, 'radius_earth': 0.119,
          'moon_type': 'cratered-airless', 'tidal_heating': 0.0, 'eccentricity': 0.001, 'inclination_deg': 0.07,
          'sub_type_flags': ['heavily_cratered', 'dark_material'], 'confidence': 'observed'},
         {'moon_name': 'Ariel', 'orbital_radius_au': 0.00128, 'mass_earth': 0.000226, 'radius_earth': 0.0911,
          'moon_type': 'ice-shell', 'tidal_heating': 0.10, 'eccentricity': 0.001, 'inclination_deg': 0.04,
          'sub_type_flags': ['cracked_ice', 'resurfaced'], 'confidence': 'observed'},
         {'moon_name': 'Miranda', 'orbital_radius_au': 0.000868, 'mass_earth': 0.0000110, 'radius_earth': 0.0369,
          'moon_type': 'cratered-airless', 'tidal_heating': 0.0, 'eccentricity': 0.001, 'inclination_deg': 4.34,
          'sub_type_flags': ['chevron_terrain', 'extreme_geology'], 'confidence': 'observed'},
     ]},
    {'planet_name': 'Neptune', 'planet_status': 'Confirmed', 'mass_earth': 17.15, 'mass_source': 'true_mass',
     'radius_earth': 3.883, 'semi_major_axis_au': 30.07, 'orbital_period_days': 60190.0, 'eccentricity': 0.009,
     'inclination_deg': 1.77, 'temp_calculated_k': 72, 'temp_measured_k': 72, 'geometric_albedo': 0.442,
     'detection_type': 'Direct', 'molecules': 'H2, He, CH4', 'discovered': '1846',
     'planet_type': 'neptune-like', 'sub_type_flags': ['banded_atmosphere', 'great_dark_spot'],
     'tidally_locked': False, 'confidence': 'observed',
     'ring_system': {'inner_radius_re': 5.3, 'outer_radius_re': 10.3, 'ring_count': 3,
                     'rings': [{'name': 'Galle', 'inner_radius_re': 5.3, 'outer_radius_re': 5.8, 'composition': 'rocky', 'optical_depth': 0.01},
                               {'name': 'Le Verrier', 'inner_radius_re': 7.0, 'outer_radius_re': 7.2, 'composition': 'rocky', 'optical_depth': 0.02},
                               {'name': 'Adams', 'inner_radius_re': 10.0, 'outer_radius_re': 10.3, 'composition': 'rocky', 'optical_depth': 0.03}],
                     'gaps': [], 'shepherd_moons': [{'name': 'Galatea', 'orbital_radius_re': 10.0, 'diameter_km': 174.8}],
                     'total_mass_fraction': 1e-9},
     'moons': [
         {'moon_name': 'Triton', 'orbital_radius_au': 0.00237, 'mass_earth': 0.00358, 'radius_earth': 0.212,
          'moon_type': 'captured-irregular', 'tidal_heating': 0.25, 'eccentricity': 0.000, 'inclination_deg': 156.9,
          'sub_type_flags': ['retrograde_orbit', 'nitrogen_geysers', 'captured_kbo', 'possible_subsurface_ocean'], 'confidence': 'observed'},
     ]},
]

_SOL_BELTS = [
    {'belt_id': 'Sol_belt_inner', 'belt_type': 'rocky-asteroid', 'inner_radius_au': 2.2, 'outer_radius_au': 3.2,
     'estimated_bodies': 1100000, 'confidence': 'observed',
     'resonance_gaps': [
         {'resonance': '4:1', 'position_au': 2.064, 'width_au': 0.02, 'width_class': 'narrow', 'shaping_planet_sma': 5.203},
         {'resonance': '3:1', 'position_au': 2.501, 'width_au': 0.06, 'width_class': 'wide', 'shaping_planet_sma': 5.203},
         {'resonance': '5:2', 'position_au': 2.824, 'width_au': 0.04, 'width_class': 'moderate', 'shaping_planet_sma': 5.203},
         {'resonance': '7:3', 'position_au': 2.957, 'width_au': 0.02, 'width_class': 'narrow', 'shaping_planet_sma': 5.203},
         {'resonance': '2:1', 'position_au': 3.278, 'width_au': 0.06, 'width_class': 'wide', 'shaping_planet_sma': 5.203},
     ],
     'families': [
         {'name': 'Flora', 'family_type': 'siliceous', 'spectral_class': 'S', 'center_au': 2.20, 'spread_au': 0.04, 'parent_diameter_km': 160.0, 'member_count': 400},
         {'name': 'Vesta', 'family_type': 'basaltic', 'spectral_class': 'V', 'center_au': 2.36, 'spread_au': 0.05, 'parent_diameter_km': 525.4, 'member_count': 300},
         {'name': 'Eos', 'family_type': 'carbonaceous', 'spectral_class': 'C', 'center_au': 3.01, 'spread_au': 0.06, 'parent_diameter_km': 104.0, 'member_count': 480},
     ],
     'major_asteroids': [
         {'name': 'Ceres', 'semi_major_axis_au': 2.77, 'diameter_km': 939.4, 'eccentricity': 0.076, 'inclination_deg': 10.59, 'spectral_class': 'C', 'confidence': 'observed'},
         {'name': 'Vesta', 'semi_major_axis_au': 2.36, 'diameter_km': 525.4, 'eccentricity': 0.089, 'inclination_deg': 7.14, 'spectral_class': 'S', 'confidence': 'observed'},
         {'name': 'Pallas', 'semi_major_axis_au': 2.77, 'diameter_km': 512.0, 'eccentricity': 0.231, 'inclination_deg': 34.83, 'spectral_class': 'C', 'confidence': 'observed'},
         {'name': 'Hygiea', 'semi_major_axis_au': 3.14, 'diameter_km': 434.0, 'eccentricity': 0.116, 'inclination_deg': 3.84, 'spectral_class': 'C', 'confidence': 'observed'},
         {'name': 'Juno', 'semi_major_axis_au': 2.67, 'diameter_km': 233.9, 'eccentricity': 0.256, 'inclination_deg': 12.97, 'spectral_class': 'S', 'confidence': 'observed'},
     ]},
    {'belt_id': 'Sol_belt_outer', 'belt_type': 'icy-kuiper', 'inner_radius_au': 30.0, 'outer_radius_au': 50.0,
     'estimated_bodies': 100000, 'confidence': 'observed',
     'resonance_gaps': [
         {'resonance': '2:3', 'position_au': 39.4, 'width_au': 1.0, 'width_class': 'wide', 'shaping_planet_sma': 30.07},
     ],
     'families': [],
     'ice_dwarfs': [
         {'name': 'Pluto', 'planet_type': 'ice-dwarf', 'mass_earth': 0.0022, 'radius_earth': 0.187, 'semi_major_axis_au': 39.48,
          'eccentricity': 0.250, 'inclination_deg': 17.16, 'surface_type': 'nitrogen-ice', 'diameter_km': 2377.0, 'has_companion': True, 'confidence': 'observed'},
         {'name': 'Eris', 'planet_type': 'ice-dwarf', 'mass_earth': 0.0028, 'radius_earth': 0.182, 'semi_major_axis_au': 67.78,
          'eccentricity': 0.436, 'inclination_deg': 44.04, 'surface_type': 'nitrogen-ice', 'diameter_km': 2326.0, 'has_companion': True, 'confidence': 'observed'},
         {'name': 'Haumea', 'planet_type': 'ice-dwarf', 'mass_earth': 0.0007, 'radius_earth': 0.128, 'semi_major_axis_au': 43.13,
          'eccentricity': 0.195, 'inclination_deg': 28.22, 'surface_type': 'water-ice', 'diameter_km': 1632.0, 'has_companion': True, 'confidence': 'observed'},
         {'name': 'Makemake', 'planet_type': 'ice-dwarf', 'mass_earth': 0.0005, 'radius_earth': 0.112, 'semi_major_axis_au': 45.79,
          'eccentricity': 0.159, 'inclination_deg': 28.98, 'surface_type': 'methane-frost', 'diameter_km': 1430.0, 'has_companion': False, 'confidence': 'observed'},
         {'name': 'Quaoar', 'planet_type': 'ice-dwarf', 'mass_earth': 0.0002, 'radius_earth': 0.088, 'semi_major_axis_au': 43.41,
          'eccentricity': 0.039, 'inclination_deg': 7.99, 'surface_type': 'water-ice', 'diameter_km': 1121.0, 'has_companion': True, 'confidence': 'observed'},
     ],
     'major_asteroids': [
         {'name': 'Pluto', 'semi_major_axis_au': 39.48, 'diameter_km': 2377.0, 'eccentricity': 0.250, 'inclination_deg': 17.16, 'spectral_class': 'C', 'confidence': 'observed'},
         {'name': 'Eris', 'semi_major_axis_au': 67.78, 'diameter_km': 2326.0, 'eccentricity': 0.436, 'inclination_deg': 44.04, 'spectral_class': 'C', 'confidence': 'observed'},
         {'name': 'Haumea', 'semi_major_axis_au': 43.13, 'diameter_km': 1632.0, 'eccentricity': 0.195, 'inclination_deg': 28.22, 'spectral_class': 'C', 'confidence': 'observed'},
         {'name': 'Makemake', 'semi_major_axis_au': 45.79, 'diameter_km': 1430.0, 'eccentricity': 0.159, 'inclination_deg': 28.98, 'spectral_class': 'C', 'confidence': 'observed'},
         {'name': 'Quaoar', 'semi_major_axis_au': 43.41, 'diameter_km': 1121.0, 'eccentricity': 0.039, 'inclination_deg': 7.99, 'spectral_class': 'C', 'confidence': 'observed'},
     ]},
    {'belt_id': 'Sol_trojans_L4', 'belt_type': 'trojan-swarm', 'lagrange_point': 'L4',
     'parent_planet': 'Jupiter', 'parent_sma_au': 5.203, 'angular_offset_deg': 60.0,
     'angular_spread_deg': 13.0, 'inclination_spread_deg': 15.0,
     'estimated_bodies': 6500, 'inner_radius_au': 4.79, 'outer_radius_au': 5.62,
     'confidence': 'observed', 'major_asteroids': []},
    {'belt_id': 'Sol_trojans_L5', 'belt_type': 'trojan-swarm', 'lagrange_point': 'L5',
     'parent_planet': 'Jupiter', 'parent_sma_au': 5.203, 'angular_offset_deg': -60.0,
     'angular_spread_deg': 13.0, 'inclination_spread_deg': 15.0,
     'estimated_bodies': 4000, 'inner_radius_au': 4.79, 'outer_radius_au': 5.62,
     'confidence': 'observed', 'major_asteroids': []},
]


def _load_systems_from_csv():
    """Load and deduplicate star systems from CSV source files.

    Steps:
      1. Parse SIMBAD for positions, object types (binary detection).
      2. Parse Exoplanet catalog for spectral types, Teff, mass, planets.
      3. Merge by name — exoplanet data enriches SIMBAD entries.
      4. Inject missing bright components (Alpha Cen A/B, Sirius A, etc.)
         from the curated companion catalog.
      5. Name-normalization dedup.
      6. Spatial deduplication — stars within 0.3 pc are merged.
      7. Inject Sol at the origin (0, 0, 0).
      8. Attach companion / system-group linkage from curated catalog.
    """
    import csv
    import re as _re

    base = os.path.join(_PROJECT_ROOT, '03_DATA', '01_SOURCES')
    exo_path = os.path.join(base, 'EXOPLANETS_01.csv')
    simbad_path = os.path.join(base, 'SIMBAD_01.csv')

    stars = {}  # name → dict

    # ── Parse SIMBAD for object types (binary detection) ──
    otype_map = {}  # main_id → set of otype codes
    if os.path.exists(simbad_path):
        try:
            with open(simbad_path, encoding='utf-8-sig') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    mid = (row.get('main_id') or '').strip()
                    otypes_str = (row.get('otypes') or '').strip()
                    ra = (row.get('Average of ra') or '').strip()
                    dec = (row.get('Average of dec') or '').strip()
                    dist = (row.get('Average of dist') or '').strip()
                    if not mid or not dist:
                        continue
                    try:
                        dist_pc = float(dist)
                    except (ValueError, TypeError):
                        continue
                    if dist_pc <= 0 or dist_pc > 30.67:  # 100 LY
                        continue

                    otype_set = set(o.strip() for o in otypes_str.split('|') if o.strip())
                    otype_map[mid] = otype_set
                    multiplicity = 1
                    for ot in otype_set:
                        if ot in _MULTI_OTYPES:
                            multiplicity = 2
                            break

                    dist_ly = dist_pc * 3.26156
                    ra_val = float(ra) if ra else 0
                    dec_val = float(dec) if dec else 0

                    # RA/Dec → approximate Cartesian (galactic XYZ in parsecs)
                    ra_rad = math.radians(ra_val)
                    dec_rad = math.radians(dec_val)
                    x = dist_pc * math.cos(dec_rad) * math.cos(ra_rad)
                    y = dist_pc * math.cos(dec_rad) * math.sin(ra_rad)
                    z = dist_pc * math.sin(dec_rad)

                    stars[mid] = {
                        'main_id': mid,
                        'x': round(x, 4),
                        'y': round(y, 4),
                        'z': round(z, 4),
                        'distance_ly': round(dist_ly, 2),
                        'spectral_class': 'K',  # default for SIMBAD
                        'teff': 4450,
                        'luminosity': 0.5,
                        'multiplicity': multiplicity,
                        'planet_count': 0,
                        'confidence': 'observed',
                        '_from_exo': False,   # track origin for dedup preference
                    }
        except Exception as e:
            logger.warning(f"SIMBAD CSV parse error: {e}")

    # ── Parse exoplanet catalog ──
    raw_planets = {}   # star_name → list of planet dicts (pre-dedup keying)
    if os.path.exists(exo_path):
        try:
            with open(exo_path, encoding='utf-8-sig') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    star_name = (row.get('star_name') or '').strip()
                    if not star_name:
                        continue
                    dist_str = (row.get('star_distance') or '').strip()
                    if not dist_str:
                        continue
                    try:
                        dist_pc = float(dist_str)
                    except (ValueError, TypeError):
                        continue
                    if dist_pc <= 0 or dist_pc > 30.67:
                        continue

                    ra_str = (row.get('ra') or '').strip()
                    dec_str = (row.get('dec') or '').strip()
                    sp_type = (row.get('star_sp_type') or '').strip()
                    teff_str = (row.get('star_teff') or '').strip()
                    mass_str = (row.get('star_mass') or '').strip()
                    radius_str = (row.get('star_radius') or '').strip()

                    ra_val = float(ra_str) if ra_str else 0
                    dec_val = float(dec_str) if dec_str else 0
                    dist_ly = dist_pc * 3.26156

                    ra_rad = math.radians(ra_val)
                    dec_rad = math.radians(dec_val)
                    x = dist_pc * math.cos(dec_rad) * math.cos(ra_rad)
                    y = dist_pc * math.cos(dec_rad) * math.sin(ra_rad)
                    z = dist_pc * math.sin(dec_rad)

                    # Spectral class
                    sp_class = sp_type[0].upper() if sp_type else 'G'
                    teff = _SPECTRAL_TEFF.get(sp_class, 5600)
                    if teff_str:
                        try:
                            teff = int(float(teff_str))
                        except (ValueError, TypeError):
                            pass

                    # Luminosity from mass (rough L ∝ M^3.5)
                    luminosity = 1.0
                    if mass_str:
                        try:
                            m = float(mass_str)
                            luminosity = round(m ** 3.5, 3)
                        except (ValueError, TypeError):
                            pass

                    if star_name in stars:
                        # Enrich existing entry from SIMBAD with spectral info
                        stars[star_name]['spectral_class'] = sp_class
                        stars[star_name]['teff'] = teff
                        stars[star_name]['luminosity'] = luminosity
                        stars[star_name]['planet_count'] = stars[star_name].get('planet_count', 0) + 1
                        stars[star_name]['_from_exo'] = True
                    else:
                        stars[star_name] = {
                            'main_id': star_name,
                            'x': round(x, 4),
                            'y': round(y, 4),
                            'z': round(z, 4),
                            'distance_ly': round(dist_ly, 2),
                            'spectral_class': sp_class,
                            'teff': teff,
                            'luminosity': luminosity,
                            'multiplicity': 1,
                            'planet_count': 1,
                            'confidence': 'observed',
                            '_from_exo': True,
                        }

                    # ── Capture individual planet record ──
                    planet_name = (row.get('planet_name') or '').strip()
                    if not planet_name:
                        planet_name = f"{star_name} (unnamed)"

                    def _pfloat(key):
                        v = (row.get(key) or '').strip()
                        if not v:
                            return None
                        try:
                            return float(v)
                        except (ValueError, TypeError):
                            return None

                    # Mass: prefer true mass (Jupiter), fall back to mass_sini
                    mass_jup = _pfloat('mass')
                    mass_sini_jup = _pfloat('mass_sini')
                    mass_earth = None
                    mass_source = None
                    if mass_jup is not None:
                        mass_earth = round(mass_jup * 317.83, 3)
                        mass_source = 'true_mass'
                    elif mass_sini_jup is not None:
                        mass_earth = round(mass_sini_jup * 317.83, 3)
                        mass_source = 'mass_sini'

                    # Radius (Jupiter → Earth radii)
                    radius_jup = _pfloat('radius')
                    radius_earth = round(radius_jup * 11.209, 3) if radius_jup is not None else None

                    sma_au = _pfloat('semi_major_axis')
                    period_days = _pfloat('orbital_period')
                    ecc = _pfloat('eccentricity')
                    incl = _pfloat('inclination')
                    temp_k = _pfloat('temp_calculated')
                    temp_measured = _pfloat('temp_measured')
                    albedo = _pfloat('geometric_albedo')
                    det_type = (row.get('detection_type') or '').strip() or None
                    molecules = (row.get('molecules') or '').strip() or None
                    planet_status = (row.get('planet_status') or '').strip() or 'Confirmed'
                    discovered = (row.get('discovered') or '').strip() or None

                    # Classify planet type from mass
                    planet_type = _classify_planet_type(mass_earth, radius_earth, sma_au)

                    planet_rec = {
                        'planet_name': planet_name,
                        'planet_status': planet_status,
                        'mass_earth': mass_earth,
                        'mass_source': mass_source,
                        'radius_earth': radius_earth,
                        'semi_major_axis_au': sma_au,
                        'orbital_period_days': period_days,
                        'eccentricity': ecc,
                        'inclination_deg': incl,
                        'temp_calculated_k': temp_k,
                        'temp_measured_k': temp_measured,
                        'geometric_albedo': albedo,
                        'detection_type': det_type,
                        'molecules': molecules,
                        'discovered': discovered,
                        'planet_type': planet_type,
                        'confidence': 'observed',
                        'moons': [],   # placeholder — populated by inference
                    }
                    raw_planets.setdefault(star_name, []).append(planet_rec)
        except Exception as e:
            logger.warning(f"Exoplanet CSV parse error: {e}")

    # ── Curated companion catalog & missing-star injection ──────────
    # Authoritative data from WDS, Sixth Orbit Catalog, Tokovinin MSC,
    # and Gaia DR3 for the nearest / most famous multiple systems.
    # Each group defines a hierarchical system:
    #   components: list of component stars with physical data
    #   hierarchy: human-readable hierarchy string
    #   bonds: list of (comp_a, comp_b, separation_AU, bond_type) pairs
    #     bond_type: 'close_binary' (<100 AU), 'wide_companion' (>1000 AU)
    _COMPANION_CATALOG = {
        'Alpha Centauri': {
            'hierarchy': '(A,B) + C',
            'components': [
                {
                    'name': 'Alpha Centauri A',
                    'aliases': ['Rigil Kentaurus', 'alf Cen A', 'HD 128620', 'HR 5459'],
                    'spectral_class': 'G', 'teff': 5790, 'luminosity': 1.519,
                    'mass': 1.1, 'ra': 219.9021, 'dec': -60.8354, 'dist_pc': 1.3241,
                    'planet_count': 0, 'multiplicity': 3,
                },
                {
                    'name': 'Alpha Centauri B',
                    'aliases': ['Toliman', 'alf Cen B', 'HD 128621', 'HR 5460'],
                    'spectral_class': 'K', 'teff': 5260, 'luminosity': 0.500,
                    'mass': 0.907, 'ra': 219.8961, 'dec': -60.8375, 'dist_pc': 1.3241,
                    'planet_count': 0, 'multiplicity': 3,
                },
                {
                    'name': 'Proxima Centauri',
                    'aliases': ['alf Cen C', 'V* V645 Cen', 'GJ 551'],
                    'spectral_class': 'M', 'teff': 3050, 'luminosity': 0.0017,
                    'mass': 0.122, 'ra': 217.4289, 'dec': -62.6795, 'dist_pc': 1.3012,
                    'planet_count': 2, 'multiplicity': 3,
                },
            ],
            'bonds': [
                ('Alpha Centauri A', 'Alpha Centauri B', 23.4, 'close_binary'),
                ('Alpha Centauri A', 'Proxima Centauri', 12950, 'wide_companion'),
            ],
        },
        'Sirius': {
            'hierarchy': 'A + B',
            'components': [
                {
                    'name': 'Sirius A',
                    'aliases': ['alf CMa', 'HD 48915', 'HR 2491'],
                    'spectral_class': 'A', 'teff': 9940, 'luminosity': 25.4,
                    'mass': 2.063, 'ra': 101.2872, 'dec': -16.7161, 'dist_pc': 2.6371,
                    'planet_count': 0, 'multiplicity': 2,
                },
                {
                    'name': 'Sirius B',
                    'aliases': ['alf CMa B', '* alf CMa B'],
                    'spectral_class': 'A', 'teff': 25200, 'luminosity': 0.056,
                    'mass': 1.018, 'ra': 101.2888, 'dec': -16.7169, 'dist_pc': 2.6371,
                    'planet_count': 0, 'multiplicity': 2,
                },
            ],
            'bonds': [
                ('Sirius A', 'Sirius B', 19.8, 'close_binary'),
            ],
        },
        'Procyon': {
            'hierarchy': 'A + B',
            'components': [
                {
                    'name': 'Procyon A',
                    'aliases': ['alf CMi', 'HD 61421', 'HR 2943'],
                    'spectral_class': 'F', 'teff': 6530, 'luminosity': 6.93,
                    'mass': 1.499, 'ra': 114.8255, 'dec': 5.2250, 'dist_pc': 3.509,
                    'planet_count': 0, 'multiplicity': 2,
                },
                {
                    'name': 'Procyon B',
                    'aliases': ['alf CMi B', '* alf CMi B'],
                    'spectral_class': 'F', 'teff': 7740, 'luminosity': 0.00049,
                    'mass': 0.602, 'ra': 114.8245, 'dec': 5.2241, 'dist_pc': 3.509,
                    'planet_count': 0, 'multiplicity': 2,
                },
            ],
            'bonds': [
                ('Procyon A', 'Procyon B', 15.0, 'close_binary'),
            ],
        },
        '61 Cygni': {
            'hierarchy': 'A + B',
            'components': [
                {
                    'name': '61 Cygni A',
                    'aliases': ['* 61 Cyg A', '*  61 Cyg A', 'HD 201091', 'HR 8085'],
                    'spectral_class': 'K', 'teff': 4526, 'luminosity': 0.153,
                    'mass': 0.70, 'ra': 316.7247, 'dec': 38.7494, 'dist_pc': 3.4896,
                    'planet_count': 0, 'multiplicity': 2,
                },
                {
                    'name': '61 Cygni B',
                    'aliases': ['* 61 Cyg B', '*  61 Cyg B', 'HD 201092', 'HR 8086'],
                    'spectral_class': 'K', 'teff': 4077, 'luminosity': 0.085,
                    'mass': 0.63, 'ra': 316.7303, 'dec': 38.7420, 'dist_pc': 3.4989,
                    'planet_count': 0, 'multiplicity': 2,
                },
            ],
            'bonds': [
                ('61 Cygni A', '61 Cygni B', 84.0, 'close_binary'),
            ],
        },
        'Luyten 726-8': {
            'hierarchy': 'A + B',
            'components': [
                {
                    'name': 'Luyten 726-8 A',
                    'aliases': ['BL Cet', 'GJ 65 A'],
                    'spectral_class': 'M', 'teff': 2670, 'luminosity': 0.00006,
                    'mass': 0.102, 'ra': 24.756, 'dec': -17.950, 'dist_pc': 2.677,
                    'planet_count': 0, 'multiplicity': 2,
                },
                {
                    'name': 'UV Ceti',
                    'aliases': ['Luyten 726-8 B', 'GJ 65 B'],
                    'spectral_class': 'M', 'teff': 2670, 'luminosity': 0.00004,
                    'mass': 0.100, 'ra': 24.757, 'dec': -17.951, 'dist_pc': 2.677,
                    'planet_count': 0, 'multiplicity': 2,
                },
            ],
            'bonds': [
                ('Luyten 726-8 A', 'UV Ceti', 5.5, 'close_binary'),
            ],
        },
        'Struve 2398': {
            'hierarchy': 'A + B',
            'components': [
                {
                    'name': 'Struve 2398 A',
                    'aliases': ['GJ 725 A', 'HD 173739'],
                    'spectral_class': 'M', 'teff': 3404, 'luminosity': 0.013,
                    'mass': 0.334, 'ra': 280.6963, 'dec': 59.6272, 'dist_pc': 3.523,
                    'planet_count': 0, 'multiplicity': 2,
                },
                {
                    'name': 'Struve 2398 B',
                    'aliases': ['GJ 725 B', 'HD 173740'],
                    'spectral_class': 'M', 'teff': 3311, 'luminosity': 0.008,
                    'mass': 0.249, 'ra': 280.6952, 'dec': 59.6298, 'dist_pc': 3.523,
                    'planet_count': 0, 'multiplicity': 2,
                },
            ],
            'bonds': [
                ('Struve 2398 A', 'Struve 2398 B', 56.0, 'close_binary'),
            ],
        },
        'Luhman 16': {
            'hierarchy': 'A + B',
            'components': [
                {
                    'name': 'Luhman 16 A',
                    'aliases': ['WISE J1049-5319 A'],
                    'spectral_class': 'L', 'teff': 1350, 'luminosity': 0.000022,
                    'mass': 0.032, 'ra': 162.3103, 'dec': -53.3181, 'dist_pc': 1.998,
                    'planet_count': 0, 'multiplicity': 2,
                },
                {
                    'name': 'Luhman 16 B',
                    'aliases': ['WISE J1049-5319 B'],
                    'spectral_class': 'T', 'teff': 1210, 'luminosity': 0.000015,
                    'mass': 0.028, 'ra': 162.3105, 'dec': -53.3183, 'dist_pc': 1.998,
                    'planet_count': 0, 'multiplicity': 2,
                },
            ],
            'bonds': [
                ('Luhman 16 A', 'Luhman 16 B', 3.6, 'close_binary'),
            ],
        },
        'Kruger 60': {
            'hierarchy': 'A + B',
            'components': [
                {
                    'name': 'Kruger 60 A',
                    'aliases': ['GJ 860 A', 'HD 239960'],
                    'spectral_class': 'M', 'teff': 3180, 'luminosity': 0.010,
                    'mass': 0.271, 'ra': 333.3189, 'dec': 57.6931, 'dist_pc': 3.957,
                    'planet_count': 0, 'multiplicity': 2,
                },
                {
                    'name': 'Kruger 60 B',
                    'aliases': ['GJ 860 B', 'HD 239960B'],
                    'spectral_class': 'M', 'teff': 2900, 'luminosity': 0.004,
                    'mass': 0.176, 'ra': 333.3195, 'dec': 57.6938, 'dist_pc': 3.957,
                    'planet_count': 0, 'multiplicity': 2,
                },
            ],
            'bonds': [
                ('Kruger 60 A', 'Kruger 60 B', 9.5, 'close_binary'),
            ],
        },
        'Groombridge 34': {
            'hierarchy': 'A + B',
            'components': [
                {
                    'name': 'Groombridge 34 A',
                    'aliases': ['GJ 15 A', 'GX And', 'GJ 15A'],
                    'spectral_class': 'M', 'teff': 3602, 'luminosity': 0.021,
                    'mass': 0.375, 'ra': 4.6144, 'dec': 44.0232, 'dist_pc': 3.562,
                    'planet_count': 1, 'multiplicity': 2,
                },
                {
                    'name': 'Groombridge 34 B',
                    'aliases': ['GJ 15 B', 'GQ And'],
                    'spectral_class': 'M', 'teff': 3132, 'luminosity': 0.005,
                    'mass': 0.163, 'ra': 4.6186, 'dec': 44.0204, 'dist_pc': 3.562,
                    'planet_count': 0, 'multiplicity': 2,
                },
            ],
            'bonds': [
                ('Groombridge 34 A', 'Groombridge 34 B', 147.0, 'wide_companion'),
            ],
        },
        'Epsilon Indi': {
            'hierarchy': 'A + (Ba,Bb)',
            'components': [
                {
                    'name': 'Epsilon Indi A',
                    'aliases': ['eps Ind A', 'eps Ind', 'HD 209100', 'HR 8387'],
                    'spectral_class': 'K', 'teff': 4649, 'luminosity': 0.27,
                    'mass': 0.762, 'ra': 330.8403, 'dec': -56.7860, 'dist_pc': 3.622,
                    'planet_count': 1, 'multiplicity': 3,
                },
                {
                    'name': 'Epsilon Indi Ba',
                    'aliases': ['eps Ind Ba', 'eps Ind B'],
                    'spectral_class': 'T', 'teff': 1300, 'luminosity': 0.000025,
                    'mass': 0.068, 'ra': 330.808, 'dec': -56.796, 'dist_pc': 3.622,
                    'planet_count': 0, 'multiplicity': 3,
                },
                {
                    'name': 'Epsilon Indi Bb',
                    'aliases': ['eps Ind Bb'],
                    'spectral_class': 'T', 'teff': 850, 'luminosity': 0.000010,
                    'mass': 0.047, 'ra': 330.809, 'dec': -56.797, 'dist_pc': 3.622,
                    'planet_count': 0, 'multiplicity': 3,
                },
            ],
            'bonds': [
                ('Epsilon Indi Ba', 'Epsilon Indi Bb', 2.4, 'close_binary'),
                ('Epsilon Indi A', 'Epsilon Indi Ba', 1459, 'wide_companion'),
            ],
        },
        '70 Ophiuchi': {
            'hierarchy': 'A + B',
            'components': [
                {
                    'name': '70 Ophiuchi A',
                    'aliases': ['HD 165341 A', 'HR 6752'],
                    'spectral_class': 'K', 'teff': 5300, 'luminosity': 0.43,
                    'mass': 0.90, 'ra': 271.3640, 'dec': 2.4990, 'dist_pc': 5.089,
                    'planet_count': 0, 'multiplicity': 2,
                },
                {
                    'name': '70 Ophiuchi B',
                    'aliases': ['HD 165341 B'],
                    'spectral_class': 'K', 'teff': 4350, 'luminosity': 0.077,
                    'mass': 0.70, 'ra': 271.3636, 'dec': 2.4968, 'dist_pc': 5.089,
                    'planet_count': 0, 'multiplicity': 2,
                },
            ],
            'bonds': [
                ('70 Ophiuchi A', '70 Ophiuchi B', 23.2, 'close_binary'),
            ],
        },
        '36 Ophiuchi': {
            'hierarchy': '(A,B) + C',
            'components': [
                {
                    'name': '36 Ophiuchi A',
                    'aliases': ['HD 155886', 'HR 6401'],
                    'spectral_class': 'K', 'teff': 5125, 'luminosity': 0.28,
                    'mass': 0.85, 'ra': 258.8385, 'dec': -26.6007, 'dist_pc': 5.924,
                    'planet_count': 0, 'multiplicity': 3,
                },
                {
                    'name': '36 Ophiuchi B',
                    'aliases': ['HD 155885', 'HR 6402'],
                    'spectral_class': 'K', 'teff': 5100, 'luminosity': 0.27,
                    'mass': 0.85, 'ra': 258.8370, 'dec': -26.6020, 'dist_pc': 5.924,
                    'planet_count': 0, 'multiplicity': 3,
                },
                {
                    'name': '36 Ophiuchi C',
                    'aliases': ['HD 156026', 'HR 6426'],
                    'spectral_class': 'K', 'teff': 4550, 'luminosity': 0.09,
                    'mass': 0.71, 'ra': 258.9010, 'dec': -26.5929, 'dist_pc': 5.924,
                    'planet_count': 0, 'multiplicity': 3,
                },
            ],
            'bonds': [
                ('36 Ophiuchi A', '36 Ophiuchi B', 4.6, 'close_binary'),
                ('36 Ophiuchi A', '36 Ophiuchi C', 730, 'wide_companion'),
            ],
        },
        'Xi Boötis': {
            'hierarchy': 'A + B',
            'components': [
                {
                    'name': 'Xi Boötis A',
                    'aliases': ['ksi Boo A', 'HD 131156 A', 'HR 5544'],
                    'spectral_class': 'G', 'teff': 5551, 'luminosity': 0.61,
                    'mass': 0.94, 'ra': 222.0067, 'dec': 19.1006, 'dist_pc': 6.733,
                    'planet_count': 0, 'multiplicity': 2,
                },
                {
                    'name': 'Xi Boötis B',
                    'aliases': ['ksi Boo B', 'HD 131156 B'],
                    'spectral_class': 'K', 'teff': 4350, 'luminosity': 0.061,
                    'mass': 0.66, 'ra': 222.0085, 'dec': 19.1010, 'dist_pc': 6.733,
                    'planet_count': 0, 'multiplicity': 2,
                },
            ],
            'bonds': [
                ('Xi Boötis A', 'Xi Boötis B', 33.6, 'close_binary'),
            ],
        },
    }

    # Build an alias → catalog component name lookup, and a name → group map
    _alias_to_canon = {}   # alias_normalised → canonical component name
    _name_to_group = {}    # component name → group key
    _catalog_canonical_names = set()  # all canonical component names
    for grp_key, grp in _COMPANION_CATALOG.items():
        for comp in grp['components']:
            _name_to_group[comp['name']] = grp_key
            _catalog_canonical_names.add(comp['name'])
            for alias in comp.get('aliases', []):
                _alias_to_canon[_re.sub(r'\s+', ' ', alias.strip().lower())] = comp['name']
            _alias_to_canon[_re.sub(r'\s+', ' ', comp['name'].strip().lower())] = comp['name']

    # Rename aliased SIMBAD entries to their canonical companion-catalog names
    # Do this BEFORE dedup so spatial dedup can recognise catalog members.
    for old_key in list(stars.keys()):
        norm = _re.sub(r'\s+', ' ', old_key.strip().lower())
        if norm in _alias_to_canon:
            canon = _alias_to_canon[norm]
            if canon != old_key and canon not in stars:
                entry = stars.pop(old_key)
                entry['main_id'] = canon
                stars[canon] = entry

    # ── Detect binary/multiple from name patterns ──
    for name, s in stars.items():
        if s['multiplicity'] < 2:
            lower = name.lower()
            if ' ab' in lower or '(ab)' in lower or ' a ' in lower:
                s['multiplicity'] = 2
            elif any(suf in name for suf in [' ABC', ' ABCD']):
                s['multiplicity'] = 3

    # ── Name-normalization dedup ─────────────────────────
    # Merge entries whose names differ only by whitespace (e.g. "Wolf  359" vs
    # "Wolf 359") or by a "NAME " / "* " prefix (SIMBAD conventions).

    def _normalise_name(n: str) -> str:
        s = n.strip()
        for prefix in ('NAME ', '* ', 'V* '):
            if s.startswith(prefix):
                s = s[len(prefix):]
        return _re.sub(r'\s+', ' ', s).lower()

    norm_map: dict[str, str] = {}          # normalised → first raw key
    dupes_to_merge: list[tuple[str, str]] = []   # (raw dup key, keep key)
    for raw_key in list(stars.keys()):
        nk = _normalise_name(raw_key)
        if nk in norm_map:
            dupes_to_merge.append((raw_key, norm_map[nk]))
        else:
            norm_map[nk] = raw_key

    for dup_key, keep_key in dupes_to_merge:
        dup = stars.pop(dup_key)
        keep = stars[keep_key]
        # Prefer the exo-catalog entry as canonical name
        if dup.get('_from_exo') and not keep.get('_from_exo'):
            keep['main_id'] = dup['main_id']
        if dup['planet_count'] > keep['planet_count']:
            keep['planet_count'] = dup['planet_count']
        if dup['multiplicity'] > keep['multiplicity']:
            keep['multiplicity'] = dup['multiplicity']
        if keep['spectral_class'] == 'K' and keep['teff'] == 4450 and dup['spectral_class'] != 'K':
            keep['spectral_class'] = dup['spectral_class']
            keep['teff'] = dup['teff']
            keep['luminosity'] = dup['luminosity']

    # ── Spatial deduplication ──────────────────────────
    # Stars within DEDUP_RADIUS_PC are almost certainly the same object
    # catalogued under different designations.  EXCEPTION: never merge two
    # stars that are both in the curated companion catalog — they are
    # physically separate components of a known multiple system.
    DEDUP_RADIUS_PC = 0.3
    DEDUP_RADIUS_SQ = DEDUP_RADIUS_PC ** 2

    systems_list = sorted(stars.values(), key=lambda s: s['distance_ly'])

    kept = []
    for s in systems_list:
        s_is_catalog = s['main_id'] in _catalog_canonical_names
        merged = False
        for k in kept:
            dx = s['x'] - k['x']
            dy = s['y'] - k['y']
            dz = s['z'] - k['z']
            if dx * dx + dy * dy + dz * dz < DEDUP_RADIUS_SQ:
                # NEVER merge two catalog companions — they are real
                k_is_catalog = k['main_id'] in _catalog_canonical_names
                if s_is_catalog and k_is_catalog:
                    continue  # skip this pair, keep looking

                # Merge into the existing kept entry
                if s.get('_from_exo') and not k.get('_from_exo'):
                    k['main_id'] = s['main_id']
                if s['planet_count'] > k['planet_count']:
                    k['planet_count'] = s['planet_count']
                if s['multiplicity'] > k['multiplicity']:
                    k['multiplicity'] = s['multiplicity']
                if k['spectral_class'] == 'K' and k['teff'] == 4450 and s['spectral_class'] != 'K':
                    k['spectral_class'] = s['spectral_class']
                    k['teff'] = s['teff']
                    k['luminosity'] = s['luminosity']
                elif s.get('_from_exo') and s['teff'] != 5600:
                    k['spectral_class'] = s['spectral_class']
                    k['teff'] = s['teff']
                    k['luminosity'] = s['luminosity']
                merged = True
                break
        if not merged:
            kept.append(s)

    # ── Inject missing companion-catalog components ───────
    # Components not in any CSV get injected AFTER dedup so they can't
    # be accidentally merged away by spatial proximity.
    kept_names = {s['main_id'] for s in kept}
    for grp_key, grp in _COMPANION_CATALOG.items():
        for comp in grp['components']:
            if comp['name'] in kept_names:
                continue
            ra_rad = math.radians(comp['ra'])
            dec_rad = math.radians(comp['dec'])
            dp = comp['dist_pc']
            x = dp * math.cos(dec_rad) * math.cos(ra_rad)
            y = dp * math.cos(dec_rad) * math.sin(ra_rad)
            z = dp * math.sin(dec_rad)
            kept.append({
                'main_id': comp['name'],
                'x': round(x, 4),
                'y': round(y, 4),
                'z': round(z, 4),
                'distance_ly': round(dp * 3.26156, 2),
                'spectral_class': comp['spectral_class'],
                'teff': comp['teff'],
                'luminosity': comp['luminosity'],
                'multiplicity': comp['multiplicity'],
                'planet_count': comp['planet_count'],
                'confidence': 'observed',
            })
            logger.info(f"Injected missing component: {comp['name']} (group {grp_key})")

    # Re-sort after injection
    kept.sort(key=lambda s: s['distance_ly'])

    # ── Inject Sol at origin ──────────────────────────
    sol = {
        'main_id': 'Sol',
        'x': 0.0,
        'y': 0.0,
        'z': 0.0,
        'distance_ly': 0.0,
        'spectral_class': 'G',
        'teff': 5778,
        'luminosity': 1.0,
        'multiplicity': 1,
        'planet_count': 8,
        'confidence': 'observed',
    }
    kept.insert(0, sol)

    # Strip internal tracking fields
    for s in kept:
        s.pop('_from_exo', None)

    # ── Attach companion / system-group linkage ───────────
    name_idx = {s['main_id']: i for i, s in enumerate(kept)}
    for s in kept:
        s['companions'] = []
        s['system_group'] = None
        s['group_hierarchy'] = None

    for grp_key, grp in _COMPANION_CATALOG.items():
        comp_names_present = [c['name'] for c in grp['components'] if c['name'] in name_idx]
        for cname in comp_names_present:
            entry = kept[name_idx[cname]]
            entry['system_group'] = grp_key
            entry['group_hierarchy'] = grp['hierarchy']
            for bond in grp['bonds']:
                a_name, b_name, sep_au, bond_type = bond
                if cname == a_name and b_name in name_idx:
                    entry['companions'].append({
                        'name': b_name,
                        'separation_au': sep_au,
                        'bond_type': bond_type,
                    })
                elif cname == b_name and a_name in name_idx:
                    entry['companions'].append({
                        'name': a_name,
                        'separation_au': sep_au,
                        'bond_type': bond_type,
                    })

    logger.info(f"CSV loader: {len(stars)} raw → {len(kept)} after dedup+inject")

    # ── Build planet-data lookup keyed by final main_id ──────────────
    # raw_planets was keyed by the CSV star_name, which may have been renamed
    # or merged during dedup. Build a reverse mapping from old keys → final main_ids.
    final_names = {s['main_id'] for s in kept}
    planets_by_star = {}   # main_id → [planet_dicts]

    # Copy raw_planets under their original keys (most match directly)
    for old_name, plist in raw_planets.items():
        if old_name in final_names:
            planets_by_star.setdefault(old_name, []).extend(plist)
        else:
            # Try normalised match
            nk = _normalise_name(old_name)
            matched = False
            for fn in final_names:
                if _normalise_name(fn) == nk:
                    planets_by_star.setdefault(fn, []).extend(plist)
                    matched = True
                    break
            if not matched:
                # Check alias map
                norm = _re.sub(r'\s+', ' ', old_name.strip().lower())
                if norm in _alias_to_canon:
                    canon = _alias_to_canon[norm]
                    if canon in final_names:
                        planets_by_star.setdefault(canon, []).extend(plist)
                    else:
                        planets_by_star.setdefault(old_name, []).extend(plist)
                else:
                    planets_by_star.setdefault(old_name, []).extend(plist)

    # Sol gets hardcoded planets
    planets_by_star['Sol'] = list(_SOL_PLANETS)

    # ── Run inference for stars without observed planets ──────────────
    belts_by_star = {}
    belts_by_star['Sol'] = list(_SOL_BELTS)

    inferred_planet_count = 0
    inferred_belt_count = 0
    for s in kept:
        mid = s['main_id']
        if mid == 'Sol':
            continue  # Sol has fully hardcoded planet/moon/belt data
        if mid in planets_by_star and len(planets_by_star[mid]) > 0:
            # Already has observed planets — infer moons for planets without them
            rng = _random.Random(_deterministic_seed(mid) + 42)
            for p in planets_by_star[mid]:
                if not p.get('moons'):
                    _infer_moons_for_planet(p, mid, rng)
                # Enrich with tidal lock + temp distribution + mineral abundance
                _enrich_planet_physics(p, s.get('spectral_class', 'G'), s.get('luminosity', 1.0), rng)
            # Also infer belts for observed systems (skip if already set, e.g. Sol)
            if mid not in belts_by_star:
                belts = _infer_belts_for_star(mid, s['spectral_class'], s['luminosity'], planets=planets_by_star.get(mid, []))
                if belts:
                    belts_by_star[mid] = belts
                    inferred_belt_count += len(belts)
        else:
            # No observed planets — infer full system
            inferred = _infer_planets_for_star(
                mid, s['spectral_class'], s['luminosity'],
                star_mass=None,  # We don't store star mass in the system dict
            )
            if inferred:
                rng = _random.Random(_deterministic_seed(mid) + 42)
                for p in inferred:
                    _infer_moons_for_planet(p, mid, rng)
                planets_by_star[mid] = inferred
                s['planet_count'] = len(inferred)
                inferred_planet_count += len(inferred)
            # Infer belts too
            belts = _infer_belts_for_star(mid, s['spectral_class'], s['luminosity'], planets=planets_by_star.get(mid, []))
            if belts:
                belts_by_star[mid] = belts
                inferred_belt_count += len(belts)

    obs_planet_count = sum(len(ps) for mid, ps in planets_by_star.items()
                           if any(p['confidence'] == 'observed' for p in ps))
    logger.info(
        f"Planet data: {obs_planet_count} observed + {inferred_planet_count} inferred planets, "
        f"{inferred_belt_count} inferred belts, across {len(planets_by_star)} systems"
    )

    return kept, planets_by_star, belts_by_star


# ── Ensure data caches are populated ─────────────────────────────

def _ensure_caches():
    """Populate module-level caches if empty."""
    global _systems_cache, _planet_cache, _belt_cache
    if _systems_cache is not None:
        return
    systems, planets, belts = _load_systems_from_csv()
    _systems_cache = systems
    _planet_cache = planets
    _belt_cache = belts


# ── System architecture classification ───────────────────────────

def _classify_system_architecture(planets, belts):
    """Classify the overall system architecture.

    Returns dict with:
      - class: 'solar-analog', 'hot-jupiter-dominated', 'compact-multi',
               'giant-rich', 'desert', 'exotic-mix', 'dwarf-only'
      - features: list of notable characteristics
    """
    if not planets:
        return {'class': 'desert', 'features': ['no_detected_planets']}

    features = []
    ptypes = [p.get('planet_type', '') for p in planets]
    masses = [p.get('mass_earth', 0) or 0 for p in planets]
    smas = [p.get('semi_major_axis_au', 0) or 0 for p in planets]

    # Count categories
    giants = sum(1 for t in ptypes if t in ('gas-giant', 'super-jupiter', 'hot-jupiter'))
    rockies = sum(1 for t in ptypes if t in ('rocky', 'earth-like', 'super-earth', 'desert-world', 'iron-planet'))
    neptunes = sum(1 for t in ptypes if t in ('neptune-like', 'warm-neptune', 'mini-neptune', 'sub-neptune'))
    exotics = sum(1 for t in ptypes if t in ('eyeball-world', 'ocean-world', 'lava-world', 'carbon-planet', 'hycean', 'chthonian'))

    # Hot Jupiter?
    hot_jupiters = [p for p in planets if p.get('planet_type') == 'hot-jupiter']
    if hot_jupiters:
        features.append('hot_jupiter_present')

    # Habitable zone planets
    hz_planets = [p for p in planets if 'habitable_zone' in (p.get('sub_type_flags') or [])]
    if hz_planets:
        features.append(f'{len(hz_planets)}_hz_planets')

    # Tidal locking
    locked = sum(1 for p in planets if p.get('tidally_locked'))
    if locked:
        features.append(f'{locked}_tidally_locked')

    # Resonance chains
    resonant = sum(1 for p in planets if p.get('resonances'))
    if resonant >= 3:
        features.append('resonance_chain')

    # Ring systems
    ringed = sum(1 for p in planets if p.get('ring_system'))
    if ringed:
        features.append(f'{ringed}_ringed_planets')

    # Belt richness
    n_belts = len(belts)
    trojans = sum(1 for b in belts if b.get('belt_type') == 'trojan-swarm')
    if trojans:
        features.append(f'{trojans}_trojan_swarms')

    # Classify
    if hot_jupiters and giants <= 2:
        arch_class = 'hot-jupiter-dominated'
    elif len(planets) >= 5 and max(smas) < 2.0:
        arch_class = 'compact-multi'
    elif giants >= 3:
        arch_class = 'giant-rich'
    elif rockies >= 3 and giants >= 1 and n_belts >= 2:
        arch_class = 'solar-analog'
    elif exotics >= 2:
        arch_class = 'exotic-mix'
    elif all(m < 0.5 for m in masses):
        arch_class = 'dwarf-only'
    else:
        arch_class = 'mixed'

    return {'class': arch_class, 'features': features}


# ── System-detail API (per-star planetary system) ────────────────

@app.route('/api/system/<path:main_id>')
def api_system_detail(main_id):
    """
    GET /api/system/<main_id>

    Return the full planetary system for a single star:
    star metadata + observed/inferred planets (with moons) + belts (with asteroids).

    The main_id should be URL-encoded if it contains special characters.
    """
    _ensure_caches()

    # Find the star in the cache
    star = None
    for s in _systems_cache:
        if s['main_id'] == main_id:
            star = s
            break

    if star is None:
        return jsonify({'error': f'Star system "{main_id}" not found'}), 404

    planets = _planet_cache.get(main_id, [])
    belts = _belt_cache.get(main_id, [])

    # Compute habitable zone bounds
    hz_in, hz_out = _hz_bounds(star.get('luminosity', 1.0))

    # Protoplanetary disc inference
    disc = _infer_protoplanetary_disc(star, planets, belts)

    # Summary counts
    observed_count = sum(1 for p in planets if p.get('confidence') == 'observed')
    inferred_count = sum(1 for p in planets if p.get('confidence') == 'inferred')
    total_moons = sum(len(p.get('moons', [])) for p in planets)

    # Architecture classification
    arch = _classify_system_architecture(planets, belts)

    # Resonance chains across the system
    resonance_chains = []
    for p in planets:
        for r in p.get('resonances', []):
            if r.get('role') == 'inner':
                resonance_chains.append({
                    'inner': p['planet_name'],
                    'outer': r['partner'],
                    'ratio': r['ratio'],
                })

    # Planet type census
    type_census = {}
    for p in planets:
        pt = p.get('planet_type', 'unknown')
        type_census[pt] = type_census.get(pt, 0) + 1

    # Moon type census
    moon_type_census = {}
    for p in planets:
        for m in p.get('moons', []):
            mt = m.get('moon_type', 'unknown')
            moon_type_census[mt] = moon_type_census.get(mt, 0) + 1

    # Trojan swarm count
    trojan_count = sum(1 for b in belts if b.get('belt_type') == 'trojan-swarm')

    # Count ring-bearing planets
    ringed_count = sum(1 for p in planets if p.get('ring_system'))

    return jsonify({
        'star': star,
        'planets': planets,
        'belts': belts,
        'habitable_zone': {'inner_au': hz_in, 'outer_au': hz_out},
        'protoplanetary_disc': disc,
        'architecture': arch,
        'resonance_chains': resonance_chains,
        'summary': {
            'observed_planets': observed_count,
            'inferred_planets': inferred_count,
            'total_planets': len(planets),
            'total_moons': total_moons,
            'total_belts': len(belts),
            'trojan_swarms': trojan_count,
            'ringed_planets': ringed_count,
            'planet_types': type_census,
            'moon_types': moon_type_census,
        },
    })


@app.route('/api/systems/planets/summary')
def api_systems_planets_summary():
    """
    GET /api/systems/planets/summary

    Quick summary of planet counts per star, for the star map to use.
    Returns list of {main_id, observed_count, inferred_count, total}.
    """
    _ensure_caches()
    summary = []
    for mid, planets in _planet_cache.items():
        obs = sum(1 for p in planets if p.get('confidence') == 'observed')
        inf = sum(1 for p in planets if p.get('confidence') == 'inferred')
        summary.append({
            'main_id': mid,
            'observed_count': obs,
            'inferred_count': inf,
            'total': len(planets),
        })
    return jsonify({'systems': summary, 'total_systems': len(summary)})


@app.route('/api/system-group/<path:group_name>')
def api_system_group(group_name):
    """
    GET /api/system-group/<group_name>

    Return the full multi-star system group: all member stars with their
    planets, belts, habitable zones, and protoplanetary disc status.
    For single-star systems, returns just that one star.
    """
    _ensure_caches()

    # Find all stars in the group
    members = [s for s in _systems_cache if s.get('system_group') == group_name]
    if not members:
        # Try as single star
        members = [s for s in _systems_cache if s['main_id'] == group_name]
    if not members:
        return jsonify({'error': f'System group "{group_name}" not found'}), 404

    # Sort by luminosity descending (primary star first)
    members.sort(key=lambda s: s.get('luminosity', 0), reverse=True)

    stars_data = []
    for star in members:
        mid = star['main_id']
        planets = _planet_cache.get(mid, [])
        belts = _belt_cache.get(mid, [])
        hz_in, hz_out = _hz_bounds(star.get('luminosity', 1.0))

        observed_count = sum(1 for p in planets if p.get('confidence') == 'observed')
        inferred_count = sum(1 for p in planets if p.get('confidence') == 'inferred')
        total_moons = sum(len(p.get('moons', [])) for p in planets)

        # Protoplanetary disc inference
        disc = _infer_protoplanetary_disc(star, planets, belts)

        stars_data.append({
            'star': star,
            'planets': planets,
            'belts': belts,
            'habitable_zone': {'inner_au': hz_in, 'outer_au': hz_out},
            'protoplanetary_disc': disc,
            'summary': {
                'observed_planets': observed_count,
                'inferred_planets': inferred_count,
                'total_planets': len(planets),
                'total_moons': total_moons,
                'total_belts': len(belts),
            },
        })

    # Group-level hierarchy info
    hierarchy = members[0].get('group_hierarchy') if members else None
    total_planets = sum(sd['summary']['total_planets'] for sd in stars_data)
    total_moons = sum(sd['summary']['total_moons'] for sd in stars_data)
    total_belts = sum(sd['summary']['total_belts'] for sd in stars_data)

    return jsonify({
        'group_name': group_name,
        'hierarchy': hierarchy,
        'star_count': len(members),
        'stars': stars_data,
        'group_summary': {
            'total_stars': len(members),
            'total_planets': total_planets,
            'total_moons': total_moons,
            'total_belts': total_belts,
        },
    })


def _infer_protoplanetary_disc(star, planets, belts):
    """Infer whether a star has a protoplanetary or debris disc.

    Heuristics:
      - Young/hot stars (O, B, A) with few planets → active protoplanetary disc
      - Stars with belts but few planets → transitional disc
      - Stars with many planets → fully cleared (no disc)
      - Late-type stars (M, L, T) → thin debris disc if belts present
    """
    sp = (star.get('spectral_class') or 'G')[0].upper()
    n_planets = len(planets)
    n_belts = len(belts)
    lum = star.get('luminosity', 1.0)
    lum_scale = math.sqrt(max(lum, 0.0001))

    # Hot blue stars with few planets: active protoplanetary
    if sp in ('O', 'B') and n_planets <= 1:
        return {
            'disc_type': 'protoplanetary',
            'inner_radius_au': round(0.5 * lum_scale, 2),
            'outer_radius_au': round(80.0 * lum_scale, 2),
            'density': 0.8,
            'opacity': 0.5,
            'color_hint': 'warm',   # amber/red glow
            'confidence': 'inferred',
        }

    # A-type stars with few planets: transitional disc
    if sp == 'A' and n_planets <= 2:
        return {
            'disc_type': 'transitional',
            'inner_radius_au': round(2.0 * lum_scale, 2),
            'outer_radius_au': round(60.0 * lum_scale, 2),
            'density': 0.5,
            'opacity': 0.3,
            'color_hint': 'warm',
            'confidence': 'inferred',
        }

    # Stars with belts but sparse planets: debris disc
    if n_belts > 0 and n_planets <= 3:
        return {
            'disc_type': 'debris',
            'inner_radius_au': round(1.0 * lum_scale, 2),
            'outer_radius_au': round(40.0 * lum_scale, 2),
            'density': 0.2,
            'opacity': 0.12,
            'color_hint': 'cool',   # blue-grey
            'confidence': 'inferred',
        }

    return None


# ── SPA catch-all (React client) ────────────────────────────────

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_spa(path):
    """
    Serve the React single-page application.
    API routes and /phase01/* are handled by their own decorators first.
    Static files (JS/CSS/images) are served directly; everything else
    gets index.html so React Router can handle client-side routing.
    """
    if os.path.isdir(_CLIENT_BUILD):
        if path and os.path.exists(os.path.join(_CLIENT_BUILD, path)):
            return send_from_directory(_CLIENT_BUILD, path)
        return send_from_directory(_CLIENT_BUILD, 'index.html')
    # Fallback: if no React build exists, show a helpful message
    return jsonify({
        'message': 'ExoMaps API is running. Build the React client with: cd 02_CLIENTS/01_WEB && npm run build',
        'api_health': '/api/health'
    })


if __name__ == "__main__":
    debug_mode = os.environ.get('FLASK_DEBUG', 'false').lower() in ('true', '1', 'yes')
    app.run(host="0.0.0.0", port=int(os.environ.get('PORT', '5000')), debug=debug_mode, use_reloader=debug_mode)