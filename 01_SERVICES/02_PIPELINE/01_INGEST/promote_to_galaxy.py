"""
Phase 01b — Staging → Dimensional Promotion
============================================

Promotes validated rows from stg_data.*_raw tables into the canonical
dm_galaxy.stars and dm_galaxy.planets tables.

This is the missing ETL step that:
  - Merges SIMBAD astrometry and exoplanet catalog stellar data
  - Propagates metallicity [Fe/H] from exoplanet catalog into dm_galaxy.stars
  - De-duplicates by main_id (SIMBAD wins for astrometry; exoplanet
    catalog wins for metallicity/age/mass where it has values)
  - Builds initial planet entries for confirmed exoplanets

Pipeline position:
  Phase 01  → stg_data.*_raw         (process_rest_csv.py)
  Phase 01b → dm_galaxy.stars        (THIS SCRIPT)
  Phase 02  → dm_galaxy.stars_xyz    (coordinate_transforms.py)
  Phase 03  → dm_galaxy.inferred_*   (inference_engine.py)

References:
  - Fischer & Valenti (2005): planet-metallicity correlation
  - SIMBAD MESFE_H table: [Fe/H] measurements
"""

import logging
import sys
import os
from pathlib import Path
import re
import json
import numpy as np
import pandas as pd
from sqlalchemy import text
from datetime import datetime

logger = logging.getLogger(__name__)

# ── Column normalisation ─────────────────────────────────────────────

def _norm(s):
    """Normalise a column name to lowercase snake_case, strip BOM."""
    return str(s).replace('\ufeff', '').strip().lower().replace(' ', '_')


# ── Stefan-Boltzmann luminosity from Teff + radius ──────────────────
SIGMA_SB = 5.670374419e-8   # W m⁻² K⁻⁴
L_SUN    = 3.828e26          # W
R_SUN    = 6.957e8           # m


def luminosity_from_teff_radius(teff_k: float, radius_solar: float) -> float:
    """L/L☉ from Teff and radius using Stefan-Boltzmann."""
    r_m = radius_solar * R_SUN
    l_w = 4.0 * np.pi * r_m**2 * SIGMA_SB * teff_k**4
    return l_w / L_SUN


# ── Spectral class heuristic from Teff ──────────────────────────────

def spectral_class_from_teff(teff_k: float) -> str:
    """Rough Morgan-Keenan spectral class from Teff (Allen 2000)."""
    if teff_k >= 30000:  return 'O'
    if teff_k >= 10000:  return 'B'
    if teff_k >= 7500:   return 'A'
    if teff_k >= 6000:   return 'F'
    if teff_k >= 5200:   return 'G'
    if teff_k >= 3700:   return 'K'
    if teff_k >= 2400:   return 'M'
    return 'L'


# ── Load staging tables ──────────────────────────────────────────────

def load_simbad_staging(connection) -> pd.DataFrame:
    """
    Load all SIMBAD raw rows from stg_data.
    We union simbad_01_raw, simbad_02_raw, simbad_03_raw if they exist.
    """
    frames = []
    for suffix in ('01', '02', '03'):
        table = f'simbad_{suffix}_raw'
        try:
            q = f"SELECT * FROM stg_data.{table} LIMIT 100000"
            df = pd.read_sql(text(q), connection)
            df.columns = [_norm(c) for c in df.columns]
            frames.append(df)
            logger.info(f"Loaded {len(df)} rows from stg_data.{table}")
        except Exception as e:
            logger.debug(f"stg_data.{table} not available: {e}")

    if not frames:
        logger.warning("No SIMBAD staging tables found")
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


def load_exoplanet_staging(connection) -> pd.DataFrame:
    """
    Load exoplanet catalog raw rows.
    Tries exoplanets_01_raw, exoplanets_01x_raw in order.
    """
    frames = []
    for suffix in ('01', '01x'):
        table = f'exoplanets_{suffix}_raw'
        try:
            q = f"SELECT * FROM stg_data.{table} LIMIT 200000"
            df = pd.read_sql(text(q), connection)
            df.columns = [_norm(c) for c in df.columns]
            frames.append(df)
            logger.info(f"Loaded {len(df)} rows from stg_data.{table}")
        except Exception as e:
            logger.debug(f"stg_data.{table} not available: {e}")

    if not frames:
        logger.warning("No exoplanet staging tables found")
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


# ── Build dm_galaxy.stars rows from SIMBAD ───────────────────────────

def build_stars_from_simbad(simbad_df: pd.DataFrame) -> pd.DataFrame:
    """
    Map SIMBAD raw columns → dm_galaxy.stars schema.

    SIMBAD CSV columns (from 03_DATA/01_SOURCES/SIMBAD_01.csv):
      sys_id, sys_code, main_id, ids, otype_txt, otype_shortname,
      otype_longname, otypes,
      Average of ra, Average of dec, Average of dist
    """
    if simbad_df.empty:
        return pd.DataFrame()

    # Column detection (handle BOM / spacing variations)
    col_map = {}
    for col in simbad_df.columns:
        key = col.lower().replace(' ', '_').replace('average_of_', '')
        col_map[key] = col

    def get(key, default=None):
        return simbad_df[col_map[key]] if key in col_map else default

    stars = pd.DataFrame()

    # Required identity fields
    main_id_col = col_map.get('main_id') or col_map.get('main_id')
    if main_id_col is None:
        logger.error("SIMBAD staging missing 'main_id' column")
        return pd.DataFrame()

    stars['main_id']        = simbad_df[main_id_col].astype(str).str.strip()
    stars['canonical_name'] = stars['main_id']
    stars['source_name']    = 'SIMBAD'
    stars['source_object_id'] = simbad_df.get(col_map.get('sys_id', 'sys_id'),
                                               stars['main_id']).astype(str)

    # Astrometry — SIMBAD distance column is in parsecs
    ra_col  = col_map.get('ra')  or col_map.get('average_of_ra', None)
    dec_col = col_map.get('dec') or col_map.get('average_of_dec', None)
    dist_col= col_map.get('dist') or col_map.get('average_of_dist', None)

    stars['ra_deg']      = pd.to_numeric(simbad_df[ra_col],  errors='coerce') if ra_col  else np.nan
    stars['dec_deg']     = pd.to_numeric(simbad_df[dec_col], errors='coerce') if dec_col else np.nan

    # SIMBAD distance is in parsecs; convert to parallax + LY
    if dist_col:
        dist_pc = pd.to_numeric(simbad_df[dist_col], errors='coerce')
        stars['distance_ly']    = dist_pc * 3.26156
        # Parallax = 1000 / dist_pc  [mas]
        with np.errstate(divide='ignore', invalid='ignore'):
            plx = np.where(dist_pc > 0, 1000.0 / dist_pc, np.nan)
        stars['parallax_mas'] = plx
    else:
        stars['distance_ly']  = np.nan
        stars['parallax_mas'] = np.nan

    # Object type → spectral class approximation (SIMBAD doesn't carry Teff directly)
    otype_col = col_map.get('otype_txt') or col_map.get('otype_shortname')
    if otype_col:
        stars['_otype'] = simbad_df[otype_col].astype(str)
    else:
        stars['_otype'] = ''

    stars['confidence_tier'] = 'observed'
    stars['provenance']      = json.dumps({'source': 'SIMBAD'})

    # Columns not available from SIMBAD — left NULL for exoplanet catalog to fill
    for null_col in ['spectral_type', 'magnitude_v', 'luminosity_solar',
                     'temperature_k', 'metallicity_feh', 'metallicity_feh_error',
                     'star_mass_solar', 'star_radius_solar', 'star_age_gyr',
                     'parallax_error_mas']:
        stars[null_col] = np.nan

    stars['metallicity_source'] = None

    return stars


# ── Build stellar supplement from exoplanet catalog ──────────────────

def build_stellar_supplement_from_exoplanets(exo_df: pd.DataFrame) -> pd.DataFrame:
    """
    Extract per-star properties from the exoplanet catalog.

    The exoplanet CSV has one row per planet; we group by star_name and
    take the first non-null value for each stellar property.

    Key columns we care about:
      star_name, ra, dec, star_distance,
      star_metallicity, star_metallicity_error_min, star_metallicity_error_max,
      star_mass, star_mass_error_min, star_mass_error_max,
      star_radius, star_radius_error_min, star_radius_error_max,
      star_sp_type, star_age, star_teff,
      star_detected_disc, star_magnetic_field, mag_v, mag_j, mag_h, mag_k
    """
    if exo_df.empty:
        return pd.DataFrame()

    # Identify column names (normalised)
    cols = list(exo_df.columns)

    def find(candidates):
        for c in candidates:
            if c in cols:
                return c
        return None

    c_star_name = find(['star_name'])
    c_ra        = find(['ra'])
    c_dec       = find(['dec'])
    c_distance  = find(['star_distance'])
    c_feh       = find(['star_metallicity'])
    c_feh_lo    = find(['star_metallicity_error_min'])
    c_feh_hi    = find(['star_metallicity_error_max'])
    c_mass      = find(['star_mass'])
    c_mass_lo   = find(['star_mass_error_min'])
    c_radius    = find(['star_radius'])
    c_radius_lo = find(['star_radius_error_min'])
    c_sp        = find(['star_sp_type'])
    c_age       = find(['star_age'])
    c_teff      = find(['star_teff'])
    c_mag_v     = find(['mag_v'])
    c_mag_i     = find(['mag_i'])
    c_mag_j     = find(['mag_j'])
    c_mag_h     = find(['mag_h'])
    c_mag_k     = find(['mag_k'])
    c_mag_field = find(['star_magnetic_field'])

    if c_star_name is None:
        logger.error("Exoplanet staging missing 'star_name' column")
        return pd.DataFrame()

    # Coerce numerics
    def numeric(col):
        if col is None:
            return pd.Series(np.nan, index=exo_df.index)
        return pd.to_numeric(exo_df[col], errors='coerce')

    exo_df = exo_df.copy()
    exo_df['_star_name'] = exo_df[c_star_name].astype(str).str.strip()

    # Aggregate: first non-null per star
    agg_spec = {}
    pairs = [
        ('ra_deg',          c_ra),
        ('dec_deg',         c_dec),
        ('distance_ly_exo', c_distance),   # in parsecs in CSV; we rename
        ('metallicity_feh', c_feh),
        ('metallicity_feh_error', c_feh_lo),
        ('star_mass_solar', c_mass),
        ('star_mass_error_solar', c_mass_lo),
        ('star_radius_solar', c_radius),
        ('star_radius_error_solar', c_radius_lo),
        ('spectral_type',   c_sp),
        ('star_age_gyr',    c_age),
        ('temperature_k',   c_teff),
        ('magnitude_v',     c_mag_v),
        ('magnitude_i',     c_mag_i),
        ('magnitude_j',     c_mag_j),
        ('magnitude_h',     c_mag_h),
        ('magnitude_k',     c_mag_k),
        ('magnetic_field_detected', c_mag_field),
    ]

    for dest, src in pairs:
        if src is not None:
            exo_df[dest] = numeric(src)
        else:
            exo_df[dest] = np.nan

    group_cols = [dest for dest, _ in pairs] + ['_star_name']
    grouped = (
        exo_df[group_cols]
        .groupby('_star_name', as_index=False)
        .first()
    )

    # Distance in CSV is in parsecs — convert to LY
    if 'distance_ly_exo' in grouped.columns:
        dist_pc = pd.to_numeric(grouped['distance_ly_exo'], errors='coerce')
        grouped['distance_ly'] = dist_pc * 3.26156
        with np.errstate(divide='ignore', invalid='ignore'):
            grouped['parallax_mas'] = np.where(dist_pc > 0, 1000.0 / dist_pc, np.nan)
        grouped.drop(columns=['distance_ly_exo'], inplace=True)
    else:
        grouped['distance_ly'] = np.nan
        grouped['parallax_mas'] = np.nan

    # Derive luminosity where we have Teff and radius
    teff  = pd.to_numeric(grouped['temperature_k'],   errors='coerce')
    r_sol = pd.to_numeric(grouped['star_radius_solar'], errors='coerce')
    lum   = np.where(
        teff.notna() & r_sol.notna() & (teff > 0) & (r_sol > 0),
        [luminosity_from_teff_radius(float(t), float(r)) for t, r in zip(teff, r_sol)],
        np.nan
    )
    grouped['luminosity_solar'] = lum

    # Derive spectral class from Teff where sp type is missing
    sp = grouped['spectral_type'].astype(str).str.strip()
    has_sp = sp.notna() & (sp != 'nan') & (sp != '')
    grouped['spectral_type'] = np.where(
        has_sp,
        sp,
        teff.apply(lambda t: spectral_class_from_teff(float(t)) if pd.notna(t) else None)
    )

    # Magnetic field: normalise to bool
    if 'magnetic_field_detected' in grouped.columns:
        mf = grouped['magnetic_field_detected']
        grouped['magnetic_field_detected'] = (
            mf.notna() & (mf.astype(str).str.strip() != '') & (mf.astype(str) != '0')
        )
    else:
        grouped['magnetic_field_detected'] = False

    grouped.rename(columns={'_star_name': 'star_name'}, inplace=True)
    grouped['metallicity_source'] = np.where(
        pd.to_numeric(grouped['metallicity_feh'], errors='coerce').notna(),
        'exoplanet_catalog',
        None
    )
    grouped['source_name']    = 'EXOPLANET_CATALOG'
    grouped['confidence_tier'] = 'confirmed'

    return grouped


# ── Upsert into dm_galaxy.stars ──────────────────────────────────────

def upsert_stars(connection, stars_df: pd.DataFrame, source_label: str) -> int:
    """
    Upsert star rows into dm_galaxy.stars.

    Strategy:
      - ON CONFLICT (main_id) DO UPDATE
      - Only overwrite NULL values (never overwrite a known-good value
        with a NULL from a less authoritative source)
      - Metallicity from exoplanet catalog wins over NULL

    Returns number of rows upserted.
    """
    if stars_df.empty:
        return 0

    # Ensure required columns exist
    required = ['main_id', 'canonical_name', 'source_name']
    for col in required:
        if col not in stars_df.columns:
            logger.error(f"Stars dataframe missing '{col}'")
            return 0

    count = 0
    for _, row in stars_df.iterrows():
        if not row.get('main_id') or str(row['main_id']) in ('nan', '', 'None'):
            continue

        def v(key):
            val = row.get(key)
            if val is None or (isinstance(val, float) and np.isnan(val)):
                return None
            return val

        params = {
            'main_id':               str(row['main_id']).strip(),
            'canonical_name':        str(row.get('canonical_name', row['main_id'])).strip(),
            'source_name':           str(row.get('source_name', source_label)),
            'source_object_id':      v('source_object_id'),
            'ra_deg':                v('ra_deg'),
            'dec_deg':               v('dec_deg'),
            'distance_ly':           v('distance_ly'),
            'parallax_mas':          v('parallax_mas'),
            'parallax_error_mas':    v('parallax_error_mas'),
            'spectral_type':         v('spectral_type'),
            'magnitude_v':           v('magnitude_v'),
            'magnitude_i':           v('magnitude_i'),
            'magnitude_j':           v('magnitude_j'),
            'magnitude_h':           v('magnitude_h'),
            'magnitude_k':           v('magnitude_k'),
            'luminosity_solar':      v('luminosity_solar'),
            'temperature_k':         v('temperature_k'),
            'metallicity_feh':       v('metallicity_feh'),
            'metallicity_feh_error': v('metallicity_feh_error'),
            'metallicity_source':    v('metallicity_source'),
            'star_mass_solar':       v('star_mass_solar'),
            'star_mass_error_solar': v('star_mass_error_solar'),
            'star_radius_solar':     v('star_radius_solar'),
            'star_radius_error_solar': v('star_radius_error_solar'),
            'star_age_gyr':          v('star_age_gyr'),
            'star_age_gyr_error':    v('star_age_gyr_error'),
            'magnetic_field_detected': bool(v('magnetic_field_detected') or False),
            'confidence_tier':       str(row.get('confidence_tier', 'candidate')),
            'provenance':            json.dumps({'source': source_label}),
        }

        try:
            connection.execute(text("""
                INSERT INTO dm_galaxy.stars (
                    main_id, canonical_name, source_name, source_object_id,
                    ra_deg, dec_deg, distance_ly,
                    parallax_mas, parallax_error_mas,
                    spectral_type,
                    magnitude_v, magnitude_i, magnitude_j, magnitude_h, magnitude_k,
                    luminosity_solar, temperature_k,
                    metallicity_feh, metallicity_feh_error, metallicity_source,
                    star_mass_solar, star_mass_error_solar,
                    star_radius_solar, star_radius_error_solar,
                    star_age_gyr, star_age_gyr_error,
                    magnetic_field_detected,
                    confidence_tier, provenance, updated_at
                )
                VALUES (
                    :main_id, :canonical_name, :source_name, :source_object_id,
                    :ra_deg, :dec_deg, :distance_ly,
                    :parallax_mas, :parallax_error_mas,
                    :spectral_type,
                    :magnitude_v, :magnitude_i, :magnitude_j, :magnitude_h, :magnitude_k,
                    :luminosity_solar, :temperature_k,
                    :metallicity_feh, :metallicity_feh_error, :metallicity_source,
                    :star_mass_solar, :star_mass_error_solar,
                    :star_radius_solar, :star_radius_error_solar,
                    :star_age_gyr, :star_age_gyr_error,
                    :magnetic_field_detected,
                    :confidence_tier, CAST(:provenance AS JSONB), NOW()
                )
                ON CONFLICT (main_id) DO UPDATE SET
                    -- Overwrite only when incumbent is NULL (COALESCE semantics)
                    ra_deg               = COALESCE(dm_galaxy.stars.ra_deg,               EXCLUDED.ra_deg),
                    dec_deg              = COALESCE(dm_galaxy.stars.dec_deg,              EXCLUDED.dec_deg),
                    distance_ly          = COALESCE(dm_galaxy.stars.distance_ly,          EXCLUDED.distance_ly),
                    parallax_mas         = COALESCE(dm_galaxy.stars.parallax_mas,         EXCLUDED.parallax_mas),
                    parallax_error_mas   = COALESCE(dm_galaxy.stars.parallax_error_mas,   EXCLUDED.parallax_error_mas),
                    spectral_type        = COALESCE(dm_galaxy.stars.spectral_type,        EXCLUDED.spectral_type),
                    magnitude_v          = COALESCE(dm_galaxy.stars.magnitude_v,          EXCLUDED.magnitude_v),
                    magnitude_j          = COALESCE(dm_galaxy.stars.magnitude_j,          EXCLUDED.magnitude_j),
                    luminosity_solar     = COALESCE(dm_galaxy.stars.luminosity_solar,     EXCLUDED.luminosity_solar),
                    temperature_k        = COALESCE(dm_galaxy.stars.temperature_k,        EXCLUDED.temperature_k),
                    -- Metallicity: exoplanet catalog value wins over NULL but
                    -- a pre-existing spectroscopic value (from GAIA etc.) is never overwritten
                    metallicity_feh      = CASE
                        WHEN dm_galaxy.stars.metallicity_feh IS NULL THEN EXCLUDED.metallicity_feh
                        WHEN dm_galaxy.stars.metallicity_source IN ('spectroscopy', 'gaia_gspphot')
                             AND EXCLUDED.metallicity_source = 'exoplanet_catalog'
                             THEN dm_galaxy.stars.metallicity_feh   -- keep better value
                        ELSE COALESCE(dm_galaxy.stars.metallicity_feh, EXCLUDED.metallicity_feh)
                    END,
                    metallicity_feh_error = COALESCE(dm_galaxy.stars.metallicity_feh_error, EXCLUDED.metallicity_feh_error),
                    metallicity_source   = COALESCE(dm_galaxy.stars.metallicity_source,   EXCLUDED.metallicity_source),
                    star_mass_solar      = COALESCE(dm_galaxy.stars.star_mass_solar,      EXCLUDED.star_mass_solar),
                    star_radius_solar    = COALESCE(dm_galaxy.stars.star_radius_solar,    EXCLUDED.star_radius_solar),
                    star_age_gyr         = COALESCE(dm_galaxy.stars.star_age_gyr,         EXCLUDED.star_age_gyr),
                    magnetic_field_detected = COALESCE(dm_galaxy.stars.magnetic_field_detected, EXCLUDED.magnetic_field_detected),
                    updated_at           = NOW()
            """), params)
            count += 1
        except Exception as e:
            logger.warning(f"Upsert failed for {params['main_id']}: {e}")

    return count


# ── Main entry point ─────────────────────────────────────────────────

def run_promotion(connection) -> dict:
    """
    Run the full Phase 01b promotion pipeline.

    1. Load SIMBAD staging → build base star rows → upsert
    2. Load exoplanet catalog staging → extract per-star supplement → upsert
       (metallicity, mass, radius, Teff, age flow in here)
    3. Return summary statistics

    Returns:
        dict with 'simbad_rows', 'exo_stellar_rows', 'summary' keys
    """
    logger.info("=== Phase 01b: Staging → Galaxy Promotion ===")

    # ── SIMBAD pass ──────────────────────────────────────────────────
    simbad_df = load_simbad_staging(connection)
    simbad_stars = build_stars_from_simbad(simbad_df)
    simbad_count = upsert_stars(connection, simbad_stars, 'SIMBAD')
    logger.info(f"SIMBAD: upserted {simbad_count} star rows into dm_galaxy.stars")

    # ── Exoplanet catalog stellar supplement ─────────────────────────
    exo_df = load_exoplanet_staging(connection)
    exo_stars = build_stellar_supplement_from_exoplanets(exo_df)
    exo_count = upsert_stars(connection, exo_stars, 'EXOPLANET_CATALOG')
    logger.info(f"EXOPLANET_CATALOG: upserted {exo_count} star-supplement rows into dm_galaxy.stars")

    # ── Verify metallicity flow ──────────────────────────────────────
    try:
        result = connection.execute(text("""
            SELECT
                COUNT(*) AS total_stars,
                COUNT(metallicity_feh) AS stars_with_metallicity,
                AVG(metallicity_feh)::NUMERIC(5,3) AS mean_feh,
                MIN(metallicity_feh)::NUMERIC(5,3) AS min_feh,
                MAX(metallicity_feh)::NUMERIC(5,3) AS max_feh
            FROM dm_galaxy.stars
        """)).fetchone()
        logger.info(
            f"Metallicity coverage: {result[1]}/{result[0]} stars "
            f"([Fe/H] range {result[3]} to {result[4]}, mean {result[2]})"
        )
    except Exception as e:
        logger.warning(f"Metallicity verification query failed: {e}")

    summary = (
        f"Phase 01b Promotion Complete:\n"
        f"  SIMBAD stars upserted:           {simbad_count}\n"
        f"  Exoplanet-catalog stars upserted: {exo_count}\n"
    )
    logger.info(summary)

    return {
        'simbad_rows': simbad_count,
        'exo_stellar_rows': exo_count,
        'summary': summary,
    }


# ── CLI entry point ──────────────────────────────────────────────────

def main():
    import argparse
    logging.basicConfig(level=logging.INFO,
                        format='%(asctime)s %(levelname)s %(name)s: %(message)s')

    parser = argparse.ArgumentParser(description='Phase 01b: promote staging tables to dm_galaxy.stars')
    parser.parse_args()

    shared_dir = Path(__file__).resolve().parents[1] / 'SHARED'
    if str(shared_dir) not in sys.path:
        sys.path.insert(0, str(shared_dir))

    from database import engine

    with engine.begin() as conn:
        result = run_promotion(conn)
    print(result['summary'])


if __name__ == '__main__':
    main()
