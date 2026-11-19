'use strict';
// ============================================================================
// The three courses: GREEN VALLEY, SUNSET COAST, MOUNTAIN RESORT
// Each map: own terrain function, routing (6 holes), lakes/ocean, palette,
// vegetation, landmarks, ambience and default time of day.
// ============================================================================

const sunFrom = (azDeg, elDeg) => { const a = deg(azDeg), e = deg(elDeg); return V3.norm([0, 0, 0], [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)]); };

const TIMES = {
  morning: {
    el: 21, sunCol: [2.75, 2.3, 1.8], sky: [0.36, 0.44, 0.64], gnd: [0.17, 0.16, 0.12], fog: [0.72, 0.78, 0.86], fogSun: [1.05, 0.88, 0.68],
    zenith: [0.13, 0.3, 0.68], horizon: [0.68, 0.76, 0.86], horizonSun: [1.1, 0.86, 0.62], cloud: [1.35, 1.28, 1.2], cloudShadow: [0.5, 0.52, 0.6], coverage: 0.32, exposure: 1.0, disc: [0.00012, 60],
  },
  noon: {
    el: 56, sunCol: [3.0, 2.88, 2.65], sky: [0.4, 0.5, 0.72], gnd: [0.18, 0.2, 0.12], fog: [0.68, 0.77, 0.9], fogSun: [0.95, 0.93, 0.86],
    zenith: [0.14, 0.33, 0.74], horizon: [0.6, 0.74, 0.92], horizonSun: [0.85, 0.86, 0.88], cloud: [1.45, 1.45, 1.45], cloudShadow: [0.55, 0.6, 0.7], coverage: 0.48, exposure: 0.92, disc: [0.0001, 70],
  },
  sunset: {
    el: 6.5, sunCol: [2.7, 1.45, 0.72], sky: [0.36, 0.33, 0.5], gnd: [0.17, 0.12, 0.1], fog: [0.84, 0.6, 0.52], fogSun: [1.5, 0.78, 0.36],
    zenith: [0.11, 0.16, 0.4], horizon: [0.95, 0.6, 0.47], horizonSun: [1.6, 0.74, 0.3], cloud: [1.5, 0.88, 0.68], cloudShadow: [0.36, 0.3, 0.46], coverage: 0.4, exposure: 1.05, disc: [0.00018, 26],
  },
};

const MAPS = [];

// ---------------------------------------------------------------- MAP 1: GREEN VALLEY
MAPS.push({
  id: 'valley', key: 'map_valley', seed: 1201, size: 800, bounds: 372, defaultTime: 'noon', sunAz: { morning: 95, noon: 160, sunset: 255 },
  airDensity: 1.2, wind: [0.8, 0.6, 2.4],
  low(x, z) {
    const e = Math.max(Math.abs(x), Math.abs(z));
    let low = 16 * fbm(x / 320 + 3.1, z / 320 - 2.7, 4) + 6 * fbm(x / 110 + 7, z / 110, 3);
    low += smoothstep(330, 405, e + 12 * fbm(x / 60, z / 60, 2)) * (36 + 22 * fbm(x / 80, z / 80, 3));
    return low;
  },
  high(x, z) { return 1.15 * fbm(x / 28 + 1, z / 28, 3) + 0.22 * fbm(x / 8, z / 8, 2); },
  holes: [
    { par: 4, tee: [-322, 322], via: [[-300, 200], [-242, 82]], green: [-214, 14], greenR: [16, 13] },
    { par: 3, tee: [-180, -22], green: [-42, -100], greenR: [15, 12], fairwayStart: 1.0 },
    { par: 5, tee: [-22, -152], via: [[60, -258], [200, -298]], green: [330, -200], greenR: [17, 13], fairwayW: 34 },
    { par: 4, tee: [322, -168], via: [[282, -22]], green: [200, 150], greenR: [15, 12] },
    { par: 3, tee: [172, 178], green: [60, 262], greenR: [14, 12], fairwayStart: 1.0 },
    { par: 4, tee: [32, 302], via: [[-80, 332], [-200, 312]], green: [-246, 288], greenR: [15, 13] },
  ],
  lakes: [{ x: -112, z: -58, r: 34, depth: 3 }, { x: 112, z: 222, r: 20, depth: 2 }, { x: 150, z: -205, r: 40, depth: 3.5 }, { x: -330, z: 60, r: 26, depth: 2.5 }],
  palette: {
    rough: [0.24, 0.37, 0.13], rough2: [0.34, 0.4, 0.15], fair: [0.35, 0.55, 0.19], green: [0.36, 0.61, 0.25], sand: [0.87, 0.76, 0.55], tee: [0.36, 0.56, 0.2],
    rock: [0.46, 0.44, 0.4], dirt: [0.35, 0.27, 0.18], snow: [0.95, 0.96, 1.0], grassBase: [0.12, 0.26, 0.06], grassTip: [0.42, 0.6, 0.18],
    waterShallow: [0.22, 0.42, 0.33], waterDeep: [0.03, 0.11, 0.13], snowLine: 9999, flag: [0.92, 0.15, 0.12],
  },
  vegPal: { leaf: [0.24, 0.44, 0.12], bark: [0.36, 0.26, 0.18], needle: [0.12, 0.3, 0.16], birch: [0.45, 0.62, 0.2], bush: [0.2, 0.4, 0.12], blossom: [0.95, 0.85, 0.9], rock: [0.52, 0.5, 0.46], moss: [0.3, 0.42, 0.15] },
  species: ['oak', 'birch', 'pine'],
  vegetation: {
    density: 0.78, step: 6.5, bushes: 0.08, rocks: 0.012, flowers: 0.12,
    pick(rng, x, z, h) { const r = rng(); if (h > 22 && r < 0.6) return SPECIES.pine; return r < 0.6 ? SPECIES.oak : r < 0.8 ? SPECIES.birch : SPECIES.pine; },
  },
  far: { r0: 950, r1: 3300, height: 620, snow: 430, color: [0.32, 0.38, 0.42], base: -10, seed: 4 },
  landmarks(c, gb) {
    const y = c.height(-352, 352);
    GEO.house(gb, -352, y, 352, 26, 14, 6, 0.785, [0.93, 0.9, 0.84], [0.62, 0.2, 0.15], { roofH: 4.5, chimney: true });
    GEO.windmill(gb, -230, c.height(-230, 375), 375);
    const by = c.height(-330, 30) + 0.2;
    GEO.bridge(gb, -360, c.height(-360, 60), 60, -300, c.height(-300, 60), 60, 2.6);
  },
  ambience: { birds: 1.0, wind: 0.45, ocean: 0, insects: 0.4, stream: 0.0 },
});

// ---------------------------------------------------------------- MAP 2: SUNSET COAST
function coastD(x, z) {
  const west = x + 286 + 34 * fbm(z / 140 + 2, 1.3, 3) - 98 * Math.exp(-Math.pow((z - 26) / 33, 2)) * smoothstep(-330, -200, x);
  const south = (328 + 28 * fbm(x / 130, 4.4, 3)) - z;
  return Math.min(west, south);
}
MAPS.push({
  id: 'coast', key: 'map_coast', seed: 2207, size: 800, bounds: 372, defaultTime: 'sunset', sunAz: { morning: 80, noon: 190, sunset: 250 },
  airDensity: 1.225, wind: [-0.85, -0.5, 4.2], ocean: { level: 0 },
  low(x, z) {
    const d = coastD(x, z);
    const ne = Math.max(x, -z);
    let inland = 9 + 9 * fbm(x / 260, z / 260 + 3, 3) + 22 * smoothstep(150, 560, d) + smoothstep(330, 410, ne + 10 * fbm(x / 50, z / 50, 2)) * 34;
    const beachMask = smoothstep(0.05, 0.35, fbm((x + z) / 110 + 5, (x - z) / 160, 2));
    const cliff = smoothstep(-2, 9, d), beach = smoothstep(-26, 70, d);
    const prof = lerp(cliff, beach, beachMask);
    return inland * prof - 2.0 * (1 - prof) - Math.max(-d, 0) * 0.22;
  },
  high(x, z) { return (0.85 * fbm(x / 24, z / 24, 3) + 0.2 * fbm(x / 7, z / 7, 2)) * smoothstep(-5, 25, coastD(x, z)); },
  beach(x, z, h) { return h < 3.0 && coastD(x, z) < 55; },
  holes: [
    { par: 4, tee: [-120, -330], via: [[-170, -200]], green: [-215, -75], greenR: [15, 12] },
    { par: 3, tee: [-228, -42], green: [-250, 104], greenR: [14, 12], fairwayStart: 1.0, autoBunkers: true },
    { par: 5, tee: [-200, 150], via: [[-100, 230], [40, 260]], green: [200, 230], greenR: [17, 13], fairwayW: 34 },
    { par: 4, tee: [235, 185], via: [[262, 60]], green: [225, -85], greenR: [15, 12] },
    { par: 3, tee: [190, -125], green: [60, -150], greenR: [14, 12], fairwayStart: 1.0 },
    { par: 4, tee: [130, -170], via: [[40, -270]], green: [-60, -310], greenR: [15, 12] },
  ],
  lakes: [{ x: 125, z: -128, r: 22, depth: 2.5 }, { x: 60, z: 120, r: 28, depth: 2.5 }],
  palette: {
    rough: [0.32, 0.4, 0.15], rough2: [0.44, 0.44, 0.2], fair: [0.38, 0.56, 0.2], green: [0.36, 0.6, 0.25], sand: [0.92, 0.82, 0.62], tee: [0.38, 0.56, 0.21],
    rock: [0.58, 0.48, 0.38], dirt: [0.45, 0.36, 0.25], snow: [1, 1, 1], grassBase: [0.17, 0.28, 0.07], grassTip: [0.5, 0.6, 0.22],
    waterShallow: [0.16, 0.62, 0.6], waterDeep: [0.02, 0.12, 0.24], snowLine: 9999, flag: [0.98, 0.75, 0.1],
  },
  vegPal: { leaf: [0.26, 0.42, 0.14], bark: [0.4, 0.3, 0.2], needle: [0.16, 0.32, 0.17], palm: [0.27, 0.5, 0.15], bush: [0.2, 0.4, 0.13], blossom: [0.95, 0.3, 0.6], rock: [0.62, 0.52, 0.42] },
  species: ['palm', 'pine', 'oak'],
  vegetation: {
    density: 0.5, step: 7, bushes: 0.12, rocks: 0.02, flowers: 0.08, beachTrees: 0.9, cliffTrees: 0.05, rockMax: 4,
    pick(rng, x, z, h) { const d = coastD(x, z); const r = rng(); if (d < 170) return r < 0.85 ? SPECIES.palm : SPECIES.pine; return r < 0.45 ? SPECIES.palm : r < 0.8 ? SPECIES.pine : SPECIES.oak; },
  },
  far: { r0: 950, r1: 3000, height: 380, snow: 9999, color: [0.4, 0.36, 0.36], base: -20, seed: 9, mask: a => { const dx = Math.cos(a), dz = Math.sin(a); return smoothstep(-0.1, 0.5, dx) * smoothstep(0.2, -0.4, dz) * 0.9 + 0.1 * smoothstep(0, 0.5, -dz); } },
  landmarks(c, gb) {
    GEO.lighthouse(gb, -268, c.height(-268, -165), -165);
    GEO.house(gb, 300, c.height(300, 290), 290, 22, 12, 5, -0.6, [0.96, 0.94, 0.9], [0.75, 0.4, 0.25], { roofH: 3 });
    const boats = [[-470, 80, 0.4], [-420, 380, 1.2], [-180, 470, 2.0], [60, 520, 0.9], [-560, -200, 2.6]];
    for (const [x, z, yaw] of boats) GEO.sailboat(gb, x, 0, z, yaw);
    // beach umbrellas where there is beach
    const rng = mulberry32(77); let n = 0;
    for (let k = 0; k < 4000 && n < 16; k++) {
      const x = -320 + rng() * 640, z = -320 + rng() * 680; const h = c.height(x, z);
      if (h > 0.6 && h < 2.2 && c.surface(x, z) === SURF.BEACH) { GEO.umbrella(gb, x, h, z, [[0.9, 0.2, 0.2], [0.15, 0.5, 0.85], [0.95, 0.75, 0.15]][n % 3]); n++; }
    }
  },
  ambience: { birds: 0.35, wind: 0.6, ocean: 1.0, insects: 0.15, gulls: 1.0 },
});

// ---------------------------------------------------------------- MAP 3: MOUNTAIN RESORT
MAPS.push({
  id: 'mountain', key: 'map_mountain', seed: 3313, size: 800, bounds: 372, defaultTime: 'morning', sunAz: { morning: 112, noon: 175, sunset: 245 },
  airDensity: 1.0, wind: [0.4, 0.9, 3.0],
  low(x, z) {
    const e = Math.max(Math.abs(x), Math.abs(z));
    const wall = smoothstep(338, 430, e + 22 * fbm(x / 70, z / 70, 2));
    return 18 * fbm(x / 300 + 1, z / 300 + 4, 4) + 7 * fbm(x / 90, z / 90, 3) - z * 0.035 + wall * (70 + 150 * ridged(x / 170 + 3, z / 170, 4));
  },
  high(x, z) {
    const e = Math.max(Math.abs(x), Math.abs(z));
    return 1.35 * fbm(x / 26, z / 26, 3) + 0.4 * fbm(x / 7, z / 7, 2) + smoothstep(338, 430, e) * 6 * ridged(x / 30, z / 30, 3);
  },
  holes: [
    { par: 4, tee: [-290, -318], via: [[-182, -172]], green: [-100, -88], greenR: [15, 12] },
    { par: 3, tee: [-60, -60], green: [60, -10], greenR: [14, 12], fairwayStart: 1.0 },
    { par: 5, tee: [90, -82], via: [[200, 40], [240, 170]], green: [190, 290], greenR: [17, 13], fairwayW: 34 },
    { par: 4, tee: [140, 322], via: [[40, 292]], green: [-110, 270], greenR: [15, 12] },
    { par: 3, tee: [-140, 230], green: [-200, 110], greenR: [14, 12], fairwayStart: 1.0 },
    { par: 4, tee: [-232, 70], via: [[-298, -40]], green: [-322, -200], greenR: [15, 12] },
  ],
  lakes: [{ x: 4, z: -6, r: 32, depth: 4, drop: 1.6 }, { x: 132, z: 160, r: 26, depth: 3 }, { x: -40, z: 150, r: 30, depth: 3 }],
  palette: {
    rough: [0.22, 0.34, 0.13], rough2: [0.32, 0.36, 0.16], fair: [0.32, 0.52, 0.19], green: [0.33, 0.58, 0.24], sand: [0.82, 0.76, 0.62], tee: [0.33, 0.53, 0.2],
    rock: [0.36, 0.355, 0.37], dirt: [0.33, 0.28, 0.22], snow: [0.93, 0.95, 0.99], grassBase: [0.1, 0.22, 0.07], grassTip: [0.38, 0.52, 0.18],
    waterShallow: [0.2, 0.44, 0.5], waterDeep: [0.02, 0.09, 0.16], snowLine: 165, flag: [0.15, 0.4, 0.9],
  },
  vegPal: { leaf: [0.22, 0.4, 0.13], bark: [0.3, 0.22, 0.16], needle: [0.1, 0.26, 0.15], birch: [0.48, 0.6, 0.2], bush: [0.16, 0.33, 0.12], rock: [0.55, 0.55, 0.57], moss: [0.25, 0.38, 0.14] },
  species: ['pine', 'birch', 'oak'],
  vegetation: {
    density: 0.85, step: 6, bushes: 0.05, rocks: 0.05, flowers: 0.1, treeline: 125, rockMax: 3.5, cliffTrees: 0.2,
    pick(rng, x, z, h) { const r = rng(); return r < 0.82 ? SPECIES.pine : r < 0.95 ? SPECIES.birch : SPECIES.oak; },
  },
  far: { r0: 900, r1: 3100, height: 1100, snow: 420, color: [0.36, 0.4, 0.46], base: 40, seed: 17 },
  landmarks(c, gb) {
    GEO.chalet(gb, -336, c.height(-336, -352) - 1, -352, 0.5);
    GEO.house(gb, -250, c.height(-250, -372), -372, 10, 8, 4, 0.2, [0.45, 0.3, 0.18], [0.3, 0.22, 0.17], { roofH: 3.2 });
    GEO.cableCar(gb, -360, c.height(-360, -300), -300, -560, 260, -560);
    GEO.bridge(gb, 100, c.height(100, 160), 160, 160, c.height(160, 160), 160, 2.4);
  },
  ambience: { birds: 0.6, wind: 0.8, ocean: 0, insects: 0.1, stream: 0.5, cowbells: 0.4 },
});

const SPECIES = {
  oak: { id: 'oak', variants: 3, scaleMin: 0.8, scaleMax: 1.3, gen: GEO.deciduous },
  birch: { id: 'birch', variants: 3, scaleMin: 0.8, scaleMax: 1.25, gen: GEO.birch },
  pine: { id: 'pine', variants: 3, scaleMin: 0.75, scaleMax: 1.35, gen: GEO.pine },
  palm: { id: 'palm', variants: 3, scaleMin: 0.85, scaleMax: 1.3, gen: GEO.palm },
};
