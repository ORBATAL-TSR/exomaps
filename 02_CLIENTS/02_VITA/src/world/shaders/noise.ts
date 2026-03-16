/**
 * noise.ts — Shared GLSL noise and utility functions.
 *
 * Extracted from planetShaders.ts FRAG.
 * These functions are shared between solid world and gas giant paths.
 */

export const NOISE_GLSL = /* glsl */`
// =============================================================
// NOISE CORE -- gradient noise, NO pole pinching (all 3D)
// =============================================================
vec3 hash33(vec3 p) {
  p = vec3(dot(p, vec3(127.1,311.7,74.7)),
           dot(p, vec3(269.5,183.3,246.1)),
           dot(p, vec3(113.5,271.9,124.6)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453);
}
float noise3D(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f*f*f*(f*(f*6.0-15.0)+10.0); // quintic for C2-smooth transitions
  return mix(mix(mix(dot(hash33(i),f),
    dot(hash33(i+vec3(1,0,0)),f-vec3(1,0,0)),u.x),
    mix(dot(hash33(i+vec3(0,1,0)),f-vec3(0,1,0)),
    dot(hash33(i+vec3(1,1,0)),f-vec3(1,1,0)),u.x),u.y),
    mix(mix(dot(hash33(i+vec3(0,0,1)),f-vec3(0,0,1)),
    dot(hash33(i+vec3(1,0,1)),f-vec3(1,0,1)),u.x),
    mix(dot(hash33(i+vec3(0,1,1)),f-vec3(0,1,1)),
    dot(hash33(i+vec3(1,1,1)),f-vec3(1,1,1)),u.x),u.y),u.z)*0.5+0.5;
}
float fbm5(vec3 p) {
  float v = 0.0, a = 0.5;
  for(int i=0;i<6;i++){v+=a*noise3D(p);p=p*2.03+31.97;a*=0.48;}
  return v;
}
float fbm3(vec3 p) {
  float v = 0.0, a = 0.5;
  for(int i=0;i<3;i++){v+=a*noise3D(p);p=p*2.03+31.97;a*=0.49;}
  return v;
}
float ridgedFbm(vec3 p) {
  float v = 0.0, a = 0.5;
  for(int i=0;i<4;i++){
    float n=abs(noise3D(p)*2.0-1.0);n=1.0-n;n=n*n;
    v+=a*n;p=p*2.1+17.3;a*=0.45;
  }
  return v;
}

// =============================================================
// VORONOI TECTONIC PLATES -- discrete biome regions
// Returns (cellDist, cellEdgeDist, cellID hash)
// =============================================================
vec3 voronoiPlates(vec3 p, float sc) {
  vec3 pp = p * sc;
  vec3 i = floor(pp), f = fract(pp);
  float d1 = 2.0, d2 = 2.0;
  float cellId = 0.0;
  // 3x3x3 neighbor search (27 iterations) — proper nearest-cell Voronoi
  for(int x=-1;x<=1;x++)
    for(int y=-1;y<=1;y++)
      for(int z=-1;z<=1;z++){
        vec3 g = vec3(float(x),float(y),float(z));
        vec3 o = fract(sin(vec3(
          dot(i+g,vec3(127.1,311.7,74.7)),
          dot(i+g,vec3(269.5,183.3,246.1)),
          dot(i+g,vec3(113.5,271.9,124.6))))*43758.5453)*0.75+0.125;
        float dd = length(g+o-f);
        if(dd < d1){ d2=d1; d1=dd;
          cellId = fract(sin(dot(i+g,vec3(7.13,157.9,113.2)))*43758.5453);
        } else if(dd < d2){ d2=dd; }
      }
  return vec3(d1, d2-d1, cellId);
}

// =============================================================
// TRIPLANAR TEXTURE -- no pole pinching
// =============================================================
vec3 triplanarSample(sampler2D tex, vec3 p, vec3 n, float sc) {
  vec3 bl = abs(n); bl = pow(bl,vec3(8.0)); bl /= dot(bl,vec3(1.0));
  // Offset each projection plane slightly to break up tiling repetition
  vec2 uvYZ = p.yz * sc + vec2(0.37, 0.13);
  vec2 uvXZ = p.xz * sc + vec2(0.71, 0.59);
  vec2 uvXY = p.xy * sc + vec2(0.23, 0.47);
  return texture2D(tex, uvYZ).rgb * bl.x
       + texture2D(tex, uvXZ).rgb * bl.y
       + texture2D(tex, uvXY).rgb * bl.z;
}
`;
