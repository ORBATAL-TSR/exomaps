"""
Phase 03 — System Completion Inference Engine
==============================================

Infers missing planets and belts using observational priors conditioned on
stellar type AND metallicity, with physically grounded habitable zone bounds.

Key improvements over v1:
  - Metallicity-conditioned occurrence rates (Fischer & Valenti 2005 for giants;
    Howard et al. 2012 for rocky/sub-Neptune planets)
  - Kopparapu et al. (2013) HZ bounds from stellar effective flux
  - Titius-Bode-style orbital spacing with Hill stability check
  - Equilibrium temperature from Stefan-Boltzmann (not hardcoded)
  - Inferred planet rows carry stellar metallicity context for downstream Rust pipeline

References:
  - Fischer & Valenti (2005): P(giant) ∝ 10^(2.0 * [Fe/H])
  - Howard et al. (2012): rocky planet rates weakly correlated with metallicity
  - Petigura et al. (2018): sub-Neptune occurrence, weak [Fe/H] correlation
  - Zhu et al. (2018): period ratio distribution from Kepler
  - Kopparapu et al. (2013): HZ limits from climate models
  - Chambers (2001): Hill sphere / orbital stability criterion
"""

import logging
import numpy as np
import pandas as pd
from uuid import uuid4
from sqlalchemy import text

logger = logging.getLogger(__name__)

# ── Kopparapu 2013 HZ effective flux coefficients ───────────────────
# Conservative HZ: Recent Venus inner edge, Early Mars outer edge
# Optimistic HZ: Runaway Greenhouse inner edge, Maximum Greenhouse outer edge
#
# S_eff(T*) = S_eff_sun + a*(T* - 5780) + b*(T* - 5780)^2
#             + c*(T* - 5780)^3 + d*(T* - 5780)^4
#
# HZ boundary (AU) = sqrt(L_star / S_eff)
#
# Coefficients from Table 3, Kopparapu et al. (2013)

HZ_COEFFICIENTS = {
    # Conservative boundaries (inner = Recent Venus, outer = Early Mars)
    'conservative_inner': {
        'Seff_sun': 1.0385, 'a': 1.2456e-4, 'b': 1.4612e-8, 'c': -7.6345e-12, 'd': -1.7511e-15
    },
    'conservative_outer': {
        'Seff_sun': 0.3179, 'a': 5.4513e-5, 'b': 1.5313e-9, 'c': -2.7786e-12, 'd': -4.8997e-16
    },
    # Optimistic boundaries (inner = Runaway GH, outer = Maximum GH)
    'optimistic_inner': {
        'Seff_sun': 1.1066, 'a': 1.4809e-4, 'b': 2.7580e-8, 'c': -3.4484e-12, 'd': -8.5399e-16
    },
    'optimistic_outer': {
        'Seff_sun': 0.3814, 'a': 5.6117e-5, 'b': 1.6551e-9, 'c': -3.0515e-12, 'd': -5.9081e-16
    },
}


def compute_hz_bounds(luminosity_solar: float, teff_k: float) -> dict:
    """
    Compute habitable zone inner and outer boundaries in AU.

    Args:
        luminosity_solar: stellar luminosity [L☉]
        teff_k: effective temperature [K]

    Returns:
        dict with keys: 'conservative_inner', 'conservative_outer',
                        'optimistic_inner', 'optimistic_outer'  (all in AU)
    """
    if luminosity_solar <= 0 or teff_k <= 0:
        return {k: None for k in HZ_COEFFICIENTS}

    dT = teff_k - 5780.0  # offset from solar Teff

    bounds = {}
    for label, c in HZ_COEFFICIENTS.items():
        seff = (c['Seff_sun']
                + c['a'] * dT
                + c['b'] * dT**2
                + c['c'] * dT**3
                + c['d'] * dT**4)
        if seff > 0:
            bounds[label] = float(np.sqrt(luminosity_solar / seff))
        else:
            bounds[label] = None

    return bounds


# ── Occurrence rate models ───────────────────────────────────────────

def giant_planet_occurrence(spectral_class: str, feh: float) -> float:
    """
    Probability of hosting at least one gas giant (> 30 M⊕).

    Based on Fischer & Valenti (2005) metallicity correlation:
      P(giant | [Fe/H]) ∝ 10^(2.0 * [Fe/H])   (for Sun-like stars)

    Calibrated to ~3% for solar metallicity G-type stars (Howard et al. 2012
    yields 3.4% for M > 30 M_J sin i via RV surveys).

    For M-dwarfs, giant occurrence is suppressed by ~5× (Endl et al. 2006).
    For F-stars, enhanced by ~2× (Johnson et al. 2010).
    """
    feh = float(feh) if feh is not None and not np.isnan(feh) else 0.0

    # Base rate from Fischer & Valenti metallicity law, normalised at [Fe/H]=0.0
    base_rate = 0.03 * (10.0 ** (2.0 * feh))
    base_rate = float(np.clip(base_rate, 0.001, 0.80))

    # Spectral-class multiplier
    sp_mult = {
        'O': 0.05, 'B': 0.10, 'A': 1.5, 'F': 1.8,
        'G': 1.0,  'K': 0.85, 'M': 0.20, 'L': 0.05,
    }.get(spectral_class, 1.0)

    return float(np.clip(base_rate * sp_mult, 0.001, 0.90))


def rocky_planet_occurrence(spectral_class: str, feh: float) -> float:
    """
    Probability of hosting at least one rocky / terrestrial planet.

    From Howard et al. (2012) Kepler statistics:
      - Rocky planets (R < 1.4 R⊕) occur around ~50% of solar-type stars
      - Weak positive correlation with [Fe/H] for super-Earths
      - M-dwarfs: highest rocky planet rate (Dressing & Charbonneau 2015: ~0.56 per M-dwarf)
    """
    feh = float(feh) if feh is not None and not np.isnan(feh) else 0.0

    # Weak metallicity dependence for rocky planets
    feh_modifier = 1.0 + 0.3 * feh  # mild enhancement at high [Fe/H]
    feh_modifier = float(np.clip(feh_modifier, 0.5, 2.0))

    base = {
        'O': 0.05, 'B': 0.08, 'A': 0.20, 'F': 0.45,
        'G': 0.55, 'K': 0.60, 'M': 0.65, 'L': 0.10,
    }.get(spectral_class, 0.50)

    return float(np.clip(base * feh_modifier, 0.05, 0.90))


def expected_rocky_count(spectral_class: str, feh: float) -> float:
    """
    Expected number of rocky planets per system (given at least one exists).
    From Zhu et al. (2018) multiplicity statistics.
    """
    feh = float(feh) if feh is not None and not np.isnan(feh) else 0.0
    base = {'O': 0.5, 'B': 0.8, 'A': 1.2, 'F': 2.0,
            'G': 2.5, 'K': 2.8, 'M': 3.5, 'L': 0.5}.get(spectral_class, 2.0)
    # Metal-poor stars tend to form fewer planets
    feh_scale = float(np.clip(1.0 + 0.25 * feh, 0.6, 1.8))
    return base * feh_scale


# ── Orbital architecture ─────────────────────────────────────────────

def hill_stability_check(sma_list: list, mass_list: list,
                         star_mass_solar: float = 1.0) -> bool:
    """
    Check that no adjacent pair of planets violates Hill stability.

    Criterion (Gladman 1993): Δ > 2√3 R_Hill_mutual
    where R_Hill_mutual = ((m_i + m_{i+1}) / (3 M_*))^(1/3) × a_mean

    M_Earth = 3.003e-6 M_Sun
    """
    m_earth_over_msun = 3.003e-6
    for i in range(len(sma_list) - 1):
        a1, a2   = sma_list[i], sma_list[i + 1]
        m1_msun  = mass_list[i] * m_earth_over_msun
        m2_msun  = mass_list[i + 1] * m_earth_over_msun
        a_mean   = (a1 + a2) / 2.0
        r_hill   = a_mean * ((m1_msun + m2_msun) / (3.0 * star_mass_solar)) ** (1.0 / 3.0)
        delta    = a2 - a1
        if delta < 2.0 * np.sqrt(3.0) * r_hill:
            return False
    return True


def equilibrium_temp(luminosity_solar: float, sma_au: float,
                     bond_albedo: float = 0.30) -> float:
    """
    Planet equilibrium temperature [K] from stellar luminosity, SMA, albedo.
    T_eq = T_sun × (R_sun / (2 × a))^(1/2) × (1 - A)^(1/4)
    Simplified: T_eq = 278.5 × L*^(1/4) × (1 - A)^(1/4) / sqrt(a_AU)
    """
    if luminosity_solar <= 0 or sma_au <= 0:
        return 0.0
    return float(278.5 * (luminosity_solar ** 0.25)
                 * ((1.0 - bond_albedo) ** 0.25)
                 / np.sqrt(sma_au))


# ── Star data loader ─────────────────────────────────────────────────

def load_nearby_stars(connection, distance_ly_max: float = 100.0) -> pd.DataFrame:
    """
    Load Phase 02 nearby stars — now including metallicity, luminosity, Teff,
    stellar mass, and age from the enriched dm_galaxy.stars table.
    """
    query = """
    SELECT
        xyz.main_id,
        xyz.x_pc, xyz.y_pc, xyz.z_pc,
        xyz.distance_ly,
        s.spectral_type,
        s.magnitude_v,
        s.luminosity_solar,
        s.temperature_k,
        s.metallicity_feh,
        s.metallicity_feh_error,
        s.star_mass_solar,
        s.star_radius_solar,
        s.star_age_gyr
    FROM dm_galaxy.stars_xyz xyz
    LEFT JOIN dm_galaxy.stars s ON xyz.main_id = s.main_id
    WHERE
        xyz.distance_ly <= :distance_ly_max
        AND xyz.sanity_pass = true
    ORDER BY xyz.distance_ly ASC
    """
    df = pd.read_sql(text(query), connection,
                     params={'distance_ly_max': distance_ly_max})
    logger.info(f"Loaded {len(df)} stars for inference (distance <= {distance_ly_max} LY)")

    # Fill metallicity gaps: default to 0.0 (solar) with a note
    feh_null = df['metallicity_feh'].isna()
    df['metallicity_feh'] = df['metallicity_feh'].fillna(0.0)
    df['metallicity_inferred'] = feh_null
    if feh_null.sum() > 0:
        logger.info(f"  {feh_null.sum()} stars missing [Fe/H] — defaulting to 0.0 (solar)")

    # Fill luminosity from Teff + radius if missing
    no_lum = df['luminosity_solar'].isna()
    if no_lum.any():
        SIGMA_SB = 5.670374419e-8
        L_SUN    = 3.828e26
        R_SUN    = 6.957e8
        teff = df.loc[no_lum, 'temperature_k'].fillna(5778.0)
        r    = df.loc[no_lum, 'star_radius_solar'].fillna(1.0)
        l_w  = 4.0 * np.pi * (r * R_SUN)**2 * SIGMA_SB * teff**4
        df.loc[no_lum, 'luminosity_solar'] = l_w / L_SUN

    df['luminosity_solar'] = df['luminosity_solar'].fillna(1.0)
    df['temperature_k']    = df['temperature_k'].fillna(5778.0)
    df['star_mass_solar']  = df['star_mass_solar'].fillna(1.0)

    return df


# ── Spectral class extractor ─────────────────────────────────────────

def extract_spectral_class(spectral_type_str) -> str:
    if not spectral_type_str or not isinstance(spectral_type_str, str):
        return 'G'
    ch = spectral_type_str.strip()[0].upper()
    return ch if ch in ('O', 'B', 'A', 'F', 'G', 'K', 'M', 'L') else 'G'


# ── Planet type from orbital position ────────────────────────────────

def assign_planet_type(sma_au: float, hz_inner: float, hz_outer: float,
                       feh: float, rng: np.random.Generator) -> tuple:
    """
    Assign planet type and mass/radius estimates based on orbital position
    and stellar metallicity.

    Returns: (planet_type, mass_earth, radius_earth)
    """
    # Inside 0.1 AU: hot / ultra-hot
    if sma_au < 0.1:
        if rng.random() < 0.3:  # hot super-Earth (Petigura 2018)
            return 'rocky', float(rng.uniform(1.5, 4.0)), float(rng.uniform(1.2, 2.0))
        else:
            mass = float(rng.uniform(0.1, 0.8))
            return 'rocky', mass, float(0.74 * mass**0.27)  # Zeng 2019 rock curve

    # In HZ: terrestrial / habitable
    if hz_inner and hz_outer and (hz_inner <= sma_au <= hz_outer):
        mass   = float(rng.uniform(0.4, 2.5))
        radius = float(rng.uniform(0.8, 1.6))
        # Metal-rich stars: slightly larger rocky planets (more rock/iron)
        if feh > 0.2:
            mass   *= rng.uniform(1.1, 1.4)
            radius *= rng.uniform(1.05, 1.2)
        return 'terrestrial-habitable', mass, radius

    # 0.1–0.5 AU: inner rocky
    if sma_au < 0.5:
        mass = float(rng.uniform(0.2, 1.5))
        return 'rocky', mass, float(rng.uniform(0.5, 1.3))

    # 0.5 AU to HZ inner edge: warm super-Earth / sub-Neptune
    if hz_inner and sma_au < hz_inner:
        if rng.random() < 0.45:  # sub-Neptune (1.4-4 R⊕)
            mass   = float(rng.uniform(3.0, 15.0))
            radius = float(rng.uniform(1.4, 4.0))
            return 'sub-neptune', mass, radius
        else:
            mass   = float(rng.uniform(1.0, 4.0))
            radius = float(rng.uniform(1.0, 1.7))
            return 'super-earth', mass, radius

    # Beyond HZ outer edge: gas giants and ice giants
    # Metallicity strongly boosts gas giant probability
    giant_boost = 10.0 ** (2.0 * feh)   # Fischer & Valenti [Fe/H] law
    p_giant     = float(np.clip(0.15 * giant_boost, 0.02, 0.70))
    if rng.random() < p_giant:
        mass   = float(rng.uniform(30, 4000))
        radius = float(rng.uniform(4.0, 14.0))
        ptype  = 'gas-giant' if mass > 95 else 'ice-giant'
        return ptype, mass, radius
    else:
        # Ice giant or sub-Neptune
        mass   = float(rng.uniform(10, 100))
        radius = float(rng.uniform(2.5, 6.0))
        return 'ice-giant', mass, radius


# ── Main inference: planets ──────────────────────────────────────────

def infer_planets(star_row, seed: int = None) -> list:
    """
    Infer planetary system for a given star.

    Improvements over v1:
    - Occurrence probabilities conditioned on [Fe/H] AND spectral class
    - Kopparapu 2013 HZ bounds from stellar luminosity
    - Titius-Bode-inspired orbital spacing with Hill stability filter
    - Equilibrium temperature from Stefan-Boltzmann
    - Planet type from orbital context + metallicity
    - Stellar properties carried through to inferred_planets rows
    """
    rng = np.random.default_rng(seed)

    main_id   = star_row['main_id']
    spectral  = extract_spectral_class(star_row.get('spectral_type'))
    feh       = float(star_row.get('metallicity_feh') or 0.0)
    lum       = float(star_row.get('luminosity_solar') or 1.0)
    teff      = float(star_row.get('temperature_k') or 5778.0)
    m_star    = float(star_row.get('star_mass_solar') or 1.0)

    hz = compute_hz_bounds(lum, teff)
    hz_in  = hz.get('conservative_inner') or 0.95
    hz_out = hz.get('conservative_outer') or 1.37

    # ── Decide whether this star gets planets at all ──────────────────
    p_rocky = rocky_planet_occurrence(spectral, feh)
    if rng.random() > p_rocky:
        return []   # no planets this run

    # ── How many rocky/terrestrial planets? ──────────────────────────
    n_rocky = int(np.clip(
        np.round(rng.normal(expected_rocky_count(spectral, feh), 0.8)),
        1, 6
    ))

    # ── Does this system also get gas giants? ─────────────────────────
    p_giant = giant_planet_occurrence(spectral, feh)
    n_giant = int(rng.poisson(1.5)) if rng.random() < p_giant else 0
    n_giant = min(n_giant, 3)

    # ── Build orbital slots ───────────────────────────────────────────
    # Rocky planets: sample from a log-uniform distribution between
    # 0.05 AU and the outer HZ boundary.
    # Giants: placed beyond the outer HZ boundary.

    ROCKY_SMA_MIN  = 0.05
    ROCKY_SMA_MAX  = hz_out * 1.2 if hz_out else 2.0
    GIANT_SMA_MIN  = hz_out * 1.5 if hz_out else 3.0
    GIANT_SMA_MAX  = 30.0
    MIN_RATIO      = 1.35   # minimum period ratio between adjacent planets (Kepler-like)

    def sample_sma_rocky(existing: list, n_tries: int = 20) -> float:
        for _ in range(n_tries):
            candidate = float(np.exp(rng.uniform(
                np.log(ROCKY_SMA_MIN), np.log(ROCKY_SMA_MAX)
            )))
            # Enforce minimum period ratio (≈ minimum SMA ratio)
            if not existing or all(
                abs(np.log(candidate) - np.log(a)) > np.log(MIN_RATIO)
                for a in existing
            ):
                return candidate
        return -1.0

    def sample_sma_giant(existing: list, n_tries: int = 20) -> float:
        for _ in range(n_tries):
            candidate = float(np.exp(rng.uniform(
                np.log(GIANT_SMA_MIN), np.log(GIANT_SMA_MAX)
            )))
            if not existing or all(
                abs(np.log(candidate) - np.log(a)) > np.log(MIN_RATIO)
                for a in existing
            ):
                return candidate
        return -1.0

    all_sma    = []
    all_types  = []
    all_masses = []
    all_radii  = []

    for _ in range(n_rocky):
        sma = sample_sma_rocky(all_sma)
        if sma < 0:
            continue
        ptype, mass, radius = assign_planet_type(sma, hz_in, hz_out, feh, rng)
        all_sma.append(sma)
        all_types.append(ptype)
        all_masses.append(mass)
        all_radii.append(radius)

    for _ in range(n_giant):
        sma = sample_sma_giant(all_sma)
        if sma < 0:
            continue
        ptype, mass, radius = assign_planet_type(sma, hz_in, hz_out, feh, rng)
        all_sma.append(sma)
        all_types.append(ptype)
        all_masses.append(mass)
        all_radii.append(radius)

    if not all_sma:
        return []

    # Sort by SMA
    order = np.argsort(all_sma)
    sma_sorted    = [all_sma[i]    for i in order]
    types_sorted  = [all_types[i]  for i in order]
    masses_sorted = [all_masses[i] for i in order]
    radii_sorted  = [all_radii[i]  for i in order]

    # Hill stability filter
    if not hill_stability_check(sma_sorted, masses_sorted, m_star):
        # Remove the most tightly-packed pair iteratively
        while len(sma_sorted) > 1 and not hill_stability_check(sma_sorted, masses_sorted, m_star):
            # Find the unstable pair and remove the lighter planet
            for i in range(len(sma_sorted) - 1):
                a1, a2 = sma_sorted[i], sma_sorted[i + 1]
                m1_msun = masses_sorted[i] * 3.003e-6
                m2_msun = masses_sorted[i + 1] * 3.003e-6
                a_mean  = (a1 + a2) / 2.0
                r_hill  = a_mean * ((m1_msun + m2_msun) / (3.0 * m_star)) ** (1.0 / 3.0)
                if (a2 - a1) < 2.0 * np.sqrt(3.0) * r_hill:
                    # Remove lighter planet
                    drop = i if masses_sorted[i] < masses_sorted[i + 1] else i + 1
                    for lst in (sma_sorted, types_sorted, masses_sorted, radii_sorted):
                        lst.pop(drop)
                    break

    # Build output records
    inferred = []
    for i, (sma, ptype, mass, radius) in enumerate(
        zip(sma_sorted, types_sorted, masses_sorted, radii_sorted)
    ):
        period_days = 365.25 * (sma ** 1.5) / np.sqrt(m_star)   # Kepler 3rd, m_star in M☉
        eq_temp     = equilibrium_temp(lum, sma)

        # Confidence based on observational basis
        if ptype == 'terrestrial-habitable':
            confidence = 'low'   # HZ planets have high prior probability but are rare confirmed
        elif ptype in ('gas-giant',):
            # Giant confidence boosted for metal-rich stars
            confidence = 'medium' if feh > 0.1 else 'low'
        else:
            confidence = 'very-low'

        inferred.append({
            'planet_uuid':           str(uuid4()),
            'main_id':               main_id,
            'semi_major_axis_au':    round(sma, 6),
            'orbital_period_days':   round(float(period_days), 2),
            'eccentricity':          round(float(rng.exponential(0.05)), 3),
            'inclination_deg':       round(float(rng.uniform(0.0, 5.0)), 2),
            'planet_type':           ptype,
            'inferred_mass_earth':   round(mass, 4),
            'inferred_radius_earth': round(radius, 4),
            'equilibrium_temp_k':    int(eq_temp),
            'hz_inner_au':           round(hz_in, 6) if hz_in else None,
            'hz_outer_au':           round(hz_out, 6) if hz_out else None,
            'in_hz':                 bool(hz_in and hz_out and (hz_in <= sma <= hz_out)),
            # Stellar context carried through for VITA WorldGenInput
            'star_metallicity_feh':  round(feh, 3),
            'star_temperature_k':    round(teff, 1),
            'star_luminosity_solar': round(lum, 6),
            'star_mass_solar':       round(m_star, 4),
            'star_age_gyr':          float(star_row.get('star_age_gyr') or 5.0),
            # Inference metadata
            'confidence':            confidence,
            'inference_method':      'spectral_feh_hz_kopparapu2013',
            'inference_seed':        seed if seed is not None else -1,
            'inference_version':     '2.0',
        })

    logger.debug(f"Inferred {len(inferred)} planets for {main_id} "
                 f"(spectral={spectral}, [Fe/H]={feh:+.2f}, "
                 f"HZ={hz_in:.2f}–{hz_out:.2f} AU)")
    return inferred


# ── Main inference: belts ────────────────────────────────────────────

def infer_belts(star_row, seed: int = None) -> list:
    """
    Infer debris/asteroid belts.
    Belt presence and location conditioned on spectral type and metallicity.
    Metal-rich systems tend to have more massive belts (more planetesimal material).
    """
    rng = np.random.default_rng(seed)

    main_id  = star_row['main_id']
    spectral = extract_spectral_class(star_row.get('spectral_type'))
    feh      = float(star_row.get('metallicity_feh') or 0.0)
    lum      = float(star_row.get('luminosity_solar') or 1.0)
    teff     = float(star_row.get('temperature_k') or 5778.0)

    hz = compute_hz_bounds(lum, teff)
    hz_out = hz.get('conservative_outer') or 1.37

    # Belt probability scales with spectral class and metallicity
    base_belt_prob = {
        'O': 0.05, 'B': 0.10, 'A': 0.35, 'F': 0.30,
        'G': 0.25, 'K': 0.20, 'M': 0.12, 'L': 0.05,
    }.get(spectral, 0.20)

    # Modestly enhanced by metallicity (more solid material)
    belt_prob = float(np.clip(base_belt_prob * (1.0 + 0.3 * feh), 0.02, 0.70))

    if rng.random() > belt_prob:
        return []

    inferred = []

    # Inner rocky belt (analogous to Solar asteroid belt)
    inner_belt_in  = max(1.5, hz_out * 1.1)
    inner_belt_out = inner_belt_in * float(rng.uniform(1.5, 2.5))
    if rng.random() > 0.25:
        inferred.append({
            'main_id':           main_id,
            'inferred_belt_id':  f"inferred_{main_id}_belt_inner",
            'belt_type':         'rocky-asteroid',
            'inner_radius_au':   round(inner_belt_in, 3),
            'outer_radius_au':   round(inner_belt_out, 3),
            'confidence':        'low',
            'method':            'hz_scaled_spectral_feh',
            'seed':              seed if seed is not None else -1,
        })

    # Outer icy belt (Kuiper Belt analog)
    # Scale with luminosity: colder stars have closer snowlines
    snowline_au = 2.7 * (lum ** 0.5)   # rough snowline scaling
    outer_belt_in  = max(snowline_au * 5.0, 15.0)
    outer_belt_out = outer_belt_in * float(rng.uniform(2.0, 4.0))
    if rng.random() > 0.15:
        inferred.append({
            'main_id':           main_id,
            'inferred_belt_id':  f"inferred_{main_id}_belt_outer",
            'belt_type':         'icy-kuiper',
            'inner_radius_au':   round(outer_belt_in, 2),
            'outer_radius_au':   round(outer_belt_out, 2),
            'confidence':        'very-low',
            'method':            'hz_scaled_spectral_feh',
            'seed':              seed if seed is not None else -1,
        })

    return inferred


# ── Pipeline runner ──────────────────────────────────────────────────

def run_inference_pipeline(connection, seed: int = None) -> dict:
    """
    Main Phase 03 entry point.

    1. Load nearby stars (with metallicity from Phase 01b + GAIA ingest)
    2. For each star: infer planets (metallicity-conditioned) and belts
    3. Return DataFrames; caller is responsible for DB write

    Returns:
        dict with 'inferred_planets', 'inferred_belts' DataFrames,
        and statistics
    """
    logger.info("=== Phase 03 Inference Pipeline v2 (metallicity-conditioned) ===")

    stars = load_nearby_stars(connection)
    if stars.empty:
        logger.error("No stars available for inference")
        return {
            'inferred_planets': pd.DataFrame(),
            'inferred_belts':   pd.DataFrame(),
            'total_systems_processed': 0,
            'systems_with_planets':    0,
            'systems_with_belts':      0,
            'summary': 'FAILED: No stars loaded',
        }

    all_planets = []
    all_belts   = []

    for idx, star in stars.iterrows():
        star_seed = (seed + idx) if seed is not None else None

        planets = infer_planets(star, seed=star_seed)
        belts   = infer_belts(star,   seed=star_seed)

        all_planets.extend(planets)
        all_belts.extend(belts)

    planets_df = pd.DataFrame(all_planets) if all_planets else pd.DataFrame()
    belts_df   = pd.DataFrame(all_belts)   if all_belts   else pd.DataFrame()

    # Log metallicity-based statistics
    if not planets_df.empty and 'star_metallicity_feh' in planets_df.columns:
        hz_count    = int(planets_df['in_hz'].sum()) if 'in_hz' in planets_df else 0
        giant_count = int((planets_df['planet_type'] == 'gas-giant').sum())
        logger.info(
            f"Inference stats: {len(planets_df)} planets total, "
            f"{hz_count} in HZ, {giant_count} gas giants"
        )

    summary = (
        f"Phase 03 Inference v2 Complete:\n"
        f"  Stars processed:      {len(stars)}\n"
        f"  Inferred planets:     {len(planets_df)}\n"
        f"  Inferred belts:       {len(belts_df)}\n"
        f"  Stars with planets:   "
        f"{len(planets_df['main_id'].unique()) if len(planets_df) > 0 else 0}\n"
        f"  Stars with belts:     "
        f"{len(belts_df['main_id'].unique()) if len(belts_df) > 0 else 0}\n"
        f"  Stars with [Fe/H]:    {int((~stars['metallicity_inferred']).sum())}/{len(stars)}\n"
    )
    logger.info(summary)

    return {
        'inferred_planets':        planets_df,
        'inferred_belts':          belts_df,
        'total_systems_processed': len(stars),
        'systems_with_planets':    len(planets_df['main_id'].unique()) if len(planets_df) > 0 else 0,
        'systems_with_belts':      len(belts_df['main_id'].unique())   if len(belts_df)   > 0 else 0,
        'summary':                 summary,
    }


if __name__ == '__main__':
    import logging
    logging.basicConfig(level=logging.INFO)
    logger.info("Inference engine v2 ready — metallicity-conditioned + Kopparapu 2013 HZ")
