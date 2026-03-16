"""
resources.py — ExoMaps In-System Economy
=========================================
Physical and economic specification of all tradeable resources.

Design philosophy:
  Resources have real physical properties (mass, energy content, storage state).
  Everything that gets moved pays a fuel cost based on mass.
  Prices are set per tonne, not per unit.
"""

from dataclasses import dataclass, field
from enum import Enum, auto
from typing import Dict


class ResourceTier(Enum):
    """
    How physically transferable is this resource across a system?
    Tier drives whether it makes sense to ship between orbital zones.
    """
    SYSTEM_BOUND = 0    # Cannot be shipped (stellar flux, orbital slots, gravity wells)
    HIGH_VALUE   = 1    # Worth expensive orbital hops (He-3, rare metals, biologicals)
    MEDIUM_VALUE = 2    # Standard in-system commodity (refined metals, processed water)
    LOW_VALUE    = 3    # Only local or short-range trade (bulk ice, raw rock)
    ENERGY       = 4    # Special: generated and consumed locally, transmitted by wire


class ResourceState(Enum):
    SOLID  = auto()
    LIQUID = auto()
    GAS    = auto()
    PLASMA = auto()
    ENERGY = auto()   # Electrical / thermal power (not physically shipped)


@dataclass(frozen=True)
class ResourceSpec:
    """
    Complete physical and economic specification of a resource type.
    All quantities in SI-adjacent units; prices in notional 'credits' per tonne.
    """
    id:                 str
    name:               str
    tier:               ResourceTier
    state:              ResourceState
    density_kg_m3:      float       # How dense is it? (affects storage volume)
    mass_per_unit:      float       # kg per 'unit' in simulation (usually 1000 → 1 tonne)
    base_price:         float       # Credits per tonne at equilibrium
    scarcity_factor:    float       # 0=ubiquitous … 1=extremely rare in typical systems
    energy_mj_kg:       float       # Energy content (0 for non-fuel resources)
    description:        str


# ---------------------------------------------------------------------------
# Resource Catalogue
# All quantities per TONNE unless noted otherwise.
# ---------------------------------------------------------------------------

RESOURCES: Dict[str, ResourceSpec] = {

    # ── RAW VOLATILES ──────────────────────────────────────────────────────

    "water_ice": ResourceSpec(
        id="water_ice", name="Water Ice",
        tier=ResourceTier.LOW_VALUE, state=ResourceState.SOLID,
        density_kg_m3=917, mass_per_unit=1000,
        base_price=80.0, scarcity_factor=0.2,
        energy_mj_kg=0.0,
        description="Bulk water ice. Abundant in outer system. Heavy to move."
    ),

    "hydrogen_gas": ResourceSpec(
        id="hydrogen_gas", name="Hydrogen Gas",
        tier=ResourceTier.MEDIUM_VALUE, state=ResourceState.GAS,
        density_kg_m3=0.09,   # at STP
        mass_per_unit=1000,
        base_price=120.0, scarcity_factor=0.1,
        energy_mj_kg=142.0,   # Lower heating value
        description="Bulk hydrogen. Skimmed from gas giants. Primary fusion feedstock and propellant."
    ),

    "helium3": ResourceSpec(
        id="helium3", name="Helium-3",
        tier=ResourceTier.HIGH_VALUE, state=ResourceState.GAS,
        density_kg_m3=0.164,
        mass_per_unit=1000,
        base_price=18_500.0, scarcity_factor=0.9,
        energy_mj_kg=350_000.0,   # Fusion yield per kg (D–He3 reaction, net)
        description="Rare helium isotope. Premium fusion fuel. Concentrated in gas giant atmospheres and regolith of airless bodies."
    ),

    "deuterium": ResourceSpec(
        id="deuterium", name="Deuterium",
        tier=ResourceTier.HIGH_VALUE, state=ResourceState.LIQUID,
        density_kg_m3=162,    # liquid D₂
        mass_per_unit=1000,
        base_price=4_200.0, scarcity_factor=0.5,
        energy_mj_kg=80_000.0,   # D–T or D–D fusion
        description="Heavy hydrogen isotope. Fusion fuel. Extractable from seawater and ice."
    ),

    "carbon_compounds": ResourceSpec(
        id="carbon_compounds", name="Carbon Compounds",
        tier=ResourceTier.LOW_VALUE, state=ResourceState.SOLID,
        density_kg_m3=1200,
        mass_per_unit=1000,
        base_price=95.0, scarcity_factor=0.3,
        energy_mj_kg=30.0,    # Combustion (rarely used for energy in-system)
        description="Mixed organic/carbonaceous material from asteroids or icy bodies. Fertiliser, polymer feedstock, bioprinting substrate."
    ),

    "nitrogen_gas": ResourceSpec(
        id="nitrogen_gas", name="Nitrogen Gas",
        tier=ResourceTier.LOW_VALUE, state=ResourceState.GAS,
        density_kg_m3=1.25,
        mass_per_unit=1000,
        base_price=60.0, scarcity_factor=0.25,
        energy_mj_kg=0.0,
        description="Atmospheric buffer gas. Essential for habitat atmosphere mix. Scarce on rocky bodies without atmosphere."
    ),

    # ── RAW MINERALS ───────────────────────────────────────────────────────

    "silicate_ore": ResourceSpec(
        id="silicate_ore", name="Silicate Ore",
        tier=ResourceTier.LOW_VALUE, state=ResourceState.SOLID,
        density_kg_m3=2700,
        mass_per_unit=1000,
        base_price=40.0, scarcity_factor=0.05,
        energy_mj_kg=0.0,
        description="Raw rock. Ubiquitous in rocky planets and asteroids. Bulk construction feedstock."
    ),

    "iron_nickel_ore": ResourceSpec(
        id="iron_nickel_ore", name="Iron-Nickel Ore",
        tier=ResourceTier.LOW_VALUE, state=ResourceState.SOLID,
        density_kg_m3=5200,
        mass_per_unit=1000,
        base_price=70.0, scarcity_factor=0.15,
        energy_mj_kg=0.0,
        description="Metallic ore. Common in M-type asteroids and planetary cores. Primary structural metal feedstock."
    ),

    "rare_metals": ResourceSpec(
        id="rare_metals", name="Rare Metals",
        tier=ResourceTier.HIGH_VALUE, state=ResourceState.SOLID,
        density_kg_m3=8000,
        mass_per_unit=1000,
        base_price=6_500.0, scarcity_factor=0.75,
        energy_mj_kg=0.0,
        description="Platinum group, rare earths, specialty isotopes. High density and value per kg makes interstellar shipping worthwhile."
    ),

    "regolith": ResourceSpec(
        id="regolith", name="Regolith",
        tier=ResourceTier.LOW_VALUE, state=ResourceState.SOLID,
        density_kg_m3=1500,
        mass_per_unit=1000,
        base_price=15.0, scarcity_factor=0.01,
        energy_mj_kg=0.0,
        description="Loose surface material. Extremely cheap but only useful locally. Shielding, bulk fill, sintered construction."
    ),

    # ── PROCESSED / REFINED ────────────────────────────────────────────────

    "water": ResourceSpec(
        id="water", name="Processed Water",
        tier=ResourceTier.MEDIUM_VALUE, state=ResourceState.LIQUID,
        density_kg_m3=1000,
        mass_per_unit=1000,
        base_price=220.0, scarcity_factor=0.3,
        energy_mj_kg=0.0,
        description="Purified water. Habitat life support, agriculture, industrial cooling. Non-negotiable for all colonies."
    ),

    "oxygen": ResourceSpec(
        id="oxygen", name="Oxygen",
        tier=ResourceTier.MEDIUM_VALUE, state=ResourceState.GAS,
        density_kg_m3=1.43,
        mass_per_unit=1000,
        base_price=180.0, scarcity_factor=0.4,
        energy_mj_kg=0.0,
        description="Breathable gas. Derived from water electrolysis or mineral reduction. Habitat atmosphere and oxidiser."
    ),

    "refined_metals": ResourceSpec(
        id="refined_metals", name="Refined Metals",
        tier=ResourceTier.MEDIUM_VALUE, state=ResourceState.SOLID,
        density_kg_m3=7800,
        mass_per_unit=1000,
        base_price=450.0, scarcity_factor=0.2,
        energy_mj_kg=0.0,
        description="Smelted structural metals. Primary input for fabrication of all machinery and infrastructure."
    ),

    "fuel": ResourceSpec(
        id="fuel", name="Propellant",
        tier=ResourceTier.MEDIUM_VALUE, state=ResourceState.LIQUID,
        density_kg_m3=71,    # Liquid hydrogen density
        mass_per_unit=1000,
        base_price=350.0, scarcity_factor=0.2,
        energy_mj_kg=120.0,
        description="Refined propellant for reaction drives. Liquid hydrogen or hydrogen/methane blend. Without it nothing moves."
    ),

    # ── BIOLOGICAL ─────────────────────────────────────────────────────────

    "food": ResourceSpec(
        id="food", name="Food",
        tier=ResourceTier.MEDIUM_VALUE, state=ResourceState.SOLID,
        density_kg_m3=800,
        mass_per_unit=1000,
        base_price=600.0, scarcity_factor=0.5,
        energy_mj_kg=4.0,    # Calorific
        description="Processed food products. Required by all population. Produced in hydroponics or surface agriculture."
    ),

    "biologicals": ResourceSpec(
        id="biologicals", name="Biologicals",
        tier=ResourceTier.HIGH_VALUE, state=ResourceState.SOLID,
        density_kg_m3=1000,
        mass_per_unit=1000,
        base_price=12_000.0, scarcity_factor=0.7,
        energy_mj_kg=0.0,
        description="Frozen embryos, seed vaults, engineered microorganisms, genomic libraries. High value per kg. Critical for new colony establishment."
    ),

    # ── MANUFACTURED ───────────────────────────────────────────────────────

    "machinery": ResourceSpec(
        id="machinery", name="Machinery",
        tier=ResourceTier.MEDIUM_VALUE, state=ResourceState.SOLID,
        density_kg_m3=3500,
        mass_per_unit=1000,
        base_price=2_800.0, scarcity_factor=0.4,
        energy_mj_kg=0.0,
        description="General fabricated equipment. Mining drills, processors, habitat components. Heavy but widely needed."
    ),

    "electronics": ResourceSpec(
        id="electronics", name="Electronics",
        tier=ResourceTier.HIGH_VALUE, state=ResourceState.SOLID,
        density_kg_m3=2500,
        mass_per_unit=1000,
        base_price=8_500.0, scarcity_factor=0.6,
        energy_mj_kg=0.0,
        description="Computing, sensors, control systems, comms hardware. High value per kg. Required to upgrade installations."
    ),

    # ── ENERGY (LOCAL ONLY) ────────────────────────────────────────────────

    "power": ResourceSpec(
        id="power", name="Electrical Power",
        tier=ResourceTier.ENERGY, state=ResourceState.ENERGY,
        density_kg_m3=0.0,     # Non-physical
        mass_per_unit=0.0,
        base_price=0.8,         # Per MWh equivalent
        scarcity_factor=0.3,
        energy_mj_kg=0.0,
        description="Electrical power. Generated locally, consumed locally. Not shippable. All installations require it."
    ),
}


def get(resource_id: str) -> ResourceSpec:
    if resource_id not in RESOURCES:
        raise KeyError(f"Unknown resource: '{resource_id}'")
    return RESOURCES[resource_id]


def all_shippable() -> list[str]:
    """Return resource IDs that can be physically transported."""
    return [r for r, spec in RESOURCES.items()
            if spec.tier not in (ResourceTier.SYSTEM_BOUND, ResourceTier.ENERGY)]
