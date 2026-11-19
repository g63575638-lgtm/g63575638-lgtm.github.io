'use strict';
// ============================================================================
// GLSL ES 3.00 shaders. Stylised semi-realistic look: hemispheric ambient,
// sun with cascaded PCF shadows, aerial-perspective fog, ACES tone mapping.
// ============================================================================

const SH = {};

SH.common = `
uniform mat4 u_viewProj;
uniform vec3 u_camPos;
uniform vec3 u_sunDir;
uniform vec3 u_sunCol;
uniform vec3 u_skyCol;
uniform vec3 u_gndCol;
uniform vec3 u_fogCol;
uniform vec3 u_fogSunCol;
uniform vec4 u_fog;          // density, height falloff, base height, max
uniform float u_time;
uniform vec4 u_wind;         // dir.x, dir.z, strength, gust
uniform float u_exposure;
uniform mat4 u_shadowMat0;
uniform mat4 u_shadowMat1;
uniform vec4 u_shadowParams; // r0, texel, enabled, r1
uniform vec3 u_shadowCenter;
uniform sampler2DShadow u_shadow;

float shadowAt(vec3 wp, vec3 n) {
  if (u_shadowParams.z < 0.5) return 1.0;
  float d = max(abs(wp.x - u_shadowCenter.x), abs(wp.z - u_shadowCenter.z));
  vec4 sc; vec2 lo, hi;
  if (d < u_shadowParams.x * 0.92) { sc = u_shadowMat0 * vec4(wp + n * 0.025, 1.0); lo = vec2(0.0, 0.0); hi = vec2(0.5, 1.0); }
  else if (d < u_shadowParams.w) { sc = u_shadowMat1 * vec4(wp + n * 0.12, 1.0); lo = vec2(0.5, 0.0); hi = vec2(1.0, 1.0); }
  else return 1.0;
  vec3 c = sc.xyz;
  if (c.z > 1.0) return 1.0;
  float t = u_shadowParams.y;
  vec2 m = vec2(t * 1.5);
  float s = 0.0;
  s += texture(u_shadow, vec3(clamp(c.xy + vec2(-0.6, -0.9) * t, lo + m, hi - m), c.z));
  s += texture(u_shadow, vec3(clamp(c.xy + vec2( 0.9, -0.6) * t, lo + m, hi - m), c.z));
  s += texture(u_shadow, vec3(clamp(c.xy + vec2(-0.9,  0.6) * t, lo + m, hi - m), c.z));
  s += texture(u_shadow, vec3(clamp(c.xy + vec2( 0.6,  0.9) * t, lo + m, hi - m), c.z));
  s *= 0.25;
  float fade = smoothstep(u_shadowParams.w * 0.8, u_shadowParams.w, d);
  return mix(s, 1.0, fade);
}

vec3 toLin(vec3 c) { return c * c; }
vec3 ambient(vec3 n) { return mix(u_gndCol, u_skyCol, n.y * 0.5 + 0.5); }

vec3 shade(vec3 albedo, vec3 n, vec3 wp, float ao, float spec, float gloss, float sh) {
  float ndl = max(dot(n, u_sunDir), 0.0);
  vec3 col = albedo * (u_sunCol * ndl * sh + ambient(n) * ao);
  if (spec > 0.0) {
    vec3 v = normalize(u_camPos - wp);
    vec3 h = normalize(v + u_sunDir);
    float sp = pow(max(dot(n, h), 0.0), gloss) * (gloss + 2.0) / 8.0;
    float fr = pow(1.0 - max(dot(n, v), 0.0), 4.0);
    col += u_sunCol * sp * spec * sh * ndl;
    col += mix(u_skyCol, u_fogCol, 0.5) * fr * spec * 0.6 * ao;
  }
  return col;
}

vec3 applyFog(vec3 col, vec3 wp) {
  vec3 d = wp - u_camPos; float dist = length(d); vec3 dir = d / max(dist, 1e-3);
  float hf = exp(-max(min(wp.y, u_camPos.y) - u_fog.z, 0.0) * u_fog.y);
  float f = 1.0 - exp(-dist * u_fog.x * hf);
  float sa = pow(max(dot(dir, u_sunDir), 0.0), 6.0);
  vec3 fc = toLin(mix(u_fogCol, u_fogSunCol, sa)) * 1.15;
  return mix(col, fc, min(f, u_fog.w));
}

vec3 tonemap(vec3 c) {
  c *= u_exposure;
  c = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14);
  return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
}
`;

// --------------------------------------------------------------------------- generic lit (props, trees, club, ball)
SH.litVS = `
${'$COMMON'}
layout(location=0) in vec3 a_pos; layout(location=1) in vec3 a_nrm; layout(location=2) in vec4 a_col; layout(location=3) in vec2 a_ext;
#ifdef INSTANCED
layout(location=4) in vec4 a_i0; layout(location=5) in vec4 a_i1;
#else
uniform mat4 u_model;
#endif
out vec3 v_wp; out vec3 v_n; out vec4 v_col; out vec2 v_ext; out float v_sh;
void main() {
#ifdef INSTANCED
  float c = cos(a_i1.x), s = sin(a_i1.x);
  vec3 p = a_pos * a_i0.w;
  p = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
  vec3 n = vec3(c * a_nrm.x + s * a_nrm.z, a_nrm.y, -s * a_nrm.x + c * a_nrm.z);
  float sway = a_col.a * a_i1.z;
  float ph = a_i0.x * 0.07 + a_i0.z * 0.05 + a_i1.w;
  float g = sin(u_time * 1.1 + ph) * 0.6 + sin(u_time * 2.3 + ph * 1.7) * 0.25 + u_wind.w * 0.4;
  p.xz += vec2(u_wind.x, u_wind.y) * g * sway * u_wind.z * (0.5 + p.y * 0.08);
  p.xz += vec2(sin(u_time * 3.1 + ph * 3.0), cos(u_time * 2.7 + ph * 2.0)) * sway * 0.03 * u_wind.z;
  vec3 wp = p + a_i0.xyz;
  vec3 tint = vec3(1.0 + a_i1.y * 0.18, 1.0 + a_i1.y * 0.08, 1.0 - a_i1.y * 0.12);
  v_col = vec4(a_col.rgb * tint, a_col.a);
#else
  vec3 wp = (u_model * vec4(a_pos, 1.0)).xyz;
  vec3 n = normalize(mat3(u_model) * a_nrm);
  v_col = a_col;
#endif
  v_wp = wp; v_n = n; v_ext = a_ext;
  gl_Position = u_viewProj * vec4(wp, 1.0);
}`;

SH.litFS = `
${'$COMMON'}
in vec3 v_wp; in vec3 v_n; in vec4 v_col; in vec2 v_ext;
uniform vec4 u_tint;      // rgb multiplier, a = opacity
uniform vec3 u_emissive;
uniform vec2 u_spec;      // strength, glossiness
out vec4 o;
void main() {
  vec3 n = normalize(v_n);
  vec3 albedo = toLin(v_col.rgb * u_tint.rgb);
  if (v_ext.x > 0.5 && dot(n, u_camPos - v_wp) < 0.0) n = -n;
  float sh = shadowAt(v_wp, n);
  vec3 col = shade(albedo, n, v_wp, 1.0, u_spec.x * v_col.a, u_spec.y, sh);
  // foliage translucency + soft wrap
  if (v_ext.x > 0.5) {
    float back = max(dot(-n, u_sunDir), 0.0);
    col += albedo * u_sunCol * back * 0.35 * sh;
    col += albedo * u_sunCol * 0.08 * sh;
  }
  col += u_emissive;
  col = applyFog(col, v_wp);
  o = vec4(tonemap(col) * u_tint.a, u_tint.a);
}`;

// --------------------------------------------------------------------------- terrain
SH.terrainVS = `
${'$COMMON'}
layout(location=0) in vec3 a_pos; layout(location=1) in vec3 a_nrm; layout(location=2) in vec4 a_col;
out vec3 v_wp; out vec3 v_n; out vec3 v_ao;
void main() {
  v_wp = a_pos; v_n = a_nrm; v_ao = a_col.rgb;
  gl_Position = u_viewProj * vec4(a_pos, 1.0);
}`;

SH.terrainFS = `
${'$COMMON'}
in vec3 v_wp; in vec3 v_n; in vec3 v_ao;
uniform sampler2D u_surf;     // r fairway, g green, b sand, a tee/path
uniform sampler2D u_noise;
uniform vec4 u_mapRect;       // minX, minZ, 1/sizeX, 1/sizeZ
uniform vec3 u_cRough, u_cRough2, u_cFair, u_cGreen, u_cSand, u_cTee, u_cRock, u_cDirt, u_cSnow;
uniform vec4 u_terr;          // waterLevel, snowLine, stripeDirX, stripeDirZ
uniform vec4 u_cup;           // x,y,z, radius
uniform vec4 u_ball;          // x,y,z, radius
uniform vec4 u_ballGlow;      // intensity, time, -, -
out vec4 o;
void main() {
  vec2 dxz = v_wp.xz - u_cup.xz;
  float dc = length(dxz);
  if (dc < u_cup.w) discard;
  vec3 n = normalize(v_n);
  vec2 uv = (v_wp.xz - u_mapRect.xy) * u_mapRect.zw;
  // organic edges: jitter surface lookup with noise
  vec4 nz0 = texture(u_noise, v_wp.xz * 0.013);
  vec4 nz1 = texture(u_noise, v_wp.xz * 0.11);
  vec4 nz2 = texture(u_noise, v_wp.xz * 0.9);
  vec4 s = texture(u_surf, uv + (nz1.xy - 0.5) * u_mapRect.zw * 0.9);
  float fair = smoothstep(0.42, 0.58, s.r), green = smoothstep(0.45, 0.55, s.g), sand = smoothstep(0.45, 0.55, s.b), tee = smoothstep(0.45, 0.55, s.a);
  // rough with patchy variation
  vec3 rough = mix(u_cRough, u_cRough2, smoothstep(0.25, 0.75, nz0.r));
  rough *= 0.78 + 0.4 * nz1.g;
  rough *= 0.88 + 0.24 * nz2.b;
  rough = mix(rough, rough * vec3(1.08, 0.98, 0.8), smoothstep(0.55, 0.8, nz0.b) * 0.6);
  // fringe / first cut around fairway & green
  float fringe = max(smoothstep(0.18, 0.42, s.r), smoothstep(0.2, 0.45, s.g)) * (1.0 - max(fair, green));
  vec3 col = mix(rough, mix(u_cRough, u_cFair, 0.55) * (0.95 + 0.1 * nz2.r), fringe);
  // fairway mow stripes
  vec2 sd = vec2(u_terr.z, u_terr.w);
  float stripe = smoothstep(0.35, 0.65, abs(fract(dot(v_wp.xz, sd) / 9.0) * 2.0 - 1.0));
  vec3 fairC = u_cFair * (0.87 + 0.17 * stripe) * (0.94 + 0.12 * nz2.g) * (0.96 + 0.08 * nz1.r);
  col = mix(col, fairC, fair);
  // green: fine cross-hatch
  float st1 = smoothstep(0.3, 0.7, abs(fract(dot(v_wp.xz, sd) / 3.0) * 2.0 - 1.0));
  float st2 = smoothstep(0.3, 0.7, abs(fract(dot(v_wp.xz, vec2(-sd.y, sd.x)) / 3.0) * 2.0 - 1.0));
  vec3 greenC = u_cGreen * (0.94 + 0.05 * st1 + 0.04 * st2) * (0.97 + 0.06 * nz2.a);
  col = mix(col, greenC, green);
  // tee box
  col = mix(col, u_cTee * (0.93 + 0.1 * stripe), tee);
  // sand: grainy + rakes
  float rake = 0.96 + 0.05 * sin(dot(v_wp.xz, vec2(sd.y, -sd.x)) * 9.0 + nz1.r * 6.0);
  vec3 sandC = u_cSand * rake * (0.92 + 0.12 * nz2.r);
  col = mix(col, sandC, sand);
  // underwater / shore
  float wet = v_ao.b;
  col = mix(col, mix(u_cSand, u_cDirt, 0.5) * 0.75, wet * (1.0 - sand * 0.5));
  // slope rock + dirt
  float slope = 1.0 - n.y;
  float rock = smoothstep(0.28 + nz1.b * 0.12, 0.45 + nz1.b * 0.12, slope) * (1.0 - green) * (1.0 - fair * 0.8);
  vec3 rockC = u_cRock * (0.58 + 0.7 * nz1.a) * (0.84 + 0.32 * nz2.g);
  rockC *= 0.82 + 0.18 * sin(v_wp.y * 0.9 + nz1.r * 5.0 + nz0.b * 3.0);   // strata
  rockC = mix(rockC, rockC * vec3(0.8, 0.85, 0.75), smoothstep(0.5, 0.75, nz0.a) * 0.5);
  col = mix(col, rockC, rock);
  // snow on high peaks
  float snow = smoothstep(u_terr.y, u_terr.y + 35.0, v_wp.y + nz0.g * 30.0) * smoothstep(0.62, 0.85, n.y) * (1.0 - rock);
  col = mix(col, u_cSnow, snow);
  // cup rim (bare soil + white liner)
  float rim = smoothstep(u_cup.w + 0.012, u_cup.w + 0.002, dc);
  col = mix(col, vec3(0.92), rim * 0.85);
  float ao = v_ao.r;
  float treeShade = v_ao.g;
  float dS = max(abs(v_wp.x - u_shadowCenter.x), abs(v_wp.z - u_shadowCenter.z));
  float far = u_shadowParams.z > 0.5 ? smoothstep(u_shadowParams.w * 0.75, u_shadowParams.w, dS) : 1.0;
  float sh = shadowAt(v_wp, n) * mix(1.0, treeShade, far);
  // ball contact shadow (ray toward sun)
  vec3 bp = u_ball.xyz - v_wp;
  float along = dot(bp, u_sunDir);
  float perp = length(bp - u_sunDir * along);
  float bsh = along > 0.0 ? smoothstep(u_ball.w * 0.55, u_ball.w * 1.25, perp) : 1.0;
  float contact = smoothstep(u_ball.w * 3.0, u_ball.w * 0.6, length(bp));
  sh *= mix(1.0, bsh, 0.85);
  vec3 lit = shade(toLin(col), n, v_wp, ao * (1.0 - contact * 0.5), green * 0.12, 24.0, sh);
  // ball finder: soft pulsing ring on the ground
  if (u_ballGlow.x > 0.0) {
    float db = length(v_wp.xz - u_ball.xz);
    float ring = smoothstep(0.08, 0.0, abs(db - (0.35 + 0.25 * fract(u_ballGlow.y * 0.6)))) * (1.0 - fract(u_ballGlow.y * 0.6));
    float disc = smoothstep(0.5, 0.0, db) * 0.35;
    lit += vec3(1.0, 0.75, 0.3) * (ring + disc) * u_ballGlow.x;
  }
  lit = applyFog(lit, v_wp);
  o = vec4(tonemap(lit), 1.0);
}`;

// --------------------------------------------------------------------------- grass (instanced, procedural placement)
SH.grassVS = `
${'$COMMON'}
layout(location=0) in vec3 a_pos; layout(location=2) in vec4 a_col; layout(location=3) in vec2 a_ext;
uniform sampler2D u_height;   // R32F heightmap
uniform sampler2D u_surf;
uniform vec4 u_mapRect;
uniform vec4 u_hmInfo;        // width, height, cellSize, -
uniform vec4 u_grid;          // originX, originZ, spacing, N
uniform float u_radius;
uniform vec3 u_cBase, u_cTip;
uniform vec4 u_cup;
uniform vec4 u_ball;
uniform float u_waterLevel;
out vec3 v_col; out float v_sh; out vec3 v_wp;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float heightAt(vec2 xz) {
  vec2 g = (xz - u_mapRect.xy) / u_hmInfo.z;
  vec2 f = fract(g); ivec2 i = ivec2(floor(g));
  ivec2 mx = ivec2(u_hmInfo.xy) - 2; i = clamp(i, ivec2(0), mx);
  float h00 = texelFetch(u_height, i, 0).r, h10 = texelFetch(u_height, i + ivec2(1, 0), 0).r;
  float h01 = texelFetch(u_height, i + ivec2(0, 1), 0).r, h11 = texelFetch(u_height, i + ivec2(1, 1), 0).r;
  // match terrain triangulation (split along diagonal)
  if (f.x + f.y < 1.0) return h00 + (h10 - h00) * f.x + (h01 - h00) * f.y;
  return h11 + (h01 - h11) * (1.0 - f.x) + (h10 - h11) * (1.0 - f.y);
}
void main() {
  int N = int(u_grid.w);
  int ix = gl_InstanceID % N, iz = gl_InstanceID / N;
  vec2 cell = vec2(float(ix), float(iz)) - float(N) * 0.5;
  vec2 base = u_grid.xy + cell * u_grid.z;
  vec2 world = base;
  float r1 = hash(world), r2 = hash(world + 17.3), r3 = hash(world + 41.9);
  world += (vec2(r1, r2) - 0.5) * u_grid.z * 1.6;
  float dist = length(world - u_camPos.xz);
  vec4 s = texture(u_surf, (world - u_mapRect.xy) * u_mapRect.zw);
  float roughness = 1.0 - clamp(max(max(s.r * 1.6, s.g * 3.0), max(s.b * 3.0, s.a * 3.0)), 0.0, 1.0);
  float scale = smoothstep(u_radius, u_radius * 0.6, dist) * roughness;
  scale *= 0.65 + r3 * 0.7;
  float h = heightAt(world);
  if (h < u_waterLevel + 0.05) scale = 0.0;
  if (length(world - u_cup.xz) < 0.6) scale = 0.0;
  float a = r1 * 6.2831;
  float c = cos(a), sn = sin(a);
  vec3 p = a_pos * vec3(1.0, scale, 1.0);
  p = vec3(c * p.x + sn * p.z, p.y, -sn * p.x + c * p.z);
  float t = a_ext.x;
  float ph = world.x * 0.35 + world.y * 0.27;
  float w = (sin(u_time * 1.7 + ph) * 0.6 + sin(u_time * 3.9 + ph * 2.3) * 0.25 + u_wind.w) * u_wind.z;
  p.xz += vec2(u_wind.x, u_wind.y) * w * t * t * 0.09 * scale;
  // push grass away from the ball
  vec3 wp = vec3(world.x, h, world.y) + p;
  vec2 tb = wp.xz - u_ball.xz; float dB = length(tb);
  wp.xz += normalize(tb + 1e-4) * smoothstep(0.12, 0.0, dB) * t * 0.06;
  if (scale < 0.02) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); v_col = vec3(0.0); v_sh = 0.0; v_wp = vec3(0.0); return; }
  float tintN = hash(floor(world * 0.25)) * 0.25;
  vec3 colr = mix(u_cBase, u_cTip, t) * (0.85 + tintN + a_col.r * 0.25);
  v_sh = shadowAt(wp, vec3(0.0, 1.0, 0.0));
  v_col = colr;
  v_wp = wp;
  gl_Position = u_viewProj * vec4(wp, 1.0);
}`;

SH.grassFS = `
${'$COMMON'}
in vec3 v_col; in float v_sh; in vec3 v_wp;
out vec4 o;
void main() {
  vec3 n = vec3(0.0, 1.0, 0.0);
  float ndl = max(dot(n, u_sunDir), 0.0) * 0.75 + 0.25;
  vec3 alb = toLin(v_col);
  vec3 col = alb * (u_sunCol * ndl * v_sh + ambient(n) * 0.9);
  col += alb * u_sunCol * 0.12 * v_sh;
  col = applyFog(col, v_wp);
  o = vec4(tonemap(col), 1.0);
}`;

// --------------------------------------------------------------------------- water (lakes + ocean)
SH.waterVS = `
${'$COMMON'}
layout(location=0) in vec3 a_pos; layout(location=3) in vec2 a_ext;
out vec3 v_wp; out float v_depth;
void main() {
  vec3 p = a_pos;
  v_wp = p; v_depth = a_ext.x;
  gl_Position = u_viewProj * vec4(p, 1.0);
}`;

SH.waterFS = `
${'$COMMON'}
in vec3 v_wp; in float v_depth;
uniform sampler2D u_noise;
uniform sampler2D u_sky;
uniform vec3 u_cShallow, u_cDeep;
uniform float u_skyRot;
uniform vec4 u_waterP;    // waveScale, foamAmount, alphaScale, sparkle
out vec4 o;
vec3 skyLookup(vec3 d) {
  float u = atan(d.x, -d.z) / 6.2831853 + 0.5 + u_skyRot;
  float v = acos(clamp(d.y, -1.0, 1.0)) / 3.14159265;
  return toLin(textureLod(u_sky, vec2(u, v), 1.5).rgb);   // explicit LOD: no mip seam at the longitude wrap
}
void main() {
  float t = u_time;
  vec2 p = v_wp.xz * u_waterP.x;
  vec3 n1 = texture(u_noise, p * 0.05 + vec2(t * 0.011, t * 0.007)).rgb * 2.0 - 1.0;
  vec3 n2 = texture(u_noise, p * 0.13 - vec2(t * 0.017, -t * 0.013)).rgb * 2.0 - 1.0;
  vec3 n3 = texture(u_noise, p * 0.41 + vec2(-t * 0.031, t * 0.023)).rgb * 2.0 - 1.0;
  vec3 v = u_camPos - v_wp; float dist = length(v); v /= dist;
  float detail = smoothstep(400.0, 40.0, dist);
  vec3 n = normalize(vec3((n1.x + n2.x * 0.7 + n3.x * 0.5 * detail) * 0.16, 1.0, (n1.y + n2.y * 0.7 + n3.y * 0.5 * detail) * 0.16));
  float fres = 0.03 + 0.97 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 r = reflect(-v, n); r.y = abs(r.y);
  vec3 refl = skyLookup(r) * 1.05;
  float depth = max(v_depth, 0.0);
  vec3 body = toLin(mix(u_cShallow, u_cDeep, smoothstep(0.0, 6.0, depth)));
  body *= (u_sunCol * max(u_sunDir.y, 0.1) * 0.6 + ambient(n) * 0.6);
  vec3 col = mix(body, refl, fres);
  // sun glitter
  float sp = pow(max(dot(r, u_sunDir), 0.0), 700.0) * 60.0 + pow(max(dot(r, u_sunDir), 0.0), 60.0) * 0.6 * u_waterP.w;
  col += u_sunCol * sp;
  // shoreline foam
  float foam = smoothstep(0.35, 0.0, depth + (n2.x * 0.08)) * u_waterP.y;
  foam *= 0.6 + 0.4 * sin(t * 1.3 + depth * 20.0 + n1.y * 3.0);
  col = mix(col, vec3(0.8) * (u_sunCol * 0.45 + u_skyCol * 0.8), clamp(foam, 0.0, 1.0));
  float alpha = clamp(smoothstep(0.0, 0.8 * u_waterP.z, depth) * 0.85 + fres * 0.5 + foam, 0.0, 1.0);
  col = applyFog(col, v_wp);
  o = vec4(tonemap(col) * alpha, alpha);
}`;

// --------------------------------------------------------------------------- sky
SH.skyVS = `
${'$COMMON'}
layout(location=0) in vec3 a_pos;
out vec3 v_dir;
void main() {
  v_dir = a_pos;
  vec4 p = u_viewProj * vec4(u_camPos + a_pos * 100.0, 1.0);
  gl_Position = p.xyww;
}`;

SH.skyFS = `
${'$COMMON'}
in vec3 v_dir;
uniform sampler2D u_sky;
uniform float u_skyRot;
uniform vec3 u_sunDisc;   // size, intensity, -
out vec4 o;
void main() {
  vec3 d = normalize(v_dir);
  float u = atan(d.x, -d.z) / 6.2831853 + 0.5 + u_skyRot;
  float v = acos(clamp(d.y, -1.0, 1.0)) / 3.14159265;
  vec3 col = toLin(textureLod(u_sky, vec2(u, v), 0.0).rgb) * 1.25;
  float sd = dot(d, u_sunDir);
  float disc = smoothstep(1.0 - u_sunDisc.x * 1.6, 1.0 - u_sunDisc.x, sd);
  float halo = pow(max(sd, 0.0), 900.0) * 1.5 + pow(max(sd, 0.0), 90.0) * 0.25;
  col += u_sunCol * (disc * u_sunDisc.y + halo) * smoothstep(-0.02, 0.03, d.y);
  o = vec4(tonemap(col), 1.0);
}`;

// sky generation: renders an equirect texture once per map (heavy noise OK)
SH.skyGenVS = `
layout(location=0) in vec3 a_pos;
out vec2 v_uv;
void main() { v_uv = a_pos.xy * 0.5 + 0.5; gl_Position = vec4(a_pos.xy, 0.0, 1.0); }`;

SH.skyGenFS = `
in vec2 v_uv;
uniform vec3 u_sunDir, u_sunCol, u_zenith, u_horizon, u_horizonSun, u_cloudCol, u_cloudShadow;
uniform vec4 u_cloud;  // coverage, density, scale, seed
uniform float u_exposureIn;
out vec4 o;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 7; i++) { s += a * vn(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
void main() {
  float phi = (v_uv.x - 0.5) * 6.2831853;
  float th = v_uv.y * 3.14159265;  // texture v = acos(dir.y)/pi
  vec3 d = vec3(sin(th) * sin(phi), cos(th), -sin(th) * cos(phi));
  float y = max(d.y, 0.0);
  float sd = max(dot(d, u_sunDir), 0.0);
  // atmosphere gradient
  vec3 hz = mix(u_horizon, u_horizonSun, pow(sd, 3.0) * smoothstep(0.6, 0.0, y));
  vec3 col = mix(hz, u_zenith, pow(y, 0.45));
  col += u_sunCol * (pow(sd, 6.0) * 0.25 + pow(sd, 64.0) * 0.6);
  // clouds on a virtual plane
  if (d.y > 0.0) {
    vec2 cp = d.xz / (d.y + 0.12) * u_cloud.z + u_cloud.w;
    vec2 warp = vec2(fbm(cp * 0.6), fbm(cp * 0.6 + 7.1));
    float c = fbm(cp + warp * 1.4);
    float cov = smoothstep(1.0 - u_cloud.x, 1.0 - u_cloud.x + 0.28, c);
    // light: sample toward sun for self-shadow
    vec2 sp = cp + u_sunDir.xz * 0.35;
    float cs = fbm(sp + warp * 1.4);
    float shadow = smoothstep(1.0 - u_cloud.x, 1.0, cs);
    vec3 cc = mix(u_cloudCol, u_cloudShadow, shadow * 0.8);
    cc += u_sunCol * pow(sd, 8.0) * (1.0 - cov) * 1.5;   // silver lining
    float fade = smoothstep(0.0, 0.18, d.y);
    col = mix(col, cc, cov * u_cloud.y * fade);
  } else {
    col = mix(u_horizon, u_horizon * 0.6, smoothstep(0.0, -0.3, d.y));
  }
  o = vec4(col, 1.0);
}`;

// --------------------------------------------------------------------------- unlit / UI / particles / depth
SH.unlitVS = `
${'$COMMON'}
layout(location=0) in vec3 a_pos; layout(location=2) in vec4 a_col; layout(location=3) in vec2 a_ext;
uniform mat4 u_model;
out vec4 v_col; out vec2 v_ext; out vec3 v_wp;
void main() { vec4 wp = u_model * vec4(a_pos, 1.0); v_wp = wp.xyz; v_col = a_col; v_ext = a_ext; gl_Position = u_viewProj * wp; }`;

SH.unlitFS = `
in vec4 v_col; in vec2 v_ext; in vec3 v_wp;
uniform vec4 u_color;
out vec4 o;
void main() { vec4 c = v_col * u_color; o = vec4(c.rgb * c.a, c.a); }`;

SH.uiVS = `
${'$COMMON'}
layout(location=0) in vec3 a_pos; layout(location=3) in vec2 a_ext;
uniform mat4 u_model;
out vec2 v_uv;
void main() { v_uv = a_ext; gl_Position = u_viewProj * u_model * vec4(a_pos, 1.0); }`;

SH.uiFS = `
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_opacity;
out vec4 o;
void main() { vec4 c = texture(u_tex, v_uv); o = c * u_opacity; }`;

SH.partVS = `
${'$COMMON'}
layout(location=0) in vec3 a_pos; layout(location=4) in vec4 a_i0; layout(location=5) in vec4 a_i1;
uniform vec3 u_camRight, u_camUp;
out vec4 v_col; out vec2 v_uv;
void main() {
  vec3 wp = a_i0.xyz + (u_camRight * a_pos.x + u_camUp * a_pos.y) * a_i0.w;
  v_uv = a_pos.xy;
  v_col = a_i1;
  gl_Position = u_viewProj * vec4(wp, 1.0);
}`;

SH.partFS = `
in vec4 v_col; in vec2 v_uv;
out vec4 o;
void main() { float d = length(v_uv); float a = smoothstep(1.0, 0.3, d) * v_col.a; o = vec4(v_col.rgb * a, a); }`;

SH.depthVS = `
layout(location=0) in vec3 a_pos; layout(location=2) in vec4 a_col;
uniform mat4 u_viewProj;
uniform float u_time;
uniform vec4 u_wind;
#ifdef INSTANCED
layout(location=4) in vec4 a_i0; layout(location=5) in vec4 a_i1;
#else
uniform mat4 u_model;
#endif
void main() {
#ifdef INSTANCED
  float c = cos(a_i1.x), s = sin(a_i1.x);
  vec3 p = a_pos * a_i0.w;
  p = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
  float sway = a_col.a * a_i1.z;
  float ph = a_i0.x * 0.07 + a_i0.z * 0.05 + a_i1.w;
  float g = sin(u_time * 1.1 + ph) * 0.6 + sin(u_time * 2.3 + ph * 1.7) * 0.25 + u_wind.w * 0.4;
  p.xz += vec2(u_wind.x, u_wind.y) * g * sway * u_wind.z * (0.5 + p.y * 0.08);
  vec3 wp = p + a_i0.xyz;
#else
  vec3 wp = (u_model * vec4(a_pos, 1.0)).xyz;
#endif
  gl_Position = u_viewProj * vec4(wp, 1.0);
}`;
SH.depthFS = `out vec4 o; void main() { o = vec4(1.0); }`;

function buildShaders(glx) {
  const C = s => s.split("${'$COMMON'}").join(SH.common).split('$COMMON').join(SH.common);
  const P = {};
  P.lit = glx.compile('lit', C(SH.litVS), C(SH.litFS));
  P.litInst = glx.compile('litInst', C(SH.litVS), C(SH.litFS), '#define INSTANCED');
  P.terrain = glx.compile('terrain', C(SH.terrainVS), C(SH.terrainFS));
  P.grass = glx.compile('grass', C(SH.grassVS), C(SH.grassFS));
  P.water = glx.compile('water', C(SH.waterVS), C(SH.waterFS));
  P.sky = glx.compile('sky', C(SH.skyVS), C(SH.skyFS));
  P.skyGen = glx.compile('skyGen', SH.skyGenVS, SH.skyGenFS);
  P.unlit = glx.compile('unlit', C(SH.unlitVS), SH.unlitFS);
  P.ui = glx.compile('ui', C(SH.uiVS), SH.uiFS);
  P.part = glx.compile('part', C(SH.partVS), SH.partFS);
  P.depth = glx.compile('depth', SH.depthVS, SH.depthFS);
  P.depthInst = glx.compile('depthInst', SH.depthVS, SH.depthFS, '#define INSTANCED');
  return P;
}
