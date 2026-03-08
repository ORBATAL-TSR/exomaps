/**
 * Common / IAU-approved names for well-known nearby stars.
 *
 * Keys are SIMBAD main_id values (or companion-catalog names)
 * used by the backend. Values are the preferred display name.
 * Stars NOT in this map just show their main_id.
 */

const COMMON_NAMES: Record<string, string> = {
  /* ── Solar system ─────────────────────────────────── */
  'Sol': 'Sol  (The Sun)',

  /* ── Alpha Centauri system ───────────────────────── */
  'Alpha Centauri A': 'Rigil Kentaurus  (α Cen A)',
  'Alpha Centauri B': 'Toliman  (α Cen B)',
  'Proxima Centauri': 'Proxima Centauri',

  /* ── Famous naked-eye & nearby stars ─────────────── */
  "Barnard's Star":    "Barnard's Star",
  'Wolf 359':          'Wolf 359  (CN Leo)',
  'Lalande 21185':     'Lalande 21185',
  'Sirius A':          'Sirius  (α CMa A)',
  'Sirius B':          'Sirius B  (The Pup)',
  'Ross 154':          'Ross 154',
  'Ross 248':          'Ross 248  (HH And)',
  'Epsilon Eridani':   'Ran  (ε Eridani)',
  'Lacaille 9352':     'Lacaille 9352',
  'Ross 128':          'Ross 128',
  'Procyon A':         'Procyon  (α CMi A)',
  'Procyon B':         'Procyon B',
  'Tau Ceti':          'Tau Ceti  (τ Cet)',
  '61 Cygni A':        '61 Cygni A',
  '61 Cygni B':        '61 Cygni B',
  'Epsilon Indi A':    'Epsilon Indi  (ε Ind)',
  'Groombridge 34 A':  'Groombridge 34 A',
  'Groombridge 34 B':  'Groombridge 34 B',
  'Kruger 60 A':       'Kruger 60 A',
  'Kruger 60 B':       'Kruger 60 B',
  '40 Eridani A':      'Keid  (40 Eri A)',
  '40 Eridani B':      '40 Eridani B',
  '40 Eridani C':      '40 Eridani C',
  '70 Ophiuchi A':     '70 Ophiuchi A',
  '70 Ophiuchi B':     '70 Ophiuchi B',
  '36 Ophiuchi A':     '36 Ophiuchi A',
  '36 Ophiuchi B':     '36 Ophiuchi B',
  '36 Ophiuchi C':     '36 Ophiuchi C',
  'Xi Bootis A':       'Xi Boötis A  (ξ Boo)',
  'Xi Bootis B':       'Xi Boötis B',
  'Delta Pavonis':     'Delta Pavonis  (δ Pav)',
  'Eta Cassiopeiae A': 'Achird  (η Cas A)',
  'Sigma Draconis':    'Alsafi  (σ Dra)',
  '82 Eridani':        '82 Eridani  (e Eri)',
  'Beta Hydri':        'Beta Hydri  (β Hyi)',
  'HR 7722':           'HR 7722  (p Eri A)',

  /* ── Bright nearby stars with IAU names ──────────── */
  'Altair':            'Altair  (α Aql)',
  'Vega':              'Vega  (α Lyr)',
  'Fomalhaut':         'Fomalhaut  (α PsA)',
  'Pollux':            'Pollux  (β Gem)',
  'Arcturus':          'Arcturus  (α Boo)',
  'Capella Aa':        'Capella  (α Aur)',

  /* ── Well-known red / brown dwarfs ───────────────── */
  'Luyten 726-8 A':    'Luyten 726-8 A  (BL Cet)',
  'Luyten 726-8 B':    'Luyten 726-8 B  (UV Cet)',
  "Teegarden's Star":  "Teegarden's Star",
  "Luyten's Star":     "Luyten's Star  (GJ 273)",
  'Kapteyn\'s Star':   'Kapteyn\'s Star',
  'Lacaille 8760':     'Lacaille 8760',
  "Van Maanen's Star": "Van Maanen's Star",
  'Groombridge 1618':  'Groombridge 1618',
  'GJ 1061':           'GJ 1061',
  'YZ Ceti':           'YZ Ceti',
  'Wolf 1061':         'Wolf 1061',
  'GJ 687':            'GJ 687',
  'GJ 674':            'GJ 674',
};

/**
 * Return a human-friendly display name for a star.
 * Falls back to main_id if no common name is catalogued.
 */
export function getCommonName(mainId: string): string {
  return COMMON_NAMES[mainId] ?? mainId;
}

/**
 * Return a SHORT label for use in 3D overlays (strip parenthetical suffixes).
 */
export function getShortName(mainId: string): string {
  const full = COMMON_NAMES[mainId];
  if (!full) return mainId;
  const idx = full.indexOf('  ');
  return idx > 0 ? full.substring(0, idx) : full;
}

export default COMMON_NAMES;
