"""
Phase 04 — Simulation Runtime Core
===================================

Deterministic server-side simulation engine for SFTL (Slower-Than-Light) expansion.
Implements hybrid tick/event loop with population growth, migration, economy, and politics.

Key Classes:
    SimulationEngine         - Main simulation runtime
    SimulationSnapshot       - Deterministic state checkpoint
    SimulationEvent          - Discrete event type

Key Functions:
    create_engine()          - Factory for new simulation
    run_simulation()          - Execute N timesteps
"""

import logging
import json
from datetime import datetime, timedelta
from enum import Enum
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, asdict
from uuid import uuid4
import hashlib

logger = logging.getLogger(__name__)

# Simulation timestep (in simulated years)
TIMESTEP_YEARS = 0.25  # Quarterly turns


class TickPhase(Enum):
    """Lifecycle phases of a single tick."""
    POPULATION = 'population_growth'
    MIGRATION = 'migration_pressure'
    TRADE = 'trade_flow'
    POLITICS = 'political_dynamics'
    EVENTS = 'discrete_events'


class SimulationState(Enum):
    """Simulation runtime state."""
    IDLE = 'idle'
    RUNNING = 'running'
    PAUSED = 'paused'
    COMPLETED = 'completed'
    FAILED = 'failed'


@dataclass
class SimulationEvent:
    """Discrete event occurring at a tick."""
    event_id: str
    event_type: str
    tick: int
    location: str  # system main_id
    description: str
    impact: Optional[Dict] = None
    
    def to_dict(self):
        return asdict(self)


@dataclass
class SimulationSnapshot:
    """
    Deterministic snapshot of simulation state at a tick.
    Includes world state, event log, and reproducibility metadata.
    """
    run_id: str
    tick: int
    simulated_year: int
    state: str  # SimulationState enum value
    
    # World state
    systems_populated: int
    total_population: int
    settled_systems: List[Dict]  # [{system_id, population, tech_level, faction}, ...]
    events: List[Dict]
    
    # Reproducibility
    seed: int
    model_version: str
    source_build_id: str  # World build ID (Phase 03 output)
    
    # Metadata
    created_at: str
    elapsed_walltime_sec: float
    
    def to_dict(self):
        """Convert snapshot to serializable dict."""
        return {
            'run_id': self.run_id,
            'tick': self.tick,
            'simulated_year': self.simulated_year,
            'state': self.state,
            'systems_populated': self.systems_populated,
            'total_population': self.total_population,
            'settled_systems': self.settled_systems,
            'events': self.events,
            'seed': self.seed,
            'model_version': self.model_version,
            'source_build_id': self.source_build_id,
            'created_at': self.created_at,
            'elapsed_walltime_sec': self.elapsed_walltime_sec
        }
    
    def to_json(self):
        return json.dumps(self.to_dict(), indent=2)


class SimulationEngine:
    """
    Main deterministic simulation runtime.
    
    Lifecycle:
        1. __init__() with seed + world build
        2. step() or run() to advance ticks
        3. snapshot() to capture state
        4. save/load for replay
    """
    
    def __init__(self, run_id: str, world_build_id: str, starting_system: str,
                 seed: int = 42, model_version: str = '0.1.0'):
        """
        Initialize simulation engine.
        
        Args:
            run_id: unique identifier for this simulation run
            world_build_id: world_build_id from Phase 03 (for reproducibility)
            starting_system: main_id of starting system (e.g., 'Sol')
            seed: random seed for deterministic behavior
            model_version: simulation rule set version
        """
        self.run_id = run_id
        self.world_build_id = world_build_id
        self.starting_system = starting_system
        self.seed = seed
        self.model_version = model_version
        
        # Runtime state
        self.tick = 0
        self.state = SimulationState.IDLE
        self.event_log: List[SimulationEvent] = []
        
        # World state
        self.settlements: Dict[str, Dict] = {
            starting_system: {
                'system_id': starting_system,
                'population': 10_000_000,  # 10M starting population
                'tech_level': 5,  # TL 5 (colonization tech)
                'faction': 'UNE'  # United Nations Earth
            }
        }
        
        # Deterministic RNG
        import numpy as np
        self.rng = np.random.RandomState(seed)
        
        logger.info(f"SimulationEngine initialized: run_id={run_id}, seed={seed}")
    
    def step(self) -> bool:
        """
        Execute one simulation tick (0.25 simulated years).
        
        Returns:
            bool: True if successful, False if simulation ended
        """
        if self.state not in (SimulationState.RUNNING, SimulationState.IDLE):
            return False
        
        self.state = SimulationState.RUNNING
        previous_tick = self.tick
        
        try:
            # Execute tick phases in order
            self._tick_population_growth()
            self._tick_migration_pressure()
            self._tick_trade_flow()
            self._tick_political_dynamics()
            self._tick_discrete_events()
            
            self.tick += 1
            logger.debug(f"Tick {previous_tick} → {self.tick} complete")
            return True
        
        except Exception as e:
            logger.error(f"Tick {self.tick} failed: {e}")
            self.state = SimulationState.FAILED
            return False
    
    def run(self, max_ticks: int = 400, max_walltime_sec: float = None) -> bool:
        """
        Run simulation for N ticks or until walltime exceeded.
        
        Args:
            max_ticks: maximum number of ticks to simulate
            max_walltime_sec: maximum wall-clock seconds (optional)
        
        Returns:
            bool: True if completed normally, False if interrupted
        """
        import time
        
        start_time = time.time()
        self.state = SimulationState.RUNNING
        
        for i in range(max_ticks):
            if not self.step():
                return False
            
            if max_walltime_sec and (time.time() - start_time) > max_walltime_sec:
                logger.info(f"Run interrupted: exceeded walltime ({max_walltime_sec}s)")
                self.state = SimulationState.PAUSED
                return False
        
        self.state = SimulationState.COMPLETED
        logger.info(f"Simulation completed: {max_ticks} ticks")
        return True
    
    def pause(self):
        """Pause simulation (state can be saved and resumed)."""
        if self.state == SimulationState.RUNNING:
            self.state = SimulationState.PAUSED
            logger.info(f"Simulation paused at tick {self.tick}")
    
    def resume(self):
        """Resume paused simulation."""
        if self.state == SimulationState.PAUSED:
            self.state = SimulationState.RUNNING
            logger.info(f"Simulation resumed from tick {self.tick}")
    
    def snapshot(self) -> SimulationSnapshot:
        """
        Capture deterministic state snapshot.
        
        Returns:
            SimulationSnapshot with full world state
        """
        import time
        
        # Normalize events to dicts
        events_list = []
        for e in self.event_log[-100:]:  # Last 100 events
            if isinstance(e, dict):
                events_list.append(e)
            elif hasattr(e, 'to_dict'):
                events_list.append(e.to_dict())
            else:
                events_list.append(str(e))
        
        return SimulationSnapshot(
            run_id=self.run_id,
            tick=self.tick,
            simulated_year=int(self.tick * TIMESTEP_YEARS),
            state=self.state.value,
            systems_populated=len(self.settlements),
            total_population=sum(s['population'] for s in self.settlements.values()),
            settled_systems=[
                {**s, 'system_id': sys_id}
                for sys_id, s in self.settlements.items()
            ],
            events=events_list,
            seed=self.seed,
            model_version=self.model_version,
            source_build_id=self.world_build_id,
            created_at=datetime.utcnow().isoformat(),
            elapsed_walltime_sec=0.0  # TODO: track actual elapsed time
        )
    
    def _tick_population_growth(self):
        """Phase 1: Population dynamics (births, deaths, carrying capacity)."""
        for sys_id, settlement in self.settlements.items():
            # Simple exponential growth with carrying capacity brake
            growth_rate = 0.02  # 2% per quarter
            carrying_capacity = 1_000_000_000  # ~1B per system
            
            pop = settlement['population']
            growth = pop * growth_rate * (1.0 - pop / carrying_capacity)
            settlement['population'] = int(pop + growth)
    
    def _tick_migration_pressure(self):
        """Phase 2: Interplanetary migration (expansion to nearby systems)."""
        # Stub: potential migration expansion logic
        # In future: check for overpopulation/high wealth triggering new colony waves
        pass
    
    def _tick_trade_flow(self):
        """Phase 3: Economic production and trade routes."""
        from economy_politics import EconomyLayer
        
        # Get nearby systems for each settlement
        for sys_id, settlement in list(self.settlements.items()):
            nearby_systems = [s for s in self.settlements.keys() if s != sys_id]
            
            # Simulate economy
            updated = EconomyLayer.simulate_economy(settlement, nearby_systems, self.rng)
            self.settlements[sys_id] = updated
    
    def _tick_political_dynamics(self):
        """Phase 4: Faction influence, bloc cohesion, alliance tension."""
        from economy_politics import PoliticsLayer
        
        for sys_id, settlement in list(self.settlements.items()):
            # Get neighboring settlements (in real implementation, based on distance)
            neighboring = [s for k, s in self.settlements.items() if k != sys_id]
            
            # Simulate politics
            updated = PoliticsLayer.simulate_politics(settlement, neighboring, self.rng)
            self.settlements[sys_id] = updated
    
    def _tick_discrete_events(self):
        """Phase 5: Random discrete events (discoveries, conflicts, etc.)."""
        from economy_politics import EventGenerator, apply_event_impacts
        
        # Generate events this tick
        events = EventGenerator.generate_events(self.tick, self.settlements, self.rng)
        
        # Apply impacts to settlements
        for event in events:
            event_location = event.get('location')
            if event_location in self.settlements:
                self.settlements[event_location] = apply_event_impacts(
                    self.settlements[event_location],
                    event
                )
            
            # Log event
            self.event_log.append(event)



def create_engine(world_build_id: str, starting_system: str = 'Sol',
                  seed: int = 42) -> SimulationEngine:
    """
    Factory: create a new simulation engine.
    
    Args:
        world_build_id: world build ID (from Phase 03)
        starting_system: starting location
        seed: random seed
    
    Returns:
        SimulationEngine ready for run()
    """
    run_id = f"sim_{uuid4().hex[:8]}"
    engine = SimulationEngine(
        run_id=run_id,
        world_build_id=world_build_id,
        starting_system=starting_system,
        seed=seed
    )
    return engine


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    
    # Quick test
    engine = create_engine(world_build_id='wb_test_001')
    engine.run(max_ticks=10)
    snap = engine.snapshot()
    print(f"Simulation complete: {snap.tick} ticks, {snap.total_population:,} population")
