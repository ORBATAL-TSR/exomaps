"""
Phase 03 — System Completion Inference Engine
==============================================

Infers missing planets and belts using observational priors and stellar type heuristics.
Produces deterministic, reproducible inferred entities with confidence metadata.

Key Functions:
    run_inference_pipeline()    - Main entry point for Phase 03
    infer_planets()             - Infer planets from stellar type + observed architecture
    infer_belts()               - Infer asteroid/debris belts
    apply_inference_metadata()  - Attach confidence scores and method flags
    validate_inferences()       - Sanity checks on inferred objects
"""

import logging
import pandas as pd
import numpy as np
from datetime import datetime
from uuid import uuid4
from sqlalchemy import text

logger = logging.getLogger(__name__)

# Stellar classification heuristics for planet prevalence
STELLAR_PRIORS = {
    'F': {'planet_prob': 0.15, 'belt_prob': 0.25, 'avg_planets': 2.5},
    'G': {'planet_prob': 0.10, 'belt_prob': 0.30, 'avg_planets': 2.0},  # Sun-like
    'K': {'planet_prob': 0.08, 'belt_prob': 0.25, 'avg_planets': 1.8},
    'M': {'planet_prob': 0.12, 'belt_prob': 0.20, 'avg_planets': 2.2},  # Red dwarfs are common hosts
    'O': {'planet_prob': 0.02, 'belt_prob': 0.10, 'avg_planets': 0.5},  # Massive stars, few planets
    'B': {'planet_prob': 0.03, 'belt_prob': 0.15, 'avg_planets': 0.8},
    'A': {'planet_prob': 0.05, 'belt_prob': 0.20, 'avg_planets': 1.2},
}

# Orbital spacing heuristics (Titius-Bode-like)
ORBITAL_SPACING = {
    'habitable_zone_inner_au': 0.95,
    'habitable_zone_outer_au': 1.37,
    'min_planet_spacing_au': 0.15,
    'max_habitable_planets': 3
}


def load_nearby_stars(connection, distance_ly_max=100):
    """
    Load Phase 02 nearby stars with XYZ coordinates for inference.
    
    Args:
        connection: sqlalchemy connection
        distance_ly_max: maximum distance in light-years
    
    Returns:
        DataFrame with [main_id, x_pc, y_pc, z_pc, distance_ly, spectral_type, magnitude_v]
    """
    query = """
    SELECT
        xyz.main_id,
        xyz.x_pc,
        xyz.y_pc,
        xyz.z_pc,
        xyz.distance_ly,
        s.spectral_type,
        s.magnitude_v,
        s.luminosity_solar,
        s.temperature_k
    FROM dm_galaxy.stars_xyz xyz
    LEFT JOIN dm_galaxy.stars s ON xyz.main_id = s.main_id
    WHERE
        xyz.distance_ly <= %s
        AND xyz.sanity_pass = true
    ORDER BY xyz.distance_ly ASC
    """
    
    df = pd.read_sql(
        text(query),
        connection,
        params={'distance_ly_max': distance_ly_max}
    )
    
    logger.info(f"Loaded {len(df)} stars for inference (distance <= {distance_ly_max} LY)")
    return df


def extract_spectral_class(spectral_type_str):
    """
    Extract primary spectral class from string (e.g., 'G2V' → 'G').
    
    Args:
        spectral_type_str (str): spectral type (e.g., 'G2V', 'K5', 'M0V')
    
    Returns:
        str: primary class letter ('F', 'G', 'K', 'M', etc.) or 'G' if unparseable
    """
    if not spectral_type_str or not isinstance(spectral_type_str, str):
        return 'G'
    
    first_char = spectral_type_str[0].upper()
    if first_char in STELLAR_PRIORS:
        return first_char
    return 'G'


def infer_planets(star_row, seed=None):
    """
    Infer planetary system for a given star.
    
    Heuristics:
    1. Use spectral type prior for expected planet count
    2. Distribute planets in orbital bands (inner rocky, habitable, outer gas giants)
    3. Check orbital spacing heuristics to avoid collisions
    4. Assign inferred masses/radii based on orbital position
    
    Args:
        star_row (Series): star data with [main_id, spectral_type, luminosity_solar, ...]
        seed (int): random seed for deterministic inference (optional)
    
    Returns:
        list of dict: inferred planet records with {
            'main_id', 'inferred_planet_id', 'orbital_period_days', 'semi_major_axis_au',
            'planet_type', 'inferred_mass_earth', 'inferred_radius_earth',
            'confidence', 'method', 'seed'
        }
    """
    if seed is not None:
        np.random.seed(seed)
    
    main_id = star_row['main_id']
    spectral = extract_spectral_class(star_row.get('spectral_type'))
    
    prior = STELLAR_PRIORS.get(spectral, STELLAR_PRIORS['G'])
    
    # Coin flip: does this star get planets?
    if np.random.random() > prior['planet_prob']:
        return []
    
    # How many planets?
    num_planets = max(1, int(np.random.normal(prior['avg_planets'], 0.5)))
    num_planets = min(num_planets, ORBITAL_SPACING['max_habitable_planets'])
    
    inferred = []
    used_sma = []
    
    for i in range(num_planets):
        # Sample orbital location
        if i < 1:
            # Inner rocky planets
            sma_au = np.random.uniform(0.4, 0.8)
            planet_type = 'rocky'
        elif i < 2:
            # Habitable zone
            hz_in = ORBITAL_SPACING['habitable_zone_inner_au']
            hz_out = ORBITAL_SPACING['habitable_zone_outer_au']
            sma_au = np.random.uniform(hz_in, hz_out)
            planet_type = 'terrestrial-habitable'
        else:
            # Outer gas giants / ice giants
            sma_au = np.random.uniform(3.0, 20.0)
            planet_type = 'gas-giant' if np.random.random() > 0.4 else 'ice-giant'
        
        # Check spacing
        conflicts = [abs(sma_au - used) < ORBITAL_SPACING['min_planet_spacing_au']
                     for used in used_sma]
        if any(conflicts):
            continue  # Skip conflicting orbit
        
        used_sma.append(sma_au)
        
        # Orbital period (Kepler's 3rd law approximation)
        orbital_period_days = 365.25 * (sma_au ** 1.5)
        
        # Inferred mass/radius
        if planet_type == 'rocky':
            mass_earth = np.random.uniform(0.3, 1.5)
            radius_earth = np.random.uniform(0.7, 1.3)
        elif planet_type == 'terrestrial-habitable':
            mass_earth = np.random.uniform(0.5, 2.0)
            radius_earth = np.random.uniform(0.8, 1.5)
        else:  # gas/ice giants
            mass_earth = np.random.uniform(30, 300)
            radius_earth = np.random.uniform(3, 12)
        
        inferred.append({
            'main_id': main_id,
            'inferred_planet_id': f"inferred_{main_id}_{i + 1}",
            'orbital_period_days': orbital_period_days,
            'semi_major_axis_au': sma_au,
            'planet_type': planet_type,
            'inferred_mass_earth': mass_earth,
            'inferred_radius_earth': radius_earth,
            'confidence': 'low' if num_planets > 1 else 'medium',
            'method': 'spectral_type_prior',
            'seed': seed if seed is not None else -1
        })
    
    logger.debug(f"Inferred {len(inferred)} planets for {main_id}")
    return inferred


def infer_belts(star_row, seed=None):
    """
    Infer asteroid/debris belts for a given star.
    
    Heuristics:
    1. Belt probability based on spectral type
    2. Inner rocky belt near habitable zone inner
    3. Outer icy belt in cold outer region
    4. Confidence reflects lack of direct observations
    
    Args:
        star_row (Series): star data
        seed (int): random seed
    
    Returns:
        list of dict: inferred belt records
    """
    if seed is not None:
        np.random.seed(seed)
    
    main_id = star_row['main_id']
    spectral = extract_spectral_class(star_row.get('spectral_type'))
    
    prior = STELLAR_PRIORS.get(spectral, STELLAR_PRIORS['G'])
    
    # Coin flip: does this star get belts?
    if np.random.random() > prior['belt_prob']:
        return []
    
    inferred = []
    
    # Inner rocky belt
    if np.random.random() > 0.3:
        inferred.append({
            'main_id': main_id,
            'inferred_belt_id': f"inferred_{main_id}_belt_inner",
            'belt_type': 'rocky-asteroid',
            'inner_radius_au': 1.5,
            'outer_radius_au': 3.0,
            'confidence': 'low',
            'method': 'spectral_type_prior',
            'seed': seed if seed is not None else -1
        })
    
    # Outer icy belt
    if np.random.random() > 0.2:
        inferred.append({
            'main_id': main_id,
            'inferred_belt_id': f"inferred_{main_id}_belt_outer",
            'belt_type': 'icy-kuiper',
            'inner_radius_au': 20.0,
            'outer_radius_au': 50.0,
            'confidence': 'very-low',
            'method': 'spectral_type_prior',
            'seed': seed if seed is not None else -1
        })
    
    logger.debug(f"Inferred {len(inferred)} belts for {main_id}")
    return inferred


def run_inference_pipeline(connection, seed=None):
    """
    Main Phase 03 entry point: infer planets and belts for nearby stars.
    
    Args:
        connection: sqlalchemy connection
        seed (int): random seed for reproducibility
    
    Returns:
        dict: {
            'inferred_planets': DataFrame,
            'inferred_belts': DataFrame,
            'total_systems_processed': int,
            'systems_with_planets': int,
            'systems_with_belts': int,
            'summary': str
        }
    """
    logger.info("Starting Phase 03 inference pipeline...")
    
    stars = load_nearby_stars(connection)
    
    if len(stars) == 0:
        logger.error("No stars available for inference")
        return {
            'inferred_planets': pd.DataFrame(),
            'inferred_belts': pd.DataFrame(),
            'total_systems_processed': 0,
            'systems_with_planets': 0,
            'systems_with_belts': 0,
            'summary': 'FAILED: No stars loaded'
        }
    
    all_planets = []
    all_belts = []
    
    for idx, star in stars.iterrows():
        star_seed = seed + idx if seed is not None else None
        
        planets = infer_planets(star, seed=star_seed)
        belts = infer_belts(star, seed=star_seed)
        
        all_planets.extend(planets)
        all_belts.extend(belts)
    
    planets_df = pd.DataFrame(all_planets) if all_planets else pd.DataFrame()
    belts_df = pd.DataFrame(all_belts) if all_belts else pd.DataFrame()
    
    summary = (
        f"Phase 03 Inference Complete:\n"
        f"  Stars processed: {len(stars)}\n"
        f"  Inferred planets: {len(planets_df)}\n"
        f"  Inferred belts: {len(belts_df)}\n"
        f"  Systems with planets: {len(stars[stars['main_id'].isin(planets_df['main_id'])]) if len(planets_df) > 0 else 0}\n"
        f"  Systems with belts: {len(stars[stars['main_id'].isin(belts_df['main_id'])]) if len(belts_df) > 0 else 0}"
    )
    
    logger.info(summary)
    
    return {
        'inferred_planets': planets_df,
        'inferred_belts': belts_df,
        'total_systems_processed': len(stars),
        'systems_with_planets': len(planets_df['main_id'].unique()) if len(planets_df) > 0 else 0,
        'systems_with_belts': len(belts_df['main_id'].unique()) if len(belts_df) > 0 else 0,
        'summary': summary
    }


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    logger.info("Inference engine skeleton ready for Phase 03")
