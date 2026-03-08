"""
app.py — World Engine HTTP Service
====================================

Flask micro-service wrapping the persistent WorldEngine.
Runs on port 5001 (gateway is 5000).

Endpoints:
    POST   /api/engine/<campaign_id>/init     — create simulation run
    POST   /api/engine/<campaign_id>/tick      — advance N ticks
    GET    /api/engine/<campaign_id>/snapshot   — full state
    GET    /api/engine/<campaign_id>/status     — lightweight summary
    POST   /api/engine/<campaign_id>/pause      — pause simulation
    POST   /api/engine/<campaign_id>/resume     — resume simulation
    POST   /api/engine/<campaign_id>/reset      — wipe simulation state
    GET    /api/engine/<campaign_id>/events     — event log query
    GET    /api/engine/health                   — health check
"""

from __future__ import annotations

import logging
import os

from flask import Flask, jsonify, request
from flask_cors import CORS
from sqlalchemy import create_engine, text

from engine import WorldEngine

# ── App setup ──────────────────────────────────────────

app = Flask(__name__)
CORS(app)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(name)s] %(levelname)s %(message)s',
)
log = logging.getLogger('world_engine')

# ── DB connection ──────────────────────────────────────

def _build_engine():
    dbuser = os.environ.get('POSTGRES_USER', 'postgres')
    dbpass = os.environ.get('POSTGRES_PASSWORD', '')
    dbhost = os.environ.get('POSTGRES_HOST', 'localhost')
    dbname = os.environ.get('POSTGRES_DB', 'exomaps')
    dbport = os.environ.get('POSTGRES_PORT', '5432')

    if not dbpass and dbhost in ('localhost', '127.0.0.1'):
        uri = f'postgresql+psycopg2:///{dbname}'
    elif dbhost.startswith('/'):
        if dbpass:
            uri = f'postgresql+psycopg2://{dbuser}:{dbpass}@/{dbname}?host={dbhost}'
        else:
            uri = f'postgresql+psycopg2://{dbuser}@/{dbname}?host={dbhost}'
    else:
        if dbpass:
            uri = f'postgresql+psycopg2://{dbuser}:{dbpass}@{dbhost}:{dbport}/{dbname}'
        else:
            uri = f'postgresql+psycopg2://{dbuser}@{dbhost}:{dbport}/{dbname}'

    try:
        eng = create_engine(uri, pool_size=3, max_overflow=5,
                            pool_recycle=1800, pool_pre_ping=True)
        with eng.connect() as c:
            c.execute(text('SELECT 1'))
        log.info('✓ DB connected: %s', dbname)
        return eng
    except Exception as exc:
        log.error('✗ DB connection failed: %s', exc)
        return None


db = _build_engine()
world = WorldEngine(db) if db else None


def _require_engine():
    if world is None:
        return jsonify({'error': 'db_unavailable',
                        'message': 'World Engine has no database connection'}), 503
    return None


# ── Health ─────────────────────────────────────────────

@app.route('/api/engine/health')
def health():
    ok = db is not None
    if ok:
        try:
            with db.connect() as c:
                c.execute(text('SELECT 1'))
        except Exception:
            ok = False
    return jsonify({
        'service': 'world_engine',
        'healthy': ok,
        'db_connected': ok,
    }), 200 if ok else 503


# ── Init ───────────────────────────────────────────────

@app.route('/api/engine/<campaign_id>/init', methods=['POST'])
def init_campaign(campaign_id):
    """Create simulation run + seed settlement for a campaign."""
    err = _require_engine()
    if err:
        return err

    body = request.get_json(force=True) if request.data else {}
    try:
        result = world.init_campaign(
            campaign_id,
            seed=body.get('seed'),
            starting_system=body.get('starting_system', 'Sol'),
            starting_faction=body.get('starting_faction', 'UNE'),
            starting_population=body.get('starting_population', 10_000_000),
        )
        return jsonify(result), 201
    except Exception as exc:
        log.error('init_campaign failed: %s', exc)
        return jsonify({'error': 'init_failed', 'message': str(exc)}), 500


# ── Tick ───────────────────────────────────────────────

@app.route('/api/engine/<campaign_id>/tick', methods=['POST'])
def tick_campaign(campaign_id):
    """Advance simulation by N ticks. Body: { n?: int, max_wall_sec?: float }"""
    err = _require_engine()
    if err:
        return err

    body = request.get_json(force=True) if request.data else {}
    n = min(body.get('n', 1), 1000)
    max_wall = body.get('max_wall_sec', 30.0)

    try:
        result = world.tick(campaign_id, n=n, max_wall_sec=max_wall)
        if 'error' in result:
            return jsonify(result), 404
        return jsonify(result)
    except Exception as exc:
        log.error('tick failed: %s', exc)
        return jsonify({'error': 'tick_failed', 'message': str(exc)}), 500


# ── Snapshot ───────────────────────────────────────────

@app.route('/api/engine/<campaign_id>/snapshot')
def snapshot_campaign(campaign_id):
    """Full state: settlements, events, metadata."""
    err = _require_engine()
    if err:
        return err

    try:
        result = world.snapshot(campaign_id)
        if result is None:
            return jsonify({'error': 'not_found'}), 404
        return jsonify(result)
    except Exception as exc:
        log.error('snapshot failed: %s', exc)
        return jsonify({'error': 'snapshot_failed', 'message': str(exc)}), 500


# ── Status ─────────────────────────────────────────────

@app.route('/api/engine/<campaign_id>/status')
def status_campaign(campaign_id):
    """Lightweight summary (no settlement data)."""
    err = _require_engine()
    if err:
        return err

    try:
        result = world.status(campaign_id)
        if result is None:
            return jsonify({'error': 'not_found'}), 404
        return jsonify(result)
    except Exception as exc:
        log.error('status failed: %s', exc)
        return jsonify({'error': 'status_failed', 'message': str(exc)}), 500


# ── Events ─────────────────────────────────────────────

@app.route('/api/engine/<campaign_id>/events')
def events_campaign(campaign_id):
    """
    GET /api/engine/<cid>/events?limit=50&after_tick=0&type=discovery
    """
    err = _require_engine()
    if err:
        return err

    limit = request.args.get('limit', 50, type=int)
    after_tick = request.args.get('after_tick', 0, type=int)
    etype = request.args.get('type')

    run = world._get_run(campaign_id)
    if run is None:
        return jsonify({'error': 'not_found'}), 404

    filters = "WHERE se.run_id = :rid AND se.tick > :after"
    params: dict = {'rid': run['id'], 'after': after_tick, 'lim': limit}
    if etype:
        filters += " AND se.event_type = :etype"
        params['etype'] = etype

    sql = f"""
        SELECT se.tick, se.event_type, se.location, se.description,
               se.impact_json, se.created_at
        FROM app_simulation.simulation_event se
        {filters}
        ORDER BY se.tick DESC LIMIT :lim
    """
    try:
        from engine import _ser_row, _row_dict
        with db.connect() as conn:
            rows = [_ser_row(_row_dict(r))
                    for r in conn.execute(text(sql), params).fetchall()]
        return jsonify({
            'campaign_id': campaign_id,
            'events': rows,
            'count': len(rows),
            'current_tick': int(run['current_tick']),
        })
    except Exception as exc:
        log.error('events query failed: %s', exc)
        return jsonify({'error': 'query_failed', 'message': str(exc)}), 500


# ── Pause / Resume / Reset ────────────────────────────

@app.route('/api/engine/<campaign_id>/pause', methods=['POST'])
def pause_campaign(campaign_id):
    err = _require_engine()
    if err:
        return err
    try:
        return jsonify(world.pause(campaign_id))
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500


@app.route('/api/engine/<campaign_id>/resume', methods=['POST'])
def resume_campaign(campaign_id):
    err = _require_engine()
    if err:
        return err
    try:
        return jsonify(world.resume(campaign_id))
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500


@app.route('/api/engine/<campaign_id>/reset', methods=['POST'])
def reset_campaign(campaign_id):
    err = _require_engine()
    if err:
        return err
    try:
        return jsonify(world.reset(campaign_id))
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500


# ── Run ────────────────────────────────────────────────

if __name__ == '__main__':
    port = int(os.environ.get('WORLD_ENGINE_PORT', 5001))
    log.info('World Engine starting on port %d', port)
    app.run(host='0.0.0.0', port=port, debug=True)
