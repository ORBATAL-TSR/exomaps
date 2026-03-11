"""
EWoCS → Texture Manifest
==========================
Maps the renderer's V-profile planet types to EWoCS texture IDs.
The desktop client reads this to know which texture file to load for each planet.

Also used by the generator to understand which textures are needed.
"""

from dataclasses import dataclass, field


@dataclass
class TextureMapping:
    """Maps a renderer planet type to its EWoCS texture(s)."""
    planet_type: str          # V-profile key (e.g., "gas-giant", "rocky", "earth-like")
    surface_texture: str      # Primary surface/cloud texture ID
    normal_map: str = ""      # Optional normal map texture ID
    specular_map: str = ""    # Optional specular/roughness map
    night_map: str = ""       # Optional night-side emission map
    cloud_map: str = ""       # Optional cloud layer texture
    fallback_style: str = ""  # Fallback to procedural style if texture missing


# ═══════════════════════════════════════════════════════════
#  V-PROFILE → EWoCS TEXTURE MAPPING
# ═══════════════════════════════════════════════════════════

TEXTURE_MAP: dict[str, TextureMapping] = {
    # ─── GAS GIANTS ───────────────────────────────────────
    "gas-giant": TextureMapping(
        planet_type="gas-giant",
        surface_texture="combined_jupiter",
        fallback_style="gas-giant",
    ),
    "super-jupiter": TextureMapping(
        planet_type="super-jupiter",
        surface_texture="combined_jupiter",
        fallback_style="gas-giant",
    ),
    "hot-jupiter": TextureMapping(
        planet_type="hot-jupiter",
        surface_texture="combined_hot_jupiter",
        fallback_style="gas-giant",
    ),
    "neptune-like": TextureMapping(
        planet_type="neptune-like",
        surface_texture="combined_neptune",
        fallback_style="gas-giant",
    ),
    "warm-neptune": TextureMapping(
        planet_type="warm-neptune",
        surface_texture="combined_neptune",
        fallback_style="gas-giant",
    ),
    "mini-neptune": TextureMapping(
        planet_type="mini-neptune",
        surface_texture="combined_uranus",
        fallback_style="gas-giant",
    ),
    "sub-neptune": TextureMapping(
        planet_type="sub-neptune",
        surface_texture="combined_uranus",
        fallback_style="gas-giant",
    ),

    # ─── TERRESTRIAL / ROCKY ─────────────────────────────
    "rocky": TextureMapping(
        planet_type="rocky",
        surface_texture="surface_apnean_cratered",
        fallback_style="rocky",
    ),
    "earth-like": TextureMapping(
        planet_type="earth-like",
        surface_texture="surface_gaian_earth",
        cloud_map="aerosol_aquean",
        night_map="combined_living_earth",
        fallback_style="earth-like",
    ),
    "super-earth": TextureMapping(
        planet_type="super-earth",
        surface_texture="surface_gaian_superearth",
        cloud_map="aerosol_aquean",
        fallback_style="earth-like",
    ),
    "sub-earth": TextureMapping(
        planet_type="sub-earth",
        surface_texture="surface_apnean_cratered",
        fallback_style="rocky",
    ),

    # ─── SPECIAL TERRESTRIAL ─────────────────────────────
    "venus": TextureMapping(
        planet_type="venus",
        surface_texture="combined_venus",
        fallback_style="venus",
    ),
    "desert-world": TextureMapping(
        planet_type="desert-world",
        surface_texture="surface_arean_desert",
        fallback_style="desert-world",
    ),
    "ocean-world": TextureMapping(
        planet_type="ocean-world",
        surface_texture="surface_abyssal",
        cloud_map="aerosol_aquean",
        fallback_style="ocean-world",
    ),
    "lava-world": TextureMapping(
        planet_type="lava-world",
        surface_texture="surface_lava_55cancri",
        fallback_style="lava-world",
    ),
    "iron-planet": TextureMapping(
        planet_type="iron-planet",
        surface_texture="surface_apnean_iron",
        fallback_style="iron-planet",
    ),
    "carbon-planet": TextureMapping(
        planet_type="carbon-planet",
        surface_texture="surface_apnean_carbon",
        fallback_style="carbon-planet",
    ),
    "hycean": TextureMapping(
        planet_type="hycean",
        surface_texture="surface_hycean",
        cloud_map="aerosol_aquean",
        fallback_style="hycean",
    ),
    "eyeball-world": TextureMapping(
        planet_type="eyeball-world",
        surface_texture="surface_eyeball_tidally_locked",
        fallback_style="eyeball-world",
    ),
    "ice-dwarf": TextureMapping(
        planet_type="ice-dwarf",
        surface_texture="surface_europan",
        fallback_style="ice-dwarf",
    ),
    "chthonian": TextureMapping(
        planet_type="chthonian",
        surface_texture="surface_chthonian",
        fallback_style="chthonian",
    ),

    # ─── MOONS ────────────────────────────────────────────
    "moon-rocky": TextureMapping(
        planet_type="moon-rocky",
        surface_texture="surface_apnean_cratered",
        fallback_style="rocky",
    ),
    "moon-icy": TextureMapping(
        planet_type="moon-icy",
        surface_texture="surface_europan",
        fallback_style="ice-dwarf",
    ),
    "moon-volcanic": TextureMapping(
        planet_type="moon-volcanic",
        surface_texture="surface_lava_young_earth",
        fallback_style="lava-world",
    ),
    "moon-ocean": TextureMapping(
        planet_type="moon-ocean",
        surface_texture="surface_abyssal",
        fallback_style="ocean-world",
    ),
    "moon-desert": TextureMapping(
        planet_type="moon-desert",
        surface_texture="surface_arean_cold",
        fallback_style="desert-world",
    ),
    "moon-iron": TextureMapping(
        planet_type="moon-iron",
        surface_texture="surface_apnean_iron",
        fallback_style="iron-planet",
    ),
    "moon-carbon-soot": TextureMapping(
        planet_type="moon-carbon-soot",
        surface_texture="surface_apnean_carbon",
        fallback_style="carbon-planet",
    ),
    "moon-subsurface-ocean": TextureMapping(
        planet_type="moon-subsurface-ocean",
        surface_texture="surface_europan",
        fallback_style="ice-dwarf",
    ),
    "moon-magma-ocean": TextureMapping(
        planet_type="moon-magma-ocean",
        surface_texture="surface_lava_55cancri",
        fallback_style="lava-world",
    ),
    "moon-atmosphere-thin": TextureMapping(
        planet_type="moon-atmosphere-thin",
        surface_texture="surface_arean_cold",
        fallback_style="rocky",
    ),
    "moon-atmosphere-thick": TextureMapping(
        planet_type="moon-atmosphere-thick",
        surface_texture="combined_titan",
        fallback_style="venus",
    ),
    "moon-tidally-heated": TextureMapping(
        planet_type="moon-tidally-heated",
        surface_texture="surface_lava_young_earth",
        fallback_style="lava-world",
    ),
    "moon-captured": TextureMapping(
        planet_type="moon-captured",
        surface_texture="surface_apnean_cratered",
        fallback_style="rocky",
    ),
    "moon-trojan": TextureMapping(
        planet_type="moon-trojan",
        surface_texture="surface_apnean_cratered",
        fallback_style="rocky",
    ),
    "moon-ring-shepherd": TextureMapping(
        planet_type="moon-ring-shepherd",
        surface_texture="surface_apnean_ice",
        fallback_style="ice-dwarf",
    ),
    "moon-binary": TextureMapping(
        planet_type="moon-binary",
        surface_texture="surface_apnean_cratered",
        fallback_style="rocky",
    ),
    "moon-earth-like": TextureMapping(
        planet_type="moon-earth-like",
        surface_texture="surface_gaian_earth",
        cloud_map="aerosol_aquean",
        fallback_style="earth-like",
    ),
    "moon-co-orbital": TextureMapping(
        planet_type="moon-co-orbital",
        surface_texture="surface_apnean_cratered",
        fallback_style="rocky",
    ),
    "moon-irregular": TextureMapping(
        planet_type="moon-irregular",
        surface_texture="surface_apnean_cratered",
        fallback_style="rocky",
    ),
    "moon-hycean": TextureMapping(
        planet_type="moon-hycean",
        surface_texture="surface_hycean",
        cloud_map="aerosol_aquean",
        fallback_style="hycean",
    ),
}


# ═══════════════════════════════════════════════════════════
#  Temperature-aware texture selection
# ═══════════════════════════════════════════════════════════

def get_gas_giant_texture(temperature_k: float) -> str:
    """Select the right aerosol texture for a gas giant based on temperature."""
    if temperature_k < 90:
        return "aerosol_cryoazurian"
    elif temperature_k < 150:
        return "aerosol_frigidian"
    elif temperature_k < 250:
        return "aerosol_ammonian"
    elif temperature_k < 350:
        return "aerosol_aquean"
    elif temperature_k < 500:
        return "aerosol_chloridian"
    elif temperature_k < 700:
        return "aerosol_alkalian"
    elif temperature_k < 950:
        return "aerosol_silicolean"
    elif temperature_k < 1200:
        return "aerosol_sulfanian"
    elif temperature_k < 1600:
        return "aerosol_corrundian"
    elif temperature_k < 2100:
        return "aerosol_glasseanian"
    else:
        return "aerosol_irolean"


def get_texture_for_planet(planet_type: str, temperature_k: float = 300) -> TextureMapping:
    """
    Get the texture mapping for a planet type, with temperature-aware gas giant selection.
    Returns the mapping; caller checks if texture files exist.
    """
    mapping = TEXTURE_MAP.get(planet_type)
    if not mapping:
        # Unknown type, default to rocky
        mapping = TextureMapping(
            planet_type=planet_type,
            surface_texture="surface_apnean_cratered",
            fallback_style="rocky",
        )

    # For gas giants, override with temperature-appropriate aerosol
    if planet_type in ("gas-giant", "super-jupiter", "hot-jupiter",
                        "neptune-like", "warm-neptune", "mini-neptune", "sub-neptune"):
        mapping.surface_texture = get_gas_giant_texture(temperature_k)

    return mapping


def export_manifest_json(path: str = "texture_manifest.json"):
    """Export the full manifest as JSON for the renderer to consume."""
    import json
    manifest = {}
    for key, m in TEXTURE_MAP.items():
        manifest[key] = {
            "surfaceTexture": m.surface_texture,
            "normalMap": m.normal_map,
            "specularMap": m.specular_map,
            "nightMap": m.night_map,
            "cloudMap": m.cloud_map,
            "fallbackStyle": m.fallback_style,
        }
    with open(path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"Exported manifest to {path}")


if __name__ == "__main__":
    # Print summary
    print(f"Texture Manifest: {len(TEXTURE_MAP)} planet types mapped")
    print()
    for pt, m in sorted(TEXTURE_MAP.items()):
        cloud = f" + cloud:{m.cloud_map}" if m.cloud_map else ""
        night = f" + night:{m.night_map}" if m.night_map else ""
        print(f"  {pt:25s} → {m.surface_texture}{cloud}{night}")

    # Export JSON
    export_manifest_json()
