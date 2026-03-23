/**
 * icecaps.ts — GLSL feature: zone-driven polar ice caps.
 *
 * References icebergs.ts (ICEBERGS_GLSL must be concatenated before ICECAPS_GLSL
 * in the shader so applyIcebergs() is available here).
 *
 * Reads uniforms directly: uIceCaps, uIsIceWorld, uAxialTilt, uSeed
 *
 * Returns globalIce (float 0–1): used downstream for specular + SSS effects.
 *
 * Call site: after ocean/land surface color, before lighting.
 *   globalIce = applyIceCaps(color, pos, N, L, V, H, bumpN, NdotL,
 *                             absLat, provEdge, isPolar, isNeighborPolar, bZone, zoneChar);
 */

import { ICEBERGS_GLSL } from './icebergs';
export { ICEBERGS_GLSL };  // re-export so solid.frag only needs to import icecaps.ts

export const ICECAPS_GLSL = /* glsl */`
// ── Ice Caps ──────────────────────────────────────────────────────────────
// POLAR_ICE zone-exclusive ice rendering.
// Fills the entire interior of POLAR_ICE zones with ice, with a noise-warped
// calving front at the zone boundary. Adjacent polar zones share the interior
// fill so no dark seams appear between them (isNeighborPolar gate).
//
// Features:
//   • Calving cliff scarp (lit bright face + shadow blue face at zone edge)
//   • Crevasse network (dark blue shadow slots)
//   • Glacial flow striations (fine parallel lines in pole→equator direction)
//   • SSS glow (blue light scatter)
//   • Blue meltwater in crevasse interiors
//   • Ice lens translucency at thin shelf edges
//   • Pressure ridges at zone boundaries
//   • Surface melt ponds (partial-ice-cover worlds only)
//
// Returns: globalIce (0–1) for downstream specular / SSS passes.
float applyIceCaps(inout vec3 color,
                   vec3 pos, vec3 N, vec3 L, vec3 V, vec3 H,
                   vec3 bumpN, float NdotL, float absLat,
                   float provEdge, float isPolar, float isNeighborPolar,
                   int bZone, vec3 zoneChar) {
  float globalIce = 0.0;
  if(uIceCaps < 0.01) return globalIce;

  // ── SOLID zone-driven ice — no latitude bleed for normal worlds ──
  // POLAR_ICE zones are opaque/solid: the whole zone interior is covered fully.
  // Calving front is noise-warped for organic edge. Latitude only used as
  // fallback for global ice-worlds (snowball, rogue planet).

  float iceEdgeN = fbm3(pos * 9.0  + uSeed + 201.0) * 0.018
                 + fbm3(pos * 22.0 + uSeed + 311.0) * 0.006 - 0.012;

  // Sharp interior fill — transition window (0.001→0.022) keeps zone solid.
  float iceZoneMask = isPolar * clamp(max(
    smoothstep(0.001 + iceEdgeN, 0.022 + iceEdgeN, provEdge),
    isPolar * isNeighborPolar
  ), 0.0, 1.0);

  // Ice-world latitude fallback (global coverage)
  // Ice is driven entirely by zone roles — no latitude fallback.
  // iceBase latitude ring removed: it was the source of the flat-top cap on every cold world.
  float ice = iceZoneMask;
  ice = clamp(ice, 0.0, 1.0);
  globalIce = ice;

  if(ice < 0.001) return globalIce;

  // Per-zone ice character
  float iceRough = isPolar > 0.5 ? zoneChar.y : 0.22;
  float iceElev  = isPolar > 0.5 ? zoneChar.x : 0.80;

  // Zone-char drives ice tone: fresh névé white → old compacted blue-grey
  // Base is mid-tone (~0.68) so NdotL shading range is visible (not blown-out white)
  vec3 iceCol = mix(vec3(0.72, 0.78, 0.84), vec3(0.48, 0.62, 0.80), zoneChar.x * 0.60);

  if(isPolar > 0.5) {
    // Per-zone hue accent: each polar zone has a slightly different ice tone
    float zHue = fract(float(bZone) * 0.618034 + uSeed * 0.001);
    iceCol = mix(iceCol,
                 iceCol + vec3(sin(zHue * 3.14) * 0.04, 0.0, cos(zHue * 3.14) * 0.06),
                 0.50);

    // ── ICE CLIFF — three-band scarp: crest / wall / cast-shadow ────
    // Creates the illusion of a tall sheer cliff at the zone boundary.
    //   crest:      brilliant white top-face strip catching direct sun
    //   cliffFace:  deep cold-blue vertical wall (always shadowed)
    //   castShadow: AO-like darkening on the ice floor at cliff base
    //   fracBands:  horizontal stratification lines on the cliff face
    {
      float cliffNoise = fbm3(pos * 11.0 + uSeed + 301.0) * 0.012 - 0.006;
      float edgeDist   = provEdge + cliffNoise;
      float cliffSun   = smoothstep(-0.1, 0.5, dot(N, L));

      float crest      = smoothstep(0.026, 0.010, edgeDist)
                       * smoothstep(0.0,   0.012, edgeDist);
      float cliffFace  = smoothstep(0.010, 0.0, edgeDist);
      float castShadow = smoothstep(0.008, 0.055, edgeDist)
                       * smoothstep(0.100, 0.045, edgeDist);

      iceCol = mix(iceCol, vec3(1.00, 1.00, 1.00) * 1.12, crest * cliffSun * 0.85);
      iceCol = mix(iceCol, vec3(0.28, 0.44, 0.68), cliffFace * 0.80);
      iceCol = mix(iceCol, iceCol * 0.78 + vec3(0.04, 0.12, 0.28),
                   castShadow * 0.45 * (1.0 - cliffSun * 0.55));

      // Horizontal fracture bands on cliff face (stratification layers)
      float fracNoise = noise3D(pos * 28.0 + uSeed + 500.0) * 1.5;
      float fracBands = smoothstep(0.30, 0.44,
                          fract((edgeDist - 0.002) * 220.0 + fracNoise));
      iceCol = mix(iceCol, vec3(0.12, 0.28, 0.52),
                   fracBands * cliffFace * smoothstep(0.008, 0.001, edgeDist) * 0.55);
    }

    // ── CALVING SHELF FRONT — angular plate ice floes + dark open water ──
    // Wide calving belt at the ice shelf edge. Uses Voronoi F2-F1 distance
    // so cell INTERIORS = solid ice plates, cell EDGES = dark open water gaps.
    // This produces the reference look: angular white plates on dark ocean.
    {
      float calvZone = smoothstep(0.0, 0.005, provEdge)
                     * smoothstep(0.110, 0.032, provEdge);
      if(calvZone > 0.01) {
        // F1/F2 Voronoi — gives angular plate shapes (not round blobs)
        vec3  cp  = pos * 20.0 + uSeed + 77.0;
        vec3  ci  = floor(cp);
        vec3  cf  = fract(cp);
        float pF1 = 99.0, pF2 = 99.0;
        vec3  bestCI = ci;
        for(int cx=-1;cx<=1;cx++)
        for(int cy=-1;cy<=1;cy++)
        for(int cz=-1;cz<=1;cz++) {
          vec3 g  = vec3(float(cx),float(cy),float(cz));
          vec3 o  = fract(sin(vec3(
            dot(ci+g,vec3(127.1,311.7, 74.7)),
            dot(ci+g,vec3(269.5,183.3,246.1)),
            dot(ci+g,vec3(113.5,271.9,124.6))))*43758.5453)*0.5+0.25;
          float d = length(g + o - cf);
          if(d < pF1){ pF2=pF1; pF1=d; bestCI=ci+g; } else if(d < pF2){ pF2=d; }
        }

        // F2-F1: large = cell interior (solid plate), small = near edge (water gap)
        float gapW  = pF2 - pF1;
        // Water gap: dark narrow channel where plates are close
        float waterG = smoothstep(0.06, 0.0, gapW);
        // Plate body: solid inside the cell
        float plate  = smoothstep(0.0, 0.07, gapW);
        // ~65% of cells become plates; rest are already-melted open water
        float platH  = fract(sin(dot(bestCI, vec3(7.13,157.9,113.2)))*43758.5);
        plate *= step(0.35, platH);

        // Size fading: plates break up into smaller fragments toward open water
        float fragFade = smoothstep(0.0, 0.050, provEdge); // smaller near edge
        plate *= mix(0.55, 1.0, fragFade);

        float sunF    = smoothstep(-0.12, 0.55, dot(N, L));
        float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.2);

        // Plate top: brilliant white with NdotL shading + Fresnel blue edge glow
        vec3 plateTop = mix(vec3(0.74, 0.84, 0.94), vec3(0.96, 0.98, 1.00), sunF);
        plateTop += vec3(0.04, 0.14, 0.46) * fresnel * 0.42;
        // Specular glint on flat plate top
        plateTop += vec3(1.0) * pow(max(dot(bumpN, H), 0.0), 55.0) * sunF * 0.38;
        // SSS: tidal light through thin ice edge
        plateTop += vec3(0.04, 0.18, 0.55) * (1.0 - fresnel) * 0.14;

        // Dark open water between plates
        vec3 waterCol = vec3(0.01, 0.04, 0.12) + vec3(0.0, 0.02, 0.06) * sunF;
        // Water specular glint
        waterCol += vec3(0.40, 0.55, 0.75) * pow(max(dot(bumpN, H), 0.0), 28.0) * sunF * 0.22;

        // Compose: open water base, plates on top, water gap cuts through
        vec3 calvFinal = mix(waterCol, plateTop, plate);
        calvFinal      = mix(calvFinal, waterCol, waterG * 0.85);

        iceCol = mix(iceCol, calvFinal, calvZone * 0.94);
        // Modulate ice mask so water gaps let ocean show through
        ice    = mix(ice, plate * calvZone, calvZone * 0.75);
      }
    }
  }

  // Crevasse network: dark slots with blue meltwater lining
  float crevScale = mix(18.0, 35.0, iceRough);
  float crevas     = abs(noise3D(pos * crevScale + uSeed + float(bZone) * 11.3) * 2.0 - 1.0);
  float crevMask   = smoothstep(0.10, 0.0, crevas) * iceRough;
  iceCol = mix(iceCol, vec3(0.04, 0.12, 0.28), crevMask * 0.62);

  // Blue meltwater inside crevasse interiors
  float meltCrevas = smoothstep(0.04, 0.0, crevas) * ice;
  iceCol = mix(iceCol, vec3(0.20, 0.52, 0.90), meltCrevas * 0.55 * (1.0 - uIsIceWorld * 0.5));

  // Glacial flow striations: fine parallel lines in pole→equator direction
  {
    vec3  flowDir     = normalize(vec3(0.0, 1.0, pos.x * 0.3));
    float striation   = sin(dot(pos, flowDir) * 95.0 + uSeed * 0.5) * 0.5 + 0.5;
    float striationStr = smoothstep(0.44, 0.56, striation) * ice * iceRough * 0.22;
    iceCol = mix(iceCol, iceCol * 0.82 + vec3(0.04, 0.10, 0.22) * 0.18, striationStr);
  }

  // SSS: blue-green light penetrating ice volume
  float iceSS = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  iceCol += vec3(0.10, 0.20, 0.36) * iceSS * 0.20 * max(dot(N, L), 0.0);

  if(uIsIceWorld > 0.5) iceCol = mix(iceCol, color * 1.10, 0.28);

  // Ice lens translucency: thin shelf edges glow backlit blue
  {
    float lensIce = smoothstep(0.0, 0.40, ice) * (1.0 - smoothstep(0.40, 0.80, ice));
    float backLit = pow(max(-dot(N, L) + 0.55, 0.0), 1.8);
    iceCol += vec3(0.04, 0.16, 0.50) * lensIce * backLit * 0.24;
  }

  // Pressure ridges: compressed plate collisions at polar zone boundaries
  if(isPolar > 0.5 && iceRough > 0.45) {
    float ridgeEdge = smoothstep(0.018, 0.002, provEdge);
    float ridgeH    = ridgeEdge * iceElev * iceRough;
    iceCol = mix(iceCol, iceCol * 1.38 + vec3(0.06, 0.06, 0.04), ridgeH * 0.48);
  }

  // Surface melt ponds: dark circular depressions on thin/warm ice
  {
    float pondStr = (1.0 - uIsIceWorld) * smoothstep(0.12, 0.55, ice)
                  * (1.0 - smoothstep(0.55, 0.75, ice)) * (1.0 - iceRough * 0.6);
    if(pondStr > 0.01) {
      vec3  pondI = floor(pos * uNoiseScale * 4.5 + uSeed + 920.0);
      float pondC = fract(sin(dot(pondI, vec3(127.1, 311.7,  74.7))) * 43758.5);
      float pondR = fract(sin(dot(pondI, vec3(269.5, 183.3, 246.1))) * 43758.5);
      float pondN = noise3D(pos * uNoiseScale * 5.0 + uSeed + 930.0) * 0.5 + 0.5;
      float pond  = step(0.76, pondC) * pondR * smoothstep(0.44, 0.60, pondN);
      iceCol = mix(iceCol, vec3(0.12, 0.28, 0.56), pond * pondStr * 0.55);
    }
  }

  color = mix(color, iceCol, ice);
  return globalIce;
}
`;
