/**
 * Harvard spectral classification reference table.
 *
 * Used across all clients for star color mapping, filtering,
 * and display. Temperatures are representative mid-range values.
 */

export interface SpectralClass {
  class: string;
  label: string;
  teff_min: number;       // K
  teff_max: number;       // K
  teff_typical: number;   // K
  color_hex: string;      // approximate sRGB
  luminosity_range: string;
  mass_range_solar: string;
  fraction_of_stars: number; // approximate % of main sequence stars
}

export const SPECTRAL_CLASSES: SpectralClass[] = [
  { class: 'O', label: 'O-type (Blue)',       teff_min: 30000, teff_max: 60000, teff_typical: 40000, color_hex: '#9bb0ff', luminosity_range: '30,000–1,000,000 L☉', mass_range_solar: '16–150',  fraction_of_stars: 0.00003 },
  { class: 'B', label: 'B-type (Blue-white)',  teff_min: 10000, teff_max: 30000, teff_typical: 20000, color_hex: '#aabfff', luminosity_range: '25–30,000 L☉',       mass_range_solar: '2.1–16', fraction_of_stars: 0.12 },
  { class: 'A', label: 'A-type (White)',       teff_min: 7500,  teff_max: 10000, teff_typical: 8500,  color_hex: '#cad7ff', luminosity_range: '5–25 L☉',            mass_range_solar: '1.4–2.1', fraction_of_stars: 0.61 },
  { class: 'F', label: 'F-type (Yellow-white)', teff_min: 6000,  teff_max: 7500,  teff_typical: 6750,  color_hex: '#f8f7ff', luminosity_range: '1.5–5 L☉',           mass_range_solar: '1.04–1.4', fraction_of_stars: 3.0 },
  { class: 'G', label: 'G-type (Yellow)',      teff_min: 5200,  teff_max: 6000,  teff_typical: 5778,  color_hex: '#fff4ea', luminosity_range: '0.6–1.5 L☉',         mass_range_solar: '0.8–1.04', fraction_of_stars: 7.6 },
  { class: 'K', label: 'K-type (Orange)',      teff_min: 3700,  teff_max: 5200,  teff_typical: 4500,  color_hex: '#ffd2a1', luminosity_range: '0.08–0.6 L☉',        mass_range_solar: '0.45–0.8', fraction_of_stars: 12.1 },
  { class: 'M', label: 'M-type (Red)',         teff_min: 2400,  teff_max: 3700,  teff_typical: 3000,  color_hex: '#ffcc6f', luminosity_range: '0.0001–0.08 L☉',     mass_range_solar: '0.08–0.45', fraction_of_stars: 76.5 },
  { class: 'L', label: 'L-type (Dark red)',    teff_min: 1300,  teff_max: 2400,  teff_typical: 1800,  color_hex: '#ff6633', luminosity_range: '<0.0001 L☉',          mass_range_solar: '0.06–0.08', fraction_of_stars: 0.1 },
  { class: 'T', label: 'T-type (Brown dwarf)', teff_min: 500,   teff_max: 1300,  teff_typical: 900,   color_hex: '#cc3300', luminosity_range: '≪0.0001 L☉',          mass_range_solar: '0.01–0.06', fraction_of_stars: 0.05 },
];

/** Lookup a spectral class record by its letter */
export function getSpectralClass(letter: string): SpectralClass | undefined {
  return SPECTRAL_CLASSES.find(sc => sc.class === letter.toUpperCase());
}

/** Get approximate hex color for a temperature */
export function teffToHex(teff: number): string {
  for (const sc of SPECTRAL_CLASSES) {
    if (teff >= sc.teff_min) return sc.color_hex;
  }
  return SPECTRAL_CLASSES[SPECTRAL_CLASSES.length - 1].color_hex;
}
