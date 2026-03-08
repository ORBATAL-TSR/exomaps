"""
campaigns.py — Campaign & Exploration API (Fog-of-War).

Blueprint providing CRUD endpoints for campaigns, exploration tracking,
and baked planet asset management.  Desktop clients generate content;
web clients view explored territory through these endpoints.

All routes are prefixed with /api/campaigns.
"""

from flask import Blueprint, request, jsonify
import logging

log = logging.getLogger(__name__)

campaigns_bp = Blueprint('campaigns', __name__, url_prefix='/api/campaigns')


# ── Campaign CRUD ──────────────────────────────────────


@campaigns_bp.route('', methods=['POST'])
def create_campaign():
    """Create a new campaign / game instance."""
    body = request.get_json(force=True)
    name = body.get('name', 'Untitled Campaign')
    seed = body.get('seed')
    settings = body.get('settings', {})
    # TODO: INSERT INTO app_simulation.campaign
    log.info('Campaign created: %s', name)
    return jsonify({
        'id': 'stub-campaign-id',
        'name': name,
        'seed': seed,
        'settings': settings,
        'status': 'active',
    }), 201


@campaigns_bp.route('', methods=['GET'])
def list_campaigns():
    """List all campaigns (optionally filtered by status)."""
    status = request.args.get('status', 'active')
    # TODO: SELECT FROM app_simulation.campaign WHERE status = ?
    return jsonify({'campaigns': [], 'total': 0, 'filter_status': status})


@campaigns_bp.route('/<campaign_id>', methods=['GET'])
def get_campaign(campaign_id):
    """Get campaign details + summary stats."""
    # TODO: SELECT FROM app_simulation.v_campaign_summary WHERE campaign_id = ?
    return jsonify({
        'id': campaign_id,
        'name': 'Stub Campaign',
        'status': 'active',
        'systems_explored': 0,
        'planets_surveyed': 0,
        'factions': 0,
    })


@campaigns_bp.route('/<campaign_id>', methods=['PATCH'])
def update_campaign(campaign_id):
    """Update campaign name, settings, or status."""
    body = request.get_json(force=True)
    # TODO: UPDATE app_simulation.campaign SET ... WHERE id = ?
    return jsonify({'id': campaign_id, 'updated': True})


@campaigns_bp.route('/<campaign_id>', methods=['DELETE'])
def delete_campaign(campaign_id):
    """Archive (soft-delete) a campaign."""
    # TODO: UPDATE app_simulation.campaign SET status = 'archived' WHERE id = ?
    return jsonify({'id': campaign_id, 'status': 'archived'})


# ── Fog-of-War Map ─────────────────────────────────────


@campaigns_bp.route('/<campaign_id>/map', methods=['GET'])
def get_campaign_map(campaign_id):
    """
    Get the explored star map for a campaign.
    Returns ONLY systems that have been explored (fog-of-war).
    Query params: ?scan_level=1 (minimum scan level filter)
    """
    min_scan = request.args.get('scan_level', 1, type=int)
    # TODO: SELECT FROM app_simulation.v_campaign_map
    #       WHERE campaign_id = ? AND scan_level >= ?
    return jsonify({
        'campaign_id': campaign_id,
        'systems': [],
        'total_explored': 0,
        'min_scan_level': min_scan,
    })


# ── Exploration ────────────────────────────────────────


@campaigns_bp.route('/<campaign_id>/systems/<path:system_id>/explore', methods=['POST'])
def explore_system(campaign_id, system_id):
    """
    Mark a system as explored — lifts the fog of war.
    Body: { explored_by?: string, scan_level?: 1|2|3, notes?: string }
    """
    body = request.get_json(force=True) if request.data else {}
    explored_by = body.get('explored_by')
    scan_level = body.get('scan_level', 1)
    notes = body.get('notes')
    # TODO: INSERT INTO app_simulation.exploration (campaign_id, system_main_id, ...)
    #       ON CONFLICT (campaign_id, system_main_id) DO UPDATE SET scan_level = GREATEST(...)
    log.info('System explored: %s in campaign %s (level %d)',
             system_id, campaign_id, scan_level)
    return jsonify({
        'campaign_id': campaign_id,
        'system_main_id': system_id,
        'explored_by': explored_by,
        'scan_level': scan_level,
        'is_new': True,
    }), 201


@campaigns_bp.route('/<campaign_id>/systems/<path:system_id>', methods=['GET'])
def get_exploration(campaign_id, system_id):
    """Get exploration details for a specific system in a campaign."""
    # TODO: SELECT FROM app_simulation.exploration WHERE campaign_id = ? AND system_main_id = ?
    return jsonify({
        'campaign_id': campaign_id,
        'system_main_id': system_id,
        'explored': False,
        'scan_level': 0,
        'planets': [],
    })


# ── Baked Planet Assets ────────────────────────────────


@campaigns_bp.route('/<campaign_id>/systems/<path:system_id>/planets/<int:planet_index>/bake',
                     methods=['POST'])
def bake_planet(campaign_id, system_id, planet_index):
    """
    Upload baked planet textures from desktop client.
    The desktop generates the planet, then POSTs the textures here
    so web clients can display them without a GPU.

    Body (multipart or JSON):
      - generation_seed: int
      - summary_json: { composition, atmosphere, geology }
      - albedo: base64 or file
      - heightmap: base64 or file
      - normal: base64 or file
      - pbr: base64 or file
      - thumbnail: base64 (128x128 preview)
    """
    body = request.get_json(force=True) if request.is_json else {}
    planet_key = f"{system_id}_{planet_index}"
    # TODO: INSERT INTO app_simulation.explored_planet (...)
    log.info('Planet baked: %s in campaign %s', planet_key, campaign_id)
    return jsonify({
        'campaign_id': campaign_id,
        'planet_key': planet_key,
        'stored': True,
    }), 201


@campaigns_bp.route('/<campaign_id>/planets/<planet_key>/textures', methods=['GET'])
def get_planet_textures(campaign_id, planet_key):
    """
    Retrieve baked textures for a planet (for web client rendering).
    Returns URLs or inline base64 depending on storage backend.
    """
    # TODO: SELECT FROM app_simulation.explored_planet WHERE planet_key = ?
    return jsonify({
        'planet_key': planet_key,
        'albedo_url': None,
        'heightmap_url': None,
        'normal_url': None,
        'pbr_url': None,
        'thumbnail_url': None,
        'summary': None,
    })


# ── Factions (stub) ───────────────────────────────────


@campaigns_bp.route('/<campaign_id>/factions', methods=['GET'])
def list_factions(campaign_id):
    """List all factions in a campaign."""
    # TODO: SELECT FROM app_simulation.campaign_faction WHERE campaign_id = ?
    return jsonify({'campaign_id': campaign_id, 'factions': []})


@campaigns_bp.route('/<campaign_id>/factions', methods=['POST'])
def create_faction(campaign_id):
    """Create a new faction in a campaign."""
    body = request.get_json(force=True)
    name = body.get('name', 'Unknown Faction')
    color = body.get('color', '#4d9fff')
    home_system = body.get('home_system_id')
    # TODO: INSERT INTO app_simulation.campaign_faction (...)
    return jsonify({
        'campaign_id': campaign_id,
        'name': name,
        'color': color,
        'home_system_id': home_system,
    }), 201
