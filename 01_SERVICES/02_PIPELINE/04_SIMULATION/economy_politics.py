"""
Phase 04 Extensions — Economy & Politics Simulation Layers
==========================================================

Extends Phase 04 simulation core with:
- Economy layer: production, consumption, trade flows, resource scarcity
- Politics layer: faction influence, bloc cohesion, alliance tension, conflicts
- Event generation: procedural events based on system conditions

Deterministic event generation seeded by simulation RNG.
"""

import logging
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
import json

logger = logging.getLogger(__name__)

# Global time constants (in simulated years per quarter turn)
TIMESTEP_YEARS = 0.25
YEARS_PER_TICK = 0.25


@dataclass
class EconomicData:
    """Economic state for a settlement."""
    system_id: str
    population: int
    
    # Production
    raw_production: int  # Units of raw materials/energy per tick
    processed_production: int  # Manufactured goods
    agricultural_production: int  # Food
    
    # Consumption
    consumption_rate: float  # Population * consumption_per_capita
    
    # Resources
    stored_raw_materials: int
    stored_processed: int
    stored_food: int
    
    # Economy health
    trade_balance: int  # Positive = surplus, negative = deficit
    average_wealth: float  # Per capita
    unemployment_rate: float  # 0.0–1.0
    tech_level: int  # 0–20 technology level
    
    def to_dict(self):
        return {
            'system_id': self.system_id,
            'population': self.population,
            'raw_production': self.raw_production,
            'processed_production': self.processed_production,
            'agricultural_production': self.agricultural_production,
            'trade_balance': self.trade_balance,
            'average_wealth': self.average_wealth,
            'unemployment_rate': self.unemployment_rate,
            'tech_level': self.tech_level
        }


@dataclass
class PoliticalData:
    """Political state for a settlement."""
    system_id: str
    faction: str
    
    # Influence measures (0.0–1.0)
    local_influence: float  # Faction control in this system
    regional_influence: float  # Influence in nearby region
    
    # Cohesion
    internal_cohesion: float  # 0.0 = fractured, 1.0 = unified
    alignment_with_homeworld: float  # 0.0 = independent, 1.0 = loyal
    
    # Tension with neighbors
    neighbor_tensions: Dict[str, float]  # {faction: tension_score}
    
    # Political status
    has_independence_movement: bool
    government_type: str  # 'corporate', 'military', 'civilian', 'mixed', 'tribal'
    
    def to_dict(self):
        return {
            'system_id': self.system_id,
            'faction': self.faction,
            'local_influence': self.local_influence,
            'regional_influence': self.regional_influence,
            'internal_cohesion': self.internal_cohesion,
            'alignment_with_homeworld': self.alignment_with_homeworld,
            'neighbor_tensions': self.neighbor_tensions,
            'government_type': self.government_type
        }


class EconomyLayer:
    """Economy simulation layer."""
    
    # Per capita consumption (in production units per tick)
    CONSUMPTION_PER_CAPITA = 10
    
    # Production factors by tech level (multiplier)
    PRODUCTION_MULTIPLIER = {
        0: 0.5, 1: 0.6, 2: 0.8, 3: 1.0, 4: 1.3, 5: 1.6,
        6: 2.0, 7: 2.5, 8: 3.0, 9: 3.6, 10: 4.3
    }
    
    @classmethod
    def simulate_economy(cls, settlement: Dict, nearby_systems: List[str], rng) -> Dict:
        """
        Simulate economic tick for a settlement.
        
        Factors:
        - Population drives consumption
        - Tech level drives production
        - Trade with neighbors alleviates scarcity
        - Unemployment pressure if consumption > production
        
        Args:
            settlement (Dict): settlement state from SimulationEngine
            nearby_systems (List[str]): adjacent system IDs for trade
            rng: numpy RandomState
        
        Returns:
            Dict: updated settlement state with economy changes
        """
        population = settlement.get('population', 1_000_000)
        tech_level = settlement.get('tech_level', 5)
        
        # Calculate production
        production_multiplier = cls.PRODUCTION_MULTIPLIER.get(tech_level, 5.0)
        base_production = population // 1000  # Rough scale
        raw_production = int(base_production * production_multiplier * 0.5)
        processed_production = int(base_production * production_multiplier * 0.3)
        agricultural_production = int(base_production * production_multiplier * 0.2)
        
        # Calculate consumption
        consumption = int(population * cls.CONSUMPTION_PER_CAPITA * YEARS_PER_TICK)
        
        # Available for trade
        total_available = raw_production + processed_production + agricultural_production
        trade_surplus = max(0, total_available - consumption)
        
        # Unemployment: if consumption > production, need to import (cost job growth)
        if consumption > total_available:
            shortage_pct = (consumption - total_available) / consumption
            unemployment_pressure = shortage_pct * 0.1  # Up to 10% pressure
        else:
            unemployment_pressure = 0.0
        
        # Tech advancement pressure: wealthier systems invest more
        avg_wealth = total_available / max(1, population)
        tech_advancement = rng.normal(0.02, 0.01)  # Base 2% advancement + noise
        if avg_wealth > consumption * 2:
            tech_advancement += 0.01  # Wealthier systems innovate faster
        
        # Clamp
        new_tech = min(20, max(0, tech_level + tech_advancement))
        
        return {
            **settlement,
            'raw_production': raw_production,
            'processed_production': processed_production,
            'agricultural_production': agricultural_production,
            'consumption': consumption,
            'trade_surplus': trade_surplus,
            'unemployment_pressure': unemployment_pressure,
            'tech_level': int(new_tech),
            'average_wealth': avg_wealth
        }


class PoliticsLayer:
    """Politics simulation layer."""
    
    @classmethod
    def simulate_politics(cls, settlement: Dict, neighboring_settlements: List[Dict], rng) -> Dict:
        """
        Simulate political dynamics for a settlement.
        
        Factors:
        - Internal cohesion influenced by wealth and tech level
        - Alignment with homeworld degrades over time (independence pressure)
        - Tensions with neighbors based on resource competition
        - Independence movements triggered by low cohesion + high wealth
        
        Args:
            settlement (Dict): settlement with faction info
            neighboring_settlements (List[Dict]): adjacent settlements
            rng: numpy RandomState
        
        Returns:
            Dict: updated settlement with political changes
        """
        faction = settlement.get('faction', 'Independent')
        population = settlement.get('population', 1_000_000)
        tech_level = settlement.get('tech_level', 5)
        
        # Internal cohesion: wealthier, higher-tech systems tend to be more stable
        # Low-tech, low-wealth systems face pressure
        current_cohesion = settlement.get('internal_cohesion', 0.7)
        tech_bonus = (tech_level / 20.0) * 0.1  # +10% max from tech
        wealth_bonus = (settlement.get('average_wealth', 100) / 1000.0) * 0.1  # Scale-dependent
        
        cohesion_change = rng.normal(0.01, 0.02)  # Small drift ± 2%
        cohesion_change += tech_bonus + wealth_bonus
        
        new_cohesion = max(0.0, min(1.0, current_cohesion + cohesion_change))
        
        # Alignment with homeworld: degrades slowly
        current_alignment = settlement.get('alignment_with_homeworld', 0.9)
        alignment_decay = rng.normal(0.005, 0.002)  # Slow 0.5% decay
        new_alignment = max(0.0, min(1.0, current_alignment - alignment_decay))
        
        # Independence pressure: low cohesion + high tech -> independence movements
        independence_threshold = 0.4
        has_independence_movement = (
            new_cohesion < independence_threshold and 
            tech_level > 10 and
            rng.random() < 0.15  # 15% chance per tick if conditions met
        )
        
        # Neighbor tensions (simplified)
        neighbor_tensions = {}
        for neighbor in neighboring_settlements:
            neighbor_faction = neighbor.get('faction', 'Independent')
            if neighbor_faction != faction:
                # Rival factions have baseline tension
                base_tension = 0.3
                # Resource conflict: scarcity increases tension
                scarcity = max(0, 1.0 - settlement.get('trade_surplus', 0) / 100)
                tension = base_tension + scarcity * 0.3 + rng.normal(0, 0.1)
                neighbor_tensions[neighbor_faction] = max(0, min(1.0, tension))
        
        return {
            **settlement,
            'internal_cohesion': new_cohesion,
            'alignment_with_homeworld': new_alignment,
            'neighbor_tensions': neighbor_tensions,
            'has_independence_movement': has_independence_movement
        }


class EventGenerator:
    """Procedural event generation based on settlement conditions."""
    
    # Event rarities (per tick, modified by conditions)
    EVENT_BASE_RATES = {
        'discovery': 0.01,  # 1% per tick
        'conflict': 0.005,  # 0.5% per tick
        'migration_wave': 0.02,  # 2% per tick
        'resource_shortage': 0.015,
        'tech_breakthrough': 0.01,
        'population_boom': 0.012,
        'political_crisis': 0.008
    }
    
    @classmethod
    def generate_events(cls, tick: int, settlements: Dict[str, Dict], rng) -> List[Dict]:
        """
        Generate discrete events for a tick.
        
        Args:
            tick (int): current simulation tick
            settlements (Dict): all settlements
            rng: numpy RandomState
        
        Returns:
            List[Dict]: events generated this tick
        """
        events = []
        
        for sys_id, settlement in settlements.items():
            population = settlement.get('population', 1_000_000)
            tech_level = settlement.get('tech_level', 5)
            cohesion = settlement.get('internal_cohesion', 0.7)
            
            # Discovery events: higher tech = more discoveries
            discovery_rate = cls.EVENT_BASE_RATES['discovery'] * (1.0 + tech_level / 20.0)
            if rng.random() < discovery_rate:
                events.append({
                    'tick': tick,
                    'event_type': 'discovery',
                    'location': sys_id,
                    'description': f"Scientific discovery in {sys_id}",
                    'impact': {'tech_level': +1}
                })
            
            # Conflict events: higher tension = more conflicts
            conflict_rate = cls.EVENT_BASE_RATES['conflict']
            if len(settlement.get('neighbor_tensions', {})) > 0:
                max_tension = max(settlement['neighbor_tensions'].values())
                conflict_rate *= (1.0 + max_tension)
            
            if rng.random() < conflict_rate:
                events.append({
                    'tick': tick,
                    'event_type': 'conflict',
                    'location': sys_id,
                    'description': f"Trade conflict in {sys_id}",
                    'impact': {'cohesion': -0.05, 'population_growth': -0.01}
                })
            
            # Migration wave: low tension + high tech = attraction
            migration_rate = cls.EVENT_BASE_RATES['migration_wave']
            if cohesion > 0.7 and tech_level > 8:
                migration_rate *= 1.5
            
            if rng.random() < migration_rate:
                pop_gain_pct = rng.normal(0.02, 0.005)  # 2% ± 0.5%
                events.append({
                    'tick': tick,
                    'event_type': 'migration_wave',
                    'location': sys_id,
                    'description': f"Migration wave to {sys_id}",
                    'impact': {'population_growth': pop_gain_pct}
                })
            
            # Resource shortage: low trade surplus + high consumption
            shortage_rate = cls.EVENT_BASE_RATES['resource_shortage']
            trade_surplus = settlement.get('trade_surplus', 0)
            if trade_surplus < 0:
                shortage_rate *= 1.5
            
            if rng.random() < shortage_rate:
                events.append({
                    'tick': tick,
                    'event_type': 'resource_shortage',
                    'location': sys_id,
                    'description': f"Resource shortage in {sys_id}",
                    'impact': {'unemployment_pressure': +0.05}
                })
            
            # Tech breakthrough: super-rare random event
            if rng.random() < 0.001:  # 0.1% per tick
                events.append({
                    'tick': tick,
                    'event_type': 'tech_breakthrough',
                    'location': sys_id,
                    'description': f"Major tech breakthrough in {sys_id}",
                    'impact': {'tech_level': +2}
                })
        
        return events


def apply_event_impacts(settlement: Dict, event: Dict) -> Dict:
    """
    Apply event impacts to a settlement.
    
    Args:
        settlement (Dict): settlement state
        event (Dict): event with 'impact' field
    
    Returns:
        Dict: updated settlement
    """
    if 'impact' not in event:
        return settlement
    
    impact = event['impact']
    updated = settlement.copy()
    
    for key, value in impact.items():
        if key in updated:
            if isinstance(value, (int, float)):
                if isinstance(value, float) and -1 <= value <= 1 and key.endswith('_growth'):
                    # Population growth percentages
                    updated['population'] = int(updated['population'] * (1.0 + value))
                elif isinstance(value, float) and 0 <= value <= 1:
                    # Cohesion-like fields (0.0–1.0)
                    updated[key] = max(0.0, min(1.0, updated[key] + value))
                else:
                    # Direct addition
                    updated[key] = updated[key] + value
    
    return updated


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    logger.info("Economy & Politics extensions for Phase 04 ready")
