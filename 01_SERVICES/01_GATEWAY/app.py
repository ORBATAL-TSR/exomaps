import os
import math
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
        engine = create_engine(database_uri)
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
        systems = _load_systems_from_csv()

    return jsonify({
        'systems': systems,
        'total_count': len(systems),
        'persona': current_role,
        'source': 'database' if db_status.get('connected') and systems else 'csv_fallback'
    })


def _load_systems_from_csv():
    """Load and deduplicate star systems from CSV source files."""
    import csv
    import hashlib

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
                    }
        except Exception as e:
            logger.warning(f"SIMBAD CSV parse error: {e}")

    # ── Parse exoplanet catalog ──
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
                        }
        except Exception as e:
            logger.warning(f"Exoplanet CSV parse error: {e}")

    # ── Detect binary/multiple from name patterns ──
    for name, s in stars.items():
        if s['multiplicity'] < 2:
            lower = name.lower()
            if ' ab' in lower or '(ab)' in lower or ' a ' in lower:
                s['multiplicity'] = 2
            elif any(suf in name for suf in [' ABC', ' ABCD']):
                s['multiplicity'] = 3

    result = sorted(stars.values(), key=lambda s: s['distance_ly'])
    return result


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