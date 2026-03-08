"""
engine.py — Persistent Campaign Simulation Engine
===================================================

Takes the Phase-04 simulation logic and wraps it in a DB-backed engine
that persists state per campaign.  Settlements, events, and snapshots are
all written to PostgreSQL so the simulation survives restarts and can be
shared across gateway + desktop clients.

The engine is deterministic: given the same seed + tick sequence, it
produces identical world states every time.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import numpy as np
from sqlalchemy import text
from sqlalchemy.engine import Engine as DBEngine

log = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────

TIMESTEP_YEARS = 0.25       # Each tick = 1 quarter
MODEL_VERSION = '0.2.0'     # Bumped from 0.1.0 to reflect DB-backed engine

# Production multiplier by tech level
_PRODUCTION_MULT = {
    0: 0.5, 1: 0.6, 2: 0.8, 3: 1.0, 4: 1.3, 5: 1.6,
    6: 2.0, 7: 2.5, 8: 3.0, 9: 3.6, 10: 4.3, 11: 5.1,
    12: 6.0, 13: 7.0, 14: 8.2, 15: 9.5, 16: 11.0,
    17: 12.5, 18: 14.5, 19: 17.0, 20: 20.0,
}

# Event base rates (per tick per settlement)
_EVENT_RATES = {
    'discovery':          0.010,
    'conflict':           0.005,
    'migration_wave':     0.020,
    'resource_shortage':  0.015,
    'tech_breakthrough':  0.001,
    'population_boom':    0.012,
    'political_crisis':   0.008,
}

CONSUMPTION_PER_CAPITA = 10


# ── Data helpers ───────────────────────────────────────

def _row_dict(row) -> dict:
    return dict(row._mapping) if hasattr(row, '_mapping') else dict(row)


def _ser(v: Any) -> Any:
    """JSON-safe serializer for UUIDs, datetimes, Decimals."""
    import uuid, decimal
    if isinstance(v, uuid.UUID):
        return str(v)
    if hasattr(v, 'isoformat'):
        return v.isoformat()
    if isinstance(v, decimal.Decimal):
        return float(v)
    return v


def _ser_row(row: dict) -> dict:
    return {k: _ser(v) for k, v in row.items()}


# ═══════════════════════════════════════════════════════
#                  WORLD ENGINE
# ═══════════════════════════════════════════════════════

class WorldEngine:
    """
    Campaign-scoped simulation engine backed by PostgreSQL.

    Usage:
        we = WorldEngine(db_engine)
        run = we.init_campaign(campaign_id)       # creates run + starting settlement
        result = we.tick(campaign_id, n=10)        # advance 10 ticks
        snap   = we.snapshot(campaign_id)          # current state
    """

    def __init__(self, db: DBEngine):
        self.db = db

    # ── Lifecycle ──────────────────────────────────────

    def init_campaign(
        self,
        campaign_id: str,
        seed: int | None = None,
        starting_system: str = 'Sol',
        starting_faction: str = 'UNE',
        starting_population: int = 10_000_000,
    ) -> dict:
        """
        Create a simulation_run row + seed settlement for a campaign.
        Idempotent: if a run already exists, returns it.
        """
        # Check for existing run
        existing = self._get_run(campaign_id)
        if existing is not None:
            return _ser_row(existing)

        # Resolve seed from campaign table if not given
        if seed is None:
            with self.db.connect() as conn:
                row = conn.execute(
                    text("SELECT seed FROM app_simulation.campaign WHERE id = :cid"),
                    {'cid': campaign_id},
                ).fetchone()
                seed = int(row._mapping['seed']) if row else 42

        with self.db.begin() as conn:
            run = conn.execute(text("""
                INSERT INTO app_simulation.simulation_run
                    (campaign_id, seed, model_version, starting_system)
                VALUES (:cid, :seed, :model, :start)
                RETURNING *
            """), {
                'cid': campaign_id,
                'seed': seed,
                'model': MODEL_VERSION,
                'start': starting_system,
            }).fetchone()
            run_id = run._mapping['id']

            # Seed the first settlement
            conn.execute(text("""
                INSERT INTO app_simulation.settlement
                    (run_id, system_main_id, population, tech_level, faction)
                VALUES (:rid, :sys, :pop, 5, :fac)
            """), {
                'rid': run_id,
                'sys': starting_system,
                'pop': starting_population,
                'fac': starting_faction,
            })

        log.info("Campaign %s init: run=%s seed=%d start=%s",
                 campaign_id, run_id, seed, starting_system)
        return _ser_row(_row_dict(run))

    # ── Tick execution ─────────────────────────────────

    def tick(self, campaign_id: str, n: int = 1, max_wall_sec: float = 30.0) -> dict:
        """
        Advance the simulation by *n* ticks.
        Returns { run_id, ticks_executed, current_tick, simulated_year, events_generated }.
        """
        run = self._get_run(campaign_id)
        if run is None:
            return {'error': 'no_run', 'message': f'No simulation run for campaign {campaign_id}'}

        run_id = run['id']
        seed = int(run['seed'])
        current_tick = int(run['current_tick'])
        rng = np.random.RandomState(seed + current_tick)  # deterministic per-resume

        # Load settlements into memory
        settlements = self._load_settlements(run_id)
        if not settlements:
            return {'error': 'no_settlements', 'message': 'No settlements to simulate'}

        t0 = time.time()
        ticks_done = 0
        all_events: list[dict] = []

        for _ in range(n):
            if (time.time() - t0) > max_wall_sec:
                break

            # Phase 1: Population
            for s in settlements.values():
                pop = s['population']
                cap = 1_000_000_000
                growth = pop * 0.02 * (1.0 - pop / cap)
                s['population'] = int(pop + growth)

            # Phase 2: Economy
            sys_ids = list(settlements.keys())
            for sid, s in settlements.items():
                neighbors = [k for k in sys_ids if k != sid]
                self._tick_economy(s, neighbors, rng)

            # Phase 3: Politics
            for sid, s in settlements.items():
                neighbor_list = [settlements[k] for k in sys_ids if k != sid]
                self._tick_politics(s, neighbor_list, rng)

            # Phase 4: Events
            events = self._tick_events(current_tick + ticks_done + 1, settlements, rng)
            for ev in events:
                loc = ev.get('location')
                if loc in settlements:
                    self._apply_impact(settlements[loc], ev)
            all_events.extend(events)

            ticks_done += 1

        # Phase 5: Migration — expand to new system if overpopulated
        for sid, s in list(settlements.items()):
            if s['population'] > 500_000_000 and rng.random() < 0.05:
                # stub: pick a new system nearby — real version queries galaxy
                new_sys = f"colony_{sid}_{current_tick + ticks_done}"
                if new_sys not in settlements:
                    settlements[new_sys] = {
                        'system_main_id': new_sys,
                        'population': int(s['population'] * 0.02),
                        'tech_level': max(0, s['tech_level'] - 1),
                        'faction': s['faction'],
                        'raw_production': 0, 'processed_production': 0,
                        'agricultural_production': 0, 'trade_surplus': 0,
                        'unemployment_pressure': 0.0, 'average_wealth': 0.0,
                        'internal_cohesion': 0.6,
                        'alignment_with_homeworld': 0.8,
                        'neighbor_tensions': {},
                        'has_independence_movement': False,
                        'government_type': 'civilian',
                    }
                    s['population'] = int(s['population'] * 0.98)

        new_tick = current_tick + ticks_done
        sim_year = round(new_tick * TIMESTEP_YEARS, 2)

        # Persist everything in one transaction
        self._save_state(run_id, new_tick, sim_year, settlements, all_events)

        log.info("Campaign %s tick %d→%d (%d events)",
                 campaign_id, current_tick, new_tick, len(all_events))

        return {
            'run_id': str(run_id),
            'ticks_executed': ticks_done,
            'current_tick': new_tick,
            'simulated_year': sim_year,
            'events_generated': len(all_events),
            'wall_time_ms': round((time.time() - t0) * 1000, 1),
        }

    # ── Snapshots & queries ────────────────────────────

    def snapshot(self, campaign_id: str) -> dict | None:
        """Full campaign simulation state."""
        run = self._get_run(campaign_id)
        if run is None:
            return None
        run_id = run['id']

        settlements = self._load_settlements(run_id)

        # Recent events (last 100)
        with self.db.connect() as conn:
            events = [_ser_row(_row_dict(r)) for r in conn.execute(text("""
                SELECT tick, event_type, location, description, impact_json
                FROM app_simulation.simulation_event
                WHERE run_id = :rid ORDER BY tick DESC LIMIT 100
            """), {'rid': run_id}).fetchall()]

        return {
            'campaign_id': campaign_id,
            'run_id': str(run_id),
            'state': run['state'],
            'current_tick': int(run['current_tick']),
            'simulated_year': float(run['simulated_year']),
            'seed': int(run['seed']),
            'model_version': run['model_version'],
            'systems_settled': len(settlements),
            'total_population': sum(s['population'] for s in settlements.values()),
            'settlements': [_ser_row(s) for s in settlements.values()],
            'recent_events': events,
        }

    def status(self, campaign_id: str) -> dict | None:
        """Lightweight status check (no settlements loaded)."""
        sql = text("""
            SELECT * FROM app_simulation.v_campaign_simulation
            WHERE campaign_id = :cid
        """)
        with self.db.connect() as conn:
            row = conn.execute(sql, {'cid': campaign_id}).fetchone()
        if row is None:
            return None
        return _ser_row(_row_dict(row))

    def pause(self, campaign_id: str) -> dict:
        return self._set_state(campaign_id, 'paused')

    def resume(self, campaign_id: str) -> dict:
        return self._set_state(campaign_id, 'idle')  # idle means "ready to tick"

    def reset(self, campaign_id: str) -> dict:
        """Wipe simulation state for a campaign (keeps the campaign itself)."""
        run = self._get_run(campaign_id)
        if run is None:
            return {'error': 'no_run'}
        with self.db.begin() as conn:
            conn.execute(text(
                "DELETE FROM app_simulation.simulation_run WHERE campaign_id = :cid"
            ), {'cid': campaign_id})
        return {'campaign_id': campaign_id, 'reset': True}

    # ── Private: tick phases ───────────────────────────

    @staticmethod
    def _tick_economy(s: dict, neighbors: list, rng) -> None:
        pop = s.get('population', 1_000_000)
        tl = s.get('tech_level', 5)
        mult = _PRODUCTION_MULT.get(tl, 5.0)
        base = pop // 1000
        s['raw_production'] = int(base * mult * 0.5)
        s['processed_production'] = int(base * mult * 0.3)
        s['agricultural_production'] = int(base * mult * 0.2)
        total = s['raw_production'] + s['processed_production'] + s['agricultural_production']
        consumption = int(pop * CONSUMPTION_PER_CAPITA * TIMESTEP_YEARS)
        s['trade_surplus'] = max(0, total - consumption)
        if consumption > total:
            s['unemployment_pressure'] = round((consumption - total) / consumption * 0.1, 4)
        else:
            s['unemployment_pressure'] = 0.0
        s['average_wealth'] = round(total / max(1, pop), 4)
        # Tech drift
        adv = rng.normal(0.02, 0.01)
        if s['average_wealth'] > consumption * 2:
            adv += 0.01
        s['tech_level'] = int(min(20, max(0, tl + adv)))

    @staticmethod
    def _tick_politics(s: dict, neighbors: list[dict], rng) -> None:
        cohesion = s.get('internal_cohesion', 0.7)
        tl = s.get('tech_level', 5)
        tech_bonus = (tl / 20.0) * 0.1
        wealth_bonus = (s.get('average_wealth', 100) / 1000.0) * 0.1
        cohesion += rng.normal(0.01, 0.02) + tech_bonus + wealth_bonus
        s['internal_cohesion'] = round(max(0.0, min(1.0, cohesion)), 4)

        alignment = s.get('alignment_with_homeworld', 0.9)
        alignment -= rng.normal(0.005, 0.002)
        s['alignment_with_homeworld'] = round(max(0.0, min(1.0, alignment)), 4)

        s['has_independence_movement'] = bool(
            s['internal_cohesion'] < 0.4 and tl > 10 and rng.random() < 0.15
        )

        tensions = {}
        fac = s.get('faction', 'Independent')
        for nb in neighbors:
            nf = nb.get('faction', 'Independent')
            if nf != fac:
                base = 0.3
                scarcity = max(0, 1.0 - s.get('trade_surplus', 0) / 100)
                t = base + scarcity * 0.3 + rng.normal(0, 0.1)
                tensions[nf] = round(max(0, min(1.0, t)), 4)
        s['neighbor_tensions'] = tensions

    @staticmethod
    def _tick_events(tick: int, settlements: dict, rng) -> list[dict]:
        events = []
        for sid, s in settlements.items():
            tl = s.get('tech_level', 5)
            cohesion = s.get('internal_cohesion', 0.7)

            if rng.random() < _EVENT_RATES['discovery'] * (1.0 + tl / 20.0):
                events.append({'tick': tick, 'event_type': 'discovery', 'location': sid,
                               'description': f'Scientific discovery in {sid}',
                               'impact': {'tech_level': 1}})

            cr = _EVENT_RATES['conflict']
            tens = s.get('neighbor_tensions', {})
            if tens:
                cr *= 1.0 + max(tens.values())
            if rng.random() < cr:
                events.append({'tick': tick, 'event_type': 'conflict', 'location': sid,
                               'description': f'Trade conflict in {sid}',
                               'impact': {'internal_cohesion': -0.05}})

            mr = _EVENT_RATES['migration_wave']
            if cohesion > 0.7 and tl > 8:
                mr *= 1.5
            if rng.random() < mr:
                pct = rng.normal(0.02, 0.005)
                events.append({'tick': tick, 'event_type': 'migration_wave', 'location': sid,
                               'description': f'Migration wave to {sid}',
                               'impact': {'population_pct': pct}})

            if s.get('trade_surplus', 0) < 0 and rng.random() < _EVENT_RATES['resource_shortage']:
                events.append({'tick': tick, 'event_type': 'resource_shortage', 'location': sid,
                               'description': f'Resource shortage in {sid}',
                               'impact': {'unemployment_pressure': 0.05}})

            if rng.random() < _EVENT_RATES['tech_breakthrough']:
                events.append({'tick': tick, 'event_type': 'tech_breakthrough', 'location': sid,
                               'description': f'Major breakthrough in {sid}',
                               'impact': {'tech_level': 2}})
        return events

    @staticmethod
    def _apply_impact(s: dict, event: dict) -> None:
        impact = event.get('impact', {})
        for key, val in impact.items():
            if key == 'population_pct':
                s['population'] = int(s['population'] * (1.0 + val))
            elif key in s and isinstance(val, (int, float)):
                cur = s[key]
                if isinstance(cur, float):
                    s[key] = round(max(0.0, min(1.0, cur + val)), 4)
                else:
                    s[key] = cur + val

    # ── Private: DB helpers ────────────────────────────

    def _get_run(self, campaign_id: str) -> dict | None:
        with self.db.connect() as conn:
            row = conn.execute(text("""
                SELECT * FROM app_simulation.simulation_run WHERE campaign_id = :cid
            """), {'cid': campaign_id}).fetchone()
        return _row_dict(row) if row else None

    def _load_settlements(self, run_id) -> dict[str, dict]:
        with self.db.connect() as conn:
            rows = conn.execute(text("""
                SELECT * FROM app_simulation.settlement WHERE run_id = :rid
            """), {'rid': run_id}).fetchall()
        settlements = {}
        for r in rows:
            d = _row_dict(r)
            sid = d['system_main_id']
            # Deserialize tensions JSON
            if isinstance(d.get('neighbor_tensions_json'), str):
                d['neighbor_tensions'] = json.loads(d['neighbor_tensions_json'])
            elif isinstance(d.get('neighbor_tensions_json'), dict):
                d['neighbor_tensions'] = d['neighbor_tensions_json']
            else:
                d['neighbor_tensions'] = {}
            settlements[sid] = d
        return settlements

    def _save_state(
        self,
        run_id,
        new_tick: int,
        sim_year: float,
        settlements: dict[str, dict],
        events: list[dict],
    ) -> None:
        """Persist tick results in a single transaction."""
        with self.db.begin() as conn:
            # Update run
            conn.execute(text("""
                UPDATE app_simulation.simulation_run
                SET current_tick = :tick, simulated_year = :yr,
                    state = 'idle', updated_at = now()
                WHERE id = :rid
            """), {'tick': new_tick, 'yr': sim_year, 'rid': run_id})

            # Upsert settlements
            for sid, s in settlements.items():
                conn.execute(text("""
                    INSERT INTO app_simulation.settlement
                        (run_id, system_main_id, population, tech_level, faction,
                         raw_production, processed_production, agricultural_production,
                         trade_surplus, unemployment_pressure, average_wealth,
                         internal_cohesion, alignment_with_homeworld,
                         neighbor_tensions_json, has_independence_movement, government_type,
                         updated_at)
                    VALUES
                        (:rid, :sys, :pop, :tl, :fac,
                         :rp, :pp, :ap, :ts, :up, :aw,
                         :ic, :ah, :ntj::jsonb, :him, :gt, now())
                    ON CONFLICT (run_id, system_main_id) DO UPDATE SET
                        population = EXCLUDED.population,
                        tech_level = EXCLUDED.tech_level,
                        faction = EXCLUDED.faction,
                        raw_production = EXCLUDED.raw_production,
                        processed_production = EXCLUDED.processed_production,
                        agricultural_production = EXCLUDED.agricultural_production,
                        trade_surplus = EXCLUDED.trade_surplus,
                        unemployment_pressure = EXCLUDED.unemployment_pressure,
                        average_wealth = EXCLUDED.average_wealth,
                        internal_cohesion = EXCLUDED.internal_cohesion,
                        alignment_with_homeworld = EXCLUDED.alignment_with_homeworld,
                        neighbor_tensions_json = EXCLUDED.neighbor_tensions_json,
                        has_independence_movement = EXCLUDED.has_independence_movement,
                        government_type = EXCLUDED.government_type,
                        updated_at = now()
                """), {
                    'rid': run_id, 'sys': sid,
                    'pop': s['population'], 'tl': s['tech_level'],
                    'fac': s.get('faction', 'Independent'),
                    'rp': s.get('raw_production', 0),
                    'pp': s.get('processed_production', 0),
                    'ap': s.get('agricultural_production', 0),
                    'ts': s.get('trade_surplus', 0),
                    'up': s.get('unemployment_pressure', 0.0),
                    'aw': s.get('average_wealth', 0.0),
                    'ic': s.get('internal_cohesion', 0.7),
                    'ah': s.get('alignment_with_homeworld', 0.9),
                    'ntj': json.dumps(s.get('neighbor_tensions', {})),
                    'him': s.get('has_independence_movement', False),
                    'gt': s.get('government_type', 'civilian'),
                })

            # Insert events
            for ev in events:
                conn.execute(text("""
                    INSERT INTO app_simulation.simulation_event
                        (run_id, tick, event_type, location, description, impact_json)
                    VALUES (:rid, :tick, :etype, :loc, :desc, :impact::jsonb)
                """), {
                    'rid': run_id,
                    'tick': ev.get('tick', new_tick),
                    'etype': ev['event_type'],
                    'loc': ev.get('location'),
                    'desc': ev.get('description'),
                    'impact': json.dumps(ev.get('impact', {})),
                })

    def _set_state(self, campaign_id: str, state: str) -> dict:
        with self.db.begin() as conn:
            row = conn.execute(text("""
                UPDATE app_simulation.simulation_run
                SET state = :state, updated_at = now()
                WHERE campaign_id = :cid
                RETURNING *
            """), {'cid': campaign_id, 'state': state}).fetchone()
        if row is None:
            return {'error': 'no_run'}
        return _ser_row(_row_dict(row))
