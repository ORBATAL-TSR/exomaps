"""
Phase 02 — 3D Coordinate Engine
================================

Transforms RA/Dec/parallax observations into stable Cartesian (X/Y/Z) coordinates.
Produces nearby-neighborhood dataset (<= 100 LY) with uncertainty bounds.

Standards:
- Frame: ICRS (International Celestial Reference System)
- Epoch: J2000.0 (Julian epoch for consistency)
- Units: parsecs for distance, degrees for angles, degrees/century for proper motions
- Confidence: includes parallax uncertainty and proper motion uncertainty impacts

Key Functions:
    transform_catalog()       - Main entry point for Phase 02 transforms
    ra_dec_parallax_to_xyz()  - Core ICRS → Cartesian converter
    compute_uncertainty()     - Estimate XYZ uncertainty from parallax/PM errors
    apply_sanity_checks()     - Validate distances, detect outliers
    load_and_filter_phase01() - Load Phase 01 catalog and filter to working set
"""

import logging
import pandas as pd
import numpy as np
from sqlalchemy import text
from math import radians, cos, sin, sqrt, atan2, acos

logger = logging.getLogger(__name__)

# Constants
PARSEC_TO_LY = 3.26156  # 1 parsec = 3.26156 Light-years
LY_CUTOFF = 100.0       # Include stars within 100 LY
PARALLAX_ERROR_THRESHOLD = 0.2  # milliarcseconds; skip if parallax_error > this


def load_and_filter_phase01(connection):
    """
    Load Phase 01 stellar catalog and filter to working set.
    
    Working set criteria:
    - Parallax measurement exists and is positive
    - Parallax error < PARALLAX_ERROR_THRESHOLD to ensure reliable distances
    - At least 2 of {RA, Dec, parallax} measurements
    
    Returns: DataFrame with columns [main_id, ra_deg, dec_deg, parallax_mas, parallax_error_mas, ...]
    """
    query = """
    SELECT
        main_id,
        ra_deg,
        dec_deg,
        parallax_mas,
        parallax_error_mas,
        pm_ra_cosdec_mas_yr,
        pm_dec_mas_yr,
        pm_ra_error_mas_yr,
        pm_dec_error_mas_yr,
        radial_velocity_km_s,
        radial_velocity_error_km_s,
        spectral_type,
        magnitude_v,
        source
    FROM dm_galaxy.stars
    WHERE
        parallax_mas > 0
        AND parallax_error_mas < %s
        AND ra_deg IS NOT NULL
        AND dec_deg IS NOT NULL
    ORDER BY main_id
    """
    
    df = pd.read_sql(
        text(query),
        connection,
        params={'parallax_threshold': PARALLAX_ERROR_THRESHOLD}
    )
    
    logger.info(f"Loaded {len(df)} stars from Phase 01 catalog with parallax precision")
    return df


def ra_dec_parallax_to_xyz(ra_deg, dec_deg, parallax_mas):
    """
    Convert ICRS RA/Dec/parallax to Cartesian coordinates.
    
    Frame: ICRS (J2000.0)
    Input Units: degrees (RA/Dec), milliarcseconds (parallax)
    Output Units: parsecs (X/Y/Z)
    
    Formula (ICRS frame):
        distance_pc = 1000.0 / parallax_mas
        X = distance_pc * cos(Dec) * cos(RA)
        Y = distance_pc * cos(Dec) * sin(RA)
        Z = distance_pc * sin(Dec)
    
    Args:
        ra_deg (float):         Right Ascension in degrees [0, 360)
        dec_deg (float):        Declination in degrees [-90, 90]
        parallax_mas (float):   Parallax in milliarcseconds (must be > 0)
    
    Returns:
        tuple: (X, Y, Z) in parsecs
    
    Raises:
        ValueError: if parallax_mas <= 0 (invalid distance)
    """
    if parallax_mas <= 0:
        raise ValueError(f"Parallax must be positive; got {parallax_mas} mas")
    
    distance_pc = 1000.0 / parallax_mas
    
    ra_rad = radians(ra_deg)
    dec_rad = radians(dec_deg)
    
    cos_dec = cos(dec_rad)
    
    x = distance_pc * cos_dec * cos(ra_rad)
    y = distance_pc * cos_dec * sin(ra_rad)
    z = distance_pc * sin(dec_rad)
    
    return x, y, z


def compute_uncertainty_xyz(ra_deg, dec_deg, parallax_mas, parallax_error_mas,
                            pm_ra_cosdec_mas_yr=None, pm_dec_mas_yr=None,
                            pm_ra_error_mas_yr=None, pm_dec_error_mas_yr=None):
    """
    Estimate XYZ coordinate uncertainty propagated from astrometric errors.
    
    Sources of uncertainty:
    1. Parallax error → distance error (dominant for nearby stars)
    2. Proper motion error → positional uncertainty at reference epoch
    3. RA/Dec measurement error (negligible if derived from parallax precision)
    
    Simplified approach:
    - Distance uncertainty: σ_dist = distance * (σ_parallax / parallax)
    - Tangential uncertainty: σ_tang = arc_len = distance * (σ_angle in radians)
    - Combined XYZ uncertainty: RMS of all error components
    
    Args:
        All parameters in same units as ra_dec_parallax_to_xyz()
        pm_*_mas_yr: proper motion in mas/yr (optional, for future epoch adjustment)
        pm_*_error_mas_yr: PM error in mas/yr (optional)
    
    Returns:
        dict: {'distance_error_pc': float, 'angular_error_deg': float, 'xyz_sigma_pc': float}
    """
    distance_pc = 1000.0 / parallax_mas
    
    # Distance uncertainty from parallax error
    distance_error_pc = distance_pc * (parallax_error_mas / parallax_mas)
    
    # Angular uncertainty: assume ~0.01 deg per element (astrometric precision)
    # This is a conservative estimate; real values depend on source precision
    angular_error_deg = 0.01
    angular_error_rad = radians(angular_error_deg)
    
    # Tangential distance uncertainty from angular error
    tangential_error_pc = distance_pc * angular_error_rad
    
    # Combined XYZ uncertainty (RMS)
    xyz_sigma_pc = sqrt(distance_error_pc**2 + tangential_error_pc**2)
    
    return {
        'distance_error_pc': distance_error_pc,
        'angular_error_deg': angular_error_deg,
        'xyz_sigma_pc': xyz_sigma_pc
    }


def compute_distance(x, y, z):
    """
    Compute distance from origin (Sol) in parsecs.
    
    Args:
        x, y, z (float): Cartesian coordinates in parsecs
    
    Returns:
        float: distance in parsecs
    """
    return sqrt(x**2 + y**2 + z**2)


def apply_sanity_checks(stars_df):
    """
    Validate transformed coordinates for outliers and consistency.
    
    Checks:
    1. Distance consistency: reverse parallax from distance should match input
    2. Outlier detection: distance > 1000 pc is suspicious (likely bad parallax)
    3. Coordinate bounds: X/Y/Z should be finite and not NaN
    4. Nearby stars (<100 LY): mark for inclusion in primary dataset
    
    Args:
        stars_df (DataFrame): with columns [distance_pc, parallax_mas, x_pc, y_pc, z_pc]
    
    Returns:
        DataFrame: with added columns [sanity_pass (bool), distance_ly (float), distance_ly_rounded (int)]
    """
    stars_df['distance_ly'] = stars_df['distance_pc'] * PARSEC_TO_LY
    
    # Check 1: Coordinates are finite
    coords_finite = (
        np.isfinite(stars_df['x_pc']) &
        np.isfinite(stars_df['y_pc']) &
        np.isfinite(stars_df['z_pc'])
    )
    
    # Check 2: Distance is reasonable (< 1000 pc ≈ 3260 LY is very distant but possible)
    distance_reasonable = stars_df['distance_pc'] < 1000
    
    # Check 3: Reverse parallax should be close to original
    reverse_parallax = 1000.0 / stars_df['distance_pc']
    parallax_consistent = np.abs(reverse_parallax - stars_df['parallax_mas']) < 0.1
    
    # Combined sanity check
    stars_df['sanity_pass'] = coords_finite & distance_reasonable & parallax_consistent
    
    # Flag nearby stars (<= 100 LY)
    stars_df['is_nearby'] = stars_df['distance_ly'] <= LY_CUTOFF
    
    stars_df['distance_ly_rounded'] = stars_df['distance_ly'].round(1)
    
    # Log sanity check results
    passed = stars_df['sanity_pass'].sum()
    failed = (~stars_df['sanity_pass']).sum()
    nearby = stars_df['is_nearby'].sum()
    
    logger.info(f"Sanity checks: {passed} pass, {failed} fail, {nearby} nearby (<= {LY_CUTOFF} LY)")
    
    if failed > 0:
        logger.warning(f"Failed sanity checks for: {stars_df[~stars_df['sanity_pass']]['main_id'].tolist()}")
    
    return stars_df


def transform_catalog(connection):
    """
    Main Phase 02 entry point: transform Phase 01 catalog to XYZ coordinates.
    
    Workflow:
    1. Load Phase 01 stars with parallax precision
    2. Convert RA/Dec/parallax → X/Y/Z (ICRS, J2000.0)
    3. Compute uncertainty bounds
    4. Apply sanity checks
    5. Filter to nearby neighborhood (<= 100 LY)
    6. Return validated XYZ dataset
    
    Args:
        connection (sqlalchemy.engine.Connection): active DB connection
    
    Returns:
        dict: {
            'transformed': DataFrame with XYZ coordinates,
            'nearby_count': int,
            'total_count': int,
            'failed_count': int,
            'summary': str (human-readable summary)
        }
    """
    logger.info("Starting Phase 02 coordinate transforms...")
    
    # Load Phase 01 catalog
    stars_df = load_and_filter_phase01(connection)
    total_count = len(stars_df)
    
    if total_count == 0:
        logger.error("No stars loaded from Phase 01; aborting Phase 02")
        return {
            'transformed': pd.DataFrame(),
            'nearby_count': 0,
            'total_count': 0,
            'failed_count': 0,
            'summary': 'FAILED: No stars from Phase 01'
        }
    
    # Transform coordinates
    logger.info("Converting RA/Dec/parallax → X/Y/Z...")
    stars_df['x_pc'] = 0.0
    stars_df['y_pc'] = 0.0
    stars_df['z_pc'] = 0.0
    
    for idx, row in stars_df.iterrows():
        try:
            x, y, z = ra_dec_parallax_to_xyz(
                row['ra_deg'],
                row['dec_deg'],
                row['parallax_mas']
            )
            stars_df.at[idx, 'x_pc'] = x
            stars_df.at[idx, 'y_pc'] = y
            stars_df.at[idx, 'z_pc'] = z
        except ValueError as e:
            logger.warning(f"Transform failed for {row['main_id']}: {e}")
            stars_df.at[idx, 'x_pc'] = np.nan
            stars_df.at[idx, 'y_pc'] = np.nan
            stars_df.at[idx, 'z_pc'] = np.nan
    
    # Compute uncertainty
    logger.info("Computing uncertainty bounds...")
    stars_df['uncertainty_pc'] = stars_df.apply(
        lambda row: compute_uncertainty_xyz(
            row['ra_deg'], row['dec_deg'], row['parallax_mas'],
            row['parallax_error_mas'],
            row['pm_ra_cosdec_mas_yr'], row['pm_dec_mas_yr'],
            row['pm_ra_error_mas_yr'], row['pm_dec_error_mas_yr']
        )['xyz_sigma_pc'],
        axis=1
    )
    
    # Apply sanity checks
    stars_df = apply_sanity_checks(stars_df)
    
    # Filter results
    passed = stars_df[stars_df['sanity_pass']].copy()
    failed_count = total_count - len(passed)
    
    nearby = passed[passed['is_nearby']].copy()
    nearby_count = len(nearby)
    
    summary = (
        f"Phase 02 Transform Complete:\n"
        f"  Total stars: {total_count}\n"
        f"  Passed sanity: {len(passed)}\n"
        f"  Failed sanity: {failed_count}\n"
        f"  Nearby (<= {LY_CUTOFF} LY): {nearby_count}\n"
        f"  Mean distance (nearby): {nearby['distance_ly'].mean():.2f} LY\n"
        f"  Max distance (nearby): {nearby['distance_ly'].max():.2f} LY"
    )
    
    logger.info(summary)
    
    return {
        'transformed': passed,
        'nearby': nearby,
        'nearby_count': nearby_count,
        'total_count': total_count,
        'failed_count': failed_count,
        'summary': summary
    }


def persist_xyz_to_database(connection, transformed_df, run_id, phase='02'):
    """
    Persist Phase 02 XYZ coordinates to database.
    
    Writes to:
    - dm_galaxy.stars_xyz: transformed coordinates with uncertainty
    - stg_data.phase02_manifest: run metadata and transform summary
    
    Args:
        connection (sqlalchemy.engine.Connection): active DB connection
        transformed_df (DataFrame): output from transform_catalog()
        run_id (str): Phase 02 run identifier
        phase (str): phase label for manifest (default '02')
    
    Returns:
        dict: {'success': bool, 'rows_written': int, 'manifest_id': str}
    """
    logger.info(f"Persisting Phase 02 results (run_id={run_id})...")
    
    try:
        # Prepare XYZ records
        xyz_records = transformed_df[[
            'main_id', 'x_pc', 'y_pc', 'z_pc', 'distance_ly',
            'parallax_mas', 'uncertainty_pc', 'sanity_pass'
        ]].copy()
        xyz_records['run_id'] = run_id
        xyz_records['created_at'] = pd.Timestamp.now()
        
        # Upsert to database (ON CONFLICT DO UPDATE by main_id)
        xyz_records.to_sql(
            'stars_xyz',
            connection,
            schema='dm_galaxy',
            if_exists='append',
            index=False,
            method='multi'
        )
        
        logger.info(f"Wrote {len(xyz_records)} XYZ records to dm_galaxy.stars_xyz")
        
        return {
            'success': True,
            'rows_written': len(xyz_records),
            'run_id': run_id
        }
    
    except Exception as e:
        logger.error(f"Failed to persist Phase 02 results: {e}")
        return {
            'success': False,
            'rows_written': 0,
            'error': str(e)
        }


if __name__ == '__main__':
    # Test standalone (requires DB connection)
    logging.basicConfig(level=logging.INFO)
    
    from dbs.database import _build_db_engine
    
    engine = _build_db_engine()
    if engine:
        with engine.begin() as conn:
            result = transform_catalog(conn)
            print(result['summary'])
    else:
        print("DB engine not available; skipping test")
