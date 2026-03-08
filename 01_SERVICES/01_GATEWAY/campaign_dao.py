"""
campaign_dao.py — Data Access Object for Campaign & Exploration tables.

Pure SQL functions against the app_simulation schema.
Each function accepts a SQLAlchemy Engine and returns plain dicts/lists.
No Flask imports — keeps this testable outside a request context.

Tables (Migration 005):
  app_simulation.campaign
  app_simulation.exploration
  app_simulation.explored_planet
  app_simulation.campaign_faction

Views:
  app_simulation.v_campaign_map
  app_simulation.v_campaign_summary
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

log = logging.getLogger(__name__)


# ── Helpers ────────────────────────────────────────────

def _row_to_dict(row) -> dict:
    """Convert a SQLAlchemy Row/RowMapping to a plain dict."""
    return dict(row._mapping) if hasattr(row, '_mapping') else dict(row)


def _rows_to_list(rows) -> list[dict]:
    return [_row_to_dict(r) for r in rows]


def _serialize(value: Any) -> Any:
    """Make a value JSON-safe (UUIDs → str, datetimes → isoformat)."""
    if isinstance(value, uuid.UUID):
        return str(value)
    if hasattr(value, 'isoformat'):
        return value.isoformat()
    return value


def _serialize_row(row: dict) -> dict:
    return {k: _serialize(v) for k, v in row.items()}


def _serialize_rows(rows: list[dict]) -> list[dict]:
    return [_serialize_row(r) for r in rows]


# ═══════════════════════════════════════════════════════
#                  CAMPAIGN CRUD
# ═══════════════════════════════════════════════════════


def create_campaign(
    engine: Engine,
    name: str,
    seed: int | None = None,
    settings: dict | None = None,
    owner_id: str | None = None,
) -> dict:
    """INSERT a new campaign row; returns the created record."""
    sql = text("""
        INSERT INTO app_simulation.campaign (name, owner_id, seed, settings_json)
        VALUES (
            :name,
            :owner_id,
            COALESCE(:seed, (floor(random() * 2147483647)::bigint)),
            :settings_json::jsonb
        )
        RETURNING id, name, owner_id, seed, settings_json, status, created_at, updated_at
    """)
    import json
    with engine.begin() as conn:
        row = conn.execute(sql, {
            'name': name,
            'owner_id': owner_id,
            'seed': seed,
            'settings_json': json.dumps(settings or {}),
        }).fetchone()
    return _serialize_row(_row_to_dict(row))


def list_campaigns(
    engine: Engine,
    status: str | None = 'active',
    limit: int = 100,
    offset: int = 0,
) -> dict:
    """Return campaigns (optionally filtered by status) with summary stats."""
    base = """
        SELECT
            cs.campaign_id AS id,
            cs.name,
            cs.status,
            cs.created_at,
            cs.systems_explored,
            cs.planets_surveyed,
            cs.factions
        FROM app_simulation.v_campaign_summary cs
    """
    count_base = "SELECT COUNT(*) AS total FROM app_simulation.campaign"

    params: dict[str, Any] = {'lim': limit, 'off': offset}

    if status:
        base += " WHERE cs.status = :status"
        count_base += " WHERE status = :status"
        params['status'] = status

    base += " ORDER BY cs.created_at DESC LIMIT :lim OFFSET :off"

    with engine.connect() as conn:
        rows = _serialize_rows(_rows_to_list(conn.execute(text(base), params).fetchall()))
        total = conn.execute(text(count_base), params).scalar() or 0

    return {'campaigns': rows, 'total': total, 'filter_status': status}


def get_campaign(engine: Engine, campaign_id: str) -> dict | None:
    """Fetch a single campaign with summary stats, or None if not found."""
    sql = text("""
        SELECT
            cs.campaign_id AS id,
            cs.name,
            cs.status,
            cs.created_at,
            cs.systems_explored,
            cs.planets_surveyed,
            cs.factions
        FROM app_simulation.v_campaign_summary cs
        WHERE cs.campaign_id = :cid
    """)
    with engine.connect() as conn:
        row = conn.execute(sql, {'cid': campaign_id}).fetchone()
    if row is None:
        return None
    return _serialize_row(_row_to_dict(row))


def update_campaign(engine: Engine, campaign_id: str, **fields) -> dict | None:
    """
    Dynamically UPDATE allowed campaign fields.
    Allowed keys: name, status, settings_json, seed.
    Returns the updated row or None if not found.
    """
    import json

    allowed = {'name', 'status', 'seed', 'settings_json'}
    sets: list[str] = []
    params: dict[str, Any] = {'cid': campaign_id}

    # Map incoming 'settings' key to the actual column name
    if 'settings' in fields:
        fields['settings_json'] = json.dumps(fields.pop('settings'))

    for key, val in fields.items():
        if key not in allowed:
            continue
        col = key
        placeholder = f':v_{key}'
        sets.append(f'{col} = {placeholder}')
        params[f'v_{key}'] = val

    if not sets:
        return get_campaign(engine, campaign_id)

    sets.append("updated_at = now()")
    set_clause = ', '.join(sets)

    sql = text(f"""
        UPDATE app_simulation.campaign
        SET {set_clause}
        WHERE id = :cid
        RETURNING id, name, owner_id, seed, settings_json, status, created_at, updated_at
    """)

    with engine.begin() as conn:
        row = conn.execute(sql, params).fetchone()
    if row is None:
        return None
    return _serialize_row(_row_to_dict(row))


def archive_campaign(engine: Engine, campaign_id: str) -> dict | None:
    """Soft-delete: set status = 'archived'. Returns updated row or None."""
    return update_campaign(engine, campaign_id, status='archived')


# ═══════════════════════════════════════════════════════
#                  FOG-OF-WAR MAP
# ═══════════════════════════════════════════════════════


def get_campaign_map(
    engine: Engine,
    campaign_id: str,
    min_scan_level: int = 1,
) -> dict:
    """
    Return explored systems for a campaign (fog-of-war lifted).
    Uses the v_campaign_map view which JOINs exploration → star_systems.
    """
    sql = text("""
        SELECT
            system_main_id,
            explored_at,
            explored_by,
            scan_level,
            x, y, z,
            distance_ly,
            spectral_class,
            teff,
            luminosity,
            planet_count,
            confidence
        FROM app_simulation.v_campaign_map
        WHERE campaign_id = :cid
          AND scan_level >= :min_scan
        ORDER BY explored_at ASC
    """)
    with engine.connect() as conn:
        rows = _serialize_rows(_rows_to_list(
            conn.execute(sql, {'cid': campaign_id, 'min_scan': min_scan_level}).fetchall()
        ))
    return {
        'campaign_id': campaign_id,
        'systems': rows,
        'total_explored': len(rows),
        'min_scan_level': min_scan_level,
    }


# ═══════════════════════════════════════════════════════
#                  EXPLORATION
# ═══════════════════════════════════════════════════════


def explore_system(
    engine: Engine,
    campaign_id: str,
    system_id: str,
    explored_by: str | None = None,
    scan_level: int = 1,
    notes: str | None = None,
) -> dict:
    """
    INSERT a new exploration or upgrade scan_level if already explored.
    Uses ON CONFLICT ... DO UPDATE with GREATEST to never downgrade.
    Returns the row + 'is_new' flag.
    """
    sql = text("""
        INSERT INTO app_simulation.exploration
            (campaign_id, system_main_id, explored_by, scan_level, notes)
        VALUES (:cid, :sid, :explored_by, :scan_level, :notes)
        ON CONFLICT (campaign_id, system_main_id) DO UPDATE
            SET scan_level = GREATEST(app_simulation.exploration.scan_level, EXCLUDED.scan_level),
                explored_by = COALESCE(EXCLUDED.explored_by, app_simulation.exploration.explored_by),
                notes = COALESCE(EXCLUDED.notes, app_simulation.exploration.notes)
        RETURNING id, campaign_id, system_main_id, explored_at, explored_by, scan_level, notes,
                  (xmax = 0) AS is_new
    """)
    with engine.begin() as conn:
        row = conn.execute(sql, {
            'cid': campaign_id,
            'sid': system_id,
            'explored_by': explored_by,
            'scan_level': scan_level,
            'notes': notes,
        }).fetchone()
    result = _serialize_row(_row_to_dict(row))
    return result


def get_exploration(
    engine: Engine,
    campaign_id: str,
    system_id: str,
) -> dict:
    """
    Get exploration details for a system including its planets.
    Returns { explored: bool, ...exploration_fields, planets: [...] }.
    """
    exp_sql = text("""
        SELECT id, campaign_id, system_main_id, explored_at, explored_by, scan_level, notes
        FROM app_simulation.exploration
        WHERE campaign_id = :cid AND system_main_id = :sid
    """)
    planet_sql = text("""
        SELECT
            ep.planet_index, ep.planet_key, ep.generation_seed, ep.scan_level,
            ep.albedo_url, ep.heightmap_url, ep.normal_url, ep.pbr_url,
            ep.thumbnail_url, ep.summary_json, ep.created_at
        FROM app_simulation.explored_planet ep
        JOIN app_simulation.exploration e ON e.id = ep.exploration_id
        WHERE e.campaign_id = :cid AND e.system_main_id = :sid
        ORDER BY ep.planet_index
    """)

    with engine.connect() as conn:
        exp_row = conn.execute(exp_sql, {'cid': campaign_id, 'sid': system_id}).fetchone()
        if exp_row is None:
            return {
                'campaign_id': campaign_id,
                'system_main_id': system_id,
                'explored': False,
                'scan_level': 0,
                'planets': [],
            }
        planets = _serialize_rows(_rows_to_list(
            conn.execute(planet_sql, {'cid': campaign_id, 'sid': system_id}).fetchall()
        ))

    result = _serialize_row(_row_to_dict(exp_row))
    result['explored'] = True
    result['planets'] = planets
    return result


# ═══════════════════════════════════════════════════════
#                 BAKED PLANET ASSETS
# ═══════════════════════════════════════════════════════


def bake_planet(
    engine: Engine,
    campaign_id: str,
    system_id: str,
    planet_index: int,
    generation_seed: int | None = None,
    scan_level: int = 1,
    summary_json: dict | None = None,
    albedo_url: str | None = None,
    heightmap_url: str | None = None,
    normal_url: str | None = None,
    pbr_url: str | None = None,
    thumbnail_url: str | None = None,
) -> dict:
    """
    Insert or update baked planet data.
    First resolves the exploration_id for (campaign, system),
    then UPSERTs the explored_planet row.
    """
    import json

    planet_key = f"{system_id}_{planet_index}"

    # Resolve exploration_id (the system must have been explored first)
    exp_sql = text("""
        SELECT id FROM app_simulation.exploration
        WHERE campaign_id = :cid AND system_main_id = :sid
    """)
    upsert_sql = text("""
        INSERT INTO app_simulation.explored_planet
            (exploration_id, planet_index, planet_key, generation_seed, scan_level,
             albedo_url, heightmap_url, normal_url, pbr_url, thumbnail_url, summary_json)
        VALUES
            (:eid, :pidx, :pkey, :gen_seed, :scan_level,
             :albedo, :hmap, :normal, :pbr, :thumb, :summary::jsonb)
        ON CONFLICT (exploration_id, planet_index) DO UPDATE SET
            generation_seed = COALESCE(EXCLUDED.generation_seed, app_simulation.explored_planet.generation_seed),
            scan_level = GREATEST(app_simulation.explored_planet.scan_level, EXCLUDED.scan_level),
            albedo_url   = COALESCE(EXCLUDED.albedo_url,   app_simulation.explored_planet.albedo_url),
            heightmap_url = COALESCE(EXCLUDED.heightmap_url, app_simulation.explored_planet.heightmap_url),
            normal_url   = COALESCE(EXCLUDED.normal_url,   app_simulation.explored_planet.normal_url),
            pbr_url      = COALESCE(EXCLUDED.pbr_url,      app_simulation.explored_planet.pbr_url),
            thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, app_simulation.explored_planet.thumbnail_url),
            summary_json = COALESCE(EXCLUDED.summary_json, app_simulation.explored_planet.summary_json)
        RETURNING id, exploration_id, planet_index, planet_key, generation_seed, scan_level,
                  albedo_url, heightmap_url, normal_url, pbr_url, thumbnail_url, summary_json, created_at
    """)

    with engine.begin() as conn:
        exp_row = conn.execute(exp_sql, {'cid': campaign_id, 'sid': system_id}).fetchone()
        if exp_row is None:
            return {
                'error': 'system_not_explored',
                'message': f'System {system_id} has not been explored in campaign {campaign_id}. '
                           f'Call POST /explore first.',
            }
        exploration_id = exp_row._mapping['id']

        row = conn.execute(upsert_sql, {
            'eid': exploration_id,
            'pidx': planet_index,
            'pkey': planet_key,
            'gen_seed': generation_seed,
            'scan_level': scan_level,
            'albedo': albedo_url,
            'hmap': heightmap_url,
            'normal': normal_url,
            'pbr': pbr_url,
            'thumb': thumbnail_url,
            'summary': json.dumps(summary_json) if summary_json else None,
        }).fetchone()

    return _serialize_row(_row_to_dict(row))


def get_planet_textures(
    engine: Engine,
    campaign_id: str,
    planet_key: str,
) -> dict | None:
    """
    Retrieve baked textures for a planet by key.
    Validates that the planet belongs to the given campaign.
    """
    sql = text("""
        SELECT
            ep.planet_key,
            ep.generation_seed,
            ep.scan_level,
            ep.albedo_url,
            ep.heightmap_url,
            ep.normal_url,
            ep.pbr_url,
            ep.thumbnail_url,
            ep.summary_json,
            ep.created_at
        FROM app_simulation.explored_planet ep
        JOIN app_simulation.exploration e ON e.id = ep.exploration_id
        WHERE e.campaign_id = :cid AND ep.planet_key = :pkey
    """)
    with engine.connect() as conn:
        row = conn.execute(sql, {'cid': campaign_id, 'pkey': planet_key}).fetchone()
    if row is None:
        return None
    return _serialize_row(_row_to_dict(row))


# ═══════════════════════════════════════════════════════
#                    FACTIONS
# ═══════════════════════════════════════════════════════


def list_factions(engine: Engine, campaign_id: str) -> list[dict]:
    """List all factions for a campaign."""
    sql = text("""
        SELECT id, campaign_id, name, color, home_system_id, created_at
        FROM app_simulation.campaign_faction
        WHERE campaign_id = :cid
        ORDER BY created_at
    """)
    with engine.connect() as conn:
        rows = _serialize_rows(_rows_to_list(conn.execute(sql, {'cid': campaign_id}).fetchall()))
    return rows


def create_faction(
    engine: Engine,
    campaign_id: str,
    name: str,
    color: str = '#4d9fff',
    home_system_id: str | None = None,
) -> dict:
    """Create a new faction in a campaign. Returns the created row."""
    sql = text("""
        INSERT INTO app_simulation.campaign_faction (campaign_id, name, color, home_system_id)
        VALUES (:cid, :name, :color, :home)
        RETURNING id, campaign_id, name, color, home_system_id, created_at
    """)
    with engine.begin() as conn:
        row = conn.execute(sql, {
            'cid': campaign_id,
            'name': name,
            'color': color,
            'home': home_system_id,
        }).fetchone()
    return _serialize_row(_row_to_dict(row))
