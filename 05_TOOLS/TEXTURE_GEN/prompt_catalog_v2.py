#!/usr/bin/env python3
"""
ExoMaps — EWoCS Texture Prompt Catalog v2
==========================================
Expanded catalog with 200+ prompts organized by ROLE:
  - BASE   : 2:1 equirectangular base textures (2400×1200), broad terrain layers
  - STAMP  : 1:1 square detail patches/decals (512–1200px), dithered-edge biome stamps
  - CLOUD  : Cloud layer textures (wisps, banks, storm cells)
  - LIQUID : Water/liquid depth textures (shallow reefs, deep oceans, hydrocarbon seas)
  - TRANSITION : Edge-blend textures (coastlines, ice edges, lava margins)

All existing v1 prompts are preserved and re-tagged with roles.
"""

from dataclasses import dataclass, field


@dataclass
class TexturePrompt:
    """Single texture generation prompt."""
    ewocs_id: str
    category: str
    label: str
    prompt: str
    negative: str = ""
    width: int = 1200
    height: int = 1200
    style: str = "DYNAMIC"
    notes: str = ""
    role: str = "stamp"  # base | stamp | cloud | liquid | transition


SHARED_NEGATIVE = (
    "text, watermark, logo, border, frame, human, person, face, cartoon, anime, "
    "low quality, blurry, jpeg artifacts, 3d render, CGI look, grid lines, seams visible, "
    "black bars, full planet, globe, sphere, space scene, stars, horizon, atmosphere glow"
)


# ═══════════════════════════════════════════════════════════
#  BASE TEXTURES (2:1 equirectangular, 2400×1200)
#  Broad terrain types meant to wrap a sphere as a base layer
# ═══════════════════════════════════════════════════════════

BASE_ROCKY_PROMPTS: list[TexturePrompt] = [
    TexturePrompt(
        ewocs_id="base_rocky_barren",
        category="base", label="Rocky Barren Base",
        role="base", width=1536, height=768,
        prompt=(
            "Ultra-realistic seamless equirectangular terrain texture of a barren rocky planet surface, "
            "top-down orthographic view, wide-field gray basalt bedrock with scattered rubble, shallow "
            "dust-filled depressions, sparse micro-craters, uniform rocky desert extending to all edges, "
            "neutral gray and dark brown palette, subtle regolith grain, no curvature, no horizon, "
            "tileable equirectangular projection, extremely uniform lighting, designed as a 2:1 base map."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="base_rocky_iron",
        category="base", label="Iron-rich Rocky Base",
        role="base", width=1536, height=768,
        prompt=(
            "Photorealistic seamless equirectangular terrain map of an iron-rich rocky planet, "
            "top-down view, dense oxidized basalt surface with reddish-brown iron staining, "
            "scattered metallic inclusions, fine regolith, micro-fractures in crust, "
            "palette of rust, charcoal gray, and warm brown, very uniform field, "
            "seamless edges for 2:1 equirectangular wrapping, neutral overhead lighting."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="base_rocky_ancient",
        category="base", label="Ancient Cratered Base",
        role="base", width=1536, height=768,
        prompt=(
            "Ultra-realistic seamless equirectangular terrain of ancient heavily cratered surface, "
            "top-down orthographic, dense overlapping small craters and micro-impacts, "
            "regolith-covered with soft gray dust mantle, worn crater rims, subtle ejecta patterns, "
            "mercury or lunar appearance, pale gray and dark charcoal palette, "
            "tileable 2:1 base map for spherical wrapping."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="base_rocky_volcanic",
        category="base", label="Volcanic Basalt Base",
        role="base", width=1536, height=768,
        prompt=(
            "Photorealistic seamless equirectangular texture of volcanic basalt plains, "
            "top-down orthographic, broad lava flow surfaces with cooling textures, "
            "dark gray-black basalt with subtle flow ridges and polygonal cooling cracks, "
            "sparse volcanic vents and fissures, extremely smooth volcanic terrain, "
            "tileable 2:1 projection for planet-scale wrapping."
        ),
        negative=SHARED_NEGATIVE,
    ),
]

BASE_DESERT_PROMPTS: list[TexturePrompt] = [
    TexturePrompt(
        ewocs_id="base_desert_sand",
        category="base", label="Sandy Desert Base",
        role="base", width=1536, height=768,
        prompt=(
            "Ultra-realistic seamless equirectangular terrain texture of a vast sandy desert, "
            "top-down orthographic view, expansive dune fields with subtle wind ripples, "
            "pale tan and amber sand coloration, uniform aeolian terrain, "
            "sparse interdune flats, fine grain texture visible at macro scale, "
            "tileable 2:1 equirectangular base map for spherical projection."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="base_desert_oxide",
        category="base", label="Mars-like Oxide Base",
        role="base", width=1536, height=768,
        prompt=(
            "Photorealistic seamless equirectangular terrain of Mars-like iron oxide desert, "
            "top-down view, fine rust-red dust covering bedrock, scattered dark basalt outcrops, "
            "wind streaks and dust devil traces, muted red-brown palette, "
            "extremely uniform field, tileable 2:1 map for planetary base layer."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="base_desert_salt",
        category="base", label="Salt Flat Base",
        role="base", width=1536, height=768,
        prompt=(
            "Ultra-realistic seamless equirectangular texture of vast salt flats, "
            "top-down orthographic, bright white crystalline salt crust with polygonal "
            "desiccation patterns, subtle mineral impurities in beige and pale gray, "
            "extremely flat terrain, tileable 2:1 projections for planet wrapping."
        ),
        negative=SHARED_NEGATIVE,
    ),
]

BASE_ICE_PROMPTS: list[TexturePrompt] = [
    TexturePrompt(
        ewocs_id="base_ice_sheet",
        category="base", label="Ice Sheet Base",
        role="base", width=1536, height=768,
        prompt=(
            "Photorealistic seamless equirectangular terrain of thick glacial ice sheet, "
            "top-down orthographic, compacted blue-white ice with subtle flow banding, "
            "long crevasse networks, wind-polished surfaces, pale cyan and white palette, "
            "tileable 2:1 equirectangular base map for icy world wrapping."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="base_ice_nitrogen",
        category="base", label="Nitrogen Ice Base",
        role="base", width=1536, height=768,
        prompt=(
            "Ultra-realistic seamless equirectangular terrain of nitrogen ice plains, "
            "top-down orthographic, smooth convection cell patterns like Pluto's Sputnik Planitia, "
            "polygonal cell boundaries, pale cream and white coloration with faint pink tholin stains, "
            "tileable 2:1 projection for cryogenic world base layer."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="base_ice_ammonia",
        category="base", label="Ammonia Ice Base",
        role="base", width=1536, height=768,
        prompt=(
            "Photorealistic seamless equirectangular terrain of ammonia-rich ice plains, "
            "top-down view, smooth granular frost with subtle bluish-lavender tint, "
            "shallow sublimation pits, faint fracture lines, very uniform icy surface, "
            "tileable 2:1 base map for cryogenic outer-system worlds."
        ),
        negative=SHARED_NEGATIVE,
    ),
]

BASE_OCEAN_PROMPTS: list[TexturePrompt] = [
    TexturePrompt(
        ewocs_id="base_ocean_deep",
        category="base", label="Deep Ocean Base",
        role="base", width=1536, height=768,
        prompt=(
            "Ultra-realistic seamless equirectangular texture of deep ocean surface, "
            "top-down orthographic, dark blue-black water surface with subtle wave patterns, "
            "very uniform deep water coloration, slight turbidity variations, "
            "no visible seafloor, tileable 2:1 equirectangular base for ocean worlds."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="base_ocean_shallow",
        category="base", label="Shallow Ocean Base",
        role="base", width=1536, height=768,
        prompt=(
            "Photorealistic seamless equirectangular texture of shallow tropical ocean, "
            "top-down view, turquoise and teal water with visible sandy seabed below, "
            "gentle current patterns, light caustic patterns through water, "
            "tileable 2:1 projection for ocean world base layer."
        ),
        negative=SHARED_NEGATIVE,
    ),
]

BASE_LAVA_PROMPTS: list[TexturePrompt] = [
    TexturePrompt(
        ewocs_id="base_lava_crust",
        category="base", label="Lava Crust Base",
        role="base", width=1536, height=768,
        prompt=(
            "Ultra-realistic seamless equirectangular terrain of solidified lava crust planet, "
            "top-down orthographic, dark basalt with glowing orange-red fracture seams, "
            "polygonal cooling plates, volcanic surface texture, "
            "tileable 2:1 base map for lava world wrapping."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="base_lava_cooled",
        category="base", label="Cooled Lava Base",
        role="base", width=1536, height=768,
        prompt=(
            "Photorealistic seamless equirectangular terrain of fully cooled basalt lava plains, "
            "top-down view, dark gray-black hardened lava with flow wrinkles and collapse pits, "
            "no active glow, muted charcoal palette, tileable 2:1 projection."
        ),
        negative=SHARED_NEGATIVE,
    ),
]

BASE_HYDROCARBON_PROMPTS: list[TexturePrompt] = [
    TexturePrompt(
        ewocs_id="base_hydrocarbon_dark",
        category="base", label="Hydrocarbon Dark Base",
        role="base", width=1536, height=768,
        prompt=(
            "Ultra-realistic seamless equirectangular terrain of hydrocarbon-covered surface, "
            "top-down orthographic, dark brown-black organic sediments, tar-like coating, "
            "subtle wind-shaped patterns, extremely dark palette with amber hints, "
            "tileable 2:1 base map for Titan-like worlds."
        ),
        negative=SHARED_NEGATIVE,
    ),
]

ALL_BASE_PROMPTS = (
    BASE_ROCKY_PROMPTS + BASE_DESERT_PROMPTS + BASE_ICE_PROMPTS +
    BASE_OCEAN_PROMPTS + BASE_LAVA_PROMPTS + BASE_HYDROCARBON_PROMPTS
)


# ═══════════════════════════════════════════════════════════
#  CLOUD LAYER TEXTURES
#  Semi-transparent cloud patterns for overlay
# ═══════════════════════════════════════════════════════════

CLOUD_PROMPTS: list[TexturePrompt] = [
    TexturePrompt(
        ewocs_id="cloud_thin_cirrus",
        category="cloud", label="Thin Cirrus Wisps",
        role="cloud", width=1536, height=768,
        prompt=(
            "Seamless equirectangular cloud layer texture on pure black background, "
            "top-down orthographic view, thin wispy cirrus clouds scattered across field, "
            "translucent white ice crystal clouds with soft edges, very sparse coverage, "
            "delicate streaky patterns, designed as alpha overlay for planet rendering, "
            "tileable 2:1 projection, clouds only on black background."
        ),
        negative=SHARED_NEGATIVE + ", ground, terrain, ocean, land, surface",
    ),
    TexturePrompt(
        ewocs_id="cloud_cumulus_scattered",
        category="cloud", label="Scattered Cumulus",
        role="cloud", width=1536, height=768,
        prompt=(
            "Seamless equirectangular cloud texture on pure black background, "
            "top-down view, scattered puffy cumulus cloud clusters, bright white tops, "
            "soft shadows beneath, moderate coverage maybe 40 percent, "
            "realistic cloud formation patterns with clear gaps between clusters, "
            "tileable 2:1 projection overlay, clouds only on black."
        ),
        negative=SHARED_NEGATIVE + ", ground, terrain, ocean, land, surface",
    ),
    TexturePrompt(
        ewocs_id="cloud_dense_overcast",
        category="cloud", label="Dense Overcast",
        role="cloud", width=1536, height=768,
        prompt=(
            "Seamless equirectangular cloud layer on pure black background, "
            "top-down orthographic, dense overcast cloud blanket with very high coverage, "
            "thick white-gray cloud mass with subtle turbulent swirl patterns, "
            "occasional thin spots showing darkness below, Venus-like thick atmosphere, "
            "tileable 2:1 projection overlay, clouds only."
        ),
        negative=SHARED_NEGATIVE + ", ground, terrain, ocean, land, surface",
    ),
    TexturePrompt(
        ewocs_id="cloud_storm_spiral",
        category="cloud", label="Storm Spiral Clouds",
        role="cloud", width=1200, height=1200,
        prompt=(
            "Seamless square cloud pattern on pure black background, "
            "top-down view of rotating storm cell with spiral arm structure, "
            "dense white cloud bands curving around central eye, "
            "hurricane-like formation, realistic cyclonic cloud patterns, "
            "bright white clouds on black background, tileable stamp texture."
        ),
        negative=SHARED_NEGATIVE + ", ground, terrain, ocean, land, surface",
    ),
    TexturePrompt(
        ewocs_id="cloud_band_striped",
        category="cloud", label="Banded Cloud Stripes",
        role="cloud", width=1536, height=768,
        prompt=(
            "Seamless equirectangular cloud layer on pure black background, "
            "top-down view, parallel horizontal cloud bands alternating with clear gaps, "
            "zonal wind-driven cloud stripes, turbulent eddies at band edges, "
            "white and pale gray clouds on black, tileable 2:1 projection."
        ),
        negative=SHARED_NEGATIVE + ", ground, terrain, ocean, land, surface",
    ),
    TexturePrompt(
        ewocs_id="cloud_volcanic_haze",
        category="cloud", label="Volcanic Haze Layer",
        role="cloud", width=1536, height=768,
        prompt=(
            "Seamless equirectangular atmospheric haze on pure black background, "
            "top-down view, thin sulfurous volcanic haze layer, pale yellow-white semi-transparent, "
            "patchy coverage with thicker patches where volcanic plumes spread, "
            "designed as atmospheric overlay, tileable 2:1 projection on black."
        ),
        negative=SHARED_NEGATIVE + ", ground, terrain, ocean, surface",
    ),
    TexturePrompt(
        ewocs_id="cloud_dust_storm",
        category="cloud", label="Dust Storm Clouds",
        role="cloud", width=1200, height=1200,
        prompt=(
            "Seamless square dust storm texture on pure black background, "
            "top-down view of swirling dust storm, reddish-tan dust particles suspended, "
            "turbulent chaotic patterns, Mars-like dust storm formation, "
            "semi-transparent dust cloud on black background, tileable stamp."
        ),
        negative=SHARED_NEGATIVE + ", ground, terrain, ocean, surface",
    ),
    TexturePrompt(
        ewocs_id="cloud_methane_haze",
        category="cloud", label="Methane Haze",
        role="cloud", width=1536, height=768,
        prompt=(
            "Seamless equirectangular haze layer on pure black background, "
            "top-down view, semi-transparent orange-brown methane haze, "
            "Titan-like photochemical smog layer, uniform but with subtle thickness variations, "
            "tileable 2:1 projection overlay on black."
        ),
        negative=SHARED_NEGATIVE + ", ground, terrain, ocean, surface",
    ),
]


# ═══════════════════════════════════════════════════════════
#  LIQUID DEPTH TEXTURES
#  Showing depth beneath water/liquid surfaces
# ═══════════════════════════════════════════════════════════

LIQUID_PROMPTS: list[TexturePrompt] = [
    TexturePrompt(
        ewocs_id="liquid_shallow_reef",
        category="liquid", label="Shallow Reef Depth",
        role="liquid", width=1200, height=1200,
        prompt=(
            "Ultra-realistic seamless top-down texture of shallow ocean water over reef terrain, "
            "orthographic view, crystal clear turquoise water revealing detailed reef structures below, "
            "branching coral formations, white sand patches between reef clusters, "
            "water caustic light patterns, visible depth gradient from shallow white sand to deeper blue channels, "
            "reef ecology structure visible through water, tileable square texture."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="liquid_deep_ocean",
        category="liquid", label="Deep Ocean Depth",
        role="liquid", width=1200, height=1200,
        prompt=(
            "Photorealistic seamless top-down texture of deep ocean surface with depth, "
            "orthographic view, dark blue-black water surface with subtle surface wave patterns, "
            "impression of extreme depth below, slight turbidity gradients, "
            "abyssal darkness beneath surface, very minimal surface texture, "
            "tileable square texture for ocean regions."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="liquid_coastal_shelf",
        category="liquid", label="Coastal Shelf Depth",
        role="liquid", width=1200, height=1200,
        prompt=(
            "Ultra-realistic seamless top-down texture of coastal continental shelf water, "
            "orthographic view, gradual depth transition from turquoise shallows to deeper blue, "
            "sandy seabed visible in shallow zones, sediment patterns, subtle wave refraction, "
            "realistic underwater terrain visible through water, tileable square texture."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="liquid_methane_lake",
        category="liquid", label="Methane Lake Depth",
        role="liquid", width=1200, height=1200,
        prompt=(
            "Photorealistic seamless top-down texture of liquid methane lake surface, "
            "orthographic view, dark amber-brown semi-transparent liquid, "
            "subtle ripple patterns, organic sediment visible in shallow edges, "
            "alien hydrocarbon lake with visible depth, extremely dark palette, "
            "tileable square texture for Titan-like worlds."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="liquid_lava_lake",
        category="liquid", label="Lava Lake Depth",
        role="liquid", width=1200, height=1200,
        prompt=(
            "Ultra-realistic seamless top-down texture of an active lava lake surface, "
            "orthographic view, bright orange-yellow incandescent magma with darker cooling crust islands, "
            "convection cell patterns, glowing fractures between rafts of dark crust, "
            "extreme temperature variations visible in color gradient from bright white-orange to dark red-black, "
            "tileable square texture for volcanic worlds."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="liquid_ammonia_ocean",
        category="liquid", label="Ammonia Ocean Depth",
        role="liquid", width=1200, height=1200,
        prompt=(
            "Photorealistic seamless top-down texture of ammonia-water ocean surface, "
            "orthographic view, pale blue-lavender semi-transparent liquid, "
            "smooth wave patterns with faint mineral coloration, "
            "subtle depth gradient, alien cryogenic ocean, tileable."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="liquid_subsurface_ice_crack",
        category="liquid", label="Sub-ice Water Crack",
        role="liquid", width=1024, height=1024,
        prompt=(
            "Ultra-realistic seamless top-down texture of dark liquid water visible through cracked ice, "
            "orthographic view, broken ice plates with dark water showing through gaps, "
            "Europa-style subsurface ocean revealed by fractures, "
            "bright ice surface with dark blue-black water in crevasses, tileable."
        ),
        negative=SHARED_NEGATIVE,
    ),
]


# ═══════════════════════════════════════════════════════════
#  TRANSITION TEXTURES
#  Edge-blend textures for biome boundaries
# ═══════════════════════════════════════════════════════════

TRANSITION_PROMPTS: list[TexturePrompt] = [
    TexturePrompt(
        ewocs_id="trans_coast_sandy",
        category="transition", label="Sandy Coastline",
        role="transition", width=1024, height=1024,
        prompt=(
            "Ultra-realistic seamless top-down texture of sandy coastline transition, "
            "orthographic view, gradual transition from pale sand beach to shallow turquoise water, "
            "wet sand zone, gentle wave wash marks, subtle foam lines, "
            "half land half water composition, sediment shelf visible underwater, "
            "tileable coastline transition texture."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="trans_coast_rocky",
        category="transition", label="Rocky Coastline",
        role="transition", width=1024, height=1024,
        prompt=(
            "Photorealistic seamless top-down texture of rocky coast transition, "
            "orthographic view, dark basalt rock meeting ocean water, "
            "tide pools, wave-worn rock faces, foam in crevices, "
            "sharp transition from solid rock to deep water, tileable."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="trans_ice_edge",
        category="transition", label="Ice Sheet Edge",
        role="transition", width=1024, height=1024,
        prompt=(
            "Ultra-realistic seamless top-down texture of ice sheet termination, "
            "orthographic view, thick white ice transitioning to dark exposed bedrock, "
            "glacial moraine debris, meltwater channels at edge, "
            "sharp ice boundary with scattered ice fragments, tileable transition."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="trans_lava_margin",
        category="transition", label="Lava Flow Margin",
        role="transition", width=1024, height=1024,
        prompt=(
            "Photorealistic seamless top-down texture of active lava flow front, "
            "orthographic view, bright orange lava advancing over gray cooled basalt, "
            "transition zone from incandescent to dim to solid, "
            "aa-type lava front with rubble border, tileable transition texture."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="trans_desert_to_rock",
        category="transition", label="Desert to Bedrock",
        role="transition", width=1024, height=1024,
        prompt=(
            "Ultra-realistic seamless top-down texture of transition from sand desert to rocky terrain, "
            "orthographic view, sand dunes thinning to expose dark rocky substrate, "
            "partial sand coverage over fractured bedrock, wind-cleaned rock surfaces, "
            "gradual biome transition, tileable."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="trans_ice_to_ocean",
        category="transition", label="Ice to Ocean",
        role="transition", width=1024, height=1024,
        prompt=(
            "Photorealistic seamless top-down texture of pack ice meeting open ocean, "
            "orthographic view, broken ice floes floating in dark water, "
            "decreasing ice coverage from dense pack to scattered fragments, "
            "white ice on deep blue-black water, tileable transition."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="trans_vegetation_edge",
        category="transition", label="Vegetation Edge",
        role="transition", width=1024, height=1024,
        prompt=(
            "Ultra-realistic seamless top-down texture of vegetation-barren boundary, "
            "orthographic view, sparse green-brown vegetation patches transitioning to bare rock, "
            "lichen-like ground cover thinning at altitude, soil to rock transition, "
            "alien treeline analog, tileable transition texture."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="trans_hydrocarbon_shore",
        category="transition", label="Hydrocarbon Shore",
        role="transition", width=1024, height=1024,
        prompt=(
            "Photorealistic seamless top-down texture of hydrocarbon lake shoreline transition, "
            "orthographic view, dark brown-black liquid methane meeting organic sediment beach, "
            "wet dark shoreline, tar-like deposits, tileable transition."
        ),
        negative=SHARED_NEGATIVE,
    ),
]


# ═══════════════════════════════════════════════════════════
#  STAMP TEXTURES — New detail patches (1:1 square)
#  These overlay onto the base at specific locations as decals
# ═══════════════════════════════════════════════════════════

# ── Cratered Stamps ─────────────────────────────────
STAMP_CRATER_PROMPTS: list[TexturePrompt] = [
    TexturePrompt(
        ewocs_id="stamp_crater_large_complex",
        category="stamp_crater", label="Large Complex Crater",
        role="stamp", width=1024, height=1024,
        prompt=(
            "Ultra-realistic seamless top-down texture of a single large complex impact crater, "
            "orthographic view, central peak, terraced walls, ejecta blanket radiating outward, "
            "crater fills most of the frame, gray basalt and regolith palette, "
            "realistic impact morphology, tileable stamp texture."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="stamp_crater_cluster",
        category="stamp_crater", label="Crater Cluster",
        role="stamp", width=768, height=768,
        prompt=(
            "Photorealistic seamless top-down texture of a cluster of small impact craters, "
            "orthographic view, 3-5 overlapping small craters with shared ejecta blankets, "
            "gray regolith, sharp crater rims, scattered debris, tileable small stamp."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="stamp_crater_fresh",
        category="stamp_crater", label="Fresh Bright Crater",
        role="stamp", width=768, height=768,
        prompt=(
            "Ultra-realistic seamless top-down texture of a fresh bright impact crater, "
            "orthographic view, sharp raised rim, bright ray system, "
            "high-albedo ejecta contrast against darker surrounding terrain, "
            "young impact feature, tileable stamp."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="stamp_crater_ancient_basin",
        category="stamp_crater", label="Ancient Impact Basin",
        role="stamp", width=1200, height=1200,
        prompt=(
            "Photorealistic seamless top-down texture of an ancient degraded impact basin, "
            "orthographic view, very worn circular depression, heavily eroded rim, "
            "basin floor filled with sediment and smaller craters, "
            "subtle circular structure barely visible, tileable."
        ),
        negative=SHARED_NEGATIVE,
    ),
]

# ── Volcanic Stamps ─────────────────────────────────
STAMP_VOLCANIC_PROMPTS: list[TexturePrompt] = [
    TexturePrompt(
        ewocs_id="stamp_shield_volcano",
        category="stamp_volcanic", label="Shield Volcano",
        role="stamp", width=1024, height=1024,
        prompt=(
            "Ultra-realistic seamless top-down texture of a large shield volcano, "
            "orthographic view, broad circular volcanic edifice with summit caldera, "
            "radial lava flow channels, gently sloping flanks, "
            "dark basalt coloration with subtle flow textures, tileable stamp."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="stamp_caldera",
        category="stamp_volcanic", label="Volcanic Caldera",
        role="stamp", width=768, height=768,
        prompt=(
            "Photorealistic seamless top-down texture of a volcanic caldera, "
            "orthographic view, circular collapse crater with steep inner walls, "
            "flat lava-filled floor, fumarole deposits, "
            "bright sulfur staining around vents, tileable stamp."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="stamp_lava_tube_field",
        category="stamp_volcanic", label="Lava Tube Collapse",
        role="stamp", width=768, height=768,
        prompt=(
            "Ultra-realistic seamless top-down texture of collapsed lava tube field, "
            "orthographic view, sinuous collapse trenches in basalt terrain, "
            "chains of pits marking underground tube routes, dark basalt palette, "
            "tileable volcanic stamp texture."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="stamp_fissure_eruption",
        category="stamp_volcanic", label="Fissure Eruption",
        role="stamp", width=1024, height=1024,
        prompt=(
            "Photorealistic seamless top-down texture of a volcanic fissure eruption zone, "
            "orthographic view, long linear crack with glowing lava emerging, "
            "fresh lava flows spreading from fissure, dark crust with orange glow seams, "
            "tileable stamp texture."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="stamp_volcanic_dome",
        category="stamp_volcanic", label="Volcanic Dome",
        role="stamp", width=768, height=768,
        prompt=(
            "Ultra-realistic seamless top-down texture of a volcanic lava dome, "
            "orthographic view, bulging circular dome of viscous lava, "
            "cracked surface with radial fractures, stubby blocky texture, "
            "gray and reddish-brown coloration, tileable stamp."
        ),
        negative=SHARED_NEGATIVE,
    ),
]

# ── Tectonic Stamps ─────────────────────────────────
STAMP_TECTONIC_PROMPTS: list[TexturePrompt] = [
    TexturePrompt(
        ewocs_id="stamp_graben_rift",
        category="stamp_tectonic", label="Graben Rift Valley",
        role="stamp", width=1200, height=1200,
        prompt=(
            "Ultra-realistic seamless top-down texture of a tectonic graben rift valley, "
            "orthographic view, long linear trough bounded by parallel fault scarps, "
            "collapsed central block, exposed rock layers in walls, "
            "tileable stamp texture for tectonic features."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="stamp_thrust_ridge",
        category="stamp_tectonic", label="Thrust Ridge",
        role="stamp", width=1024, height=1024,
        prompt=(
            "Photorealistic seamless top-down texture of compressional thrust ridge, "
            "orthographic view, linear raised ridge from crustal compression, "
            "folded rock layers exposed on ridge face, debris apron at base, "
            "gray and brown rock palette, tileable stamp."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="stamp_fracture_network",
        category="stamp_tectonic", label="Fracture Network",
        role="stamp", width=768, height=768,
        prompt=(
            "Ultra-realistic seamless top-down texture of dense tectonic fracture network, "
            "orthographic view, intersecting cracks and fractures creating polygonal blocks, "
            "stress-fractured rocky crust, gray basalt palette, tileable stamp."
        ),
        negative=SHARED_NEGATIVE,
    ),
]

# ── Erosion/Geologic Stamps ────────────────────────
STAMP_EROSION_PROMPTS: list[TexturePrompt] = [
    TexturePrompt(
        ewocs_id="stamp_river_delta",
        category="stamp_erosion", label="River Delta Fan",
        role="stamp", width=1024, height=1024,
        prompt=(
            "Ultra-realistic seamless top-down texture of a river delta fan, "
            "orthographic view, branching distributary channels spreading across sediment plain, "
            "fine sediment in warm tan and brown tones, water channels in darker blue, "
            "fan-shaped delta morphology, tileable stamp."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="stamp_canyon_system",
        category="stamp_erosion", label="Canyon System",
        role="stamp", width=1200, height=1200,
        prompt=(
            "Photorealistic seamless top-down texture of deep canyon system, "
            "orthographic view, branching canyons cutting through layered sedimentary rock, "
            "canyon walls showing exposed strata, warm rust-red palette, "
            "Grand Canyon-like erosion morphology, tileable stamp."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="stamp_dried_riverbed",
        category="stamp_erosion", label="Dried Riverbed",
        role="stamp", width=768, height=768,
        prompt=(
            "Ultra-realistic seamless top-down texture of ancient dried riverbed, "
            "orthographic view, sinuous channel carved into bedrock, cracked dry sediment "
            "lining channel floor, meandering course, pale beige and tan palette, tileable stamp."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="stamp_landslide_scar",
        category="stamp_erosion", label="Landslide Scar",
        role="stamp", width=768, height=768,
        prompt=(
            "Photorealistic seamless top-down texture of a mass wasting landslide scar, "
            "orthographic view, exposed fresh rock surface where material detached, "
            "debris fan at base, irregular scalloped headwall, tileable stamp."
        ),
        negative=SHARED_NEGATIVE,
    ),
]

# ── Ice Feature Stamps ─────────────────────────────
STAMP_ICE_PROMPTS: list[TexturePrompt] = [
    TexturePrompt(
        ewocs_id="stamp_cryovolcano",
        category="stamp_ice", label="Cryovolcano Vent",
        role="stamp", width=1024, height=1024,
        prompt=(
            "Ultra-realistic seamless top-down texture of a cryovolcanic vent on icy surface, "
            "orthographic view, circular vent surrounded by bright frost deposits, "
            "radial fracture patterns, cryolava flow channels, "
            "icy terrain with fresh white frost spray pattern, tileable stamp."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="stamp_ice_chaos",
        category="stamp_ice", label="Chaos Ice Region",
        role="stamp", width=1024, height=1024,
        prompt=(
            "Photorealistic seamless top-down texture of chaotic ice terrain, "
            "orthographic view, broken ice plates rotated and jumbled, "
            "refrozen matrix between fragments, Europa-style chaos region, "
            "blue-white ice with reddish-brown salt staining, tileable stamp."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="stamp_glacial_valley",
        category="stamp_ice", label="Glacial Valley",
        role="stamp", width=1200, height=1200,
        prompt=(
            "Ultra-realistic seamless top-down texture of a glacial U-shaped valley, "
            "orthographic view, glacier flowing through valley with lateral moraines, "
            "crevasse field in glacier center, exposed rocky walls at sides, "
            "blue-white ice and gray rock, tileable stamp."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="stamp_sublimation_pit",
        category="stamp_ice", label="Sublimation Pit Field",
        role="stamp", width=768, height=768,
        prompt=(
            "Photorealistic seamless top-down texture of sublimation pit field on ice surface, "
            "orthographic view, numerous round pits formed by ice sublimation, "
            "scalloped terrain, bright ice between dark pit shadows, "
            "Swiss-cheese terrain pattern, tileable stamp."
        ),
        negative=SHARED_NEGATIVE,
    ),
]

# ── Desert Feature Stamps ──────────────────────────
STAMP_DESERT_PROMPTS: list[TexturePrompt] = [
    TexturePrompt(
        ewocs_id="stamp_star_dune",
        category="stamp_desert", label="Star Dune Formation",
        role="stamp", width=1024, height=1024,
        prompt=(
            "Ultra-realistic seamless top-down texture of a star dune formation, "
            "orthographic view, multi-armed sand dune with radiating ridges, "
            "wind from multiple directions creating complex dune arms, "
            "pale tan and amber sand coloration, tileable stamp."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="stamp_dust_devil_tracks",
        category="stamp_desert", label="Dust Devil Tracks",
        role="stamp", width=768, height=768,
        prompt=(
            "Photorealistic seamless top-down texture of dust devil track patterns, "
            "orthographic view, dark sinuous tracks on lighter dusty surface, "
            "where dust devils have exposed darker substrate, Mars-like feature, "
            "tileable stamp texture."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="stamp_oasis_mineral_spring",
        category="stamp_desert", label="Mineral Spring Oasis",
        role="stamp", width=768, height=768,
        prompt=(
            "Ultra-realistic seamless top-down texture of mineral spring deposit in desert, "
            "orthographic view, circular mineral deposit with concentric rings of chemical precipitation, "
            "bright white and pale green mineral crusts around central dark pool, "
            "tileable stamp."
        ),
        negative=SHARED_NEGATIVE,
    ),
]

# ── Ocean Feature Stamps ───────────────────────────
STAMP_OCEAN_PROMPTS: list[TexturePrompt] = [
    TexturePrompt(
        ewocs_id="stamp_atoll_reef",
        category="stamp_ocean", label="Atoll Reef Ring",
        role="stamp", width=1024, height=1024,
        prompt=(
            "Ultra-realistic seamless top-down texture of an atoll reef formation, "
            "orthographic view, circular reef ring enclosing turquoise lagoon, "
            "dark deep water outside, bright shallow reef inside, "
            "coral reef ring structure visible from above, tileable stamp."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="stamp_hydrothermal_vent",
        category="stamp_ocean", label="Hydrothermal Vent Field",
        role="stamp", width=768, height=768,
        prompt=(
            "Photorealistic seamless top-down texture of underwater hydrothermal vent field, "
            "orthographic view, dark basalt seafloor with mineral chimney structures, "
            "bright orange-yellow mineral deposits around vents, dark water, "
            "black smoker formations, tileable stamp."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="stamp_sea_ice_edge",
        category="stamp_ocean", label="Sea Ice Floe Edge",
        role="stamp", width=1024, height=1024,
        prompt=(
            "Ultra-realistic seamless top-down texture of sea ice edge meeting open water, "
            "orthographic view, large ice floe fragmenting into smaller pieces, "
            "white ice on dark blue-black water, decreasing ice density, "
            "pancake ice and brash ice at margins, tileable stamp."
        ),
        negative=SHARED_NEGATIVE,
    ),
]

# ── Special Surface Stamps ─────────────────────────
STAMP_SPECIAL_PROMPTS: list[TexturePrompt] = [
    TexturePrompt(
        ewocs_id="stamp_mineral_vein_field",
        category="stamp_special", label="Mineral Vein Network",
        role="stamp", width=768, height=768,
        prompt=(
            "Ultra-realistic seamless top-down texture of exposed mineral vein network, "
            "orthographic view, bright metallic mineral veins cutting through darker host rock, "
            "quartz and iron sulfide veins creating branching network, "
            "geologically rich terrain, tileable stamp."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="stamp_regolith_garden",
        category="stamp_special", label="Regolith Impact Garden",
        role="stamp", width=768, height=768,
        prompt=(
            "Photorealistic seamless top-down texture of heavily gardened regolith surface, "
            "orthographic view, deeply churned by billions of years of micro-impacts, "
            "soft fluffy regolith with scattered rock fragments, "
            "lunar-like gardened surface, gray palette, tileable stamp."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="stamp_geothermal_field",
        category="stamp_special", label="Geothermal Field",
        role="stamp", width=1024, height=1024,
        prompt=(
            "Ultra-realistic seamless top-down texture of alien geothermal field, "
            "orthographic view, hot spring pools with bright mineral deposits, "
            "concentric mineral terraces, bright white and orange deposits, "
            "siliceous sinter and sulfur formations, tileable stamp."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="stamp_dark_terrain_patch",
        category="stamp_special", label="Dark Terrain Patch",
        role="stamp", width=512, height=512,
        prompt=(
            "Photorealistic seamless top-down texture of very dark carbon-rich terrain patch, "
            "orthographic view, extremely low albedo surface, near-black carbonaceous material, "
            "subtle granular texture, dark asteroid-like surface, tileable small stamp."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="stamp_bright_terrain_patch",
        category="stamp_special", label="Bright Terrain Patch",
        role="stamp", width=512, height=512,
        prompt=(
            "Ultra-realistic seamless top-down texture of bright high-albedo terrain patch, "
            "orthographic view, bright white ice or frost deposit on darker substrate, "
            "fresh bright material covering older dark terrain, tileable small stamp."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="stamp_alien_vegetation",
        category="stamp_special", label="Alien Vegetation Patch",
        role="stamp", width=1024, height=1024,
        prompt=(
            "Ultra-realistic seamless top-down texture of alien vegetation-like surface cover, "
            "orthographic view, dense mat of organic-looking growth in muted greens, dark purples, "
            "and reddish-browns, lichen-like ground cover with fractal branching patterns, "
            "biologically realistic alien groundcover, tileable stamp texture."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="stamp_ancient_ruin_trace",
        category="stamp_special", label="Ancient Ruin Traces",
        role="stamp", width=1024, height=1024,
        prompt=(
            "Photorealistic seamless top-down texture of subtle geometric anomalies in terrain, "
            "orthographic view, very faint regular grid-like patterns partially buried under "
            "natural sediment and erosion, barely visible straight lines and right angles, "
            "archaeological trace in natural terrain, tileable stamp."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="stamp_bioluminescent_patch",
        category="stamp_special", label="Bioluminescent Patch",
        role="stamp", width=768, height=768,
        prompt=(
            "Ultra-realistic seamless top-down texture of bioluminescent organism colony, "
            "orthographic view, glowing blue-green organic patches against dark substrate, "
            "scattered luminescent nodules and connecting filaments, "
            "alien bioluminescence on dark terrain, tileable stamp."
        ),
        negative=SHARED_NEGATIVE,
    ),
]

# ── Additional variety stamps for more detail ──────
STAMP_VARIETY_PROMPTS: list[TexturePrompt] = [
    TexturePrompt(
        ewocs_id="stamp_scree_slope",
        category="stamp_variety", label="Scree Slope",
        role="stamp", width=768, height=768,
        prompt=(
            "Ultra-realistic seamless top-down texture of rocky scree slope debris, "
            "orthographic view, loose angular rock fragments piled on steep slope, "
            "gravity-sorted with larger rocks at base, gray and brown rock debris, tileable."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="stamp_obsidian_field",
        category="stamp_variety", label="Obsidian Glass Field",
        role="stamp", width=768, height=768,
        prompt=(
            "Photorealistic seamless top-down texture of volcanic glass obsidian field, "
            "orthographic view, glassy black obsidian fragments and flows, "
            "conchoidal fracture surfaces, brilliant dark reflective surfaces, tileable."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="stamp_pumice_field",
        category="stamp_variety", label="Pumice Field",
        role="stamp", width=768, height=768,
        prompt=(
            "Ultra-realistic seamless top-down texture of pumice stone field, "
            "orthographic view, light-colored porous volcanic rock scattered across surface, "
            "vesicular texture, pale gray and cream pumice fragments, tileable stamp."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="stamp_crystal_deposit",
        category="stamp_variety", label="Crystal Deposit",
        role="stamp", width=768, height=768,
        prompt=(
            "Photorealistic seamless top-down texture of mineral crystal deposit, "
            "orthographic view, large crystalline formations growing from cave-like surface, "
            "translucent crystal clusters in white and pale blue, geometric crystal faces, "
            "tileable stamp texture."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="stamp_iron_oxide_deposit",
        category="stamp_variety", label="Iron Oxide Deposit",
        role="stamp", width=512, height=512,
        prompt=(
            "Ultra-realistic seamless top-down texture of concentrated iron oxide deposit, "
            "orthographic view, deep rust-red and orange iron mineral concentration, "
            "banded iron formation, metallic luster patches, tileable small stamp."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="stamp_sulfur_deposit",
        category="stamp_variety", label="Sulfur Deposit",
        role="stamp", width=512, height=512,
        prompt=(
            "Photorealistic seamless top-down texture of native sulfur deposit, "
            "orthographic view, bright yellow crystalline sulfur crust, "
            "fumarolic sublimate patterns, vivid yellow palette, tileable small stamp."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="stamp_permafrost_polygon",
        category="stamp_variety", label="Permafrost Polygons",
        role="stamp", width=1024, height=1024,
        prompt=(
            "Ultra-realistic seamless top-down texture of permafrost polygon terrain, "
            "orthographic view, regular polygonal patterns formed by frost weathering, "
            "raised polygon edges with troughs between, periglacial patterned ground, "
            "brown soil and pale frost, tileable stamp."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="stamp_mud_volcano",
        category="stamp_variety", label="Mud Volcano",
        role="stamp", width=768, height=768,
        prompt=(
            "Photorealistic seamless top-down texture of a mud volcano, "
            "orthographic view, small circular mound with central crater, "
            "radiating mud flow lobes, dark gray-brown mud deposits, "
            "tileable stamp texture."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="stamp_hoodoo_terrain",
        category="stamp_variety", label="Hoodoo Rock Towers",
        role="stamp", width=1024, height=1024,
        prompt=(
            "Ultra-realistic seamless top-down texture of hoodoo rock tower terrain, "
            "orthographic view, tall narrow rock pillars with resistant cap rocks, "
            "eroded sedimentary layers, clustered spire formations, "
            "warm desert palette of tan and rust, tileable stamp."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="stamp_salt_dome",
        category="stamp_variety", label="Salt Dome Intrusion",
        role="stamp", width=768, height=768,
        prompt=(
            "Photorealistic seamless top-down texture of a salt dome intrusion, "
            "orthographic view, circular bright white salt intrusion through darker sediments, "
            "concentric rings of displaced strata, mineral deposits at margins, tileable."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="stamp_pillow_basalt",
        category="stamp_variety", label="Pillow Basalt",
        role="stamp", width=768, height=768,
        prompt=(
            "Ultra-realistic seamless top-down texture of pillow basalt formation, "
            "orthographic view, rounded bulbous lava pillows formed by underwater eruption, "
            "dark gray-green basalt with glassy rims, packed pillow shapes, tileable stamp."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="stamp_impact_glass_field",
        category="stamp_variety", label="Impact Glass Strewn Field",
        role="stamp", width=512, height=512,
        prompt=(
            "Photorealistic seamless top-down texture of impact glass tektite strewn field, "
            "orthographic view, scattered dark glassy impact debris on lighter soil, "
            "splatter-shaped glass fragments, tileable small stamp."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="stamp_wind_streak",
        category="stamp_variety", label="Wind Streak Pattern",
        role="stamp", width=1024, height=512,
        prompt=(
            "Ultra-realistic seamless top-down texture of wind tail streak behind obstacle, "
            "orthographic view, dark streak extending downwind from a crater or rock, "
            "Mars-like aeolian streak on dusty terrain, elongated pattern, tileable stamp."
        ),
        negative=SHARED_NEGATIVE,
    ),
]


# ═══════════════════════════════════════════════════════════
#  RE-TAGGED ORIGINAL v1 PROMPTS (with role annotations)
#  Imported from prompt_catalog.py — preserved as stamps
# ═══════════════════════════════════════════════════════════
#  (We re-import AllV1 from prompt_catalog at the bottom)
# ═══════════════════════════════════════════════════════════


# ═══════════════════════════════════════════════════════════
#  MASTER CATALOG — ALL v2 prompts
# ═══════════════════════════════════════════════════════════

ALL_NEW_PROMPTS: list[TexturePrompt] = (
    ALL_BASE_PROMPTS +
    CLOUD_PROMPTS +
    LIQUID_PROMPTS +
    TRANSITION_PROMPTS +
    STAMP_CRATER_PROMPTS +
    STAMP_VOLCANIC_PROMPTS +
    STAMP_TECTONIC_PROMPTS +
    STAMP_EROSION_PROMPTS +
    STAMP_ICE_PROMPTS +
    STAMP_DESERT_PROMPTS +
    STAMP_OCEAN_PROMPTS +
    STAMP_SPECIAL_PROMPTS +
    STAMP_VARIETY_PROMPTS
)

# ── Import existing v1 prompts and add to combined list ──
try:
    from prompt_catalog import ALL_PROMPTS as V1_PROMPTS
    # Re-tag v1 prompts as stamps (they all have 1200×1200 and work as detail patches)
    V1_AS_STAMPS: list[TexturePrompt] = []
    for p in V1_PROMPTS:
        V1_AS_STAMPS.append(TexturePrompt(
            ewocs_id=p.ewocs_id,
            category=p.category,
            label=p.label,
            prompt=p.prompt,
            negative=p.negative,
            width=p.width,
            height=p.height,
            style=p.style,
            notes=p.notes,
            role="stamp",
        ))
except ImportError:
    V1_AS_STAMPS = []

ALL_PROMPTS_V2: list[TexturePrompt] = ALL_NEW_PROMPTS + V1_AS_STAMPS


def get_prompt_by_id(ewocs_id: str) -> TexturePrompt | None:
    """Look up a prompt by its EWoCS ID."""
    for p in ALL_PROMPTS_V2:
        if p.ewocs_id == ewocs_id:
            return p
    return None


def list_all_ids() -> list[str]:
    return [p.ewocs_id for p in ALL_PROMPTS_V2]


def list_by_role(role: str) -> list[TexturePrompt]:
    return [p for p in ALL_PROMPTS_V2 if p.role == role]


def list_new_only() -> list[TexturePrompt]:
    return ALL_NEW_PROMPTS


def export_prompts_json(filepath: str = "prompts_catalog_v2.json") -> None:
    import json
    data = []
    for p in ALL_PROMPTS_V2:
        data.append({
            "id": p.ewocs_id,
            "category": p.category,
            "label": p.label,
            "role": p.role,
            "prompt": p.prompt,
            "negative": p.negative,
            "resolution": f"{p.width}x{p.height}",
            "style": p.style,
            "notes": p.notes,
        })
    with open(filepath, "w") as f:
        json.dump(data, f, indent=2)
    print(f"Exported {len(data)} prompts to {filepath}")


if __name__ == "__main__":
    print(f"v2 Prompt Catalog Summary:")
    print(f"  New prompts:    {len(ALL_NEW_PROMPTS)}")
    print(f"  v1 re-tagged:   {len(V1_AS_STAMPS)}")
    print(f"  Total combined: {len(ALL_PROMPTS_V2)}")
    print()
    roles = {}
    for p in ALL_PROMPTS_V2:
        roles[p.role] = roles.get(p.role, 0) + 1
    for r, c in sorted(roles.items()):
        print(f"  {r:12s}: {c}")
    print()
    sizes = {}
    for p in ALL_PROMPTS_V2:
        key = f"{p.width}x{p.height}"
        sizes[key] = sizes.get(key, 0) + 1
    for s, c in sorted(sizes.items()):
        print(f"  {s:12s}: {c}")
