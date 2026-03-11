"""
EWoCS Planet Texture Prompt Catalog
====================================
Regional surface texture prompts for Leonardo AI (Lucid Origin model).
Each prompt produces a seamless top-down orthographic terrain tile,
NOT a full-planet scene.

Prompts sourced from curated EWoCS terrain descriptions.
"""

from dataclasses import dataclass
from typing import Optional

@dataclass
class TexturePrompt:
    """A single texture generation prompt for one planet visual type."""
    ewocs_id: str           # e.g. 'basaltic_cratered_moon'
    category: str           # 'cratered', 'volcanic', 'desert'
    label: str              # human readable name
    prompt: str             # Leonardo AI prompt text
    negative: str = ""      # negative prompt
    width: int = 1200       # square texture tile
    height: int = 1200      # square texture tile
    style: str = "DYNAMIC"  # Leonardo style preset
    notes: str = ""         # any notes about this prompt


# ═══════════════════════════════════════════════════════════
#  NEGATIVE PROMPT (shared across all planet textures)
# ═══════════════════════════════════════════════════════════
SHARED_NEGATIVE = (
    "text, watermark, logo, border, frame, human, person, face, "
    "cartoon, anime, low quality, blurry, jpeg artifacts, "
    "3d render, CGI look, grid lines, seams visible, black bars, "
    "full planet, globe, sphere, space scene, stars, horizon, atmosphere glow"
)

# ═══════════════════════════════════════════════════════════
#  CRATERED TERRAIN TEXTURES
# ═══════════════════════════════════════════════════════════
CRATERED_PROMPTS: list[TexturePrompt] = [
    TexturePrompt(
        ewocs_id="basaltic_cratered_moon",
        category="cratered",
        label="Basaltic Cratered Moon",
        prompt=(
            "Ultra-realistic seamless planetary terrain texture, top-down orthographic view, "
            "tileable surface map of an ancient airless basaltic moon, extremely high crater "
            "density from billions of years of impacts, overlapping craters at many scales from "
            "micro-pitting to broad degraded basins, crater rims softened by deep powdery "
            "regolith, occasional sharp younger impacts with brighter ejecta halos, subtle "
            "radial ray remnants, dark charcoal-gray basaltic fines with cool ash-gray variation, "
            "sparse angular boulder scatter around fresher rims, faint compression ridges and "
            "fractured crater floors, extremely low erosion, no water, no atmosphere, no "
            "vegetation, scientifically plausible lunar-style surface, strong emphasis on crater "
            "count, regolith grain, ejecta morphology, and realistic mineral color restraint, "
            "neutral overhead lighting, seamless tileable texture only, not a full planet render."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="ancient_lunar_highlands",
        category="cratered",
        label="Ancient Lunar Highlands",
        prompt=(
            "Ultra-realistic seamless terrain texture, top-down orthographic, tileable surface "
            "of old anorthositic lunar highlands, very dense small and medium crater population, "
            "numerous overlapping degraded craters creating saturated impact texture, rough "
            "elevated crust with bright pale-gray feldspathic regolith, subtle off-white to "
            "bluish-gray mineral variation, isolated darker basaltic contamination in low "
            "pockets, softened ejecta blankets from extreme age, abundant micro-cratering "
            "across the entire tile, occasional blocky uplifted crater walls, highly mature "
            "regolith with dusty texture and almost no erosional smoothing, vacuum-exposed, "
            "airless, ancient battered highland terrain, emphasis on crater saturation, bright "
            "highland composition, and powdery impact gardening texture, seamless tileable map "
            "with neutral overhead lighting."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="fresh_impact_crater_field",
        category="cratered",
        label="Fresh Impact Crater Field",
        prompt=(
            "Photorealistic seamless planetary terrain texture, top-down orthographic, tileable "
            "impact field dominated by young fresh craters on a dry rocky airless world, lower "
            "background crater density but many crisp recent impacts with razor-sharp rims, "
            "bright ejecta aprons, radial streak systems, secondary crater chains, broken "
            "shattered bedrock plates, rough debris fans and angular impact blocks, strong "
            "textural contrast between mature dusty ground and newly excavated brighter "
            "subsurface material, color palette of medium gray silicate dust, pale ejecta, and "
            "slightly darker exposed substrate, scientifically plausible impact mechanics "
            "emphasized, fresh energetic morphology, highly readable ejecta rays and rim "
            "sharpness, realistic texture-only output for terrain generation."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="mercury_hollow_terrain",
        category="cratered",
        label="Mercury Hollow Terrain",
        prompt=(
            "Ultra-detailed seamless top-down planetary texture of a Mercury-like cratered "
            "surface featuring shallow irregular bright hollows etched into darker impact "
            "materials, dense cratered rocky terrain with sun-baked regolith, sharp and softened "
            "craters mixed together, hollow clusters inside crater floors and central peaks, "
            "bright bluish-pale volatile-loss patches contrasting with warm brown-gray and "
            "charcoal silicate bedrock, subtle lobate scarps from crustal contraction, airless "
            "and extremely dry, no erosion except impact gardening, fine granular regolith "
            "between craters, fractured heat-stressed rock, emphasis on unusual hollow "
            "morphology, cratered metal-rich rocky plains, muted but distinct color variation, "
            "seamless tileable orthographic texture for scientific planetary use."
        ),
        negative=SHARED_NEGATIVE,
    ),
]

# ═══════════════════════════════════════════════════════════
#  VOLCANIC TERRAIN TEXTURES
# ═══════════════════════════════════════════════════════════
VOLCANIC_PROMPTS: list[TexturePrompt] = [
    TexturePrompt(
        ewocs_id="basalt_lava_plains",
        category="volcanic",
        label="Basalt Lava Plains",
        prompt=(
            "Ultra-realistic seamless tileable terrain texture, top-down orthographic view of "
            "broad basaltic volcanic plains on a rocky planet or moon, extensive cooled lava "
            "sheets with subtle overlapping flow lobes, low shield-like swells, wrinkle ridges, "
            "pressure ridges, fine contraction cracking and faint ropey pahoehoe textures in "
            "places, dark charcoal to iron-gray color palette with minor rusty oxidation hints, "
            "low crater density relative to surrounding terrain but scattered superposed impacts, "
            "occasional lava breakout textures and smooth basalt flood surfaces, very dry, no "
            "vegetation, no visible atmosphere effects, emphasis on hardened volcanic material "
            "texture, flow directionality, and realistic basalt mineral coloration, high-resolution "
            "texture map designed for seamless planetary tiling."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="ropy_pahoehoe_lava",
        category="volcanic",
        label="Ropy Pahoehoe Lava",
        prompt=(
            "Photorealistic seamless top-down terrain texture of fresh-to-moderately-weathered "
            "pahoehoe lava, strongly detailed ropey flow folds, billowed crustal surfaces, "
            "smooth curving lava skins, small pressure tumuli, narrow cooling cracks, occasional "
            "collapsed lava toes, dark obsidian-black to deep graphite-gray volcanic rock with "
            "slight reddish-brown oxidation along cracks, minimal dust cover, low crater count, "
            "highly material-driven surface with realistic igneous microtexture, no water, no "
            "plants, no atmospheric haze, designed as a tileable lava-field texture emphasizing "
            "tactile hardened flow geometry and subtle color variation in basaltic volcanic crust."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="lava_world_magma_crust",
        category="volcanic",
        label="Lava World Magma Crust",
        prompt=(
            "Ultra-realistic seamless planetary terrain texture, top-down orthographic tileable "
            "map of an ultra-hot lava world surface, fragmented dark basaltic crust plates "
            "floating over glowing molten seams, extensive thermal cracking, incandescent "
            "fissure networks, jagged crust rafts, scorched mineral crust with black, gunmetal, "
            "dark maroon, and orange-red molten accents, very low impact count due to frequent "
            "resurfacing, localized sulfurous staining or metallic vapor deposition near hotter "
            "fractures, aggressive heat-fracture texture, no water, no atmosphere visible at "
            "surface scale, emphasize realism in crust breakup, temperature gradients, and "
            "partially molten surface behavior, suitable for procedural extreme volcanic planet "
            "terrain."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="volcanic_shield_plains",
        category="volcanic",
        label="Volcanic Shield Plains",
        prompt=(
            "Seamless ultra-detailed top-down texture of a shield-volcanic plain, broad gently "
            "sloping basalt terrain with overlapping low-relief lava flows, subtle vent chains, "
            "collapse pits, lava tubes implied by sinuous surface ridges and skylight "
            "depressions, moderate crater count partly buried by younger volcanism, dark gray to "
            "black basalt with some oxidized brown-red streaking, dusty ash accumulation in low "
            "areas, realistic volcanic resurfacing patterns, emphasis on shield-plain smoothness "
            "interrupted by vents, fractures, and buried flow boundaries, photorealistic geology "
            "texture, neutral lighting, tileable surface map for planetary rendering."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="io_sulfur_volcanic_plains",
        category="volcanic",
        label="Io Sulfur Volcanic Plains",
        prompt=(
            "Ultra-realistic seamless top-down texture of a tidally heated sulfurous volcanic "
            "moon, intensely alien but scientifically grounded, low crater count due to constant "
            "resurfacing, mottled plains of sulfur yellow, burnt orange, black basaltic patches, "
            "and pale frost deposits, irregular volcanic paterae margins, flow fronts of dark "
            "silicate lava mixed with sulfur condensates, vent fallout stains, chaotic plume "
            "deposit halos, crust fractured by constant thermal and tidal stress, very dry and "
            "airless appearance, powdery sulfur textures mixed with dense volcanic crust, "
            "emphasis on color realism for sulfur allotropes and volcanic resurfacing complexity, "
            "tileable orthographic terrain texture only."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="sulfur_vent_fields",
        category="volcanic",
        label="Sulfur Vent Fields",
        prompt=(
            "Photorealistic seamless planetary terrain texture, top-down orthographic view of "
            "sulfur-rich geothermal vent terrain, cracked volcanic ground coated in mineral "
            "sublimates, dense patchwork of bright yellow sulfur crust, ochre deposits, black "
            "scorched basalt, pale fumarole halos, vent-ring fracturing and brittle crust "
            "breakup, irregular steam-vent residue patterns implied through mineral staining "
            "rather than visible plumes, moderate small-crater overprint possible if on older "
            "terrain, sharp chemical contrast but still realistic natural mineral colors, "
            "emphasis on sulfur crystal crust texture, chemical deposition patterns, and "
            "geothermal fracture morphology, seamless tileable map."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="ash_covered_lava_plateau",
        category="volcanic",
        label="Ash Covered Lava Plateau",
        prompt=(
            "Ultra-realistic seamless top-down texture of a volcanic plateau blanketed in fine "
            "ash, hardened basalt underlayer partially obscured by soft gray ash drifts, subdued "
            "surface roughness, buried flow textures, fine powder accumulation in cracks and "
            "depressions, sparse vent fragments and lapilli-rich patches, muted palette of cool "
            "gray, charcoal, dusty taupe, and faint oxidized reddish-brown tones, moderate "
            "erosion by wind if atmosphere is thin or absent if airless, crater density low to "
            "moderate depending on resurfacing age, strong emphasis on ash grain texture, soft "
            "mantling over rough volcanic substrate, realistic volcanic sediment cover in a "
            "tileable orthographic terrain map."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="cooling_lava_crust",
        category="volcanic",
        label="Cooling Lava Crust",
        prompt=(
            "Seamless top-down planetary terrain texture of recently solidified lava crust "
            "transitioning from hot to cold, cracked polygonal cooling plates, glowing seams "
            "mostly dimmed to deep red-orange in narrow fractures, black glassy crust edges, "
            "vesicular rock textures in places, flow-skin wrinkling, sparse ash dusting, "
            "minimal impact count, strong textural focus on brittle thermal contraction and "
            "partially quenched volcanic surfaces, realistic obsidian-black and dark iron-gray "
            "palette with restrained residual incandescence, designed as a tileable ground "
            "texture rather than a cinematic scene, highly material-specific and geologically "
            "plausible."
        ),
        negative=SHARED_NEGATIVE,
    ),
]

# ═══════════════════════════════════════════════════════════
#  DESERT TERRAIN TEXTURES
# ═══════════════════════════════════════════════════════════
DESERT_PROMPTS: list[TexturePrompt] = [
    TexturePrompt(
        ewocs_id="desert_dune_planet",
        category="desert",
        label="Desert Dune Planet",
        prompt=(
            "Ultra-realistic seamless top-down orthographic texture of a vast arid dune sea on "
            "a dry desert planet, dense fields of crescentic and linear dunes, fine aeolian "
            "ripples between larger crests, soft slip faces, interdune flats with compacted "
            "dust, color palette of pale tan, amber, ochre, and muted rusty-brown depending on "
            "mineral content, very low crater retention where dunes are active, occasional "
            "partially buried small impacts, strong wind-shaping evident across entire terrain, "
            "emphasis on sand grain texture, dune spacing, ripple scale hierarchy, and realistic "
            "desert sediment coloration, tileable planetary terrain map with neutral light and "
            "no atmospheric horizon."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="megadune_desert",
        category="desert",
        label="Megadune Desert",
        prompt=(
            "Photorealistic seamless terrain texture, top-down orthographic, tileable surface "
            "of giant planetary megadunes, very large sweeping dune ridges with clear slip-face "
            "asymmetry, broad troughs, secondary ripple fields superimposed on major forms, "
            "some dune crest bifurcation, underlying bedrock almost entirely buried, color "
            "palette slightly darker and more iron-rich than ordinary dune seas with deep amber, "
            "cinnamon, and dusty brown tones, hyper-arid appearance, almost no crater "
            "preservation, emphasis on large-scale aeolian morphology, sediment transport "
            "realism, and fine-to-coarse dune hierarchy, suitable for procedural desert world "
            "generation."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="rocky_desert_plateau",
        category="desert",
        label="Rocky Desert Plateau",
        prompt=(
            "Ultra-detailed seamless top-down planetary texture of a rocky desert plateau, "
            "fractured sandstone and basalt outcrop mosaic, wind-scoured bedrock, gravelly lag "
            "surfaces, scattered talus and dust pockets, low-to-moderate small crater or impact "
            "pitting if on an older thin-atmosphere world, dry wash channels faintly etched, "
            "palette of warm brown, rust, tan, muted red, and gray stone, textures emphasizing "
            "erosion-resistant slabs, cracked rock faces, and dust accumulation in joints, "
            "realistic arid geology rather than stylized fantasy desert, tileable orthographic "
            "surface map for planetary terrain systems."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="wind_carved_yardangs",
        category="desert",
        label="Wind Carved Yardangs",
        prompt=(
            "Ultra-realistic seamless top-down orthographic texture of yardang terrain sculpted "
            "by persistent abrasive winds, elongated streamlined ridges aligned in one "
            "prevailing direction, intervening troughs filled with dust and fine sediment, "
            "exposed bedrock with alternating hard and soft layers, minimal crater preservation "
            "due to active erosion, muted palette of tan, dusty brown, pale ochre, and gray "
            "sedimentary rock, strong emphasis on directional erosional morphology, ridge "
            "spacing, abrasion texture, and realistic desert aeolian carving, seamless tileable "
            "terrain prompt for thin-atmosphere or ancient dry worlds."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="salt_flat_planet",
        category="desert",
        label="Salt Flat Planet",
        prompt=(
            "Photorealistic seamless top-down planetary terrain texture of a broad evaporitic "
            "salt flat, polygonal desiccation and crystallization patterns across a nearly level "
            "surface, hard bright crust with subtle thickness variations, fine fracture lines, "
            "occasional salt ridges and shallow mineral basins, minimal crater preservation "
            "unless very old and inactive, color palette of off-white, chalk white, pale beige, "
            "faint gray, and occasional rusty or greenish mineral impurities, intense dryness, "
            "highly reflective mineral surface but without glare, emphasis on crystalline crust "
            "texture, polygon scale variation, and realistic evaporite morphology, tileable "
            "orthographic texture only."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="evaporite_basin",
        category="desert",
        label="Evaporite Basin",
        prompt=(
            "Ultra-detailed seamless top-down texture of an ancient evaporite basin on a dry "
            "planet, layered mineral crusts, patchy salt polygons, gypsum-like pale streaks, "
            "muddy desiccation zones, basin-floor deposition textures, subtle shoreline mineral "
            "banding remnants, color palette of cream, white, pale yellow, dusty beige, and "
            "muted iron-red sediment stains, low relief but high material complexity, moderate "
            "erosion and occasional buried micro-craters depending on age, emphasis on "
            "depositional chemistry, crack patterns, and mineralogical texture realism in a "
            "tileable planetary surface map."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="dry_lakebed_terrain",
        category="desert",
        label="Dry Lakebed Terrain",
        prompt=(
            "Ultra-realistic seamless orthographic terrain texture of a desiccated lakebed, "
            "cracked clay-rich sediment with polygonal mud plates, fine silt veneers, salt "
            "traces in low zones, shallow curled crust edges, faint old drainage or shoreline "
            "traces, warm beige, taupe, dusty gray, and pale brown palette with occasional "
            "white evaporite residue, very low crater count if atmospherically active, emphasis "
            "on sediment shrinkage texture, brittle surface skin, and natural desiccation "
            "geometry, seamless top-down texture for arid planetary basins."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="dust_storm_desert_surface",
        category="desert",
        label="Dust Storm Desert Surface",
        prompt=(
            "Photorealistic seamless top-down texture of a dust-dominated desert planet surface, "
            "fine powder mantling over bedrock and low dunes, dust devil streak traces, "
            "ripple-smoothed sediment, muted iron-oxide red-brown and tan coloration, low "
            "contrast due to widespread fine dust cover, occasional exposed darker rocks peeking "
            "through, small crater forms partly infilled, strong emphasis on soft dust texture, "
            "aeolian streaking, and suspended-sediment deposition history translated into "
            "surface pattern, realistic Mars-like or hyper-arid planetary terrain, tileable "
            "orthographic texture."
        ),
        negative=SHARED_NEGATIVE,
    ),
]

# ═══════════════════════════════════════════════════════════
#  ICE / CRYOGENIC TERRAIN TEXTURES (batch 2a)
# ═══════════════════════════════════════════════════════════
ICE_PROMPTS: list[TexturePrompt] = [
    TexturePrompt(
        ewocs_id="glacial_ice_sheet",
        category="ice",
        label="Glacial Ice Sheet",
        prompt=(
            "Ultra-realistic seamless planetary terrain texture, top-down orthographic view, "
            "tileable surface of a vast glacial ice sheet on a frozen planet, thick compacted "
            "water ice with subtle flow banding, smooth wind-polished surfaces alternating with "
            "rougher fractured ice zones, long crevasse fields forming branching crack networks, "
            "pale blue-white coloration with deeper turquoise hints where ice is thick and "
            "compressed, scattered snow-drift accumulation patterns, extremely low crater "
            "density where ice flow has erased impacts, occasional exposed rocky inclusions "
            "embedded in ice, emphasis on crystalline ice texture, pressure flow structures, and "
            "glacial stress fractures, neutral overhead lighting, highly realistic cryogenic "
            "terrain map."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="crevasse_ice_field",
        category="ice",
        label="Crevasse Ice Field",
        prompt=(
            "Photorealistic seamless top-down planetary terrain texture of a heavily fractured "
            "glacier or ice sheet surface, dense networks of deep crevasses cutting through "
            "compact blue ice, long parallel fractures and chaotic intersections, jagged broken "
            "ice blocks between gaps, snow accumulation along crevasse edges, subtle shading "
            "from ice translucency rather than lighting direction, palette of pale blue, white, "
            "and faint gray with darker blue depths in crack openings, extremely detailed ice "
            "fracture geometry and brittle cryogenic crust texture, designed as a tileable "
            "orthographic terrain texture emphasizing glacial stress patterns."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="polar_ice_cap_terrain",
        category="ice",
        label="Polar Ice Cap Terrain",
        prompt=(
            "Ultra-realistic seamless top-down texture of a planetary polar ice cap, thick "
            "layered ice dome surface with wind-carved snow ridges, radial fracture lines from "
            "thermal stress, compressed ice flow bands moving outward from center, scattered "
            "frost deposits and sublimation pits, palette of bright white, pale cyan, and faint "
            "gray-blue shadows within ice structures, very low crater preservation due to ice "
            "deposition cycles, emphasis on layered cryosphere structure and wind-sculpted snow "
            "textures, seamless tileable map suitable for polar planetary terrain."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="blue_ice_plains",
        category="ice",
        label="Blue Ice Plains",
        prompt=(
            "Photorealistic seamless top-down terrain texture of exposed blue glacial ice "
            "plains, extremely smooth wind-scoured ice with glossy compacted surfaces, faint "
            "shallow fractures and pressure lines, occasional darker inclusions of trapped dust, "
            "brilliant cyan and pale blue coloration typical of compressed bubble-free ice, "
            "minimal snow cover, almost no surface roughness except subtle stress cracks, "
            "extremely clean frozen surface emphasizing crystalline ice grain and compression "
            "patterns, seamless orthographic planetary texture designed for high-latitude ice "
            "worlds."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="cryovolcanic_ice_moon",
        category="ice",
        label="Cryovolcanic Ice Moon",
        prompt=(
            "Ultra-detailed seamless top-down terrain texture of an icy moon with cryovolcanic "
            "resurfacing, fractured ice crust with branching fissures radiating from vent zones, "
            "smooth frozen cryolava plains where water-ammonia mixtures have refrozen, irregular "
            "ridges formed by tidal stress, pale blue and white coloration with faint gray "
            "mineral contamination, moderate small crater density where resurfacing is "
            "incomplete, crystalline frost accumulation near fissures, emphasis on brittle ice "
            "crust morphology and cryovolcanic flow patterns, tileable orthographic planetary "
            "terrain texture."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="europa_chaos_terrain",
        category="ice",
        label="Europa Chaos Terrain",
        prompt=(
            "Photorealistic seamless planetary terrain texture of Europa-style chaos terrain, "
            "broken ice rafts and rotated crustal blocks embedded in partially refrozen ice "
            "matrix, complex fracture networks, irregular polygonal ice slabs of varying "
            "orientation, thin dark linear bands marking subsurface ocean upwelling fractures, "
            "color palette of pale blue ice with reddish-brown salt staining along cracks, very "
            "low crater density due to active resurfacing, emphasis on chaotic ice plate "
            "geometry and stress fracture textures, seamless top-down tileable cryogenic terrain "
            "map."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="enceladus_tiger_stripes",
        category="ice",
        label="Enceladus Tiger Stripes",
        prompt=(
            "Ultra-realistic seamless top-down terrain texture of active cryovolcanic fracture "
            "belts, long parallel fissures across a bright icy crust, narrow dark fracture "
            "lines surrounded by fresh frost deposits, subtle ridges where crust has been "
            "uplifted along cracks, extremely bright white ice surfaces reflecting fresh plume "
            "fallout, near absence of craters due to ongoing resurfacing, slight bluish tint "
            "from pure water ice crystals, emphasis on linear fracture morphology and "
            "plume-deposited frost textures, tileable orthographic ice moon terrain."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="subglacial_ocean_ice_shell",
        category="ice",
        label="Subglacial Ocean Ice Shell",
        prompt=(
            "Photorealistic seamless top-down planetary terrain texture of a thick ice shell "
            "above a subsurface ocean, broad smooth ice plains interrupted by pressure ridges "
            "and thermal fracture lines, ice plates gently shifting and colliding creating "
            "irregular raised ridges, occasional cryovolcanic vent scars, pale blue-white "
            "coloration with faint mineral streaking, moderate micro-fracture density from tidal "
            "flexing, emphasis on slow-moving ice tectonics and frozen ocean crust texture, "
            "seamless tileable orthographic surface map."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="fractured_ice_shelf",
        category="ice",
        label="Fractured Ice Shelf",
        prompt=(
            "Ultra-detailed seamless terrain texture of a planetary ice shelf floating above "
            "ocean water, top-down orthographic perspective showing long tension cracks, "
            "floating ice plates separated by narrow fracture seams, pressure ridges and jagged "
            "ice boundaries, snow dusting across surfaces, pale white and light blue palette "
            "with darker seams indicating thinner ice, subtle polygonal stress fields across "
            "the shelf, emphasis on floating ice mechanics and brittle fracture geometry, "
            "tileable cryogenic terrain map."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="ammonia_ice_plains",
        category="ice",
        label="Ammonia Ice Plains",
        prompt=(
            "Photorealistic seamless top-down planetary terrain texture of ammonia-rich ice "
            "plains on a cryogenic world, smooth frozen surface with soft granular frost "
            "texture, occasional shallow pits from sublimation, muted bluish-white and pale "
            "lavender tones characteristic of ammonia-water mixtures, very low crater density "
            "where frost accumulation buries impacts, faint fracture lines across brittle "
            "crust, emphasis on soft cryogenic ice materials and subtle sublimation textures, "
            "seamless orthographic terrain texture."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="nitrogen_ice_glacier",
        category="ice",
        label="Nitrogen Ice Glacier",
        prompt=(
            "Ultra-realistic seamless planetary terrain texture of slow-flowing nitrogen ice "
            "glaciers similar to Pluto's Sputnik Planitia, polygonal convection cells across "
            "the ice surface, smooth flow boundaries between cells, shallow troughs where ice "
            "circulates downward, pale cream, white, and faint pink coloration caused by tholin "
            "contamination, almost no visible craters due to convective resurfacing, emphasis "
            "on cellular ice convection patterns and cryogenic glacier morphology, tileable "
            "orthographic map."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="methane_ice_plains",
        category="ice",
        label="Methane Ice Plains",
        prompt=(
            "Photorealistic seamless top-down texture of methane frost plains on a frigid "
            "outer-system world, smooth icy crust covered with granular methane frost deposits, "
            "faint wind-sculpted ridges and soft sublimation pits, pale ivory to faint "
            "yellow-white coloration typical of frozen hydrocarbons, extremely low crater "
            "retention due to frost cycling, delicate crystalline surface texture emphasizing "
            "cryogenic volatile deposition, seamless tileable terrain texture."
        ),
        negative=SHARED_NEGATIVE,
    ),
]

# ═══════════════════════════════════════════════════════════
#  HYDROCARBON TERRAIN TEXTURES (batch 2b)
# ═══════════════════════════════════════════════════════════
HYDROCARBON_PROMPTS: list[TexturePrompt] = [
    TexturePrompt(
        ewocs_id="titan_hydrocarbon_dunes",
        category="hydrocarbon",
        label="Titan Hydrocarbon Dunes",
        prompt=(
            "Ultra-realistic seamless top-down planetary terrain texture of hydrocarbon sand "
            "dunes similar to Titan, large parallel dune ridges composed of organic particles, "
            "smooth slip faces, dark brown and charcoal coloration from complex hydrocarbons, "
            "subtle wind ripple textures between dunes, extremely low crater density due to "
            "constant sediment transport, palette of dark amber, brown, and near-black organic "
            "sands, emphasis on organic sediment texture and aeolian dune morphology, tileable "
            "orthographic terrain."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="methane_hydrocarbon_shores",
        category="hydrocarbon",
        label="Methane Hydrocarbon Shores",
        prompt=(
            "Photorealistic seamless top-down terrain texture of methane lake shoreline, smooth "
            "liquid hydrocarbon surface transitioning into frozen organic sediment beaches, wet "
            "dark shoreline bands where liquids saturate the ground, faint wave-smoothed "
            "margins, tar-like sediment textures in deep brown and black hues, subtle "
            "crystalline frost deposits farther inland, emphasis on alien hydrocarbon coastal "
            "geomorphology and organic sediment coloration, seamless tileable map."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="hydrocarbon_lake_shore",
        category="hydrocarbon",
        label="Hydrocarbon Lake Shore",
        prompt=(
            "Ultra-realistic seamless top-down planetary terrain texture of a shallow "
            "hydrocarbon lake edge, smooth dark reflective liquid areas blending into muddy "
            "organic sediments, soft ripple marks from gentle winds, deposits of complex "
            "organic particles forming irregular shoreline bands, muted palette of black, dark "
            "brown, amber, and faint reddish organic compounds, extremely smooth terrain due to "
            "liquid smoothing, emphasis on shoreline sediment transitions and hydrocarbon "
            "material realism."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="tar_sand_plains",
        category="hydrocarbon",
        label="Tar Sand Plains",
        prompt=(
            "Photorealistic seamless top-down terrain texture of thick hydrocarbon tar sand "
            "deposits, sticky dark sediments interspersed with granular organic particles, "
            "cracked tar surfaces and small viscous flow ridges, deep brown to black coloration "
            "with occasional amber highlights, minimal crater preservation as viscous materials "
            "slowly deform, emphasis on organic sediment textures and alien hydrocarbon geology, "
            "tileable orthographic terrain surface."
        ),
        negative=SHARED_NEGATIVE,
    ),
]

# ═══════════════════════════════════════════════════════════
#  OCEAN / SEAFLOOR TERRAIN TEXTURES (batch 2c)
# ═══════════════════════════════════════════════════════════
OCEAN_PROMPTS: list[TexturePrompt] = [
    TexturePrompt(
        ewocs_id="ocean_world_shallow_shelf",
        category="ocean",
        label="Ocean World Shallow Shelf",
        prompt=(
            "Ultra-realistic seamless top-down planetary terrain texture of a shallow ocean "
            "shelf on a water world, submerged basalt bedrock visible beneath clear water "
            "layers, rippled sand sediments, scattered rocky outcrops and mineral growths, "
            "color palette of turquoise, teal, and pale sand tones, gentle underwater dune "
            "structures formed by currents, emphasis on seabed sediment texture and submerged "
            "geology rather than surface waves, tileable orthographic seafloor texture."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="coral_reef_shelf",
        category="ocean",
        label="Coral Reef Shelf",
        prompt=(
            "Photorealistic seamless top-down texture of a dense reef ecosystem on a shallow "
            "ocean world shelf, branching mineral reef structures resembling coral growth, "
            "patchy sand between reef clusters, bright turquoise shallow water coloration "
            "transitioning to deeper blue channels, organic texture complexity but still "
            "geological at macro scale, emphasis on reef structure density and seabed sediment "
            "variation, tileable orthographic terrain map."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="basalt_seafloor_ridge",
        category="ocean",
        label="Basalt Seafloor Ridge",
        prompt=(
            "Ultra-realistic seamless planetary terrain texture of a mid-ocean ridge seafloor, "
            "cracked basalt pillows formed by underwater lava eruptions, narrow ridge crest "
            "running across terrain, fractured volcanic rock and hydrothermal mineral staining, "
            "dark gray and deep blue-black basalt coloration with orange mineral deposits near "
            "vents, emphasis on pillow lava morphology and submarine volcanic geology, tileable "
            "top-down seafloor texture."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="deep_ocean_abyssal_plain",
        category="ocean",
        label="Deep Ocean Abyssal Plain",
        prompt=(
            "Photorealistic seamless top-down terrain texture of a deep ocean abyssal plain, "
            "extremely smooth fine sediment covering ancient basalt crust, occasional manganese "
            "nodules scattered across the surface, muted blue-gray and dark slate sediment "
            "colors, extremely low relief terrain, no visible currents at this scale, emphasis "
            "on soft marine sediment texture and subtle geological uniformity, seamless "
            "orthographic planetary seafloor map."
        ),
        negative=SHARED_NEGATIVE,
    ),
]

# ═══════════════════════════════════════════════════════════
#  TECTONIC TERRAIN TEXTURES (batch 3a)
# ═══════════════════════════════════════════════════════════
TECTONIC_PROMPTS: list[TexturePrompt] = [
    TexturePrompt(
        ewocs_id="tectonic_rift_zone",
        category="tectonic",
        label="Tectonic Rift Zone",
        prompt=(
            "Ultra-realistic seamless planetary terrain texture, top-down orthographic view, "
            "tileable map of an active tectonic rift valley, long linear fractures splitting "
            "the crust, steep fault scarps with collapsed blocks, volcanic basalt flows "
            "emerging from fissures, scattered young craters partly buried by lava, exposed "
            "mantle-colored rock along rift walls, dusty basalt plains between faults, color "
            "palette of dark gray basalt, rusty iron oxides, and pale dust sediments, emphasis "
            "on strong directional fracture patterns, crustal stretching morphology, and "
            "layered tectonic deformation textures."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="faulted_crust_terrain",
        category="tectonic",
        label="Faulted Crust Terrain",
        prompt=(
            "Photorealistic seamless top-down texture of heavily faulted planetary crust, "
            "intersecting fault lines creating offset rock blocks, fractured bedrock surfaces "
            "with narrow trenches and uplifted ridges, exposed stratified rock layers along "
            "scarps, scattered gravel and regolith pockets filling lower areas, muted color "
            "palette of gray stone, dusty tan sediments, and faint rust mineral streaks, "
            "emphasis on brittle crust deformation and sharp tectonic fracture textures, "
            "tileable orthographic geological terrain."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="folded_mountain_belt",
        category="tectonic",
        label="Folded Mountain Belt",
        prompt=(
            "Ultra-realistic seamless top-down terrain texture of a folded mountain belt "
            "created by continental compression, elongated ridges and valleys running parallel "
            "across the terrain, exposed layered rock strata folded into arcs and waves, rocky "
            "slopes and sediment-filled troughs between ridges, color palette of gray granite, "
            "brown sedimentary rock, and pale dust deposits, moderate erosion softening ridge "
            "edges, emphasis on ridge spacing, folded stratigraphy, and large-scale "
            "compressional geology."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="plate_boundary_scarps",
        category="tectonic",
        label="Plate Boundary Scarps",
        prompt=(
            "Photorealistic seamless orthographic planetary terrain texture of a major plate "
            "boundary scarp, abrupt cliffs and uplifted crust blocks, large fractures and "
            "broken bedrock slabs at the base of scarps, dusty talus deposits in valleys, "
            "exposed rock strata in varying tones of gray, tan, and rusty brown, sparse crater "
            "preservation due to tectonic resurfacing, emphasis on vertical displacement "
            "textures and brittle lithosphere fracture patterns."
        ),
        negative=SHARED_NEGATIVE,
    ),
]

# ═══════════════════════════════════════════════════════════
#  EROSION / WEATHERING TERRAIN TEXTURES (batch 3b)
# ═══════════════════════════════════════════════════════════
EROSION_PROMPTS: list[TexturePrompt] = [
    TexturePrompt(
        ewocs_id="continental_craton_terrain",
        category="erosion",
        label="Continental Craton Terrain",
        prompt=(
            "Ultra-realistic seamless top-down terrain texture of an ancient continental "
            "craton, extremely old stable crust with heavily weathered bedrock surfaces, "
            "scattered shallow basins, rounded hills, and sparse erosion channels, color "
            "palette of warm granite pinks, pale gray stone, and dusty soil, very low tectonic "
            "activity, moderate erosion smoothing ancient structures, emphasis on subtle relief "
            "and deeply weathered rock textures typical of stable continental interiors."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="granite_plateau_surface",
        category="erosion",
        label="Granite Plateau Surface",
        prompt=(
            "Photorealistic seamless top-down texture of exposed granite plateau terrain, "
            "broad slabs of cracked granite bedrock with polygonal fracture networks, sparse "
            "sediment accumulation in depressions, scattered boulder clusters from long-term "
            "weathering, pale gray and pink granite coloration with faint mineral streaks, "
            "extremely low crater density in atmospherically active worlds, emphasis on "
            "crystalline rock texture and weathered bedrock surfaces."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="eroded_highlands",
        category="erosion",
        label="Eroded Highlands",
        prompt=(
            "Ultra-realistic seamless top-down terrain texture of heavily eroded highland "
            "terrain, irregular hills and shallow valleys shaped by long-term weathering, "
            "exposed rock interspersed with soil deposits, drainage channels etched across "
            "slopes, color palette of gray stone, tan sediment, and occasional darker mineral "
            "patches, emphasis on natural erosion patterns, sediment transport textures, and "
            "mixed rocky-soil terrain."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="ancient_shield_terrain",
        category="erosion",
        label="Ancient Shield Terrain",
        prompt=(
            "Photorealistic seamless planetary terrain texture of an extremely ancient "
            "planetary shield region, worn-down bedrock surfaces with shallow impact basins "
            "partly eroded, scattered rock outcrops and regolith patches, subtle structural "
            "ridges from ancient tectonic events, muted palette of gray, brown, and pale green "
            "mineral weathering, emphasis on extremely old terrain morphology and gentle relief."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="plateau_canyon_terrain",
        category="erosion",
        label="Plateau Canyon Terrain",
        prompt=(
            "Ultra-realistic seamless top-down texture of canyon-carved plateau terrain, steep "
            "canyon walls cutting through flat rocky plateau surfaces, branching drainage "
            "networks forming intricate canyon systems, exposed sediment layers visible in "
            "canyon walls, warm tan and rust-red sedimentary rock palette, emphasis on "
            "erosion-driven landforms, canyon branching patterns, and layered geological strata."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="eroded_canyon_network",
        category="erosion",
        label="Eroded Canyon Network",
        prompt=(
            "Photorealistic seamless orthographic terrain texture of a vast canyon network "
            "carved by ancient water or erosion, narrow sinuous channels intersecting across "
            "rocky terrain, sediment deposits along channel floors, exposed rock ridges between "
            "valleys, palette of dusty tan sediment and darker exposed bedrock, emphasis on "
            "fluvial erosion geometry and branching drainage structures."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="sedimentary_layer_terrain",
        category="erosion",
        label="Sedimentary Layer Terrain",
        prompt=(
            "Ultra-realistic seamless planetary terrain texture of layered sedimentary rock "
            "plains, visible horizontal strata exposed across fractured rock surfaces, "
            "scattered erosion pits revealing deeper layers, soft sediment tones of tan, ochre, "
            "pale gray, and reddish mineral bands, moderate erosion shaping rock faces, "
            "emphasis on stratified geology and sediment deposition textures."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="mesa_plateau_fields",
        category="erosion",
        label="Mesa Plateau Fields",
        prompt=(
            "Photorealistic seamless top-down terrain texture of mesas and buttes scattered "
            "across a desert plateau, flat-topped rock mesas rising from eroded plains, cliff "
            "edges exposing layered sedimentary rock, scattered debris fans around mesa bases, "
            "warm desert tones of rust, tan, and brown rock, emphasis on plateau erosion and "
            "isolated mesa landforms."
        ),
        negative=SHARED_NEGATIVE,
    ),
]

# ═══════════════════════════════════════════════════════════
#  IMPACT TERRAIN TEXTURES (batch 3c)
# ═══════════════════════════════════════════════════════════
IMPACT_PROMPTS: list[TexturePrompt] = [
    TexturePrompt(
        ewocs_id="impact_melt_plains",
        category="impact",
        label="Impact Melt Plains",
        prompt=(
            "Ultra-realistic seamless orthographic terrain texture of impact melt plains "
            "formed after a large asteroid collision, smooth glassy rock surfaces interspersed "
            "with frozen lava-like flow patterns, scattered shattered rock debris and small "
            "secondary craters, dark gray and black glassified rock coloration with subtle "
            "metallic sheen, emphasis on impact melt textures and solidified shock-heated rock."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="glassified_impact_terrain",
        category="impact",
        label="Glassified Impact Terrain",
        prompt=(
            "Photorealistic seamless planetary terrain texture of glass-rich terrain created "
            "by intense meteor impacts, fractured obsidian-like rock plates, sharp angular "
            "shards embedded in dusty regolith, glossy black and deep gray coloration with "
            "occasional brown oxidized patches, moderate crater density with many fractured "
            "impact rims, emphasis on brittle glassy rock textures."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="shock_fractured_rock",
        category="impact",
        label="Shock Fractured Rock",
        prompt=(
            "Ultra-realistic seamless top-down terrain texture of rock heavily fractured by "
            "repeated meteor impacts, dense networks of cracks radiating from small craters, "
            "shattered rock plates with irregular edges, dusty regolith filling fracture gaps, "
            "palette of dark gray and pale ash-colored rock fragments, emphasis on impact shock "
            "deformation and fractured crust patterns."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="crater_ejecta_blanket",
        category="impact",
        label="Crater Ejecta Blanket",
        prompt=(
            "Photorealistic seamless terrain texture of a thick ejecta blanket surrounding a "
            "large impact basin, chaotic mix of rock fragments, radial debris streaks extending "
            "outward, hummocky terrain with scattered secondary craters, mixed color palette of "
            "darker excavated rock and lighter surface dust, emphasis on radial ejecta "
            "morphology and chaotic debris textures."
        ),
        negative=SHARED_NEGATIVE,
    ),
]

# ═══════════════════════════════════════════════════════════
#  VOLCANIC ARC TERRAIN TEXTURES (batch 3d)
# ═══════════════════════════════════════════════════════════
VOLCANIC_ARC_PROMPTS: list[TexturePrompt] = [
    TexturePrompt(
        ewocs_id="subduction_arc_volcano_terrain",
        category="volcanic_arc",
        label="Subduction Arc Volcano Terrain",
        prompt=(
            "Ultra-realistic seamless orthographic terrain texture of volcanic arc terrain "
            "along a subduction zone, clusters of volcanic cones and lava fields surrounded by "
            "ash-covered slopes, fractured crust between volcanoes, mixed basalt and andesite "
            "rock coloration, dark gray lava and reddish volcanic soils, emphasis on volcanic "
            "cluster distribution and tectonic arc structure."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="island_arc_volcanics",
        category="volcanic_arc",
        label="Island Arc Volcanics",
        prompt=(
            "Photorealistic seamless top-down texture of volcanic island arc terrain emerging "
            "from shallow seas, clusters of volcanic cones separated by sediment plains, lava "
            "flows reaching toward shoreline zones, mixture of dark volcanic rock and pale "
            "coastal sediment textures, emphasis on volcanic island distribution and mixed "
            "volcanic-sedimentary surface."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="andesite_volcano_field",
        category="volcanic_arc",
        label="Andesite Volcano Field",
        prompt=(
            "Ultra-realistic seamless terrain texture of andesite-rich volcanic terrain, rough "
            "volcanic rock fields with thick lava domes and explosive eruption debris, "
            "fractured crust surfaces with ash accumulation, muted gray and brown rock "
            "coloration with lighter ash layers, emphasis on explosive volcanic geology and "
            "rough volcanic debris fields."
        ),
        negative=SHARED_NEGATIVE,
    ),
    TexturePrompt(
        ewocs_id="volcanic_ash_basin",
        category="volcanic_arc",
        label="Volcanic Ash Basin",
        prompt=(
            "Photorealistic seamless planetary terrain texture of a basin blanketed by thick "
            "volcanic ash deposits, smooth dusty surfaces interrupted by ash dunes and buried "
            "lava flows, subtle ridges from underlying terrain, gray and charcoal ash "
            "coloration with faint reddish mineral oxidation, emphasis on fine volcanic ash "
            "texture and soft depositional terrain."
        ),
        negative=SHARED_NEGATIVE,
    ),
]

# ═══════════════════════════════════════════════════════════
#  MASTER CATALOG — all prompts in one list
# ═══════════════════════════════════════════════════════════
ALL_PROMPTS: list[TexturePrompt] = (
    CRATERED_PROMPTS + VOLCANIC_PROMPTS + DESERT_PROMPTS +
    ICE_PROMPTS + HYDROCARBON_PROMPTS + OCEAN_PROMPTS +
    TECTONIC_PROMPTS + EROSION_PROMPTS + IMPACT_PROMPTS + VOLCANIC_ARC_PROMPTS
)

# Legacy aliases for generate_textures.py compatibility
AEROSOL_PROMPTS = CRATERED_PROMPTS
SURFACE_PROMPTS = VOLCANIC_PROMPTS
COMBINED_PROMPTS = DESERT_PROMPTS


def get_prompt_by_id(ewocs_id: str) -> TexturePrompt | None:
    """Look up a prompt by its EWoCS ID."""
    for p in ALL_PROMPTS:
        if p.ewocs_id == ewocs_id:
            return p
    return None


def list_all_ids() -> list[str]:
    """Return all prompt IDs."""
    return [p.ewocs_id for p in ALL_PROMPTS]


def export_prompts_json(filepath: str = "prompts_catalog.json") -> None:
    """Export the full prompt catalog to JSON for review/archival."""
    import json
    data = []
    for p in ALL_PROMPTS:
        data.append({
            "id": p.ewocs_id,
            "category": p.category,
            "label": p.label,
            "prompt": p.prompt,
            "negative": p.negative,
            "resolution": f"{p.width}x{p.height}",
            "style": p.style,
            "notes": p.notes,
        })
    with open(filepath, "w") as f:
        json.dump(data, f, indent=2)
    print(f"Exported {len(data)} prompts to {filepath}")
