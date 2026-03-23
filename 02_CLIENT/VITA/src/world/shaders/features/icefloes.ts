/**
 * icefloes.ts — Shader-based drifting ice floes, rendered over ocean surface.
 *
 * Same Voronoi hemisphere-shading technique as the boulder pass, but applied
 * to ocean fragments near the polar calving belt.
 *
 * Drift: each latitude band rotates around the Y-axis at a unique speed
 * (mimicking real ocean gyres). The rotation is applied to the Voronoi
 * sample position so floes appear to slowly drift across the surface.
 *
 * Look: flat-top ice plate (hemisphere normal blended toward sphere normal
 * at plate centre), brilliant white top, translucent blue-cyan SSS at the
 * sides, specular glint on the wet flat top.
 *
 * Reads uniforms: uIceCaps, uNoiseScale, uSeed, uTime
 * Called after icecaps + eyeball, before lighting.
 *   applyIceFloes(color, pos, N, L, V, H, NdotL, isOcean, globalIce);
 */
export const ICEFLOES_GLSL = /* glsl */`
void applyIceFloes(
  inout vec3 color,
  vec3 pos, vec3 N, vec3 L, vec3 V, vec3 H,
  float NdotL, bool isOceanFrag, float globalIce
) {
  if(!isOceanFrag)     return;
  if(uIceCaps < 0.05)  return;

  // ── POLAR CALVING BELT ───────────────────────────────────────────────
  // Icebergs calve from the ice shelf and drift equatorward. The belt is
  // just equatorward of the polar ice line; density fades toward open sea.
  float absLat        = abs(pos.y);  // 0 = equator, 1 = pole
  float iceLine       = 1.0 - uIceCaps * 0.14;  // matches zone-role formula
  float beltOuter     = iceLine;
  float beltInner     = max(0.30, iceLine - 0.18);
  float bergBand      = smoothstep(beltInner, beltOuter, absLat)
                      * smoothstep(beltOuter + 0.08, beltOuter - 0.02, absLat);
  // Don't render floes under solid ice cap
  bergBand *= (1.0 - smoothstep(0.30, 0.75, globalIce));
  if(bergBand < 0.005) return;

  // ── OCEAN-CURRENT DRIFT ──────────────────────────────────────────────
  // Each latitude band rotates around the Y-axis at a unique speed.
  // Sign reversal between bands mimics real gyre circulation:
  //   subtropical gyre: eastward near equator
  //   subpolar gyre:    westward at mid-lat
  // Speed chosen so a full orbit takes ~25 real-time minutes (very subtle).
  float lat    = pos.y;
  float gyreHz = cos(lat * 3.14159) * 0.0075    // main subtropical gyre
               + sin(lat * 6.28318) * 0.0028    // subpolar counter-gyre
               + sin(lat * 11.00)   * 0.0009;   // polar eddy
  float dA = gyreHz * uTime;
  float dc = cos(dA), ds = sin(dA);
  // Y-axis rotation of the sample position (bergs drift in XZ plane)
  vec3 driftPos = vec3(
    pos.x * dc - pos.z * ds,
    pos.y,
    pos.x * ds + pos.z * dc
  );

  // ── VORONOI FLOE POSITIONS ────────────────────────────────────────────
  float bScale  = uNoiseScale * 4.8;
  vec3  bSample = driftPos * bScale + uSeed + vec3(91.0, 37.0, 183.0);
  vec3  bI      = floor(bSample);
  vec3  bF      = fract(bSample);
  float bF1     = 99.0;
  vec3  bCtr    = vec3(0.5);

  for(int x=-1;x<=1;x++)
  for(int y=-1;y<=1;y++)
  for(int z=-1;z<=1;z++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = fract(sin(vec3(
      dot(bI+g, vec3(127.1, 311.7,  74.7)),
      dot(bI+g, vec3(269.5, 183.3, 246.1)),
      dot(bI+g, vec3(113.5, 271.9, 124.6))
    )) * 43758.5453) * 0.5 + 0.25;
    float d = length(g + o - bF);
    if(d < bF1){ bF1 = d; bCtr = o; }
  }

  // ~55% of cells activate as ice floes; variable size per cell
  float bHash  = fract(sin(dot(bI, vec3(7.13, 157.9, 113.2))) * 43758.5);
  float bSz    = mix(0.18, 0.36, bHash);
  float bShape = smoothstep(bSz, bSz * 0.26, bF1) * step(0.45, bHash);
  if(bShape < 0.005) return;

  // ── ICE FLOE SHADING ─────────────────────────────────────────────────
  float rimFrac = clamp(bF1 / bSz, 0.0, 1.0);  // 0 = plate centre, 1 = edge

  // Flat-top normal: sphere normal at centre, tilts outward toward edge.
  // Creates the appearance of a FLAT plate, not a round boulder.
  vec3  sideNorm = normalize(bF - bCtr);
  vec3  bergN    = normalize(mix(N, sideNorm, rimFrac * 0.60));
  float bergNdotL = max(dot(bergN, L), 0.0);
  float bergNdotV = max(dot(bergN, V), 0.0);

  // Top face: brilliant snow-white, cooler in shadow
  vec3 topWhite = mix(
    vec3(0.78, 0.88, 0.96),   // overcast shadow: cool blue-grey
    vec3(0.97, 0.99, 1.00),   // direct sun:      near-white
    bergNdotL
  );
  // Subtle snow texture variation across plate surface
  float snowN = fbm3(driftPos * uNoiseScale * 12.0 + uSeed + 55.0) * 0.5 + 0.5;
  topWhite   += vec3(-0.04, -0.01, 0.02) * snowN * (1.0 - rimFrac);

  // ── TRANSLUCENT SIDES: Fresnel + SSS ─────────────────────────────────
  // Ice is semi-translucent; light enters the side, scatters blue, exits.
  // Fresnel: edge-on = more rim colour visible (thin ice looks bright blue).
  float fresnel  = pow(1.0 - bergNdotV, 3.2);
  // SSS depth: deeper blue in shadowed rim, brighter cyan in lit rim
  float sssDepth = rimFrac * (1.0 - bergNdotL * 0.55);
  vec3  rimSSS   = mix(
    vec3(0.32, 0.72, 0.96),   // shallow melt edge: bright sky-blue
    vec3(0.06, 0.22, 0.55),   // deep interior ice: dark navy blue
    sssDepth
  );
  // Back-scatter SSS: when light comes through the berg from behind
  float backSSS = pow(max(dot(-bergN, L) + 0.45, 0.0), 2.2) * rimFrac;
  rimSSS += vec3(0.04, 0.28, 0.72) * backSSS * 0.55;

  // Compose top + translucent rim
  vec3 bergCol = mix(topWhite, rimSSS, fresnel * 0.55 + rimFrac * 0.22);

  // Specular glint on flat wet ice surface (bright sun-glitter on melt pools)
  float specG  = pow(max(dot(bergN, H), 0.0), 72.0) * bergNdotL;
  bergCol     += vec3(0.88, 0.94, 1.00) * specG * 0.50;

  // Waterline AO: ocean shadow under the berg edge darkens base slightly
  float waterAO = 1.0 - pow(rimFrac, 1.8) * 0.24;
  bergCol      *= waterAO;

  // Final composite: blend over ocean surface
  // Density fades with distance from calving belt and with low iceCaps
  float density = bShape * bergBand * clamp(uIceCaps * 2.8, 0.0, 1.0);
  color = mix(color, bergCol, density * 0.94);
}
`;
