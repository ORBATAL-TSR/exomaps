"""
GAIA DR3 Ingest — Nearby Star Astrometry & Astrophysical Parameters
=====================================================================

Pulls GAIA DR3 data for all stars within the survey volume (parallax > 20 mas,
i.e. distance < 50 pc / 163 LY) via the GAIA TAP service, writes to
stg_data.gaia_dr3_raw, then crossmatches to dm_galaxy.stars and upserts
the improved parallax, Teff, metallicity, radius, and luminosity values.

Why GAIA over SIMBAD for distances?
  - GAIA DR3 parallax uncertainties: σ_plx ≈ 0.01–0.02 mas for bright stars
    (vs ~0.3 mas for Hipparcos)
  - Full covariance matrix available (we propagate σ_plx → σ_dist)
  - Astrophysical parameters from GSP-Phot (Teff, [M/H], R, L) and FLAME (age, mass)
  - ~1.46 billion sources; all nearby stars covered

Pipeline position:
  Phase 01   → stg_data.*_raw              (process_rest_csv.py)
  Phase 01b  → dm_galaxy.stars             (promote_to_galaxy.py)
  GAIA INGEST→ stg_data.gaia_dr3_raw       (THIS SCRIPT)
             → dm_galaxy.stars (upsert)    (THIS SCRIPT)
  Phase 02   → dm_galaxy.stars_xyz         (coordinate_transforms.py)
  Phase 03   → dm_galaxy.inferred_*        (inference_engine.py)

References:
  - GAIA DR3: Vallenari et al. (2023), A&A 674, A1
  - GSP-Phot: Andrae et al. (2023) — Teff, logg, [M/H], A₀, R, L from BP/RP spectra
  - FLAME: Creevey et al. (2023) — age, mass from stellar evolution models
  - TAP endpoint: https://gea.esac.esa.int/tap-server/tap
"""

import logging
import sys
import json
import time
from pathlib import Path
from math import radians, cos, sin, sqrt

import numpy as np
import pandas as pd
from sqlalchemy import text

logger = logging.getLogger(__name__)

# ── TAP query config ─────────────────────────────────────────────────

GAIA_TAP_URL   = "https://gea.esac.esa.int/tap-server/tap"
GAIA_TABLE     = "gaiadr3.gaia_source"
PARALLAX_MIN   = 20.0   # mas → distance < 50 pc (163 LY); covers our 100 LY map + margin
BATCH_SIZE     = 5000   # rows per TAP page (TAP async not needed for this volume)

# ── Angular separation helper ────────────────────────────────────────

def angular_separation_arcsec(ra1, dec1, ra2, dec2) -> float:
    """
    Vincenty formula for angular separation [arcsec].
    Input in degrees.
    """
    ra1_r  = radians(ra1);  dec1_r = radians(dec1)
    ra2_r  = radians(ra2);  dec2_r = radians(dec2)
    dra    = ra2_r - ra1_r
    num    = sqrt((cos(dec2_r)*sin(dra))**2 +
                  (cos(dec1_r)*sin(dec2_r) - sin(dec1_r)*cos(dec2_r)*cos(dra))**2)
    den    = sin(dec1_r)*sin(dec2_r) + cos(dec1_r)*cos(dec2_r)*cos(dra)
    sep_r  = abs(float(np.arctan2(num, den)))  # radians
    return sep_r * (180.0 / np.pi) * 3600.0    # → arcsec


# ── ADQL query builder ───────────────────────────────────────────────

def build_gaia_adql(parallax_min: float) -> str:
    """
    Build ADQL query to fetch nearby stars from GAIA DR3.

    Columns selected:
      Identity:    source_id, designation
      Astrometry:  ra, dec, parallax, parallax_error,
                   pmra, pmdec, pmra_error, pmdec_error,
                   radial_velocity, radial_velocity_error
      Photometry:  phot_g_mean_mag, phot_bp_mean_mag, phot_rp_mean_mag
      GSP-Phot:    teff_gspphot, teff_gspphot_lower, teff_gspphot_upper,
                   logg_gspphot, mh_gspphot, mh_gspphot_lower, mh_gspphot_upper,
                   azero_gspphot,
                   radius_gspphot, radius_gspphot_lower, radius_gspphot_upper
      FLAME:       lum_flame, lum_flame_lower, lum_flame_upper,
                   age_flame, age_flame_lower, age_flame_upper,
                   mass_flame, mass_flame_lower, mass_flame_upper

    Filter: parallax > parallax_min (positive parallax, nearby stars only)
            parallax_over_error > 5  (5σ detection quality gate)
    """
    return f"""
SELECT
    source_id, designation,
    ra, dec,
    parallax, parallax_error,
    pmra, pmdec, pmra_error, pmdec_error,
    radial_velocity, radial_velocity_error,
    phot_g_mean_mag, phot_bp_mean_mag, phot_rp_mean_mag,
    teff_gspphot, teff_gspphot_lower, teff_gspphot_upper,
    logg_gspphot,
    mh_gspphot, mh_gspphot_lower, mh_gspphot_upper,
    azero_gspphot,
    radius_gspphot, radius_gspphot_lower, radius_gspphot_upper,
    lum_flame, lum_flame_lower, lum_flame_upper,
    age_flame, age_flame_lower, age_flame_upper,
    mass_flame, mass_flame_lower, mass_flame_upper
FROM {GAIA_TABLE}
WHERE parallax > {parallax_min}
  AND parallax_over_error > 5
ORDER BY parallax DESC
""".strip()


# ── TAP fetch ────────────────────────────────────────────────────────

def fetch_gaia_tap(parallax_min: float = PARALLAX_MIN,
                   timeout_s: int = 120) -> pd.DataFrame:
    """
    Fetch GAIA DR3 data via astroquery.gaia (synchronous TAP query).

    Falls back to requests-based VOTABLE download if astroquery is
    unavailable.

    Returns:
        DataFrame with one row per GAIA source.
    """
    adql = build_gaia_adql(parallax_min)
    logger.info(f"Fetching GAIA DR3: parallax > {parallax_min} mas ...")

    # ── Attempt astroquery ────────────────────────────────────────────
    try:
        from astroquery.gaia import Gaia
        Gaia.MAIN_GAIA_TABLE = GAIA_TABLE
        Gaia.ROW_LIMIT = -1   # no row limit
        job = Gaia.launch_job(adql, dump_to_file=False)
        result = job.get_results()
        df = result.to_pandas()
        logger.info(f"astroquery: fetched {len(df)} GAIA sources")
        return df

    except ImportError:
        logger.warning("astroquery not available — falling back to requests/VOTABLE")

    except Exception as e:
        logger.warning(f"astroquery fetch failed: {e} — falling back to requests")

    # ── Fallback: requests → VOTABLE ─────────────────────────────────
    try:
        import requests
        import io
        from astropy.io.votable import parse_single_table

        encoded = adql.replace('\n', ' ').replace('  ', ' ')
        params  = {
            'REQUEST': 'doQuery',
            'LANG':    'ADQL',
            'FORMAT':  'votable',
            'QUERY':   encoded,
        }
        url = f"{GAIA_TAP_URL}/sync"
        logger.info(f"Requesting GAIA TAP sync: {url}")
        resp = requests.get(url, params=params, timeout=timeout_s)
        resp.raise_for_status()

        vot  = parse_single_table(io.BytesIO(resp.content))
        df   = vot.to_table().to_pandas()
        logger.info(f"requests/VOTABLE: fetched {len(df)} GAIA sources")
        return df

    except Exception as e:
        logger.error(f"GAIA TAP fetch failed completely: {e}")
        return pd.DataFrame()


# ── Write to staging ─────────────────────────────────────────────────

def write_gaia_to_staging(connection, gaia_df: pd.DataFrame,
                           ingest_run_id: str) -> int:
    """
    Write raw GAIA DR3 rows to stg_data.gaia_dr3_raw.
    Uses UPSERT on source_id to allow re-runs without duplicates.
    Returns number of rows written.
    """
    if gaia_df.empty:
        return 0

    # Normalise column names
    gaia_df.columns = [str(c).lower().strip() for c in gaia_df.columns]

    def col(candidates):
        for c in candidates:
            if c in gaia_df.columns:
                return c
        return None

    count = 0
    for _, row in gaia_df.iterrows():
        def v(key):
            val = row.get(key)
            if val is None:
                return None
            if isinstance(val, float) and np.isnan(val):
                return None
            return val

        params = {
            'ingest_run_id':             ingest_run_id,
            'source_id':                 int(v('source_id') or 0),
            'designation':               v('designation'),
            'ra_deg':                    v('ra'),
            'dec_deg':                   v('dec'),
            'parallax_mas':              v('parallax'),
            'parallax_error_mas':        v('parallax_error'),
            'pm_ra_cosdec_mas_yr':       v('pmra'),
            'pm_dec_mas_yr':             v('pmdec'),
            'pm_ra_error_mas_yr':        v('pmra_error'),
            'pm_dec_error_mas_yr':       v('pmdec_error'),
            'radial_velocity_km_s':      v('radial_velocity'),
            'radial_velocity_error_km_s':v('radial_velocity_error'),
            'phot_g_mean_mag':           v('phot_g_mean_mag'),
            'phot_bp_mean_mag':          v('phot_bp_mean_mag'),
            'phot_rp_mean_mag':          v('phot_rp_mean_mag'),
            'teff_gspphot':              v('teff_gspphot'),
            'teff_gspphot_lower':        v('teff_gspphot_lower'),
            'teff_gspphot_upper':        v('teff_gspphot_upper'),
            'logg_gspphot':              v('logg_gspphot'),
            'mh_gspphot':                v('mh_gspphot'),
            'mh_gspphot_lower':          v('mh_gspphot_lower'),
            'mh_gspphot_upper':          v('mh_gspphot_upper'),
            'azero_gspphot':             v('azero_gspphot'),
            'radius_gspphot':            v('radius_gspphot'),
            'radius_gspphot_lower':      v('radius_gspphot_lower'),
            'radius_gspphot_upper':      v('radius_gspphot_upper'),
            'lum_flame':                 v('lum_flame'),
            'lum_flame_lower':           v('lum_flame_lower'),
            'lum_flame_upper':           v('lum_flame_upper'),
            'age_flame':                 v('age_flame'),
            'age_flame_lower':           v('age_flame_lower'),
            'age_flame_upper':           v('age_flame_upper'),
            'mass_flame':                v('mass_flame'),
            'mass_flame_lower':          v('mass_flame_lower'),
            'mass_flame_upper':          v('mass_flame_upper'),
        }

        if params['source_id'] == 0:
            continue

        try:
            connection.execute(text("""
                INSERT INTO stg_data.gaia_dr3_raw (
                    ingest_run_id, source_id, designation,
                    ra_deg, dec_deg,
                    parallax_mas, parallax_error_mas,
                    pm_ra_cosdec_mas_yr, pm_dec_mas_yr,
                    pm_ra_error_mas_yr, pm_dec_error_mas_yr,
                    radial_velocity_km_s, radial_velocity_error_km_s,
                    phot_g_mean_mag, phot_bp_mean_mag, phot_rp_mean_mag,
                    teff_gspphot, teff_gspphot_lower, teff_gspphot_upper,
                    logg_gspphot,
                    mh_gspphot, mh_gspphot_lower, mh_gspphot_upper,
                    azero_gspphot,
                    radius_gspphot, radius_gspphot_lower, radius_gspphot_upper,
                    lum_flame, lum_flame_lower, lum_flame_upper,
                    age_flame, age_flame_lower, age_flame_upper,
                    mass_flame, mass_flame_lower, mass_flame_upper
                ) VALUES (
                    :ingest_run_id, :source_id, :designation,
                    :ra_deg, :dec_deg,
                    :parallax_mas, :parallax_error_mas,
                    :pm_ra_cosdec_mas_yr, :pm_dec_mas_yr,
                    :pm_ra_error_mas_yr, :pm_dec_error_mas_yr,
                    :radial_velocity_km_s, :radial_velocity_error_km_s,
                    :phot_g_mean_mag, :phot_bp_mean_mag, :phot_rp_mean_mag,
                    :teff_gspphot, :teff_gspphot_lower, :teff_gspphot_upper,
                    :logg_gspphot,
                    :mh_gspphot, :mh_gspphot_lower, :mh_gspphot_upper,
                    :azero_gspphot,
                    :radius_gspphot, :radius_gspphot_lower, :radius_gspphot_upper,
                    :lum_flame, :lum_flame_lower, :lum_flame_upper,
                    :age_flame, :age_flame_lower, :age_flame_upper,
                    :mass_flame, :mass_flame_lower, :mass_flame_upper
                )
                ON CONFLICT (source_id) DO UPDATE SET
                    parallax_mas          = EXCLUDED.parallax_mas,
                    parallax_error_mas    = EXCLUDED.parallax_error_mas,
                    teff_gspphot          = COALESCE(EXCLUDED.teff_gspphot,   stg_data.gaia_dr3_raw.teff_gspphot),
                    mh_gspphot            = COALESCE(EXCLUDED.mh_gspphot,     stg_data.gaia_dr3_raw.mh_gspphot),
                    radius_gspphot        = COALESCE(EXCLUDED.radius_gspphot, stg_data.gaia_dr3_raw.radius_gspphot),
                    lum_flame             = COALESCE(EXCLUDED.lum_flame,      stg_data.gaia_dr3_raw.lum_flame),
                    age_flame             = COALESCE(EXCLUDED.age_flame,      stg_data.gaia_dr3_raw.age_flame),
                    mass_flame            = COALESCE(EXCLUDED.mass_flame,     stg_data.gaia_dr3_raw.mass_flame),
                    ingest_run_id         = EXCLUDED.ingest_run_id,
                    ingest_at             = NOW(),
                    match_status          = 'pending'
            """), params)
            count += 1
        except Exception as e:
            logger.warning(f"GAIA staging insert failed for source_id {params['source_id']}: {e}")

    logger.info(f"Wrote {count} GAIA DR3 rows to stg_data.gaia_dr3_raw")
    return count


# ── Crossmatch and promote to dm_galaxy.stars ─────────────────────────

def crossmatch_and_promote(connection,
                           max_separation_arcsec: float = 3.0) -> dict:
    """
    Crossmatch stg_data.gaia_dr3_raw against dm_galaxy.stars by position,
    then upsert GAIA-quality astrometry and astrophysical parameters.

    Matching strategy:
      1. For each GAIA source with match_status = 'pending', find the
         nearest dm_galaxy.stars entry within max_separation_arcsec.
      2. If a match is found, upsert:
           - gaia_source_id, gaia_dr = 'DR3'
           - gaia_parallax_mas, gaia_parallax_error_mas
           - gaia_teff_k (from teff_gspphot)
           - gaia_mh_gspphot (metallicity [M/H])
           - gaia_radius_solar, gaia_luminosity_solar
           - Also update parallax_mas (replacing old estimate)
           - Also update temperature_k, metallicity_feh IF NULL
             (GAIA wins for stars lacking a spectroscopic measurement)
      3. Mark GAIA staging row match_status = 'matched' or 'new'

    Uses a Python-side loop (not PostGIS) for portability.
    For the ~2000-star nearby census, this is fast enough.

    Returns:
        dict with 'matched', 'new', 'total' counts
    """
    logger.info("Starting GAIA × dm_galaxy.stars crossmatch...")

    # Load pending GAIA rows
    gaia_pending = pd.read_sql(
        text("SELECT * FROM stg_data.gaia_dr3_raw WHERE match_status = 'pending'"),
        connection
    )
    if gaia_pending.empty:
        logger.info("No pending GAIA rows to crossmatch")
        return {'matched': 0, 'new': 0, 'total': 0}

    # Load dm_galaxy.stars for matching
    stars = pd.read_sql(
        text("""
            SELECT main_id, ra_deg, dec_deg
            FROM dm_galaxy.stars
            WHERE ra_deg IS NOT NULL AND dec_deg IS NOT NULL
        """),
        connection
    )

    matched_count = 0
    new_count     = 0

    for _, grow in gaia_pending.iterrows():
        g_ra  = float(grow['ra_deg']  or 0)
        g_dec = float(grow['dec_deg'] or 0)
        g_plx = float(grow['parallax_mas'] or 0)
        g_sid = int(grow['source_id'])

        if g_ra == 0 and g_dec == 0:
            continue

        # Find nearest dm_galaxy.stars entry
        best_main_id = None
        best_sep     = max_separation_arcsec + 1.0

        for _, srow in stars.iterrows():
            if pd.isna(srow['ra_deg']) or pd.isna(srow['dec_deg']):
                continue
            sep = angular_separation_arcsec(
                g_ra, g_dec,
                float(srow['ra_deg']), float(srow['dec_deg'])
            )
            if sep < best_sep:
                best_sep     = sep
                best_main_id = srow['main_id']

        # Helper to extract nullable float
        def gv(key):
            val = grow.get(key)
            if val is None or (isinstance(val, float) and np.isnan(val)):
                return None
            return float(val)

        if best_main_id is not None and best_sep <= max_separation_arcsec:
            # ── Match found: upsert GAIA values into dm_galaxy.stars ─
            dist_ly = None
            if g_plx > 0:
                dist_ly = (1000.0 / g_plx) * 3.26156

            connection.execute(text("""
                UPDATE dm_galaxy.stars SET
                    gaia_source_id          = :gaia_source_id,
                    gaia_dr                 = 'DR3',
                    gaia_parallax_mas       = :gaia_parallax_mas,
                    gaia_parallax_error_mas = :gaia_parallax_error_mas,
                    gaia_teff_k             = :gaia_teff_k,
                    gaia_mh_gspphot         = :gaia_mh,
                    gaia_radius_solar       = :gaia_radius,
                    gaia_luminosity_solar   = :gaia_lum,
                    -- Update primary astrometry from GAIA (better precision)
                    parallax_mas            = :gaia_parallax_mas,
                    parallax_error_mas      = :gaia_parallax_error_mas,
                    distance_ly             = COALESCE(:dist_ly, dm_galaxy.stars.distance_ly),
                    pm_ra_cosdec_mas_yr     = COALESCE(:pmra,    dm_galaxy.stars.pm_ra_cosdec_mas_yr),
                    pm_dec_mas_yr           = COALESCE(:pmdec,   dm_galaxy.stars.pm_dec_mas_yr),
                    pm_ra_error_mas_yr      = COALESCE(:pmra_e,  dm_galaxy.stars.pm_ra_error_mas_yr),
                    pm_dec_error_mas_yr     = COALESCE(:pmdec_e, dm_galaxy.stars.pm_dec_error_mas_yr),
                    radial_velocity_km_s    = COALESCE(:rv,      dm_galaxy.stars.radial_velocity_km_s),
                    -- Astrophysical parameters: GAIA fills gaps
                    temperature_k           = COALESCE(dm_galaxy.stars.temperature_k, :gaia_teff_k),
                    metallicity_feh         = CASE
                        WHEN dm_galaxy.stars.metallicity_feh IS NULL THEN :gaia_mh
                        ELSE dm_galaxy.stars.metallicity_feh
                    END,
                    metallicity_feh_error   = CASE
                        WHEN dm_galaxy.stars.metallicity_feh IS NULL
                             AND :gaia_mh IS NOT NULL
                             THEN :gaia_mh_err
                        ELSE dm_galaxy.stars.metallicity_feh_error
                    END,
                    metallicity_source      = CASE
                        WHEN dm_galaxy.stars.metallicity_feh IS NULL
                             AND :gaia_mh IS NOT NULL
                             THEN 'gaia_gspphot'
                        ELSE dm_galaxy.stars.metallicity_source
                    END,
                    star_radius_solar       = COALESCE(dm_galaxy.stars.star_radius_solar, :gaia_radius),
                    luminosity_solar        = COALESCE(dm_galaxy.stars.luminosity_solar,  :gaia_lum),
                    star_age_gyr            = COALESCE(dm_galaxy.stars.star_age_gyr,      :gaia_age),
                    star_mass_solar         = COALESCE(dm_galaxy.stars.star_mass_solar,   :gaia_mass),
                    updated_at              = NOW()
                WHERE main_id = :main_id
            """), {
                'main_id':               best_main_id,
                'gaia_source_id':        g_sid,
                'gaia_parallax_mas':     g_plx if g_plx > 0 else None,
                'gaia_parallax_error_mas': gv('parallax_error_mas'),
                'gaia_teff_k':           gv('teff_gspphot'),
                'gaia_mh':               gv('mh_gspphot'),
                'gaia_mh_err':           gv('mh_gspphot_upper'),   # upper bound as proxy error
                'gaia_radius':           gv('radius_gspphot'),
                'gaia_lum':              gv('lum_flame'),
                'gaia_age':              gv('age_flame'),
                'gaia_mass':             gv('mass_flame'),
                'dist_ly':               dist_ly,
                'pmra':                  gv('pm_ra_cosdec_mas_yr'),
                'pmdec':                 gv('pm_dec_mas_yr'),
                'pmra_e':                gv('pm_ra_error_mas_yr'),
                'pmdec_e':               gv('pm_dec_error_mas_yr'),
                'rv':                    gv('radial_velocity_km_s'),
            })

            # Mark matched
            connection.execute(text("""
                UPDATE stg_data.gaia_dr3_raw
                SET matched_main_id = :mid, match_separation_arcsec = :sep,
                    match_status = 'matched'
                WHERE source_id = :sid
            """), {'mid': best_main_id, 'sep': best_sep, 'sid': g_sid})

            matched_count += 1

        else:
            # ── No match: new star in GAIA not yet in our catalog ────
            # Insert as a new dm_galaxy.stars entry
            if g_plx > 0:
                dist_ly = (1000.0 / g_plx) * 3.26156
                # Only insert if within 110 LY (our survey boundary + edge shell)
                if dist_ly > 358.8:  # 110 pc = 358.8 LY
                    connection.execute(text("""
                        UPDATE stg_data.gaia_dr3_raw
                        SET match_status = 'out_of_range'
                        WHERE source_id = :sid
                    """), {'sid': g_sid})
                    continue

                new_main_id = f"GAIA_DR3_{g_sid}"
                try:
                    connection.execute(text("""
                        INSERT INTO dm_galaxy.stars (
                            main_id, canonical_name, source_name, source_object_id,
                            ra_deg, dec_deg, distance_ly,
                            parallax_mas, parallax_error_mas,
                            gaia_source_id, gaia_dr,
                            gaia_parallax_mas, gaia_parallax_error_mas,
                            gaia_teff_k, gaia_mh_gspphot, gaia_radius_solar, gaia_luminosity_solar,
                            temperature_k, metallicity_feh, metallicity_source,
                            star_radius_solar, luminosity_solar,
                            star_age_gyr, star_mass_solar,
                            pm_ra_cosdec_mas_yr, pm_dec_mas_yr,
                            pm_ra_error_mas_yr, pm_dec_error_mas_yr,
                            radial_velocity_km_s,
                            confidence_tier, provenance
                        ) VALUES (
                            :main_id, :main_id, 'GAIA_DR3', :source_object_id,
                            :ra, :dec, :dist_ly,
                            :plx, :plx_e,
                            :sid, 'DR3',
                            :plx, :plx_e,
                            :teff, :mh, :radius, :lum,
                            :teff, :mh, CASE WHEN :mh IS NOT NULL THEN 'gaia_gspphot' ELSE NULL END,
                            :radius, :lum,
                            :age, :mass,
                            :pmra, :pmdec, :pmra_e, :pmdec_e,
                            :rv,
                            'observed', CAST(:prov AS JSONB)
                        )
                        ON CONFLICT (main_id) DO NOTHING
                    """), {
                        'main_id':         new_main_id,
                        'source_object_id': str(g_sid),
                        'ra':              g_ra,
                        'dec':             g_dec,
                        'dist_ly':         dist_ly,
                        'plx':             g_plx,
                        'plx_e':           gv('parallax_error_mas'),
                        'sid':             g_sid,
                        'teff':            gv('teff_gspphot'),
                        'mh':              gv('mh_gspphot'),
                        'radius':          gv('radius_gspphot'),
                        'lum':             gv('lum_flame'),
                        'age':             gv('age_flame'),
                        'mass':            gv('mass_flame'),
                        'pmra':            gv('pm_ra_cosdec_mas_yr'),
                        'pmdec':           gv('pm_dec_mas_yr'),
                        'pmra_e':          gv('pm_ra_error_mas_yr'),
                        'pmdec_e':         gv('pm_dec_error_mas_yr'),
                        'rv':              gv('radial_velocity_km_s'),
                        'prov':            json.dumps({'source': 'GAIA_DR3', 'source_id': g_sid}),
                    })
                    new_count += 1
                except Exception as e:
                    logger.debug(f"GAIA new-star insert failed for {new_main_id}: {e}")

            connection.execute(text("""
                UPDATE stg_data.gaia_dr3_raw
                SET match_status = 'new'
                WHERE source_id = :sid
            """), {'sid': g_sid})

    logger.info(
        f"GAIA crossmatch complete: {matched_count} matched, "
        f"{new_count} new stars added to dm_galaxy.stars"
    )

    # Report metallicity coverage improvement
    try:
        result = connection.execute(text("""
            SELECT
                COUNT(*) AS total,
                COUNT(metallicity_feh) AS with_feh,
                COUNT(gaia_source_id) AS with_gaia
            FROM dm_galaxy.stars
        """)).fetchone()
        logger.info(
            f"Post-GAIA coverage: {result[2]}/{result[0]} stars have GAIA match, "
            f"{result[1]}/{result[0]} have [Fe/H]"
        )
    except Exception:
        pass

    return {
        'matched': matched_count,
        'new':     new_count,
        'total':   len(gaia_pending),
    }


# ── Full run ─────────────────────────────────────────────────────────

def run_gaia_ingest(connection,
                    parallax_min: float = PARALLAX_MIN,
                    max_separation_arcsec: float = 3.0) -> dict:
    """
    Full GAIA DR3 ingest pipeline:
      1. Fetch from TAP
      2. Write to stg_data.gaia_dr3_raw
      3. Crossmatch → upsert into dm_galaxy.stars

    Returns summary dict.
    """
    import uuid
    run_id = str(uuid.uuid4())
    logger.info(f"=== GAIA DR3 Ingest (run_id={run_id}) ===")

    # Step 1: fetch
    gaia_df = fetch_gaia_tap(parallax_min=parallax_min)
    if gaia_df.empty:
        return {'status': 'failed', 'reason': 'TAP fetch returned no data', 'run_id': run_id}

    # Step 2: write to staging
    staged = write_gaia_to_staging(connection, gaia_df, run_id)

    # Step 3: crossmatch + promote
    xmatch = crossmatch_and_promote(connection, max_separation_arcsec=max_separation_arcsec)

    summary = (
        f"GAIA DR3 Ingest Complete (run_id={run_id}):\n"
        f"  GAIA sources fetched:   {len(gaia_df)}\n"
        f"  Written to staging:     {staged}\n"
        f"  Matched to dm_galaxy:   {xmatch['matched']}\n"
        f"  New stars inserted:     {xmatch['new']}\n"
    )
    logger.info(summary)

    return {
        'status':  'ok',
        'run_id':  run_id,
        'fetched': len(gaia_df),
        'staged':  staged,
        'matched': xmatch['matched'],
        'new':     xmatch['new'],
        'summary': summary,
    }


# ── CLI ──────────────────────────────────────────────────────────────

def main():
    import argparse
    logging.basicConfig(level=logging.INFO,
                        format='%(asctime)s %(levelname)s %(name)s: %(message)s')

    parser = argparse.ArgumentParser(description='Ingest GAIA DR3 nearby-star data')
    parser.add_argument('--parallax-min', type=float, default=PARALLAX_MIN,
                        help=f'Minimum parallax in mas (default {PARALLAX_MIN})')
    parser.add_argument('--max-sep', type=float, default=3.0,
                        help='Max crossmatch separation in arcsec (default 3.0)')
    args = parser.parse_args()

    shared_dir = Path(__file__).resolve().parents[1] / 'SHARED'
    if str(shared_dir) not in sys.path:
        sys.path.insert(0, str(shared_dir))
    from database import engine

    with engine.begin() as conn:
        result = run_gaia_ingest(conn,
                                 parallax_min=args.parallax_min,
                                 max_separation_arcsec=args.max_sep)
    print(result.get('summary', result))


if __name__ == '__main__':
    main()
