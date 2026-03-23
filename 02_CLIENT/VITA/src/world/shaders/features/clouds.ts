/**
 * clouds.ts — GLSL feature: circulation-aware procedural cloud layer.
 *
 * Renders clouds directly in the planet fragment shader (not a separate mesh).
 * This avoids the oval-blob artifact that a separate sphere mesh produces.
 *
 * Technique:
 *   - circMask(lat): latitude-based Gaussian model of real atmospheric circulation
 *     cells (ITCZ / subtropical dry / mid-lat storm track / polar stratus).
 *   - Differential wind rotation per latitude band animates each altitude
 *     independently, producing wind shear.
 *   - Domain-warped FBM: two offset FBM samples warp the cumulus coordinates,
 *     breaking the straight-FBM oval-blob shape into organic patchy clouds.
 *   - Two altitude layers: cumulus (low, thick) + cirrus (high, wispy).
 *   - Cloud shadow cast on surface before cloud compositing.
 *
 * Reads uniforms: uCloudDensity, uAtmThickness, uTime, uSeed
 *
 * Call site: after lighting, before province borders.
 *   applyClouds(finalColor, pos, N, L, NdotL);
 */
export const CLOUDS_GLSL = /* glsl */`
// ── Cloud layer wind rotation helper ────────────────────────────────────
vec3 cloudWarpFn(vec3 p, float speed) {
  float lat   = asin(clamp(p.y, -1.0, 1.0));
  float angle = speed * cos(lat) * uTime;
  float c = cos(angle), s = sin(angle);
  return vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c);
}

// ── Atmospheric circulation mask ─────────────────────────────────────────
// lat = pos.y = sin(latitude), range [-1, +1].
// Models Earth-like pressure cells:
//   ITCZ (0°):        dense convection at equator
//   Subtropical dry (±25°): stable high pressure, clear, arid
//   Mid-lat storm (±55°):  cyclone belt
//   Polar stratus (±80°):  sparse low cloud
float circMask(float lat) {
  float itcz   = exp(-pow(lat / 0.16, 2.0));
  float subDry = 1.0 - exp(-pow((abs(lat) - 0.42) / 0.13, 2.0));
  float mid    = exp(-pow((abs(lat) - 0.62) / 0.16, 2.0)) * 0.65;
  // polar stratus removed — it created a white flat-top cap on every world
  return clamp((itcz * 0.80 + mid + 0.12) * subDry, 0.0, 1.0);
}

// ── Dedicated Cloud Layer ────────────────────────────────────────────────
// Circulation-aware, domain-warped, two-altitude cloud rendering.
// Runs inside the planet fragment shader — no oval-blob sphere-mesh artifacts.
void applyClouds(inout vec3 finalColor, vec3 pos, vec3 N, vec3 L, float NdotL) {
  if(uCloudDensity < 0.02 || uAtmThickness < 0.06) return;

  float circ = circMask(pos.y);

  // Latitude-dependent wind speed: trade winds faster at low lat
  float windSpd1 = mix(0.038, 0.018, abs(pos.y));
  float windSpd2 = mix(0.022, 0.010, abs(pos.y));

  // Altitude offsets: cumulus low, cirrus high
  vec3 cldPos  = pos + N * 0.018;
  vec3 cldPos2 = pos + N * 0.042;

  vec3 w1 = cloudWarpFn(cldPos,  windSpd1) * 4.8;
  vec3 w2 = cloudWarpFn(cldPos2, windSpd2) * 9.2;

  // Domain warp: two FBM offset vectors distort the cumulus sample coords,
  // breaking straight-FBM oval blobs into irregular patchy cloud masses.
  vec3 warpV = vec3(
    fbm3(w1 + uSeed + 88.0) * 2.0 - 1.0,
    fbm3(w1 + uSeed + 44.0) * 2.0 - 1.0,
    0.0
  ) * 0.42;

  float cumRaw = fbm3(w1       + uSeed + vec3(0.0, uTime * 0.009, 0.0));
  float cumWrp = fbm3(w1 + warpV + uSeed + 7.0 + vec3(0.0, uTime * 0.009, 0.0));
  float cumN   = cumRaw * 0.55 + cumWrp * 0.45;

  float cirN   = fbm3(w2 + uSeed + 333.0 + vec3(uTime * 0.006, 0.0, 0.0));

  float cumAlpha = pow(smoothstep(0.40, 0.64, cumN), 1.2) * uCloudDensity * circ;
  float cirAlpha = pow(smoothstep(0.54, 0.74, cirN), 1.6) * uCloudDensity * circ * 0.45;

  // Top/bottom illumination: sun-facing tops bright white, undersides grey-blue
  float topBot = smoothstep(-0.12, 0.35, dot(N, L));
  vec3  cumTop = mix(vec3(0.80, 0.84, 0.92), vec3(0.94, 0.96, 0.99), NdotL);
  vec3  cumBot = mix(vec3(0.22, 0.26, 0.32), vec3(0.42, 0.46, 0.54), NdotL * 0.5);
  vec3  cumCol = mix(cumBot, cumTop, topBot);
  vec3  cirCol = mix(vec3(0.60, 0.65, 0.78), vec3(0.88, 0.92, 0.98), NdotL);

  // Cloud shadow cast on surface before compositing
  float cldShadow = (cumAlpha * 0.60 + cirAlpha * 0.15)
                  * smoothstep(-0.1, 0.4, dot(N, L));
  finalColor *= 1.0 - cldShadow * 0.42;

  // Composite clouds; fade smoothly toward night side
  float cldLit = smoothstep(-0.1, 0.3, dot(N, L));
  finalColor = mix(finalColor, cumCol, cumAlpha * 0.92 * cldLit);
  finalColor = mix(finalColor, cirCol, cirAlpha * 0.62 * cldLit);
}
`;
