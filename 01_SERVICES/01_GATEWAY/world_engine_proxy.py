"""
world_engine_proxy.py — Gateway proxy to World Engine service.

Routes campaign-simulation requests from the gateway to the
World Engine micro-service running on WORLD_ENGINE_URL.
Falls back to an in-process engine if the service is unreachable.

All routes prefixed with /api/campaigns/<id>/simulation.
"""

from __future__ import annotations

import logging
import os

import requests as http_requests
from flask import Blueprint, jsonify, request

log = logging.getLogger(__name__)

engine_bp = Blueprint('world_engine', __name__)

# World Engine service URL — same host in dev, separate container in prod
WORLD_ENGINE_URL = os.environ.get('WORLD_ENGINE_URL', 'http://localhost:5001')


def _proxy(method: str, path: str, json_body: dict | None = None, params: dict | None = None):
    """Forward a request to the World Engine service."""
    url = f'{WORLD_ENGINE_URL}{path}'
    try:
        resp = http_requests.request(method, url, json=json_body, params=params, timeout=60)
        return jsonify(resp.json()), resp.status_code
    except http_requests.ConnectionError:
        return jsonify({
            'error': 'engine_unavailable',
            'message': 'World Engine service is not running. '
                       f'Expected at {WORLD_ENGINE_URL}',
        }), 503
    except Exception as exc:
        log.error('World Engine proxy error: %s', exc)
        return jsonify({'error': 'proxy_error', 'message': str(exc)}), 502


# ── Campaign-Simulation Endpoints ─────────────────────

@engine_bp.route('/api/campaigns/<campaign_id>/simulation/init', methods=['POST'])
def init_simulation(campaign_id):
    """Initialize the World Engine simulation for a campaign."""
    body = request.get_json(force=True) if request.data else {}
    return _proxy('POST', f'/api/engine/{campaign_id}/init', json_body=body)


@engine_bp.route('/api/campaigns/<campaign_id>/simulation/tick', methods=['POST'])
def tick_simulation(campaign_id):
    """Advance simulation by N ticks."""
    body = request.get_json(force=True) if request.data else {}
    return _proxy('POST', f'/api/engine/{campaign_id}/tick', json_body=body)


@engine_bp.route('/api/campaigns/<campaign_id>/simulation/snapshot')
def snapshot_simulation(campaign_id):
    """Get full simulation state."""
    return _proxy('GET', f'/api/engine/{campaign_id}/snapshot')


@engine_bp.route('/api/campaigns/<campaign_id>/simulation/status')
def status_simulation(campaign_id):
    """Get lightweight simulation status."""
    return _proxy('GET', f'/api/engine/{campaign_id}/status')


@engine_bp.route('/api/campaigns/<campaign_id>/simulation/events')
def events_simulation(campaign_id):
    """Query simulation event log."""
    params = {k: v for k, v in request.args.items()}
    return _proxy('GET', f'/api/engine/{campaign_id}/events', params=params)


@engine_bp.route('/api/campaigns/<campaign_id>/simulation/pause', methods=['POST'])
def pause_simulation(campaign_id):
    """Pause the simulation."""
    return _proxy('POST', f'/api/engine/{campaign_id}/pause')


@engine_bp.route('/api/campaigns/<campaign_id>/simulation/resume', methods=['POST'])
def resume_simulation(campaign_id):
    """Resume the simulation."""
    return _proxy('POST', f'/api/engine/{campaign_id}/resume')


@engine_bp.route('/api/campaigns/<campaign_id>/simulation/reset', methods=['POST'])
def reset_simulation(campaign_id):
    """Reset (wipe) simulation state for a campaign."""
    return _proxy('POST', f'/api/engine/{campaign_id}/reset')


# ── Engine Health (for admin dashboard) ────────────────

@engine_bp.route('/api/engine/health')
def engine_health():
    """Proxy the World Engine health check."""
    return _proxy('GET', '/api/engine/health')
