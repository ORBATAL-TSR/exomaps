/**
 * Extended World Classification System (EWoCS)
 * 
 * A multi-factored classification system for planets and sub-stellar bodies.
 * Based on the Orion's Arm EWoCS specification.
 * 
 * Each world gets a multi-axis classification:
 *   GasFraction × VolatileContent × CarbonContent × MetalContent ×
 *   AtmosphereType × AerosolClass × SurfaceType × SubsurfaceType ×
 *   MassClass × PrecipitationType × LiquidCoverage × FluidType ×
 *   RotationClass × OrbitalClass × LifeClass × HistoryClass
 */

// ═══════════════════════════════════════════════════════
//  COMPOSITIONAL CATEGORIES
// ═══════════════════════════════════════════════════════

/** Nebular Gas Fraction — H₂/He content */
export type GasFraction = 'jovian' | 'neptunian' | 'terrestrial';
export const GAS_FRACTIONS: Record<GasFraction, { label: string; h2hePct: [number, number]; desc: string }> = {
  jovian:      { label: 'Jovian',      h2hePct: [50, 100],  desc: 'Gas Giant — H/He >50% by mass' },
  neptunian:   { label: 'Neptunian',   h2hePct: [0.1, 50],  desc: 'Ice Giant — H/He 0.1-50%' },
  terrestrial: { label: 'Terrestrial', h2hePct: [0, 0.1],   desc: 'Rocky — H/He <0.1%' },
};

/** Volatile Content — ice fraction of non-gaseous mass */
export type VolatileContent = 'ymirian' | 'gelidian' | 'cerean' | 'lapidian';
export const VOLATILE_CONTENTS: Record<VolatileContent, { label: string; prefix: string; pct: [number, number]; desc: string }> = {
  ymirian:  { label: 'Ymirian',  prefix: 'Ymir',  pct: [67, 100], desc: 'Ice-dominated — volatiles >67%' },
  gelidian: { label: 'Gelidian', prefix: 'Geli',   pct: [33, 67],  desc: 'Mixed rock/ice — volatiles 33-67%' },
  cerean:   { label: 'Cerean',   prefix: 'Cere',   pct: [1, 33],   desc: 'Rocky with some ice — volatiles 1-33%' },
  lapidian: { label: 'Lapidian', prefix: 'Lapi',   pct: [0, 1],    desc: 'Dry rock — volatiles <1%' },
};

/** Carbon Content — C/O ratio */
export type CarbonContent = 'adamean' | 'carbidic' | 'carbonatic' | 'oxidic';
export const CARBON_CONTENTS: Record<CarbonContent, { label: string; prefix: string; coRatio: [number, number]; desc: string }> = {
  adamean:   { label: 'Adamean',   prefix: 'Ada',   coRatio: [10, Infinity], desc: 'Diamond/graphite crust — C/O >10' },
  carbidic:  { label: 'Carbidic',  prefix: 'Carbi', coRatio: [1, 10],       desc: 'Carbide minerals — C/O 1-10' },
  carbonatic:{ label: 'Carbonatic',prefix: 'Carbo', coRatio: [0.1, 1],      desc: 'Mixed carbonate/oxide — C/O 0.1-1' },
  oxidic:    { label: 'Oxidic',    prefix: 'Oxy',   coRatio: [0, 0.1],      desc: 'Oxide-dominated — C/O <0.1' },
};

/** Siderophile Metal Content */
export type MetalContent = 'ferrinian' | 'hermian' | 'telluric' | 'selenian';
export const METAL_CONTENTS: Record<MetalContent, { label: string; pct: [number, number]; desc: string }> = {
  ferrinian: { label: 'Ferrinian', pct: [80, 100], desc: 'Super-dense metal world — siderophiles >80%' },
  hermian:   { label: 'Hermian',   pct: [50, 80],  desc: 'Mercury-like — siderophiles 50-80%' },
  telluric:  { label: 'Telluric',  pct: [20, 50],  desc: 'Earth-like — siderophiles 20-50%' },
  selenian:  { label: 'Selenian',  pct: [0, 20],   desc: 'Low metal — siderophiles 0-20%' },
};

// ═══════════════════════════════════════════════════════
//  ATMOSPHERIC COMPOSITION
// ═══════════════════════════════════════════════════════

export type AtmosphereType =
  | 'jotunnian' | 'helian' | 'ydratian' | 'rhean'
  | 'minervan' | 'hephaestian' | 'edelian';

export const ATMOSPHERE_TYPES: Record<AtmosphereType, { label: string; dominant: string; desc: string }> = {
  jotunnian:   { label: 'Jotunnian',   dominant: 'H₂',          desc: 'Hydrogen-dominated' },
  helian:      { label: 'Helian',      dominant: 'He',           desc: 'Helium-dominated' },
  ydratian:    { label: 'Ydratian',    dominant: 'CH₄/NH₃/H₂O', desc: 'Simple hydrides dominated' },
  rhean:       { label: 'Rhean',       dominant: 'N₂/O₂',       desc: 'Diatomic non-metals' },
  minervan:    { label: 'Minervan',    dominant: 'CO₂/SO₂',     desc: 'Non-metal compounds' },
  hephaestian: { label: 'Hephaestian', dominant: 'SiO₂/MgO/Fe', desc: 'Metal/metalloid compounds' },
  edelian:     { label: 'Edelian',     dominant: 'Noble gases',  desc: 'Noble gas dominated' },
};

// ═══════════════════════════════════════════════════════
//  AEROSOL CLASSES — THE VISUAL APPEARANCE
// ═══════════════════════════════════════════════════════

export type ThermalRange = 'cryothermal' | 'mesothermal' | 'pyrothermal' | 'hyperpyrothermal';

export interface AerosolClass {
  id: string;
  label: string;
  prefix: string;
  thermalRange: ThermalRange;
  tempK: [number, number];
  desc: string;
  /** Natural appearance colors [primary, secondary, accent] as hex */
  colors: [string, string, string];
  /** Visual description for texture generation prompts */
  visualDesc: string;
}

export const AEROSOL_CLASSES: AerosolClass[] = [
  // ── Cryothermal (<90K) ──
  {
    id: 'cryoazurian', label: 'CryoAzurian', prefix: 'Cryoazuri',
    thermalRange: 'cryothermal', tempK: [0, 90],
    desc: 'No tropospheric clouds, faint hazes. Dull blue, hints of cyan hydrocarbon haze.',
    colors: ['#4a6a8f', '#5a7a9f', '#3a5a7f'],
    visualDesc: 'Dull blue featureless sphere with faint cyan hydrocarbon haze bands, like a cold Uranus',
  },
  {
    id: 'frigidian', label: 'Frigidian', prefix: 'Frigi',
    thermalRange: 'cryothermal', tempK: [5, 20],
    desc: 'Extremely cold hydrogen clouds. White with hints of grey and blue.',
    colors: ['#d8dce8', '#c0c8d8', '#e8eaf0'],
    visualDesc: 'White and grey hydrogen clouds, extremely cold, almost featureless with subtle blue-grey banding',
  },
  {
    id: 'neonean', label: 'Neonean', prefix: 'Neono',
    thermalRange: 'cryothermal', tempK: [15, 35],
    desc: 'Very cold neon clouds.',
    colors: ['#b8a8c8', '#a898b8', '#c8b8d8'],
    visualDesc: 'Pale lavender neon clouds, ethereal and translucent, very cold gas world',
  },
  {
    id: 'borean', label: 'Borean', prefix: 'Boreo',
    thermalRange: 'cryothermal', tempK: [35, 60],
    desc: 'N₂/CO clouds. Pale pink/purple, with reds/oranges/browns from organic haze.',
    colors: ['#c89898', '#a87878', '#d8a8a8'],
    visualDesc: 'Pale pink and purple nitrogen clouds with organic haze streaks of red-brown and orange',
  },
  {
    id: 'methanean', label: 'Methanean', prefix: 'Metho',
    thermalRange: 'cryothermal', tempK: [60, 90],
    desc: 'CH₄/C₂H₆ clouds + organic haze. Light blue-turquoise, can be dull green or bronze.',
    colors: ['#6aa8c8', '#5898b8', '#78b8d8'],
    visualDesc: 'Light blue-turquoise methane clouds with organic haze giving green-bronze tint, like Neptune',
  },
  // ── Mesothermal (90-550K) ──
  {
    id: 'mesoazurian', label: 'MesoAzurian', prefix: 'Azuri',
    thermalRange: 'mesothermal', tempK: [90, 550],
    desc: 'Rare clarified atmosphere. Teal/green from organic + sulfur hazes.',
    colors: ['#488878', '#387868', '#589888'],
    visualDesc: 'Clear teal-green atmosphere with heavy organic and sulfur haze discoloration',
  },
  {
    id: 'tholian', label: 'Tholian', prefix: 'Tholi',
    thermalRange: 'mesothermal', tempK: [60, 550],
    desc: 'Organic hazes obscuring surface. Pale yellow/orange/brown.',
    colors: ['#c8a858', '#b89848', '#d8b868'],
    visualDesc: 'Thick organic tholin haze, pale yellow-orange-brown, opaque like Titan',
  },
  {
    id: 'sulfanian', label: 'Sulfanian', prefix: 'Sulfa',
    thermalRange: 'mesothermal', tempK: [80, 180],
    desc: 'Sulfur-enriched ammonia clouds. Dull yellow/orange/gold.',
    colors: ['#b8a848', '#a89838', '#c8b858'],
    visualDesc: 'Sulfur-enriched ammonia clouds, dull yellow-orange-gold bands like a sulfurous Jupiter',
  },
  {
    id: 'ammonian', label: 'Ammonian', prefix: 'Ammo',
    thermalRange: 'mesothermal', tempK: [80, 190],
    desc: 'NH₃ + NH₄SH clouds + organic haze. Cream/peach/orange.',
    colors: ['#d8b888', '#c8a878', '#e8c898'],
    visualDesc: 'Cream and peach ammonia cloud bands with orange organic haze, Saturn-like banding',
  },
  {
    id: 'hydronian', label: 'Hydronian', prefix: 'Hydro',
    thermalRange: 'mesothermal', tempK: [170, 350],
    desc: 'Water clouds + organic haze. White, can be yellow/brown-tinged.',
    colors: ['#d8d8d8', '#c8c0b8', '#e8e8e8'],
    visualDesc: 'White water clouds with organic haze giving yellow-brown tinge, Earth-like cloud patterns',
  },
  {
    id: 'acidian', label: 'Acidian', prefix: 'Acidi',
    thermalRange: 'mesothermal', tempK: [250, 500],
    desc: 'H₂SO₄ clouds + sulfur aerosols. Tan/taupe/beige.',
    colors: ['#c8b898', '#b8a888', '#d8c8a8'],
    visualDesc: 'Tan-taupe sulfuric acid clouds like Venus, thick beige cloud deck with sulfur aerosols',
  },
  // ── Pyrothermal (550-1300K) ──
  {
    id: 'pyroazurian', label: 'PyroAzurian', prefix: 'Pyroazuri',
    thermalRange: 'pyrothermal', tempK: [550, 1300],
    desc: 'Very few clouds, especially above 900K. Various blues depending on haze.',
    colors: ['#4868a8', '#3858b8', '#587898'],
    visualDesc: 'Clear hot atmosphere, deep blue with varying haze density, cloud-free scorched world',
  },
  {
    id: 'sulfolian', label: 'Sulfolian', prefix: 'Sulfoli',
    thermalRange: 'pyrothermal', tempK: [400, 1000],
    desc: 'Sulfur + organosulfur hazes. Gold/bronze, can be green or orange.',
    colors: ['#b89838', '#a88828', '#c8a848'],
    visualDesc: 'Golden-bronze sulfur and organosulfur haze, hot atmosphere with green-orange variations',
  },
  {
    id: 'aithalian', label: 'Aithalian', prefix: 'Aithali',
    thermalRange: 'pyrothermal', tempK: [550, 1000],
    desc: 'Soot/hydrocarbon haze. Dull brown, dark grey/hazel/olive.',
    colors: ['#685848', '#584838', '#786858'],
    visualDesc: 'Dark sooty hydrocarbon haze, dull brown to dark grey-olive, like a hot smoggy world',
  },
  {
    id: 'alkalinean', label: 'Alkalinean', prefix: 'Alkali',
    thermalRange: 'pyrothermal', tempK: [700, 850],
    desc: 'KCl clouds, often with Aithalian haze. Bronze/greenish-brown.',
    colors: ['#887858', '#786848', '#988868'],
    visualDesc: 'Bronze and greenish-brown alkali chloride clouds with sooty haze overlay',
  },
  // ── Hyperpyrothermal (>1300K) ──
  {
    id: 'hyperpyroazurian', label: 'HyperpyroAzurian', prefix: 'Hyperpyro',
    thermalRange: 'hyperpyrothermal', tempK: [1300, 10000],
    desc: 'No cloud deck, slightly hazy. Blue dayside, thermal luminosity nightside.',
    colors: ['#3848b8', '#4858c8', '#2838a8'],
    visualDesc: 'Blazing hot, clear blue dayside atmosphere, glowing red-orange nightside from thermal emission',
  },
  {
    id: 'enstatian', label: 'Enstatian', prefix: 'Enstato',
    thermalRange: 'hyperpyrothermal', tempK: [1300, 1900],
    desc: 'Silicate clouds (Mg, Fe). Grey with blue/green/brown tinge.',
    colors: ['#888898', '#787888', '#9898a8'],
    visualDesc: 'Grey silicate clouds of magnesium and iron, tinged blue-green-brown, molten rock rain',
  },
  {
    id: 'refractian', label: 'Refractian', prefix: 'Refra',
    thermalRange: 'hyperpyrothermal', tempK: [1800, 2300],
    desc: 'Refractory oxide clouds (Al₂O₃, TiO₂). Red/orange/tan.',
    colors: ['#c87848', '#b86838', '#d88858'],
    visualDesc: 'Red-orange-tan refractory oxide clouds of aluminum and titanium oxides, extremely hot',
  },
  {
    id: 'carbean', label: 'Carbean', prefix: 'Carbo',
    thermalRange: 'hyperpyrothermal', tempK: [2000, 2900],
    desc: 'Refractory carbide clouds (TiC, VC). Carbon haze. Dark brown.',
    colors: ['#483828', '#382818', '#584838'],
    visualDesc: 'Very dark brown refractory carbide clouds with thick carbon haze, ultra-hot carbon world',
  },
];

// ═══════════════════════════════════════════════════════
//  SURFACE & SUBSURFACE TYPES
// ═══════════════════════════════════════════════════════

export type SurfaceType =
  | 'abyssal' | 'gaian' | 'cytherean' | 'muspellian'
  | 'barian' | 'arean' | 'agonian' | 'achlysian' | 'apnean';

export const SURFACE_TYPES: Record<SurfaceType, { label: string; desc: string; visualDesc: string }> = {
  abyssal:    { label: 'Abyssal',    desc: 'High pressure compressible liquid surface under thick vapor/supercritical atmosphere', visualDesc: 'Deep dark ocean under crushing atmosphere, no visible surface features' },
  gaian:      { label: 'Gaian',      desc: 'Earth-like with condensing vapor forming lakes, seas, oceans', visualDesc: 'Blue-green world with continents, oceans, clouds — Earth-like' },
  cytherean:  { label: 'Cytherean',  desc: 'Venus-like with supercritical fluid to solid surface transition', visualDesc: 'Dense orange-yellow cloud deck hiding a scorched rocky surface, Venus-like' },
  muspellian: { label: 'Muspellian', desc: 'Supercritical fluid to high-pressure ice surface', visualDesc: 'Crushing atmosphere over high-pressure exotic ice surface' },
  barian:     { label: 'Barian',     desc: 'Metallic liquid surface (metallic hydrogen) under supercritical atmosphere', visualDesc: 'Deep metallic hydrogen ocean with swirling supercritical fluid atmosphere' },
  arean:      { label: 'Arean',      desc: 'Mars-like with vapor below triple point — sublimation/deposition', visualDesc: 'Dusty red-orange desert with frost deposits and thin atmosphere, Mars-like' },
  agonian:    { label: 'Agonian',    desc: 'Gaseous atmosphere above triple pressure, no liquids', visualDesc: 'Rocky surface with thin atmosphere but no liquid water or frost' },
  achlysian:  { label: 'Achlysian',  desc: 'Vapor atmosphere below triple pressure, no surface ices', visualDesc: 'Barren airless-looking world with trace vapors and exposed bedrock' },
  apnean:     { label: 'Apnean',     desc: 'Airless with only exosphere, <0.1 nanobar', visualDesc: 'Completely airless cratered body like Mercury or the Moon' },
};

export type SubsurfaceType =
  | 'europan' | 'thalassic' | 'ganymedean'
  | 'phlegethean' | 'atlantean' | 'cryptian' | 'none';

export const SUBSURFACE_TYPES: Record<SubsurfaceType, { label: string; desc: string }> = {
  europan:    { label: 'Europan',    desc: 'Subglacial hydrosphere beneath solid ice' },
  thalassic:  { label: 'Thalassic',  desc: 'High pressure ices below liquid ocean' },
  ganymedean: { label: 'Ganymedean', desc: 'High pressure ices below subglacial hydrosphere' },
  phlegethean:{ label: 'Phlegethean',desc: 'Supercritical fluid under deep liquid ocean' },
  atlantean:  { label: 'Atlantean',  desc: 'Supercritical fluid below subglacial hydrosphere' },
  cryptian:   { label: 'Cryptian',   desc: 'Subsurface liquid in caverns/fluid tables' },
  none:       { label: 'None',       desc: 'No notable subsurface liquid layer' },
};

// ═══════════════════════════════════════════════════════
//  PRECIPITATION & LIQUID COVERAGE
// ═══════════════════════════════════════════════════════

export type PrecipitationType = 'thermal' | 'tepidal' | 'tundral' | 'glacial' | 'none';

export type LiquidCoverage =
  | 'inundic' | 'oceanic' | 'marine' | 'estuarine'
  | 'lacustrine' | 'conlectic' | 'none';

export const LIQUID_COVERAGES: Record<LiquidCoverage, { label: string; pct: [number, number] }> = {
  inundic:    { label: 'Inundic',    pct: [100, 100] },
  oceanic:    { label: 'Oceanic',    pct: [90, 100] },
  marine:     { label: 'Marine',     pct: [60, 90] },
  estuarine:  { label: 'Estuarine',  pct: [40, 60] },
  lacustrine: { label: 'Lacustrine', pct: [10, 40] },
  conlectic:  { label: 'Conlectic',  pct: [0, 10] },
  none:       { label: 'None',       pct: [0, 0] },
};

// ═══════════════════════════════════════════════════════
//  FLUID TYPES
// ═══════════════════════════════════════════════════════

export interface FluidType {
  id: string;
  label: string;
  prefix: string;
  substance: string;
  color: string;        // typical visible color
  rarity: 'common' | 'uncommon' | 'rare' | 'very_rare';
}

export const FLUID_TYPES: FluidType[] = [
  { id: 'aquatic',     label: 'Aquatic',     prefix: 'Aqua',     substance: 'Water',             color: '#2060c0', rarity: 'common' },
  { id: 'amunian',     label: 'Amunian',     prefix: 'Amu',      substance: 'Ammonia',           color: '#6880a0', rarity: 'common' },
  { id: 'titanian',    label: 'Titanian',    prefix: 'Titano',   substance: 'Methane/Ethane',    color: '#8a6830', rarity: 'common' },
  { id: 'petrolic',    label: 'Petrolic',    prefix: 'Petro',    substance: 'Crude hydrocarbons',color: '#4a3820', rarity: 'uncommon' },
  { id: 'bitumic',     label: 'Bitumic',     prefix: 'Bitu',     substance: 'Bitumen/heavy HC',  color: '#302018', rarity: 'uncommon' },
  { id: 'dionysian',   label: 'Dionysian',   prefix: 'Diono',    substance: 'Alcohols',          color: '#c0b8a0', rarity: 'rare' },
  { id: 'capnian',     label: 'Capnian',     prefix: 'Capno',    substance: 'Carbon dioxide',    color: '#d8d0c0', rarity: 'common' },
  { id: 'azotian',     label: 'Azotian',     prefix: 'Azo',      substance: 'Nitrogen',          color: '#b0c8e0', rarity: 'common' },
  { id: 'monoxian',    label: 'Monoxian',    prefix: 'Monoxo',   substance: 'Carbon monoxide',   color: '#a8b8c8', rarity: 'uncommon' },
  { id: 'oxygenean',   label: 'Oxygenean',   prefix: 'Oxygo',    substance: 'Oxygen',            color: '#90b0d0', rarity: 'rare' },
  { id: 'hydrogenean', label: 'Hydrogenean', prefix: 'Hydrogo',  substance: 'Hydrogen',          color: '#c0c8d0', rarity: 'common' },
  { id: 'neonic',      label: 'Neonic',      prefix: 'Neono',    substance: 'Neon',              color: '#d0c8e0', rarity: 'uncommon' },
  { id: 'ignean',      label: 'Ignean',      prefix: 'Igneo',    substance: 'Magma/molten metal',color: '#e04010', rarity: 'common' },
  { id: 'salific',     label: 'Salific',     prefix: 'Salifo',   substance: 'Metal salts',       color: '#d0c0a0', rarity: 'uncommon' },
  { id: 'fortic',      label: 'Fortic',      prefix: 'Forto',    substance: 'Nitric acid',       color: '#c8c098', rarity: 'very_rare' },
  { id: 'amylian',     label: 'Amylian',     prefix: 'Amy',      substance: 'Nitrogen oxides',   color: '#c09040', rarity: 'rare' },
  { id: 'cyanic',      label: 'Cyanic',      prefix: 'Cyano',    substance: 'Hydrogen cyanide',  color: '#b8c0b8', rarity: 'rare' },
  { id: 'hepatic',     label: 'Hepatic',     prefix: 'Hepa',     substance: 'Hydrogen sulfide',  color: '#a0a870', rarity: 'uncommon' },
  { id: 'ionean',      label: 'Ionean',      prefix: 'Io',       substance: 'Sulfur oxides',     color: '#d8d098', rarity: 'uncommon' },
  { id: 'disulfian',   label: 'Disulfian',   prefix: 'Disulfa',  substance: 'Carbon disulfide',  color: '#b8a870', rarity: 'rare' },
  { id: 'brimstonian', label: 'Brimstonian', prefix: 'Brimo',    substance: 'Sulfur',            color: '#c8b020', rarity: 'uncommon' },
  { id: 'vitriolic',   label: 'Vitriolic',   prefix: 'Vitrio',   substance: 'Sulfuric acid',     color: '#c8b888', rarity: 'uncommon' },
  { id: 'carbonylic',  label: 'Carbonylic',  prefix: 'Carbonylo',substance: 'Metal carbonyls',   color: '#a09048', rarity: 'very_rare' },
  { id: 'formamian',   label: 'Formamian',   prefix: 'Forma',    substance: 'Formamide',         color: '#c0b8a8', rarity: 'very_rare' },
  { id: 'phosphinic',  label: 'Phosphinic',  prefix: 'Phosphi',  substance: 'Phosphine',         color: '#a8b0a0', rarity: 'very_rare' },
  { id: 'phosphoric',  label: 'Phosphoric',  prefix: 'Phospho',  substance: 'Phosphoric acid',   color: '#c0b8a0', rarity: 'very_rare' },
  { id: 'hydrochloric',label: 'Hydrochloric',prefix: 'Chloro',   substance: 'HCl',               color: '#a0b8b0', rarity: 'very_rare' },
  { id: 'hydrofluoric',label: 'Hydrofluoric',prefix: 'Fluoro',   substance: 'HF',                color: '#a8b8c0', rarity: 'very_rare' },
];

// ═══════════════════════════════════════════════════════
//  MASS CLASSES
// ═══════════════════════════════════════════════════════

export type MassClass =
  // Planetesimals
  | 'lowerplanetesimal' | 'midplanetesimal' | 'upperplanetesimal'
  // Planetoids
  | 'lowerplanetoid' | 'midplanetoid' | 'upperplanetoid'
  // Terrenes
  | 'petiterrene' | 'lowerterrene' | 'midterrene' | 'upperterrene' | 'grandterrene'
  // Giants
  | 'lowergiant' | 'midgiant' | 'uppergiant';

export interface MassClassDef {
  label: string;
  category: 'planetesimal' | 'planetoid' | 'terrene' | 'giant';
  earthMassRange: [number, number];
}

export const MASS_CLASSES: Record<MassClass, MassClassDef> = {
  lowerplanetesimal: { label: 'Lowerplanetesimal', category: 'planetesimal', earthMassRange: [4e-14, 4e-12] },
  midplanetesimal:   { label: 'Midplanetesimal',   category: 'planetesimal', earthMassRange: [4e-12, 4e-10] },
  upperplanetesimal: { label: 'Upperplanetesimal', category: 'planetesimal', earthMassRange: [4e-10, 4e-8] },
  lowerplanetoid:    { label: 'Lowerplanetoid',    category: 'planetoid',    earthMassRange: [4e-8, 4e-7] },
  midplanetoid:      { label: 'Midplanetoid',      category: 'planetoid',    earthMassRange: [4e-7, 4e-6] },
  upperplanetoid:    { label: 'Upperplanetoid',     category: 'planetoid',    earthMassRange: [4e-6, 3.3e-5] },
  petiterrene:       { label: 'Petiterrene',       category: 'terrene',      earthMassRange: [0.00004, 0.0004] },
  lowerterrene:      { label: 'Lowerterrene',      category: 'terrene',      earthMassRange: [0.0004, 0.004] },
  midterrene:        { label: 'Midterrene',        category: 'terrene',      earthMassRange: [0.004, 0.04] },
  upperterrene:      { label: 'Upperterrene',      category: 'terrene',      earthMassRange: [0.04, 0.4] },
  grandterrene:      { label: 'Grandterrene',      category: 'terrene',      earthMassRange: [0.4, 4] },
  lowergiant:        { label: 'Lowergiant',        category: 'giant',        earthMassRange: [4, 40] },
  midgiant:          { label: 'Midgiant',          category: 'giant',        earthMassRange: [40, 400] },
  uppergiant:        { label: 'Uppergiant',        category: 'giant',        earthMassRange: [400, 4000] },
};

// ═══════════════════════════════════════════════════════
//  MISCELLANEOUS CLASSIFICATIONS
// ═══════════════════════════════════════════════════════

export type RotationClass = 'skolian' | 'videntian' | 'stilbonian' | 'aeolian' | 'jacobian' | 'synestian' | 'normal';
export type OrbitalClass = 'stevensonian' | 'ikarian' | 'circumbinary' | 'normal';
export type LifeClass = 'protobiotic' | 'microbiotic' | 'mesobiotic' | 'macrobiotic' | 'neobiotic' | 'postbiotic' | 'abiotic';
export type HistoryClass = 'chthonian' | 'ragnorokian' | 'odyssian' | 'phoenixian' | 'chaotian' | 'genesian' | 'normal';
export type MultiworldClass = 'trojan' | 'janusian' | 'satellite' | 'dioscuran' | 'rochean' | 'independent';

// ═══════════════════════════════════════════════════════
//  FULL EWoCS DESIGNATION
// ═══════════════════════════════════════════════════════

export interface EWoCSDesignation {
  /** Compositional */
  gasFraction: GasFraction;
  volatileContent: VolatileContent;
  carbonContent: CarbonContent;
  metalContent: MetalContent;
  /** Atmosphere */
  atmosphereType: AtmosphereType | 'none';
  aerosolClass: string;           // id from AEROSOL_CLASSES
  /** Surface */
  surfaceType: SurfaceType;
  subsurfaceType: SubsurfaceType;
  /** Precipitation & Hydrology */
  precipitationType: PrecipitationType;
  liquidCoverage: LiquidCoverage;
  primaryFluid: string;           // id from FLUID_TYPES
  secondaryFluid?: string;
  /** Mass */
  massClass: MassClass;
  /** Miscellaneous */
  rotationClass: RotationClass;
  orbitalClass: OrbitalClass;
  lifeClass: LifeClass;
  historyClass: HistoryClass;
  multiworldClass: MultiworldClass;
}

/**
 * Build a human-readable short EWoCS designation string.
 * e.g. "Terrestrial LapiOxidic Telluric RheanGaian Aqua-Marine Grandterrene"
 */
export function formatEWoCS(d: EWoCSDesignation): string {
  const vol = VOLATILE_CONTENTS[d.volatileContent];
  const carb = CARBON_CONTENTS[d.carbonContent];
  const gas = GAS_FRACTIONS[d.gasFraction];
  const metal = METAL_CONTENTS[d.metalContent];
  const aerosol = AEROSOL_CLASSES.find(a => a.id === d.aerosolClass);
  const surface = SURFACE_TYPES[d.surfaceType];
  const fluid = FLUID_TYPES.find(f => f.id === d.primaryFluid);
  const liq = LIQUID_COVERAGES[d.liquidCoverage];
  const mass = MASS_CLASSES[d.massClass];

  const parts: string[] = [gas.label];

  if (d.gasFraction === 'terrestrial') {
    parts.push(`${vol.prefix}${carb.prefix}`);
    parts.push(metal.label);
  }

  if (d.atmosphereType !== 'none' && aerosol) {
    parts.push(`${aerosol.prefix}${surface.label}`);
  } else {
    parts.push(surface.label);
  }

  if (d.liquidCoverage !== 'none' && fluid) {
    parts.push(`${fluid.prefix}-${liq.label}`);
  }

  parts.push(mass.label);

  // Modifiers
  const mods: string[] = [];
  if (d.rotationClass !== 'normal') mods.push(d.rotationClass);
  if (d.orbitalClass !== 'normal') mods.push(d.orbitalClass);
  if (d.lifeClass !== 'abiotic') mods.push(d.lifeClass);
  if (d.historyClass !== 'normal') mods.push(d.historyClass);
  if (d.multiworldClass !== 'independent') mods.push(d.multiworldClass);

  if (mods.length > 0) {
    parts.push(`[${mods.join(', ')}]`);
  }

  return parts.join(' ');
}

/**
 * Get the best-matching aerosol class for a given temperature.
 */
export function getAerosolForTemp(tempK: number): AerosolClass {
  const matches = AEROSOL_CLASSES.filter(a => tempK >= a.tempK[0] && tempK <= a.tempK[1]);
  if (matches.length === 0) {
    // Fallback: nearest
    return AEROSOL_CLASSES.reduce((best, a) => {
      const dist = Math.min(Math.abs(tempK - a.tempK[0]), Math.abs(tempK - a.tempK[1]));
      const bestDist = Math.min(Math.abs(tempK - best.tempK[0]), Math.abs(tempK - best.tempK[1]));
      return dist < bestDist ? a : best;
    });
  }
  return matches[0];
}

/**
 * Classify mass in Earth masses to a MassClass.
 */
export function classifyMass(earthMasses: number): MassClass {
  for (const [key, def] of Object.entries(MASS_CLASSES)) {
    if (earthMasses >= def.earthMassRange[0] && earthMasses < def.earthMassRange[1]) {
      return key as MassClass;
    }
  }
  if (earthMasses >= 4000) return 'uppergiant';
  return 'lowerplanetesimal';
}
