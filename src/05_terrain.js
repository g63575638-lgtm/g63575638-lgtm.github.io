'use strict';
// ============================================================================
// Course generation: heightfield, surface classification, lakes, holes,
// vegetation placement and baked lighting. Shared by renderer and physics,
// so the ball rolls on exactly the surface you see.
// ============================================================================

const SURF = { ROUGH: 0, FAIRWAY: 1, GREEN: 2, SAND: 3, TEE: 4, FRINGE: 5, DEEP: 6, WATER: 7, ROCK: 8, BEACH: 9, PATH: 10 };
const SURF_NAMES = ['rough', 'fairway', 'green', 'sand', 'tee', 'fringe', 'deep', 'water', 'rock', 'beach', 'path'];

// physical surface properties: e = restitution, mu = slide friction, roll = rolling resistance coefficient,
// lie = [ball speed factor, spin factor] for shots from this lie
const SURF_PHYS = [
  { e: 0.28, mu: 0.55, roll: 0.30, tl: 0.38, lie: [0.86, 0.55], bump: 0.020 },   // rough
  { e: 0.40, mu: 0.42, roll: 0.11, tl: 0.26, lie: [1.0, 1.0], bump: 0.006 },    // fairway
  { e: 0.30, mu: 0.48, roll: 0.058, tl: 0.2, lie: [1.0, 1.0], bump: 0.0008 },   // green
  { e: 0.05, mu: 0.90, roll: 1.60, lie: [0.62, 0.45], bump: 0.0 },     // sand
  { e: 0.40, mu: 0.42, roll: 0.11, tl: 0.26, lie: [1.0, 1.0], bump: 0.004 },     // tee
  { e: 0.33, mu: 0.48, roll: 0.15, tl: 0.28, lie: [0.97, 0.9], bump: 0.004 },    // fringe
  { e: 0.2, mu: 0.65, roll: 0.55, tl: 0.5, lie: [0.7, 0.35], bump: 0.03 },     // deep rough
  { e: 0.0, mu: 1.0, roll: 5.0, lie: [0.3, 0.1], bump: 0 },            // water
  { e: 0.55, mu: 0.30, roll: 0.06, lie: [0.9, 0.8], bump: 0.04 },      // rock
  { e: 0.06, mu: 0.85, roll: 1.30, lie: [0.7, 0.5], bump: 0.0 },       // beach sand
  { e: 0.6, mu: 0.3, roll: 0.03, lie: [1.0, 0.9], bump: 0.0 },         // path
];

class Course {
  constructor(def, opts = {}) {
    this.def = def;
    this.size = def.size || 800;
    this.half = this.size / 2;
    this.min = -this.half;
    this.cell = 1;
    this.N = this.size + 1;      // vertices per side
    this.time = opts.time || def.defaultTime;
    this.rng = mulberry32(def.seed);
  }

  // ------------------------------------------------------------ layout prep
  prepareHoles() {
    const def = this.def; const rng = mulberry32(def.seed * 7 + 1);
    this.holes = def.holes.map((h, i) => {
      const path = [h.tee, ...(h.via || []), h.green];
      let len = 0; for (let k = 0; k < path.length - 1; k++) len += Math.hypot(path[k + 1][0] - path[k][0], path[k + 1][1] - path[k][1]);
      const dir0 = V3.norm([0, 0, 0], [path[1][0] - path[0][0], 0, path[1][1] - path[0][1]]);
      const last = path[path.length - 2]; const g = h.green;
      const appr = V3.norm([0, 0, 0], [g[0] - last[0], 0, g[1] - last[1]]);
      const gr = h.greenR || [15, 12];
      const cupOff = h.cup || [(rng() - 0.5) * gr[0] * 0.7, (rng() - 0.5) * gr[1] * 0.7];
      // cup offset in green-local (along approach, across)
      const cup = [g[0] + appr[0] * cupOff[0] - appr[2] * cupOff[1], g[1] + appr[2] * cupOff[0] + appr[0] * cupOff[1]];
      const fw = h.fairwayW || 32;
      const bunkers = (h.bunkers || []).slice();
      if (h.autoBunkers !== false) {
        // greenside bunkers
        const nb = 1 + (rng() * 2.4 | 0);
        for (let b = 0; b < nb; b++) {
          const ang = (rng() < 0.5 ? -1 : 1) * (0.9 + rng() * 1.3) + (b === 2 ? PI : 0);
          const ca = Math.cos(ang), sa = Math.sin(ang);
          const ex = -appr[0] * ca - appr[2] * sa, ez = -appr[2] * ca + appr[0] * sa;
          const rr = gr[0] * 0.9 + 6;
          bunkers.push([g[0] + ex * rr, g[1] + ez * rr, 4.5 + rng() * 3, 2.5 + rng() * 1.5, Math.atan2(ex, ez)]);
        }
        // fairway bunker in landing zone of longer holes
        if (len > 260) {
          const t = clamp(225 / len, 0.3, 0.75); const p = this.pointAlong(path, t);
          const side = rng() < 0.5 ? -1 : 1; const o = fw / 2 + 3 + rng() * 4;
          bunkers.push([p[0] - p[3] * side * o, p[1] + p[2] * side * o, 6 + rng() * 4, 3 + rng() * 2, Math.atan2(p[2], p[3])]);
        }
      }
      const segs = []; let acc = 0; let bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9;
      for (let k = 0; k < path.length - 1; k++) {
        const ax = path[k][0], az = path[k][1], dx = path[k + 1][0] - ax, dz = path[k + 1][1] - az, l = Math.hypot(dx, dz);
        segs.push([ax, az, dx, dz, l, acc]); acc += l;
      }
      for (const p of path) { bx0 = Math.min(bx0, p[0]); bx1 = Math.max(bx1, p[0]); bz0 = Math.min(bz0, p[1]); bz1 = Math.max(bz1, p[1]); }
      const pad = 95;
      return {
        segs, bbox: [bx0 - pad, bx1 + pad, bz0 - pad, bz1 + pad],
        index: i, par: h.par, path, len, tee: h.tee, green: g, greenR: gr, appr, dir0, cup, fw, bunkers,
        fairwayStart: h.fairwayStart !== undefined ? h.fairwayStart : (h.par === 3 ? 1.0 : 0.2),
        teeYaw: Math.atan2(dir0[0], dir0[2]), greenYaw: Math.atan2(appr[0], appr[2]),
        tilt: [(rng() - 0.5) * 0.03, (rng() - 0.5) * 0.03],
      };
    });
  }
  pointAlong(path, t) { // returns [x,z,dirx,dirz]
    let total = 0; const L = [];
    for (let k = 0; k < path.length - 1; k++) { const l = Math.hypot(path[k + 1][0] - path[k][0], path[k + 1][1] - path[k][1]); L.push(l); total += l; }
    let d = t * total;
    for (let k = 0; k < L.length; k++) {
      if (d <= L[k] || k === L.length - 1) { const f = clamp(d / L[k], 0, 1); const dx = (path[k + 1][0] - path[k][0]) / L[k], dz = (path[k + 1][1] - path[k][1]) / L[k]; return [path[k][0] + (path[k + 1][0] - path[k][0]) * f, path[k][1] + (path[k + 1][1] - path[k][1]) * f, dx, dz]; }
      d -= L[k];
    }
  }

  // ------------------------------------------------------------ analytic composition
  // returns {h, surf, wfair, wgreen, wsand, wtee, wet}
  evalPoint(x, z, wantSurf) {
    const def = this.def;
    const low = this.lowAt(x, z), high = def.high(x, z);
    let corridor = 0, green = 0, tee = 0, sand = 0, fair = 0, fringeF = 0, fringeG = 0, deepness = 1;
    let h;
    let target = null, tw = 0;
    const dp = this._dp || (this._dp = { d: 0, t: 0, len: 0 });
    for (const hole of this.holes) {
      const bb = hole.bbox;
      if (x < bb[0] || x > bb[1] || z < bb[2] || z > bb[3]) continue;
      // fast polyline distance
      let best = 1e18, bt = 0;
      for (const sg of hole.segs) {
        const L2 = sg[4] * sg[4] || 1; let t = ((x - sg[0]) * sg[2] + (z - sg[1]) * sg[3]) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = sg[0] + sg[2] * t - x, qz = sg[1] + sg[3] * t - z; const d2 = qx * qx + qz * qz;
        if (d2 < best) { best = d2; bt = sg[5] + t * sg[4]; }
      }
      dp.d = Math.sqrt(best); dp.len = hole.len; dp.t = bt / hole.len;
      if (dp.d > hole.fw / 2 + 80 && Math.hypot(x - hole.green[0], z - hole.green[1]) > 80) continue;
      const fwHalf = hole.fw / 2 * (1 + 0.22 * vnoise(x * 0.02 + hole.index * 13, z * 0.02));
      corridor = Math.max(corridor, smoothstep(fwHalf + 30, fwHalf + 4, dp.d));
      deepness = Math.min(deepness, smoothstep(fwHalf + 18, fwHalf + 45, dp.d));
      // fairway
      if (dp.t * dp.len > hole.fairwayStart * 60 && dp.t < 0.999) {
        const fe = 1 - smoothstep(fwHalf - 0.5, fwHalf + 0.5, dp.d);
        // fairway fades before green and after tee carry
        const tz = smoothstep(hole.fairwayStart * 60 - 8, hole.fairwayStart * 60 + 4, dp.t * dp.len);
        fair = Math.max(fair, fe * tz);
        fringeF = Math.max(fringeF, (1 - smoothstep(fwHalf + 1.0, fwHalf + 2.6, dp.d)) * tz);
      }
      // green ellipse (oriented along approach)
      const gx = x - hole.green[0], gz = z - hole.green[1];
      const ga = gx * hole.appr[0] + gz * hole.appr[2], gc = -gx * hole.appr[2] + gz * hole.appr[0];
      const gn = Math.hypot(ga / hole.greenR[0], gc / hole.greenR[1]) * (1 + 0.08 * vnoise(x * 0.15, z * 0.15));
      if (gn < 1.0) green = 1; else fringeG = Math.max(fringeG, 1 - smoothstep(1.0, 1.18, gn));
      if (gn < 1.6) {
        const gw = smoothstep(1.7, 1.05, gn);
        const gh = this.greenHeight(hole, x, z);
        if (gw > tw) { target = gh; tw = gw; }
      }
      // tee box (rectangle 10 x 16 along dir0)
      const tx = x - hole.tee[0], tz2 = z - hole.tee[1];
      const ta = tx * hole.dir0[0] + tz2 * hole.dir0[2], tc = -tx * hole.dir0[2] + tz2 * hole.dir0[0];
      const tdist = Math.max(Math.abs(ta) / 9, Math.abs(tc) / 5.5);
      if (tdist < 1) tee = 1;
      if (tdist < 1.8) {
        const tw2 = smoothstep(1.6, 1.0, tdist);
        if (tw2 > tw) { tw = tw2; target = this.teeHeight(hole); }
      }
      // bunkers
      for (const b of hole.bunkers) {
        if (Math.abs(x - b[0]) > 15 || Math.abs(z - b[1]) > 15) { b.__w = 0; continue; }
        const bx = x - b[0], bz = z - b[1]; const ca = Math.cos(b[4] || 0), sa = Math.sin(b[4] || 0);
        const u = (bx * ca - bz * sa) / b[2], v = (bx * sa + bz * ca) / b[3];
        const bd = Math.hypot(u, v) * (1 + 0.18 * vnoise(x * 0.3 + 5, z * 0.3));
        if (bd < 1) sand = Math.max(sand, 1);
        if (bd < 1.35) b.__w = smoothstep(1.3, 0.75, bd); else b.__w = 0;
      }
    }
    // compose height
    h = low + high * (1 - 0.85 * corridor);
    if (tw > 0 && target !== null) h = lerp(h, target, tw);
    // bunker depressions (applied after green/tee)
    for (const hole of this.holes) for (const b of hole.bunkers) if (b.__w) {
      h -= 0.65 * b.__w; b.__w = 0;
    }
    // lakes
    let wet = 0, lakeIdx = -1;
    for (let li = 0; li < this.lakes.length; li++) {
      const L = this.lakes[li];
      const dx = x - L.x, dz = z - L.z;
      if (Math.abs(dx) > L.r * 2.8 || Math.abs(dz) > L.r * 2.8) continue;
      const ang = Math.atan2(dz, dx);
      const rr = L.r * (1 + 0.22 * vnoise(Math.cos(ang) * 1.6 + li * 7, Math.sin(ang) * 1.6) + 0.08 * vnoise(Math.cos(ang) * 5, Math.sin(ang) * 5 + li));
      const d = Math.hypot(dx * (L.sx || 1), dz) / rr;
      if (d < 2.0) {
        const tgt = d < 1 ? L.level - L.depth * (1 - d * d) - 0.25 : L.level + (d - 1) * 2.2;
        const w = smoothstep(2.0, 1.0, d);
        h = lerp(h, Math.min(h, tgt), w);
        if (d < 1.4) h = Math.min(h, tgt);
        // shoreline berm keeps water inside the lake basin
        if (d > 1.0 && d < 1.7 && tw < 0.3) h = Math.max(h, lerp(h, L.level + 0.12 + (d - 1) * 1.2, smoothstep(1.7, 1.25, d)));
      }
      if (h < L.level && d < 1.3) { wet = 1; lakeIdx = li; }
    }
    if (def.ocean && h < def.ocean.level) { wet = 1; lakeIdx = -2; }
    if (!wantSurf) return { h };
    let surf = SURF.ROUGH;
    if (wet) surf = SURF.WATER;
    else if (green) surf = SURF.GREEN;
    else if (tee) surf = SURF.TEE;
    else if (sand) surf = SURF.SAND;
    else if (fair > 0.5) surf = SURF.FAIRWAY;
    else if (fringeG > 0.4 || fringeF > 0.4) surf = SURF.FRINGE;
    else if (def.beach && def.beach(x, z, h)) surf = SURF.BEACH;
    else if (deepness > 0.6) surf = SURF.DEEP;
    return { h, surf, fair: Math.max(fair, Math.min(fringeF, 1) * 0.3), green: green ? 1 : fringeG * 0.3, sand: sand || (surf === SURF.BEACH ? 1 : 0), tee, wet, lakeIdx, deep: deepness };
  }

  greenHeight(hole, x, z) {
    const g = hole.green; if (hole._gBase === undefined) hole._gBase = this.lowAt(g[0], g[1]) + 0.35; const base = hole._gBase;
    const dx = x - g[0], dz = z - g[1];
    let h = base + dx * hole.tilt[0] + dz * hole.tilt[1] + 0.22 * vnoise(x * 0.07 + hole.index * 3, z * 0.07) + 0.08 * vnoise(x * 0.18, z * 0.18 + 9);
    // flatten around the cup so the hole sits level
    const cx = hole.cup[0], cz = hole.cup[1];
    const dc = Math.hypot(x - cx, z - cz);
    if (dc < 2.2) {
      const hc = hole._cupH !== undefined ? hole._cupH : (hole._cupH = base + (cx - g[0]) * hole.tilt[0] + (cz - g[1]) * hole.tilt[1] + 0.22 * vnoise(cx * 0.07 + hole.index * 3, cz * 0.07) + 0.08 * vnoise(cx * 0.18, cz * 0.18 + 9));
      h = lerp(hc, h, smoothstep(0.9, 2.2, dc));
    }
    return h;
  }
  teeHeight(hole) { if (hole._teeH === undefined) hole._teeH = this.lowAt(hole.tee[0], hole.tee[1]) + 0.55; return hole._teeH; }
  // low-frequency relief sampled on a 4 m grid with Catmull-Rom interpolation (fast + smooth)
  buildLowGrid() {
    const S = 4, M = Math.ceil(this.size / S) + 5; const o = this.min - 2 * S;
    const G = new Float32Array(M * M);
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) G[j * M + i] = this.def.low(o + i * S, o + j * S);
    this.lowG = { G, M, S, o };
  }
  lowAt(x, z) {
    const L = this.lowG; if (!L) return this.def.low(x, z);
    const gx = (x - L.o) / L.S, gz = (z - L.o) / L.S; const i = Math.floor(gx), j = Math.floor(gz); const fx = gx - i, fz = gz - j;
    if (i < 1 || j < 1 || i > L.M - 3 || j > L.M - 3) return this.def.low(x, z);
    const G = L.G, M = L.M;
    const cr = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
    let r = 0; const rows = [0, 0, 0, 0];
    for (let k = -1; k <= 2; k++) { const b = (j + k) * M + i; rows[k + 1] = cr(G[b - 1], G[b], G[b + 1], G[b + 2], fx); }
    return cr(rows[0], rows[1], rows[2], rows[3], fz);
  }

  // ------------------------------------------------------------ generation
  async generate(progress) {
    const def = this.def; const N = this.N, S = this.size, min = this.min;
    this.buildLowGrid();
    this.prepareHoles();
    this.lakes = (def.lakes || []).map(l => {
      let level = l.level !== undefined ? l.level : this.lowAt(l.x, l.z) - (l.drop || 1.2);
      let ring = 1e9; for (let a = 0; a < 24; a++) { const an = a / 24 * TAU; ring = Math.min(ring, this.lowAt(l.x + Math.cos(an) * l.r * 1.25, l.z + Math.sin(an) * l.r * 1.25)); }
      level = Math.min(level, ring - 0.5);
      return Object.assign({}, l, { level });
    });
    // single pass: height + surface at every vertex (1 m grid)
    const H = new Float32Array(N * N);
    const surfT = new Uint8Array(N * N);
    const surfTex = new Uint8Array(N * N * 4);
    const lakeMap = new Int8Array(N * N).fill(-1);
    const t0 = performance.now();
    for (let j = 0; j < N; j++) {
      const z = min + j;
      for (let i = 0; i < N; i++) {
        const x = min + i; const k = j * N + i;
        const e = this.evalPoint(x, z, true);
        H[k] = e.h; surfT[k] = e.surf; lakeMap[k] = e.lakeIdx;
        surfTex[k * 4] = e.fair * 255; surfTex[k * 4 + 1] = e.green * 255; surfTex[k * 4 + 2] = e.sand * 255; surfTex[k * 4 + 3] = e.tee * 255;
      }
      if ((j & 3) === 0) { progress && progress(0.05 + 0.62 * j / N); await nextFrame(); }
    }
    this.H = H;
    // steep natural slopes become rock (cliffs)
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i; const sf = surfT[k];
      if ((sf === SURF.ROUGH || sf === SURF.DEEP || sf === SURF.BEACH) && this.slopeAtGrid(i, j) > 0.62) surfT[k] = SURF.ROCK;
    }
    this.surfT = surfT; this.surfTex = surfTex; this.lakeMap = lakeMap;
    // hole 3D data
    for (const hole of this.holes) {
      hole.cupPos = [hole.cup[0], this.height(hole.cup[0], hole.cup[1]), hole.cup[1]];
      hole.teePos = [hole.tee[0], this.height(hole.tee[0], hole.tee[1]), hole.tee[1]];
      hole.greenPos = [hole.green[0], this.height(hole.green[0], hole.green[1]), hole.green[1]];
    }
    this.genTime = performance.now() - t0;
    progress && progress(0.72);
  }

  slopeAtGrid(i, j) {
    const N = this.N; const H = this.H;
    const i0 = clamp(i, 0, N - 2), j0 = clamp(j, 0, N - 2);
    const dx = H[j0 * N + i0 + 1] - H[j0 * N + i0], dz = H[(j0 + 1) * N + i0] - H[j0 * N + i0];
    return Math.hypot(dx, dz);
  }

  // ------------------------------------------------------------ queries (mesh-consistent)
  height(x, z) {
    const N = this.N, H = this.H;
    let gx = x - this.min, gz = z - this.min;
    gx = clamp(gx, 0, N - 1.0001); gz = clamp(gz, 0, N - 1.0001);
    const i = Math.floor(gx), j = Math.floor(gz); const fx = gx - i, fz = gz - j;
    const h00 = H[j * N + i], h10 = H[j * N + i + 1], h01 = H[(j + 1) * N + i], h11 = H[(j + 1) * N + i + 1];
    if (fx + fz < 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }
  // face normal of the triangle under (x,z)
  normal(x, z, out) {
    const N = this.N, H = this.H;
    let gx = clamp(x - this.min, 0, N - 1.0001), gz = clamp(z - this.min, 0, N - 1.0001);
    const i = Math.floor(gx), j = Math.floor(gz); const fx = gx - i, fz = gz - j;
    const h00 = H[j * N + i], h10 = H[j * N + i + 1], h01 = H[(j + 1) * N + i], h11 = H[(j + 1) * N + i + 1];
    let dx, dz;
    if (fx + fz < 1) { dx = h10 - h00; dz = h01 - h00; } else { dx = h11 - h01; dz = h11 - h10; }
    out = out || [0, 0, 0]; const l = Math.hypot(dx, 1, dz); out[0] = -dx / l; out[1] = 1 / l; out[2] = -dz / l; return out;
  }
  // smooth (vertex-interpolated) normal for visuals
  smoothNormal(x, z, out) {
    const e = 1.0; const hL = this.height(x - e, z), hR = this.height(x + e, z), hD = this.height(x, z - e), hU = this.height(x, z + e);
    out = out || [0, 0, 0]; const nx = hL - hR, nz = hD - hU, ny = 2 * e; const l = Math.hypot(nx, ny, nz); out[0] = nx / l; out[1] = ny / l; out[2] = nz / l; return out;
  }
  surface(x, z) {
    const N = this.N; const i = Math.round(x - this.min), j = Math.round(z - this.min);
    if (i < 0 || j < 0 || i >= N || j >= N) return SURF.DEEP;
    return this.surfT[j * N + i];
  }
  lakeAt(x, z) {
    const N = this.N; const i = Math.round(x - this.min), j = Math.round(z - this.min);
    if (i < 0 || j < 0 || i >= N || j >= N) return -1;
    return this.lakeMap[j * N + i];
  }
  waterLevelAt(x, z) {
    const li = this.lakeAt(x, z);
    if (li >= 0) return this.lakes[li].level;
    if (li === -2 && this.def.ocean) return this.def.ocean.level;
    if (this.def.ocean) return this.def.ocean.level;
    return -1e9;
  }
  nearWaterLevel(x, z) {
    let wl = this.def.ocean ? this.def.ocean.level : -1e9;
    for (const L of this.lakes) if (Math.abs(x - L.x) < L.r * 2.2 && Math.abs(z - L.z) < L.r * 2.2) wl = Math.max(wl, L.level);
    return wl;
  }
  inBounds(x, z) { const b = this.def.bounds || (this.half - 40); return Math.abs(x) < b && Math.abs(z) < b; }

  // ------------------------------------------------------------ vegetation placement
  placeVegetation(sunDir) {
    const def = this.def; const rng = mulberry32(def.seed * 31 + 5); const V = def.vegetation;
    const trees = [], bushes = [], rocks = [], flowers = [];
    const step = V.step || 6.5; const lim = this.half - 4;
    const holeDist = (x, z) => {
      let m = 1e9;
      for (const h of this.holes) {
        const d = distToPolyline(x, z, h.path).d - h.fw / 2; m = Math.min(m, d);
        m = Math.min(m, Math.hypot(x - h.green[0], z - h.green[1]) - h.greenR[0] - 6);
        m = Math.min(m, Math.hypot(x - h.tee[0], z - h.tee[1]) - 12);
      }
      return m;
    };
    for (let z = -lim; z < lim; z += step) for (let x = -lim; x < lim; x += step) {
      const px = x + (rng() - 0.5) * step * 0.95, pz = z + (rng() - 0.5) * step * 0.95;
      const s = this.surface(px, pz);
      if (s === SURF.WATER || s === SURF.SAND || s === SURF.GREEN || s === SURF.TEE || s === SURF.FAIRWAY) continue;
      const h = this.height(px, pz);
      const dHole = holeDist(px, pz);
      const forest = fbm(px * 0.008 + def.seed, pz * 0.008, 3) * 0.5 + 0.5;
      let p = 0;
      if (dHole > 14) p = smoothstep(14, 40, dHole) * (V.density || 0.7) * smoothstep(0.35, 0.65, forest + 0.12) + 0.04;
      if (dHole > 8 && dHole < 30) p += 0.05; // scattered specimen trees along fairways
      if (V.treeline !== undefined && h > V.treeline) p *= 0.15;
      if (s === SURF.ROCK) p *= V.cliffTrees || 0.1;
      if (s === SURF.BEACH) p *= V.beachTrees || 0.3;
      if (V.mask) p *= V.mask(px, pz, h);
      const r = rng();
      if (r < p) {
        const species = V.pick(rng, px, pz, h, s);
        trees.push({ x: px, y: h, z: pz, s: species.scaleMin + rng() * (species.scaleMax - species.scaleMin), rot: rng() * TAU, sp: species.id, v: (rng() * species.variants) | 0, tint: (rng() - 0.5) * 2, ph: rng() * TAU });
      } else if (r < p + (V.bushes || 0.08) * smoothstep(6, 20, dHole)) {
        bushes.push({ x: px + (rng() - 0.5) * 2, y: h, z: pz, s: 0.7 + rng() * 0.8, rot: rng() * TAU, v: (rng() * 3) | 0, tint: (rng() - 0.5) * 2, ph: rng() * TAU });
      }
      if (rng() < (V.rocks || 0.03) * (s === SURF.ROCK ? 4 : 1) && dHole > 6) rocks.push({ x: px, y: h - 0.2, z: pz, s: 0.4 + Math.pow(rng(), 3) * (V.rockMax || 3), rot: rng() * TAU, v: (rng() * 3) | 0, tint: (rng() - 0.5) * 2, ph: 0 });
      if (dHole > 3 && dHole < 40 && rng() < (V.flowers || 0.12) && s !== SURF.ROCK && s !== SURF.BEACH) {
        for (let k = 0; k < 3; k++) { const fx = px + (rng() - 0.5) * 4, fz = pz + (rng() - 0.5) * 4; const fs = this.surface(fx, fz); if (fs === SURF.ROUGH || fs === SURF.DEEP) flowers.push({ x: fx, y: this.height(fx, fz), z: fz, s: 0.8 + rng() * 0.6, rot: rng() * TAU, v: (rng() * 3) | 0, tint: 0, ph: rng() * TAU }); }
      }
    }
    // extra hand-placed features
    if (def.extraTrees) def.extraTrees(this, trees, rng);
    this.trees = trees; this.bushes = bushes; this.rocks = rocks; this.flowers = flowers;
    // spatial hash for ball/tree collisions
    this.treeGrid = new Map();
    for (const t of trees) { const k = this.gkey(t.x, t.z); if (!this.treeGrid.has(k)) this.treeGrid.set(k, []); this.treeGrid.get(k).push(t); }
    for (const r of rocks) if (r.s > 0.9) { const k = this.gkey(r.x, r.z); if (!this.treeGrid.has(k)) this.treeGrid.set(k, []); this.treeGrid.get(k).push(Object.assign({ rock: true }, r)); }
  }
  gkey(x, z) { return (Math.floor(x / 10) + 1000) * 4000 + (Math.floor(z / 10) + 1000); }
  nearbyObstacles(x, z, out) {
    out.length = 0; const cx = Math.floor(x / 10), cz = Math.floor(z / 10);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const l = this.treeGrid.get((cx + dx + 1000) * 4000 + (cz + dz + 1000)); if (l) for (const t of l) out.push(t); }
    return out;
  }

  // ------------------------------------------------------------ terrain mesh vertex data (AO + tree shade + wetness)
  bakeVertexData(sunDir, treeDims) {
    const N = this.N, H = this.H;
    const pos = new Float32Array(N * N * 3), nrm = new Float32Array(N * N * 3), col = new Uint8Array(N * N * 4);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i; const h = H[k];
      pos[k * 3] = this.min + i; pos[k * 3 + 1] = h; pos[k * 3 + 2] = this.min + j;
      const hl = H[j * N + Math.max(i - 1, 0)], hr = H[j * N + Math.min(i + 1, N - 1)], hd = H[Math.max(j - 1, 0) * N + i], hu = H[Math.min(j + 1, N - 1) * N + i];
      let nx = hl - hr, ny = 2, nz = hd - hu; const l = Math.hypot(nx, ny, nz);
      nrm[k * 3] = nx / l; nrm[k * 3 + 1] = ny / l; nrm[k * 3 + 2] = nz / l;
      // curvature AO
      const lap = (hl + hr + hd + hu) / 4 - h;
      const ao = clamp(1 - lap * 0.6, 0.62, 1.0);
      col[k * 4] = ao * 255; col[k * 4 + 1] = 255; col[k * 4 + 2] = 0; col[k * 4 + 3] = 255;
    }
    // wetness / underwater flag per vertex
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i; const x = this.min + i, z = this.min + j; const wl = this.nearWaterLevel(x, z);
      const h = H[k]; const w = clamp((wl + 0.35 - h) / 0.4, 0, 1);
      col[k * 4 + 2] = w * 255;
    }
    // tree shade stamps (used beyond shadow-map range) + contact AO
    const sx = -sunDir[0] / Math.max(sunDir[1], 0.15), sz = -sunDir[2] / Math.max(sunDir[1], 0.15);
    const stamp = (cx, cz, r, strength) => {
      const i0 = Math.max(0, Math.floor(cx - r - this.min)), i1 = Math.min(N - 1, Math.ceil(cx + r - this.min));
      const j0 = Math.max(0, Math.floor(cz - r - this.min)), j1 = Math.min(N - 1, Math.ceil(cz + r - this.min));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(this.min + i - cx, this.min + j - cz) / r; if (d >= 1) continue;
        const k = (j * N + i) * 4 + 1; const v = col[k] * (1 - strength * smoothstep(1, 0.4, d)); col[k] = v;
      }
    };
    for (const t of this.trees) {
      const d = treeDims[t.sp][t.v]; const cy = d.canopyY * t.s, cr = d.canopyR * t.s;
      stamp(t.x + sx * cy, t.z + sz * cy, Math.min(cr * 1.15, 12), 0.55);
      // ambient contact darkening at the trunk base
      const k0 = (Math.round(t.z - this.min) * N + Math.round(t.x - this.min)) * 4;
      if (k0 >= 0 && k0 < col.length) col[k0] = Math.min(col[k0], 150);
    }
    return { pos, nrm, col };
  }
}

// ---------------------------------------------------------------- terrain renderer (chunked LOD with skirts)
class TerrainRenderer {
  constructor(glx, course, vdata) {
    this.glx = glx; const gl = glx.gl;
    const N = course.N; const C = 50; this.C = C; const nC = (N - 1) / C; this.nC = nC;
    this.lods = [1, 2, 5, 10, 25];
    this.chunks = [];
    for (let cj = 0; cj < nC; cj++) for (let ci = 0; ci < nC; ci++) {
      const V = C + 1; const nv = V * V + 4 * V;
      const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), col = new Uint8Array(nv * 4);
      let minY = 1e9, maxY = -1e9;
      const copy = (dst, gi, gj, yoff) => {
        const k = gj * N + gi;
        pos[dst * 3] = vdata.pos[k * 3]; pos[dst * 3 + 1] = vdata.pos[k * 3 + 1] + yoff; pos[dst * 3 + 2] = vdata.pos[k * 3 + 2];
        nrm[dst * 3] = vdata.nrm[k * 3]; nrm[dst * 3 + 1] = vdata.nrm[k * 3 + 1]; nrm[dst * 3 + 2] = vdata.nrm[k * 3 + 2];
        for (let c = 0; c < 4; c++) col[dst * 4 + c] = vdata.col[k * 4 + c];
        minY = Math.min(minY, pos[dst * 3 + 1]); maxY = Math.max(maxY, pos[dst * 3 + 1]);
      };
      for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) copy(j * V + i, ci * C + i, cj * C + j, 0);
      // skirts: 4 edges (bottom, right, top, left), each V vertices, lowered
      const sk = V * V;
      for (let i = 0; i < V; i++) {
        copy(sk + i, ci * C + i, cj * C, -2.5);
        copy(sk + V + i, ci * C + C, cj * C + i, -2.5);
        copy(sk + 2 * V + i, ci * C + i, cj * C + C, -2.5);
        copy(sk + 3 * V + i, ci * C, cj * C + i, -2.5);
      }
      const idx = []; const ranges = [];
      for (const s of this.lods) {
        const start = idx.length;
        for (let j = 0; j < C; j += s) for (let i = 0; i < C; i += s) {
          const a = j * V + i, b = a + s, c = a + s * V, d = c + s;
          idx.push(a, c, b, b, c, d);   // diagonal from b to c (matches height())
        }
        for (let i = 0; i < C; i += s) {
          // bottom edge (j=0): grid a=i, skirt sk+i
          idx.push(i, i + s, sk + i, i + s, sk + i + s, sk + i);
          // top edge
          const ta = C * V + i; idx.push(ta, sk + 2 * V + i, ta + s, ta + s, sk + 2 * V + i, sk + 2 * V + i + s);
          // left edge
          const la = i * V; idx.push(la, sk + 3 * V + i, la + s * V, la + s * V, sk + 3 * V + i, sk + 3 * V + i + s);
          // right edge
          const ra = i * V + C; idx.push(ra, ra + s * V, sk + V + i, ra + s * V, sk + V + i + s, sk + V + i);
        }
        ranges.push([start, idx.length - start]);
      }
      const mesh = glx.mesh({ pos, nrm, col, idx: new Uint32Array(idx) });
      const cx = course.min + (ci + 0.5) * C, cz = course.min + (cj + 0.5) * C;
      this.chunks.push({ mesh, ranges, cx, cz, cy: (minY + maxY) / 2, r: Math.hypot(C / 2, C / 2, (maxY - minY) / 2) + 2 });
    }
  }
  draw(frustum, camPos, lodBias = 1) {
    let n = 0;
    for (const ch of this.chunks) {
      if (!frustum.sphere(ch.cx, ch.cy, ch.cz, ch.r)) continue;
      const d = Math.max(0, Math.hypot(ch.cx - camPos[0], ch.cy - camPos[1], ch.cz - camPos[2]) - 36) * lodBias;
      const lod = d < 45 ? 0 : d < 150 ? 1 : d < 330 ? 2 : d < 600 ? 3 : 4;
      const r = ch.ranges[lod];
      this.glx.drawRange(ch.mesh, r[0], r[1]); n++;
    }
    return n;
  }
}
