"""
campaigns.py — Campaign & Exploration API (Fog-of-War).

Blueprint providing CRUD endpoints for campaigns, exploration tracking,
and baked planet asset management.  Desktop clients generate content;
web clients view explored territory through these endpoints.

All routes are prefixed with /api/campaigns.
"""

from flask import Blueprint, request, jsonify, current_app
from sqlalchemy.exc import SQLAlchemyError, IntegrityError
import logging

import campaign_dao as dao

log = logging.getLogger(__name__)

campaigns_bp = Blueprint('campaigns', __name__, url_prefix='/api/campaigns')


def _engine():
    """Get the SQLAlchemy engine from Flask app config."""
    engine = current_app.config.get('DB_ENGINE')
    if engine is None:
        raise RuntimeError('Database engine not configured')
    return engine


# ── Campaign CRUD ──────────────────────────────────────


@campaigns_bp.route('', methods=['POST'])
def create_campaign():
    """Create a new campaign / game instance."""
    body = request.get_json(force=True)
    name = body.get('name', 'Untitled Campaign')
    seed = body.get('seed')
    settings = body.get('settings', {})
    owner_id = body.get('owner_id')

    try:
        result = dao.create_campaign(
            _engine(), name=name, seed=seed, settings=settings, owner_id=owner_id,
        )
        log.info('Campaign created: %s (id=%s)', name, result.get('id'))
        return jsonify(result), 201
    except SQLAlchemyError as exc:
        log.error('Failed to create campaign: %s', exc)
        return jsonify({'error': 'db_error', 'message': str(exc)}), 500


@campaigns_bp.route('', methods=['GET'])
def list_campaigns():
    """List all campaigns (optionally filtered by status)."""
    status = request.args.get('status', 'active')
    limit = request.args.get('limit', 100, type=int)
    offset = request.args.get('offset', 0, type=int)

    try:
        result = dao.list_campaigns(
            _engine(), status=status or None, limit=limit, offset=offset,
        )
        return jsonify(result)
    except SQLAlchemyError as exc:
        log.error('Failed to list campaigns: %s', exc)
        return jsonify({'error': 'db_error', 'message': str(exc)}), 500


@campaigns_bp.route('/<campaign_id>', methods=['GET'])
def get_campaign(campaign_id):
    """Get campaign details + summary stats."""
    try:
        result = dao.get_campaign(_engine(), campaign_id)
        if result is None:
            return jsonify({'error': 'not_found', 'message': f'Campaign {campaign_id} not found'}), 404
        return jsonify(result)
    except SQLAlchemyError as exc:
        log.error('Failed to get campaign %s: %s', campaign_id, exc)
        return jsonify({'error': 'db_error', 'message': str(exc)}), 500


@campaigns_bp.route('/<campaign_id>', methods=['PATCH'])
def update_campaign(campaign_id):
    """Update campaign name, settings, or status."""
    body = request.get_json(force=True)

    try:
        result = dao.update_campaign(_engine(), campaign_id, **body)
        if result is None:
            return jsonify({'error': 'not_found', 'message': f'Campaign {campaign_id} not found'}), 404
        return jsonify(result)
    except SQLAlchemyError as exc:
        log.error('Failed to update campaign %s: %s', campaign_id, exc)
        return jsonify({'error': 'db_error', 'message': str(exc)}), 500


@campaigns_bp.route('/<campaign_id>', methods=['DELETE'])
def delete_campaign(campaign_id):
    """Archive (soft-delete) a campaign."""
    try:
        result = dao.archive_campaign(_engine(), campaign_id)
        if result is None:
            return jsonify({'error': 'not_found', 'message': f'Campaign {campaign_id} not found'}), 404
        return jsonify(result)
    except SQLAlchemyError as exc:
        log.error('Failed to archive campaign %s: %s', campaign_id, exc)
        return jsonify({'error': 'db_error', 'message': str(exc)}), 500


# ── Fog-of-War Map ─────────────────────────────────────


@campaigns_bp.route('/<campaign_id>/map', methods=['GET'])
def get_campaign_map(campaign_id):
    """
    Get the explored star map for a campaign.
    Returns ONLY systems that have been explored (fog-of-war).
    Query params: ?scan_level=1 (minimum scan level filter)
    """
    min_scan = request.args.get('scan_level', 1, type=int)

    try:
        result = dao.get_campaign_map(_engine(), campaign_id, min_scan_level=min_scan)
        return jsonify(result)
    except SQLAlchemyError as exc:
        log.error('Failed to get campaign map %s: %s', campaign_id, exc)
        return jsonify({'error': 'db_error', 'message': str(exc)}), 500


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

    try:
        result = dao.explore_system(
            _engine(),
            campaign_id=campaign_id,
            system_id=system_id,
            explored_by=explored_by,
            scan_level=scan_level,
            notes=notes,
        )
        is_new = result.get('is_new', True)
        status_code = 201 if is_new else 200
        log.info('System explored: %s in campaign %s (level %d, new=%s)',
                 system_id, campaign_id, scan_level, is_new)
        return jsonify(result), status_code
    except SQLAlchemyError as exc:
        log.error('Failed to explore system %s: %s', system_id, exc)
        return jsonify({'error': 'db_error', 'message': str(exc)}), 500


@campaigns_bp.route('/<campaign_id>/systems/<path:system_id>', methods=['GET'])
def get_exploration(campaign_id, system_id):
    """Get exploration details for a specific system in a campaign."""
    try:
        result = dao.get_exploration(_engine(), campaign_id, system_id)
        return jsonify(result)
    except SQLAlchemyError as exc:
        log.error('Failed to get exploration %s/%s: %s', campaign_id, system_id, exc)
        return jsonify({'error': 'db_error', 'message': str(exc)}), 500


# ── Baked Planet Assets ────────────────────────────────


@campaigns_bp.route('/<campaign_id>/systems/<path:system_id>/planets/<int:planet_index>/bake',
                     methods=['POST'])
def bake_planet(campaign_id, system_id, planet_index):
    """
    Upload baked planet textures from desktop client.
    The desktop generates the planet, then POSTs the textures here
    so web clients can display them without a GPU.

    Body (JSON):
      - generation_seed: int
      - scan_level: 1|2|3
      - summary_json: { composition, atmosphere, geology }
      - albedo_url: string (URL or base64)
      - heightmap_url: string
      - normal_url: string
      - pbr_url: string
      - thumbnail_url: string (128x128 preview)
    """
    body = request.get_json(force=True) if request.is_json else {}

    try:
        result = dao.bake_planet(
            _engine(),
            campaign_id=campaign_id,
            system_id=system_id,
            planet_index=planet_index,
            generation_seed=body.get('generation_seed'),
            scan_level=body.get('scan_level', 1),
            summary_json=body.get('summary_json'),
            albedo_url=body.get('albedo_url'),
            heightmap_url=body.get('heightmap_url'),
            normal_url=body.get('normal_url'),
            pbr_url=body.get('pbr_url'),
            thumbnail_url=body.get('thumbnail_url'),
        )
        if 'error' in result:
            return jsonify(result), 409
        planet_key = f"{system_id}_{planet_index}"
        log.info('Planet baked: %s in campaign %s', planet_key, campaign_id)
        return jsonify(result), 201
    except SQLAlchemyError as exc:
        log.error('Failed to bake planet %s_%d: %s', system_id, planet_index, exc)
        return jsonify({'error': 'db_error', 'message': str(exc)}), 500


@campaigns_bp.route('/<campaign_id>/planets/<planet_key>/textures', methods=['GET'])
def get_planet_textures(campaign_id, planet_key):
    """
    Retrieve baked textures for a planet (for web client rendering).
    Returns URLs or inline base64 depending on storage backend.
    """
    try:
        result = dao.get_planet_textures(_engine(), campaign_id, planet_key)
        if result is None:
            return jsonify({
                'error': 'not_found',
                'message': f'No textures found for planet {planet_key} in campaign {campaign_id}',
            }), 404
        return jsonify(result)
    except SQLAlchemyError as exc:
        log.error('Failed to get textures for %s: %s', planet_key, exc)
        return jsonify({'error': 'db_error', 'message': str(exc)}), 500


# ── Factions ──────────────────────────────────────────


@campaigns_bp.route('/<campaign_id>/factions', methods=['GET'])
def list_factions(campaign_id):
    """List all factions in a campaign."""
    try:
        factions = dao.list_factions(_engine(), campaign_id)
        return jsonify({'campaign_id': campaign_id, 'factions': factions})
    except SQLAlchemyError as exc:
        log.error('Failed to list factions for %s: %s', campaign_id, exc)
        return jsonify({'error': 'db_error', 'message': str(exc)}), 500


@campaigns_bp.route('/<campaign_id>/factions', methods=['POST'])
def create_faction(campaign_id):
    """Create a new faction in a campaign."""
    body = request.get_json(force=True)
    name = body.get('name', 'Unknown Faction')
    color = body.get('color', '#4d9fff')
    home_system = body.get('home_system_id')

    try:
        result = dao.create_faction(
            _engine(),
            campaign_id=campaign_id,
            name=name,
            color=color,
            home_system_id=home_system,
        )
        log.info('Faction created: %s in campaign %s', name, campaign_id)
        return jsonify(result), 201
    except IntegrityError:
        return jsonify({
            'error': 'duplicate',
            'message': f'Faction "{name}" already exists in this campaign',
        }), 409
    except SQLAlchemyError as exc:
        log.error('Failed to create faction %s: %s', name, exc)
        return jsonify({'error': 'db_error', 'message': str(exc)}), 500
