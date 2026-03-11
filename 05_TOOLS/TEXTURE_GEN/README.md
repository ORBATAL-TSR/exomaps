# ExoMaps — EWoCS Texture Generator

Standalone tool for pre-generating equirectangular planet texture maps using the **Leonardo AI API**, driven by the **Extended World Classification System (EWoCS)** from Orion's Arm.

> **This is a SEPARATE tool** — not part of the main runtime. Run it once (or periodically) to generate texture assets that the desktop client loads.

## Setup

```bash
cd 05_TOOLS/TEXTURE_GEN
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Ensure your `.env` in the project root has:
```
LEONARDO_AI_API_KEY=your_key_here
```

## Usage

```bash
# List all available prompt IDs
python generate_textures.py --list

# Dry run — see what would be generated
python generate_textures.py --dry-run

# Show budget estimate
python generate_textures.py --budget

# Generate ALL textures (~50 prompts)
python generate_textures.py

# Generate only aerosol (gas giant cloud) textures
python generate_textures.py --category aerosol

# Generate only surface textures
python generate_textures.py --category surface

# Generate specific texture(s) by ID
python generate_textures.py --ids aerosol_ammonian surface_gaian_earth

# Force regenerate even if texture exists
python generate_textures.py --force --ids aerosol_ammonian

# Export all prompts to JSON
python generate_textures.py --export-prompts

# Check generation status
python generate_textures.py --status
```

## Output

Textures are saved to:
```
02_CLIENTS/02_DESKTOP/public/textures/planets/{ewocs_id}.png
```

Each texture is 2048×1024 equirectangular projection, suitable for sphere UV mapping.

Generation metadata is logged to:
```
05_TOOLS/TEXTURE_GEN/logs/generation_log.json
```

## Prompt Catalog

All prompts are defined in `prompt_catalog.py` and organized by category:

| Category   | Count | Description                                      |
|-----------|-------|--------------------------------------------------|
| `aerosol`  | 20    | Gas giant cloud/aerosol types (4 thermal ranges)  |
| `surface`  | 20    | Solid body surface types (rocky, icy, lava, etc.) |
| `combined` | 10    | Specific EWoCS combos (Jupiter, Saturn, etc.)     |

**Total: ~50 prompts**

Every prompt used is saved in the generation log alongside the output file.

## EWoCS Classification Axes

The prompts cover the Orion's Arm EWoCS taxonomy:

- **Aerosol Classes** (20): Cryoazurian → Carbean (4 thermal ranges)
- **Surface Types** (9): Apnean, Arean, Gaian, Cytherean, Abyssal, Lava, Europan, Chthonian, Adamean
- **Mass Classes** (14): Lowerplanetesimal → Uppergiant
- **Atmosphere Types** (7): Protoatmospheric → Hydroatmospheric
- **And more**: volatile content, carbon content, metal content, fluid types, etc.

## File Structure

```
05_TOOLS/TEXTURE_GEN/
├── README.md              # This file
├── requirements.txt       # Python dependencies
├── generate_textures.py   # Main generator script
├── prompt_catalog.py      # All Leonardo AI prompts (saved)
├── texture_manifest.py    # EWoCS-to-texture mapping for renderer
└── logs/
    ├── generation_log.json    # Generation history
    └── prompts_catalog.json   # Exported prompts
```
