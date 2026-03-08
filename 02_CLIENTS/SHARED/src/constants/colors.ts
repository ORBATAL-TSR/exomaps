/**
 * ExoMaps dark theme color tokens.
 *
 * Shared across all client platforms to maintain consistent
 * visual language. Desktop and web use these directly;
 * mobile adapts them for native components.
 */

export const COLORS = {
  /* ── Background / surface ────────────────────────── */
  bg_deep:        '#0a0e17',   // deepest background (space)
  bg_primary:     '#0f1923',   // main panel background
  bg_secondary:   '#162030',   // card / surface
  bg_elevated:    '#1c2a3e',   // elevated panel / hover
  bg_overlay:     'rgba(10, 14, 23, 0.85)', // modal overlay

  /* ── Text ────────────────────────────────────────── */
  text_primary:   '#e8edf5',   // high-emphasis text
  text_secondary: '#8899aa',   // medium-emphasis
  text_tertiary:  '#556677',   // low-emphasis / disabled
  text_link:      '#4d9fff',   // interactive links

  /* ── Accent colors ──────────────────────────────── */
  accent_blue:    '#4d9fff',   // primary action
  accent_cyan:    '#00cccc',   // star footprints, selection
  accent_gold:    '#ffa726',   // Sol marker, warnings
  accent_green:   '#4caf50',   // observed / confirmed
  accent_amber:   '#ff9800',   // inferred / caution
  accent_red:     '#f44336',   // error / danger

  /* ── Star spectral (quick reference) ─────────────── */
  star_O:         '#9bb0ff',
  star_B:         '#aabfff',
  star_A:         '#cad7ff',
  star_F:         '#f8f7ff',
  star_G:         '#fff4ea',
  star_K:         '#ffd2a1',
  star_M:         '#ffcc6f',

  /* ── Planet type colors ──────────────────────────── */
  planet_rocky:       '#b0855a',
  planet_super_earth: '#6b9e4a',
  planet_neptune:     '#4a8eb0',
  planet_gas_giant:   '#c4874a',
  planet_hot_jupiter: '#e05530',

  /* ── UI elements ─────────────────────────────────── */
  border:         '#1e3050',
  border_focus:   '#4d9fff',
  divider:        '#1a2a3a',

  /* ── Galactic plane ──────────────────────────────── */
  galactic_plane:  '#0e2244',
  galactic_grid:   '#1a2a3a',
  footprint_line:  '#00cccc',
  footprint_dot:   '#00aaaa',

  /* ── Confidence badges ───────────────────────────── */
  confidence_high: '#4caf50',
  confidence_low:  '#ff9800',
} as const;

export type ColorToken = keyof typeof COLORS;
