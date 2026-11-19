'use strict';
// ============================================================================
// Procedural 3D models: golf ball (real dimples), clubs, flag, vegetation,
// rocks and landmark props. Everything vertex-coloured (no textures needed),
// with baked ambient occlusion and wind weights.
// col.a: wind weight (instanced vegetation) or specular mask (static props)
// ext.x: 1 = foliage (translucent lighting)
// ============================================================================

const GEO = {};

GEO.icosphere = function (sub) {
  const t = (1 + Math.sqrt(5)) / 2;
  let v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
    .map(a => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; });
  let f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let s = 0; s < sub; s++) {
    const cache = new Map(); const nf = [];
    const mid = (a, b) => {
      const k = a < b ? a * 100003 + b : b * 100003 + a; if (cache.has(k)) return cache.get(k);
      const p = [(v[a][0] + v[b][0]) / 2, (v[a][1] + v[b][1]) / 2, (v[a][2] + v[b][2]) / 2]; const l = Math.hypot(...p);
      v.push([p[0] / l, p[1] / l, p[2] / l]); cache.set(k, v.length - 1); return v.length - 1;
    };
    for (const [a, b, c] of f) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    f = nf;
  }
  return { v, f };
};

// add a deformed sphere blob. colorFn(nx,ny,nz,x,y,z) -> [r,g,b]
GEO.blob = function (gb, cx, cy, cz, rx, ry, rz, sub, colorFn, opts = {}) {
  const ico = GEO.icosphere(sub); const base = gb.vcount; const rng = opts.rng || Math.random;
  const seed = rng() * 100, amp = opts.noise || 0;
  for (const p of ico.v) {
    const d = amp ? 1 + amp * vnoise(p[0] * 2.3 + seed, p[1] * 2.3 + p[2] * 1.7 + seed) + amp * 0.5 * vnoise(p[0] * 5.1 - seed, p[2] * 5.3 + p[1] * 3.1) : 1;
    let x = cx + p[0] * rx * d, y = cy + p[1] * ry * d, z = cz + p[2] * rz * d;
    if (opts.flatBottom !== undefined && y < cy + opts.flatBottom * ry) y = cy + opts.flatBottom * ry + (y - (cy + opts.flatBottom * ry)) * 0.15;
    const [r, g, b] = colorFn(p[0], p[1], p[2], x, y, z);
    const w = opts.windFn ? opts.windFn(x, y, z) : (opts.wind || 0);
    gb.vert(x, y, z, p[0], p[1], p[2], r, g, b, w, opts.foliage ? 1 : 0, 0);
  }
  for (const [a, b, c] of ico.f) gb.tri(base + a, base + b, base + c);
};

// cylinder/cone between two points
GEO.tube = function (gb, a, b, r0, r1, sides, colorFn, opts = {}) {
  const ax = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const L = Math.hypot(...ax); const d = ax.map(x => x / L);
  let up = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = V3.norm([0, 0, 0], V3.cross([0, 0, 0], d, up)); const w = V3.cross([0, 0, 0], d, u);
  const rings = opts.rings || 1; const base = gb.vcount;
  for (let ri = 0; ri <= rings; ri++) {
    const t = ri / rings; const r = r0 + (r1 - r0) * t;
    const bend = opts.bend ? opts.bend(t) : [0, 0, 0];
    const cx = a[0] + ax[0] * t + bend[0], cy = a[1] + ax[1] * t + bend[1], cz = a[2] + ax[2] * t + bend[2];
    for (let s = 0; s <= sides; s++) {
      const th = s / sides * TAU; const c = Math.cos(th), sn = Math.sin(th);
      const nx = u[0] * c + w[0] * sn, ny = u[1] * c + w[1] * sn, nz = u[2] * c + w[2] * sn;
      const slope = (r0 - r1) / L;
      const [cr, cg, cb] = colorFn(t, th, cy);
      const wind = opts.windFn ? opts.windFn(t, cy) : (opts.wind || 0);
      gb.vert(cx + nx * r, cy + ny * r, cz + nz * r, nx + d[0] * slope, ny + d[1] * slope, nz + d[2] * slope, cr, cg, cb, wind, opts.foliage ? 1 : 0, 0);
    }
  }
  for (let ri = 0; ri < rings; ri++) for (let s = 0; s < sides; s++) {
    const i0 = base + ri * (sides + 1) + s, i1 = i0 + sides + 1; gb.quad(i0, i1, i1 + 1, i0 + 1);
  }
  if (opts.capTop) {
    const c = gb.vert(b[0], b[1], b[2], d[0], d[1], d[2], ...colorFn(1, 0, b[1]), opts.wind || 0, 0, 0);
    const top = base + rings * (sides + 1);
    for (let s = 0; s < sides; s++) gb.tri(top + s, top + s + 1, c);
  }
  if (opts.capBottom) {
    const c = gb.vert(a[0], a[1], a[2], -d[0], -d[1], -d[2], ...colorFn(0, 0, a[1]), 0, 0, 0);
    for (let s = 0; s < sides; s++) gb.tri(base + s + 1, base + s, c);
  }
};

// axis-aligned box with per-face shading
GEO.box = function (gb, cx, cy, cz, sx, sy, sz, col, opts = {}) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2; const a = opts.alpha !== undefined ? opts.alpha : 0;
  const faces = [
    [[1, 0, 0], [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz]]],
    [[-1, 0, 0], [[-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-hx, -hy, -hz]]],
    [[0, 1, 0], [[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz]]],
    [[0, -1, 0], [[-hx, -hy, hz], [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz]]],
    [[0, 0, 1], [[hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz], [-hx, -hy, hz]]],
    [[0, 0, -1], [[-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz], [hx, -hy, -hz]]],
  ];
  const rot = opts.yaw || 0, c = Math.cos(rot), s = Math.sin(rot);
  for (const [n, vs] of faces) {
    if (opts.noBottom && n[1] < 0) continue;
    const b = gb.vcount;
    const nn = [c * n[0] + s * n[2], n[1], -s * n[0] + c * n[2]];
    for (const v of vs) {
      const x = c * v[0] + s * v[2], z = -s * v[0] + c * v[2];
      const ao = v[1] < 0 ? (opts.aoBottom !== undefined ? opts.aoBottom : 0.8) : 1;
      gb.vert(cx + x, cy + v[1], cz + z, nn[0], nn[1], nn[2], col[0] * ao, col[1] * ao, col[2] * ao, a, 0, 0);
    }
    gb.quad(b, b + 1, b + 2, b + 3);
  }
};

GEO.transformBuilder = function (src, m) {
  const gb = new GeoBuilder();
  gb.append(src, (p, n) => { const tp = M4.transformPoint([0, 0, 0], m, p); const tn = M4.transformDir([0, 0, 0], m, n); p[0] = tp[0]; p[1] = tp[1]; p[2] = tp[2]; V3.norm(n, tn); });
  return gb;
};

// ---------------------------------------------------------------- golf ball with real dimples
GEO.golfBall = function (detail) {
  const sub = detail ? 5 : 2;
  const ico = GEO.icosphere(sub); const gb = new GeoBuilder();
  const centers = detail ? GEO.icosphere(3).v : [];
  // dimple angular radius ~ half spacing
  const cosR = Math.cos(0.068);
  // spatial hash of centres for speed
  const grid = new Map(); const key = (x, y, z) => ((Math.floor(x * 8) + 8) * 289 + (Math.floor(y * 8) + 8) * 17 + (Math.floor(z * 8) + 8));
  for (const c of centers) { const k = key(...c); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(c); }
  const pos = [];
  for (const p of ico.v) {
    let depth = 0;
    if (detail) {
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const list = grid.get(key(p[0] + dx / 8, p[1] + dy / 8, p[2] + dz / 8)); if (!list) continue;
        for (const c of list) { const d = p[0] * c[0] + p[1] * c[1] + p[2] * c[2]; if (d > cosR) { const t = (d - cosR) / (1 - cosR); depth = Math.max(depth, Math.sqrt(t)); } }
      }
    }
    const r = 1 - depth * 0.045;
    pos.push([p[0] * r, p[1] * r, p[2] * r]);
  }
  for (let i = 0; i < pos.length; i++) { const p = pos[i]; gb.vert(p[0], p[1], p[2], 0, 1, 0, 0.97, 0.97, 0.95, 1, 0, 0); }
  for (const [a, b, c] of ico.f) gb.tri(a, b, c);
  gb.computeNormals();
  // subtle printed logo band: tint vertices around equator front
  for (let i = 0; i < pos.length; i++) {
    const p = ico.v[i];
    if (Math.abs(p[1]) < 0.09 && p[2] > 0.55 && Math.abs(p[0]) < 0.55) { gb.c[i * 4] = 210; gb.c[i * 4 + 1] = 40; gb.c[i * 4 + 2] = 50; }
    // AO in dimples
  }
  // scale to real radius (0.02135 m)
  for (let i = 0; i < gb.p.length; i++) gb.p[i] *= 0.02135;
  return gb;
};

// ---------------------------------------------------------------- clubs
// Local frame == WebXR grip space of the holding hand: shaft toward head = -Z,
// face normal (unlofted) = -X for a right-handed golfer, toe = +Y.
const CLUBS = [
  { id: 'driver', name: 'DR', loft: 10.5, dyn: 2.5, len: 1.14, mass: 0.200, cor: 0.83, lie: 58, type: 'wood', size: 1.0, color: [0.1, 0.11, 0.13], accent: [0.95, 0.45, 0.12] },
  { id: 'wood3', name: '3W', loft: 15, dyn: 1.5, len: 1.07, mass: 0.210, cor: 0.81, lie: 58.5, type: 'wood', size: 0.78, color: [0.12, 0.16, 0.2], accent: [0.2, 0.75, 0.95] },
  { id: 'hybrid', name: '4H', loft: 21, dyn: -3, len: 1.02, mass: 0.235, cor: 0.79, lie: 60, type: 'wood', size: 0.6, color: [0.15, 0.15, 0.17], accent: [0.4, 0.85, 0.4] },
  { id: 'iron5', name: '5i', loft: 26, dyn: -6.5, len: 0.97, mass: 0.250, cor: 0.78, lie: 61.5, type: 'iron', size: 1.0 },
  { id: 'iron7', name: '7i', loft: 33, dyn: -8, len: 0.95, mass: 0.262, cor: 0.77, lie: 62.5, type: 'iron', size: 1.0 },
  { id: 'iron9', name: '9i', loft: 41, dyn: -9, len: 0.92, mass: 0.276, cor: 0.76, lie: 63.5, type: 'iron', size: 1.0 },
  { id: 'pw', name: 'PW', loft: 46, dyn: -10, len: 0.91, mass: 0.285, cor: 0.75, lie: 64, type: 'iron', size: 1.02 },
  { id: 'sw', name: 'SW', loft: 56, dyn: -10, len: 0.89, mass: 0.300, cor: 0.73, lie: 64, type: 'wedge', size: 1.05 },
  { id: 'putter', name: 'PT', loft: 3, dyn: 0, len: 0.86, mass: 0.350, cor: 0.62, lie: 71, type: 'putter', size: 1.0 },
];

GEO.club = function (club) {
  const gb = new GeoBuilder();
  const steel = (t, th) => { const v = 0.62 + 0.18 * Math.cos(th * 2) ; return [v, v * 1.01, v * 1.04]; };
  const graphite = (t, th) => { const v = 0.12 + 0.05 * Math.cos(th); return [v, v, v * 1.1]; };
  const shaftEnd = club.len - 0.1;
  // grip with ribs
  GEO.tube(gb, [0, 0, 0.07], [0, 0, -0.2], 0.0128, 0.0108, 12, (t, th) => {
    const rib = (Math.floor(t * 18) % 3 === 0) ? 0.07 : 0.035; return [rib, rib, rib * 1.1];
  }, { rings: 18, capTop: true });
  // butt cap ring
  GEO.tube(gb, [0, 0, 0.071], [0, 0, 0.064], 0.0131, 0.0131, 12, () => club.accent || [0.85, 0.2, 0.25], {});
  const shaftCol = club.type === 'wood' ? graphite : steel;
  GEO.tube(gb, [0, 0, -0.2], [0, 0, -shaftEnd + 0.03], 0.0075, 0.0048, 8, shaftCol, { rings: 1 });
  // set spec mask: grip non-shiny, shaft shiny -> alpha channel
  for (let i = 0; i < gb.vcount; i++) gb.c[i * 4 + 3] = gb.p[i * 3 + 2] < -0.2 ? (club.type === 'wood' ? 140 : 255) : 20;
  // ---- head (built in head frame then transformed)
  const head = new GeoBuilder();
  const loft = deg(club.loft), lie = deg(club.lie);
  // head frame: u toe (sole line), v up, w face-forward
  const chrome = [0.78, 0.8, 0.84];
  if (club.type === 'wood') {
    const k = club.size; const L = 0.112 * k, D = 0.1 * k, H = 0.058 * k;
    // body: deformed sphere, flattened face (w max) and sole
    const ico = GEO.icosphere(3); const b0 = head.vcount;
    for (const p of ico.v) {
      let u = p[0], v = p[1], w = p[2];
      // pear shape: wider at back, flat face at w>0.55
      let x = u * L * 0.5 * (1 - 0.15 * Math.max(0, w)), y = v * H * 0.5, z = w * D * 0.5;
      if (z > D * 0.36) z = D * 0.36 + (z - D * 0.36) * 0.08;
      if (y < -H * 0.38) y = -H * 0.38 + (y + H * 0.38) * 0.2;
      x += L * 0.5; // heel at u=0
      y += H * 0.5; z -= D * 0.1;
      let col;
      const isFace = w > 0.62; const isCrown = v > 0.15 && !isFace;
      if (isFace) { const groove = Math.abs(Math.sin(y * 260)) > 0.93 ? 0.35 : 0.62; col = [groove, groove, groove * 1.05]; }
      else if (isCrown) { col = club.color; if (Math.abs(u) < 0.08 && w > 0.1 && w < 0.6) col = [0.9, 0.9, 0.92]; }
      else col = [0.55, 0.56, 0.6];
      if (v > -0.1 && v < 0.15 && !isFace) col = club.accent;
      head.vert(x, y, z, u, v, w, col[0], col[1], col[2], isCrown ? 220 / 255 : 1, 0, 0);
    }
    for (const [a, b, c] of ico.f) head.tri(b0 + a, b0 + b, b0 + c);
    head.computeNormals();
  } else if (club.type === 'iron' || club.type === 'wedge') {
    // blade: extruded profile in (u,v), thickness along w
    const L = 0.078 * club.size, Hh = 0.03, Ht = club.type === 'wedge' ? 0.05 : 0.045;
    const prof = [];
    const N = 14;
    for (let i = 0; i <= N; i++) { const t = i / N; prof.push([t * L, 0.0]); }
    for (let i = 0; i <= N; i++) { const t = 1 - i / N; const top = Hh + (Ht - Hh) * Math.pow(t, 1.4) - (t > 0.85 ? (t - 0.85) * 0.12 : 0); prof.push([t * L, top]); }
    const thickF = 0.004, thickB = club.type === 'wedge' ? 0.018 : 0.02;
    // front face (w = +thickF) and back (w = -thickB at sole, thinner at top)
    const addFace = (wfn, nw, colFn) => {
      const b = head.vcount;
      for (const [u, v] of prof) { const c = colFn(u, v); head.vert(u, v, wfn(v), 0, 0, nw, c[0], c[1], c[2], 1, 0, 0); }
      for (let i = 0; i < N; i++) {
        const a = b + i, bb = b + i + 1, c = b + 2 * N + 1 - i - 1, d = b + 2 * N + 1 - i;
        if (nw > 0) head.quad(a, d, c, bb); else head.quad(a, bb, c, d);
      }
    };
    addFace(() => thickF, 1, (u, v) => { const g = (Math.abs(Math.sin(v * 330)) > 0.9 && u > 0.012 && u < L - 0.008) ? 0.45 : 0.82; return [g, g, g * 1.03]; });
    addFace(v => -thickB * (1 - v / Ht * 0.65), -1, (u, v) => (v > 0.008 && v < 0.022 && u > 0.012 && u < L - 0.01) ? (club.type === 'wedge' ? [0.25, 0.25, 0.28] : [0.15, 0.45, 0.85]) : chrome);
    // sole + top edges as strips
    const bS = head.vcount;
    for (let i = 0; i < prof.length; i++) {
      const [u, v] = prof[i]; const wB = -thickB * (1 - v / Ht * 0.65);
      const n = i <= N ? [0, -1, 0] : [0, 1, 0];
      head.vert(u, v, thickF, n[0], n[1], n[2], ...chrome, 1, 0, 0); head.vert(u, v, wB, n[0], n[1], n[2], ...chrome, 1, 0, 0);
    }
    for (let i = 0; i < prof.length - 1; i++) { const a = bS + i * 2; head.quad(a, a + 1, a + 3, a + 2); head.quad(a, a + 2, a + 3, a + 1); }
    // hosel
    GEO.tube(head, [0.004, 0.02, -0.004], [-0.012, 0.075, -0.006], 0.008, 0.0065, 8, () => chrome, {});
  } else { // putter: modern mallet
    const L = 0.1, D = 0.075, H = 0.025;
    const ico = GEO.icosphere(3); const b0 = head.vcount;
    for (const p of ico.v) {
      let u = p[0], v = p[1], w = p[2];
      let x = u * L * 0.5, y = v * H * 0.5, z = w * D * 0.5;
      if (z > D * 0.1) z = D * 0.1 + (z - D * 0.1) * 0.05; // flat face
      if (z < -D * 0.2) x *= 1 - (Math.abs(z) - D * 0.2) * 6; // half-moon back
      if (y < -H * 0.3) y = -H * 0.3 + (y + H * 0.3) * 0.1;
      if (y > H * 0.35) y = H * 0.35 + (y - H * 0.35) * 0.1;
      x += L * 0.5; y += H * 0.3;
      let col = [0.12, 0.12, 0.14];
      if (v > 0.6 && Math.abs(u) < 0.05) col = [0.95, 0.95, 0.95]; // sight line
      if (v > 0.6 && Math.abs(u) > 0.25 && Math.abs(u) < 0.32 && w < -0.1) col = [0.95, 0.3, 0.2];
      if (w > 0.4) col = [0.7, 0.7, 0.74];
      head.vert(x, y, z, u, v, w, col[0], col[1], col[2], 1, 0, 0);
    }
    for (const [a, b, c] of ico.f) head.tri(b0 + a, b0 + b, b0 + c);
    head.computeNormals();
    GEO.tube(head, [L * 0.5, H * 0.6, -0.005], [L * 0.45, 0.06, -0.005], 0.005, 0.0055, 8, () => chrome, {});
  }
  // transform head frame -> club local frame
  const s = [0, 0, -1], t = [0, 1, 0];
  const sole = V3.norm([0, 0, 0], [s[0] * Math.cos(lie) + t[0] * Math.sin(lie), s[1] * Math.cos(lie) + t[1] * Math.sin(lie), s[2] * Math.cos(lie) + t[2] * Math.sin(lie)]);
  const up = V3.norm([0, 0, 0], [-s[0] * Math.sin(lie) + t[0] * Math.cos(lie), -s[1] * Math.sin(lie) + t[1] * Math.cos(lie), -s[2] * Math.sin(lie) + t[2] * Math.cos(lie)]);
  const face0 = [-1, 0, 0];
  // loft: tilt face backward (rotate around sole axis)
  const faceL = V3.norm([0, 0, 0], [face0[0] * Math.cos(loft) + up[0] * Math.sin(loft), face0[1] * Math.cos(loft) + up[1] * Math.sin(loft), face0[2] * Math.cos(loft) + up[2] * Math.sin(loft)]);
  const upL = V3.norm([0, 0, 0], V3.cross([0, 0, 0], sole, faceL));
  // head origin: hosel bottom sits at shaft end, slightly toward heel
  const hosel = [0, 0, -shaftEnd];
  const hoselOffset = club.type === 'wood' ? 0.035 * club.size : (club.type === 'putter' ? 0.065 : 0.07);
  const origin = V3.madd([0, 0, 0], hosel, up, -hoselOffset);
  const m = M4.fromBasis(M4.new(), origin, sole, upL, faceL, 1);
  gb.append(head, (p, n) => { const tp = M4.transformPoint([0, 0, 0], m, p); const tn = M4.transformDir([0, 0, 0], m, n); p[0] = tp[0]; p[1] = tp[1]; p[2] = tp[2]; V3.norm(n, tn); });
  // collision description in club-local coordinates
  const width = club.type === 'wood' ? 0.112 * club.size : (club.type === 'putter' ? 0.1 : 0.078 * club.size);
  const hgt = club.type === 'wood' ? 0.058 * club.size * 0.5 : (club.type === 'putter' ? 0.012 : 0.018);
  const fwd = club.type === 'wood' ? 0.026 * club.size : (club.type === 'putter' ? 0.004 : 0.0);
  const heelP = V3.add([0, 0, 0], V3.madd([0, 0, 0], origin, upL, hgt), V3.scale([0, 0, 0], faceL, fwd));
  const toeP = V3.madd([0, 0, 0], heelP, sole, width);
  club.col = {
    heel: V3.madd([0, 0, 0], heelP, sole, width * 0.12), toe: V3.madd([0, 0, 0], heelP, sole, width * 0.9),
    radius: club.type === 'wood' ? 0.024 * club.size : (club.type === 'putter' ? 0.013 : 0.011),
    face: faceL, face0: face0, up: upL, sole: sole, sweet: V3.madd([0, 0, 0], heelP, sole, width * 0.5),
  };
  return gb;
};

// ---------------------------------------------------------------- flag (pole + cloth grid)
GEO.flagPole = function (color) {
  const gb = new GeoBuilder();
  GEO.tube(gb, [0, -0.1, 0], [0, 2.3, 0], 0.0125, 0.0115, 10, (t) => (Math.floor(t * 10) % 2 ? [0.95, 0.95, 0.95] : [0.92, 0.85, 0.2]), { rings: 10, capTop: true });
  GEO.blob(gb, 0, 2.31, 0, 0.02, 0.02, 0.02, 1, () => [0.95, 0.95, 0.95], {});
  for (let i = 0; i < gb.vcount; i++) gb.c[i * 4 + 3] = 120;
  return gb;
};
GEO.flagCloth = function (color) {
  const gb = new GeoBuilder(); const NX = 10, NY = 6;
  for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) {
    const u = i / NX, v = j / NY;
    const stripe = (v > 0.38 && v < 0.62) ? 0.85 : 1.0;
    gb.vert(u * 0.5, 2.28 - v * 0.34, 0, 0, 0, 1, color[0] * stripe + (1 - stripe), color[1] * stripe + (1 - stripe), color[2] * stripe + (1 - stripe), 0.1, 1, 0);
  }
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const a = j * (NX + 1) + i; gb.quad(a, a + NX + 1, a + NX + 2, a + 1); }
  gb.NX = NX; gb.NY = NY; return gb;
};
GEO.cup = function () {
  const gb = new GeoBuilder();
  GEO.tube(gb, [0, -0.102, 0], [0, 0.0, 0], 0.054, 0.054, 24, (t) => [0.85 * (0.4 + 0.6 * t), 0.85 * (0.4 + 0.6 * t), 0.87 * (0.4 + 0.6 * t)], { rings: 3 });
  // flip normals inward
  for (let i = 0; i < gb.n.length; i++) gb.n[i] = -gb.n[i];
  const c = gb.vert(0, -0.1, 0, 0, 1, 0, 0.25, 0.25, 0.27, 0, 0, 0); const b = gb.vcount;
  for (let s = 0; s <= 24; s++) { const th = s / 24 * TAU; gb.vert(Math.cos(th) * 0.054, -0.1, Math.sin(th) * 0.054, 0, 1, 0, 0.25, 0.25, 0.27, 0, 0, 0); }
  for (let s = 0; s < 24; s++) gb.tri(c, b + s + 1, b + s);
  return gb;
};

// ---------------------------------------------------------------- vegetation
// colour helpers
const jitterCol = (c, rng, a = 0.08) => [c[0] * (1 + (rng() - 0.5) * a * 2), c[1] * (1 + (rng() - 0.5) * a * 2), c[2] * (1 + (rng() - 0.5) * a * 2)];

GEO.deciduous = function (rng, pal, low) {
  const gb = new GeoBuilder();
  const H = 5.5 + rng() * 3.5; const trunkH = H * 0.42;
  const bark = pal.bark || [0.36, 0.26, 0.18];
  GEO.tube(gb, [0, -0.3, 0], [0, trunkH + 0.6, 0], 0.32, 0.17, low ? 5 : 8, (t, th) => { const v = 0.8 + 0.25 * Math.sin(th * 3 + t * 5); return [bark[0] * v, bark[1] * v, bark[2] * v]; },
    { rings: low ? 1 : 2, windFn: (t) => t * 0.15, bend: t => [Math.sin(t * 2.2) * 0.25, 0, Math.cos(t * 1.7) * 0.1] });
  if (!low) { // a couple of branches
    for (let b = 0; b < 3; b++) {
      const a = rng() * TAU, y0 = trunkH * (0.65 + rng() * 0.3);
      GEO.tube(gb, [0, y0, 0], [Math.cos(a) * 1.4, y0 + 1.1, Math.sin(a) * 1.4], 0.09, 0.04, 5, () => bark, { windFn: t => 0.2 + t * 0.4 });
    }
  }
  const leaf = pal.leaf; const nb = low ? 2 : 5 + (rng() * 3 | 0);
  const cy = trunkH + (H - trunkH) * 0.5; const R = (H - trunkH) * 0.55;
  for (let i = 0; i < nb; i++) {
    const a = i / nb * TAU + rng(); const rr = i === 0 ? 0 : R * (0.45 + rng() * 0.35);
    const bx = Math.cos(a) * rr, bz = Math.sin(a) * rr, by = cy + (i === 0 ? R * 0.25 : (rng() - 0.35) * R * 0.8);
    const s = R * (i === 0 ? 0.95 : 0.6 + rng() * 0.3);
    const lc = jitterCol(leaf, rng, 0.1);
    GEO.blob(gb, bx, by, bz, s * 1.05, s * 0.85, s * 1.05, 1, (nx, ny, nz, x, y, z) => {
      const ao = 0.55 + 0.45 * clamp((y - (cy - R)) / (R * 2), 0, 1) * (0.7 + 0.3 * Math.max(ny, 0));
      const sun = 1 + 0.12 * Math.max(ny, 0);
      return [lc[0] * ao * sun, lc[1] * ao * sun, lc[2] * ao * sun];
    }, { noise: 0.26, rng, foliage: true, windFn: (x, y) => clamp((y - trunkH * 0.5) / H, 0, 1) });
  }
  gb.radius = R * 1.2; gb.trunkR = 0.25; gb.trunkH = trunkH; gb.height = H; gb.canopyY = cy; gb.canopyR = R * 1.1;
  return gb;
};

GEO.pine = function (rng, pal, low) {
  const gb = new GeoBuilder();
  const H = 9 + rng() * 7; const bark = pal.bark || [0.32, 0.22, 0.16];
  GEO.tube(gb, [0, -0.3, 0], [0, H * 0.4, 0], 0.3, 0.16, low ? 5 : 7, () => bark, { windFn: t => t * 0.1 });
  const tiers = low ? 3 : 6; const leaf = pal.needle || [0.12, 0.3, 0.18];
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers; const y0 = H * (0.22 + t * 0.68); const h = H * (0.32 - t * 0.12); const r = H * 0.24 * (1 - t * 0.78) + 0.4;
    const sides = low ? 6 : 11; const base = gb.vcount; const lc = jitterCol(leaf, rng, 0.07);
    for (let s = 0; s <= sides; s++) {
      const th = s / sides * TAU + i * 0.7; const jag = 1 + (s % 2 ? 0.16 : -0.08);
      const x = Math.cos(th) * r * jag, z = Math.sin(th) * r * jag;
      const ny = r / Math.hypot(r, h);
      const ao = 0.45 + t * 0.4;
      gb.vert(x, y0 - (s % 2 ? 0.25 : 0), z, Math.cos(th) * (h / Math.hypot(r, h)), ny, Math.sin(th) * (h / Math.hypot(r, h)), lc[0] * ao, lc[1] * ao, lc[2] * ao, clamp(y0 / H, 0, 1) * 0.7, 1, 0);
    }
    const tip = gb.vert(0, y0 + h, 0, 0, 1, 0, lc[0] * 1.05, lc[1] * 1.05, lc[2] * 1.05, clamp((y0 + h) / H, 0, 1) * 0.8, 1, 0);
    for (let s = 0; s < sides; s++) gb.tri(base + s + 1, base + s, tip);
    // underside
    const c = gb.vert(0, y0 + h * 0.15, 0, 0, -1, 0, lc[0] * 0.3, lc[1] * 0.3, lc[2] * 0.3, 0.3, 1, 0);
    for (let s = 0; s < sides; s++) gb.tri(base + s, base + s + 1, c);
  }
  gb.radius = H * 0.26; gb.trunkR = 0.25; gb.trunkH = H * 0.2; gb.height = H; gb.canopyY = H * 0.5; gb.canopyR = H * 0.22;
  return gb;
};

GEO.palm = function (rng, pal, low) {
  const gb = new GeoBuilder();
  const H = 7 + rng() * 5; const lean = 0.6 + rng() * 1.2; const bark = [0.55, 0.45, 0.33];
  const bend = t => [lean * t * t, 0, lean * 0.3 * t * t];
  GEO.tube(gb, [0, -0.3, 0], [0, H, 0], 0.24, 0.16, low ? 4 : 7, (t, th) => { const ring = (Math.floor(t * 26) % 2) ? 0.85 : 1; return [bark[0] * ring, bark[1] * ring, bark[2] * ring]; }, { rings: low ? 3 : 8, bend, windFn: t => t * 0.6 });
  const top = [lean, H, lean * 0.3]; const nf = low ? 6 : 10; const leaf = pal.palm || [0.25, 0.48, 0.15];
  for (let f = 0; f < nf; f++) {
    const a = f / nf * TAU + rng() * 0.3; const len = 3.2 + rng() * 1.4; const droop = 0.5 + rng() * 0.4;
    const segs = low ? 2 : 6; const base = gb.vcount; const lc = jitterCol(leaf, rng, 0.12);
    for (let s = 0; s <= segs; s++) {
      const t = s / segs; const r = t * len; const y = top[1] + Math.sin(t * 2.2) * 0.9 - droop * t * t * 3.2;
      const cx = top[0] + Math.cos(a) * r, cz = top[2] + Math.sin(a) * r;
      const w = Math.sin(t * PI) * 0.55 + 0.05; const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
      const ao = 0.7 + 0.3 * t;
      gb.vert(cx + px, y - 0.12 * Math.sin(t * PI), cz + pz, 0, 1, 0, lc[0] * ao, lc[1] * ao, lc[2] * ao, 0.6 + t * 0.4, 1, 0);
      gb.vert(cx, y + 0.08, cz, 0, 1, 0, lc[0] * ao * 1.1, lc[1] * ao * 1.1, lc[2] * ao, 0.6 + t * 0.4, 1, 0);
      gb.vert(cx - px, y - 0.12 * Math.sin(t * PI), cz - pz, 0, 1, 0, lc[0] * ao, lc[1] * ao, lc[2] * ao, 0.6 + t * 0.4, 1, 0);
    }
    for (let s = 0; s < segs; s++) { const a0 = base + s * 3; gb.quad(a0, a0 + 3, a0 + 4, a0 + 1); gb.quad(a0 + 1, a0 + 4, a0 + 5, a0 + 2); }
  }
  // coconuts
  if (!low) for (let c = 0; c < 3; c++) { const a = c * 2.1; GEO.blob(gb, top[0] + Math.cos(a) * 0.22, top[1] - 0.25, top[2] + Math.sin(a) * 0.22, 0.13, 0.15, 0.13, 0, () => [0.35, 0.25, 0.12], { wind: 0.6 }); }
  gb.computeNormals();
  gb.radius = 3.5; gb.trunkR = 0.2; gb.trunkH = H; gb.height = H; gb.canopyY = H; gb.canopyR = 2.5; gb.trunkLean = top;
  return gb;
};

GEO.birch = function (rng, pal, low) {
  const gb = new GeoBuilder(); const H = 7 + rng() * 4;
  GEO.tube(gb, [0, -0.3, 0], [0, H * 0.75, 0], 0.16, 0.08, low ? 5 : 6, (t, th) => (Math.sin(t * 40 + th * 2) > 0.75 ? [0.15, 0.14, 0.13] : [0.88, 0.86, 0.82]), { rings: low ? 2 : 5, windFn: t => t * 0.3 });
  const leaf = pal.birch || [0.48, 0.62, 0.22];
  for (let i = 0; i < (low ? 2 : 4); i++) {
    const y = H * (0.5 + i * 0.13); const s = H * (0.2 - i * 0.03); const lc = jitterCol(leaf, rng, 0.1);
    GEO.blob(gb, (rng() - 0.5) * 0.6, y, (rng() - 0.5) * 0.6, s * 0.9, s * 1.25, s * 0.9, low ? 0 : 1, (nx, ny) => { const ao = 0.6 + 0.4 * Math.max(ny, 0) ; return [lc[0] * ao, lc[1] * ao, lc[2] * ao]; }, { noise: 0.25, rng, foliage: true, windFn: (x, yy) => clamp(yy / H, 0, 1) });
  }
  gb.radius = H * 0.2; gb.trunkR = 0.12; gb.trunkH = H * 0.4; gb.height = H; gb.canopyY = H * 0.65; gb.canopyR = H * 0.18;
  return gb;
};

GEO.bush = function (rng, pal, low) {
  const gb = new GeoBuilder(); const leaf = pal.bush || pal.leaf; const n = low ? 1 : 3;
  for (let i = 0; i < n; i++) {
    const s = 0.6 + rng() * 0.5; const lc = jitterCol(leaf, rng, 0.12);
    GEO.blob(gb, (rng() - 0.5) * 0.9, s * 0.55, (rng() - 0.5) * 0.9, s, s * 0.8, s, low ? 0 : 1, (nx, ny) => { const ao = 0.5 + 0.5 * Math.max(ny, 0); return [lc[0] * ao, lc[1] * ao, lc[2] * ao]; }, { noise: 0.25, rng, foliage: true, windFn: (x, y) => clamp(y, 0, 1) * 0.5, flatBottom: -0.4 });
    if (pal.blossom && !low && rng() < 0.7) { // flowering shrub dots
      for (let k = 0; k < 4; k++) { const a = rng() * TAU, e = rng() * 0.9; GEO.blob(gb, Math.cos(a) * s * 0.85 * Math.cos(e), s * 0.55 + Math.sin(e) * s * 0.7, Math.sin(a) * s * 0.85 * Math.cos(e), 0.09, 0.09, 0.09, 0, () => pal.blossom, { wind: 0.5 }); }
    }
  }
  gb.radius = 1.0; gb.trunkR = 0; gb.height = 1.3;
  return gb;
};

GEO.rock = function (rng, pal, low) {
  const gb = new GeoBuilder(); const c = pal.rock || [0.5, 0.48, 0.45];
  const s = 1;
  GEO.blob(gb, 0, 0.25 * s, 0, s, s * 0.62, s * 0.85, low ? 1 : 2, (nx, ny, nz) => {
    const v = 0.65 + 0.35 * Math.max(ny, 0) + 0.06 * vnoise(nx * 6, nz * 6); const moss = ny > 0.65 && pal.moss ? 0.6 : 0;
    return [lerp(c[0] * v, pal.moss ? pal.moss[0] : 0, moss), lerp(c[1] * v, pal.moss ? pal.moss[1] : 0, moss), lerp(c[2] * v, pal.moss ? pal.moss[2] : 0, moss)];
  }, { noise: 0.32, rng, flatBottom: -0.3 });
  // flat-ish shading look: keep smooth but crisp via noise
  gb.radius = 1; gb.trunkR = 0.8; gb.height = 0.8;
  return gb;
};

GEO.flowers = function (rng, pal) {
  const gb = new GeoBuilder(); const cols = pal.flowers || [[0.95, 0.85, 0.2], [0.95, 0.95, 0.95], [0.85, 0.3, 0.6], [0.6, 0.4, 0.9]];
  for (let i = 0; i < 9; i++) {
    const x = (rng() - 0.5) * 1.2, z = (rng() - 0.5) * 1.2, h = 0.18 + rng() * 0.22; const c = cols[(rng() * cols.length) | 0];
    const b = gb.vcount;
    gb.vert(x - 0.006, 0, z, 0, 1, 0, 0.2, 0.45, 0.15, 0, 0, 0); gb.vert(x + 0.006, 0, z, 0, 1, 0, 0.2, 0.45, 0.15, 0, 0, 0);
    gb.vert(x, h, z, 0, 1, 0, 0.25, 0.5, 0.18, 1, 0, 0); gb.tri(b, b + 1, b + 2);
    GEO.blob(gb, x, h, z, 0.035, 0.02, 0.035, 0, () => c, { wind: 1 });
  }
  gb.radius = 0.8; gb.height = 0.4;
  return gb;
};

GEO.grassClump = function () { // for instanced grass field (5 blades)
  const gb = new GeoBuilder(); const rng = mulberry32(7);
  for (let b = 0; b < 5; b++) {
    const a = rng() * TAU; const r = rng() * 0.12; const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = 0.09 + rng() * 0.11; const w = 0.012 + rng() * 0.008; const lean = (rng() - 0.5) * 0.08; const la = rng() * TAU;
    const dx = Math.cos(la), dz = Math.sin(la); const px = -dz * w, pz = dx * w;
    const base = gb.vcount; const tone = rng();
    for (let s = 0; s <= 2; s++) {
      const t = s / 2; const ww = 1 - t * 0.85; const off = lean * t * t;
      gb.vert(x + px * ww + dx * off, h * t, z + pz * ww + dz * off, 0, 1, 0, tone, 0, 0, 0, t, 0);
      gb.vert(x - px * ww + dx * off, h * t, z - pz * ww + dz * off, 0, 1, 0, tone, 0, 0, 0, t, 0);
    }
    gb.vert(x + dx * lean * 1.2, h * 1.12, z + dz * lean * 1.2, 0, 1, 0, tone, 0, 0, 0, 1, 0);
    gb.quad(base, base + 1, base + 3, base + 2); gb.quad(base + 2, base + 3, base + 5, base + 4); gb.tri(base + 4, base + 5, base + 6);
  }
  return gb;
};

// ---------------------------------------------------------------- props & landmarks (static, placed in world coords)
GEO.teeMarker = function (gb, x, y, z, col) {
  GEO.blob(gb, x, y + 0.06, z, 0.07, 0.07, 0.07, 2, (nx, ny) => { const v = 0.75 + 0.3 * Math.max(ny, 0); return [col[0] * v, col[1] * v, col[2] * v]; }, {});
};
GEO.bench = function (gb, x, y, z, yaw) {
  const wood = [0.55, 0.36, 0.2], iron = [0.15, 0.16, 0.17];
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const P = (lx, lz) => [x + c * lx + s * lz, z - s * lx + c * lz];
  for (const lx of [-0.75, 0.75]) { const [px, pz] = P(lx, 0); GEO.box(gb, px, y + 0.22, pz, 0.06, 0.44, 0.45, iron, { yaw }); }
  for (let k = 0; k < 3; k++) { const [px, pz] = P(0, -0.15 + k * 0.15); GEO.box(gb, px, y + 0.45, pz, 1.7, 0.04, 0.12, wood, { yaw }); }
  for (let k = 0; k < 2; k++) { const [px, pz] = P(0, -0.25); GEO.box(gb, px, y + 0.62 + k * 0.16, pz, 1.7, 0.1, 0.03, wood, { yaw }); }
};
GEO.signPost = function (gb, x, y, z) {
  const wood = [0.42, 0.28, 0.17];
  GEO.box(gb, x - 0.35, y + 0.6, z, 0.08, 1.2, 0.08, wood, {}); GEO.box(gb, x + 0.35, y + 0.6, z, 0.08, 1.2, 0.08, wood, {});
  GEO.box(gb, x, y + 1.25, z, 0.9, 0.62, 0.05, [0.25, 0.18, 0.12], {});
};
GEO.ballWasher = function (gb, x, y, z) {
  GEO.tube(gb, [x, y, z], [x, y + 0.85, z], 0.03, 0.03, 6, () => [0.12, 0.3, 0.18], {});
  GEO.box(gb, x, y + 0.95, z, 0.18, 0.22, 0.12, [0.15, 0.45, 0.25], {});
};

GEO.house = function (gb, x, y, z, w, d, h, yaw, wall, roof, opts = {}) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  GEO.box(gb, x, y + h / 2 - 0.5, z, w, h + 1, d, wall, { yaw, aoBottom: 0.6 });
  // windows (emissive look via bright vertex colour)
  const win = opts.window || [0.95, 0.85, 0.55];
  const nW = Math.max(1, Math.floor(w / 3));
  for (let i = 0; i < nW; i++) {
    const lx = -w / 2 + (i + 0.5) * (w / nW);
    for (const side of [-1, 1]) {
      const lz = side * (d / 2 + 0.02); const px = x + c * lx + s * lz, pz = z - s * lx + c * lz;
      GEO.box(gb, px, y + h * 0.55, pz, 1.1, 1.3, 0.06, win, { yaw });
      if (opts.floors > 1) GEO.box(gb, px, y + h * 0.55 - 3, pz, 1.1, 1.3, 0.06, win, { yaw });
    }
  }
  // gable roof
  const rh = opts.roofH || h * 0.55; const ov = 0.6; const b = gb.vcount;
  const pts = [[-w / 2 - ov, h, -d / 2 - ov], [w / 2 + ov, h, -d / 2 - ov], [w / 2 + ov, h + rh, 0], [-w / 2 - ov, h + rh, 0], [-w / 2 - ov, h, d / 2 + ov], [w / 2 + ov, h, d / 2 + ov]];
  const T = p => [x + c * p[0] + s * p[2], y + p[1], z - s * p[0] + c * p[2]];
  const n1 = V3.norm([0, 0, 0], [s * -rh, d / 2 + ov, c * -rh]), n2 = V3.norm([0, 0, 0], [s * rh, d / 2 + ov, c * rh]);
  const R = (p, n, k) => { const q = T(p); return gb.vert(q[0], q[1], q[2], n[0], n[1], n[2], roof[0] * k, roof[1] * k, roof[2] * k, 0.3, 0, 0); };
  let a0 = R(pts[0], n1, 0.9), a1 = R(pts[1], n1, 0.9), a2 = R(pts[2], n1, 1), a3 = R(pts[3], n1, 1); gb.quad(a0, a3, a2, a1); gb.quad(a0, a1, a2, a3);
  a0 = R(pts[4], n2, 0.9); a1 = R(pts[5], n2, 0.9); a2 = R(pts[2], n2, 1); a3 = R(pts[3], n2, 1); gb.quad(a0, a1, a2, a3); gb.quad(a0, a3, a2, a1);
  // gable walls
  for (const sd of [-1, 1]) {
    const nx = [c * sd, 0, -s * sd];
    const g0 = T([sd * w / 2, h, -d / 2]), g1 = T([sd * w / 2, h, d / 2]), g2 = T([sd * w / 2, h + rh, 0]);
    const i0 = gb.vert(...g0, ...nx, ...wall, 0, 0, 0), i1 = gb.vert(...g1, ...nx, ...wall, 0, 0, 0), i2 = gb.vert(...g2, ...nx, ...wall, 0, 0, 0);
    gb.tri(i0, i1, i2); gb.tri(i0, i2, i1);
  }
  if (opts.chimney) GEO.box(gb, x + c * w * 0.3, y + h + rh * 0.8, z - s * w * 0.3, 0.8, rh * 1.2, 0.8, [0.45, 0.42, 0.4], { yaw });
};

GEO.lighthouse = function (gb, x, y, z) {
  GEO.tube(gb, [x, y - 1, z], [x, y + 16, z], 2.2, 1.4, 16, (t) => (Math.floor(t * 6) % 2 ? [0.85, 0.18, 0.15] : [0.96, 0.95, 0.92]), { rings: 6 });
  GEO.tube(gb, [x, y + 16, z], [x, y + 16.4, z], 2.0, 2.0, 16, () => [0.15, 0.15, 0.16], { capTop: true });
  GEO.tube(gb, [x, y + 16.4, z], [x, y + 18.2, z], 1.1, 1.1, 12, () => [1.0, 0.95, 0.7], {});
  GEO.tube(gb, [x, y + 18.2, z], [x, y + 19.8, z], 1.4, 0.1, 12, () => [0.2, 0.2, 0.22], { capBottom: true });
  GEO.house(gb, x + 5, y, z + 1, 5, 4, 3, 0.3, [0.95, 0.94, 0.9], [0.3, 0.35, 0.45], {});
};

GEO.windmill = function (gb, x, y, z) {
  GEO.tube(gb, [x, y - 1, z], [x, y + 11, z], 2.6, 1.6, 10, () => [0.92, 0.9, 0.85], { rings: 2 });
  GEO.tube(gb, [x, y + 11, z], [x, y + 13.5, z], 1.9, 0.2, 10, () => [0.5, 0.25, 0.18], {});
  // blades (static, angled)
  for (let b = 0; b < 4; b++) {
    const a = b * PI / 2 + 0.4; const cx = x, cz = z + 1.9, cy = y + 10.5;
    const ex = Math.cos(a) * 7, ey = Math.sin(a) * 7;
    GEO.tube(gb, [cx, cy, cz], [cx + ex, cy + ey, cz], 0.12, 0.08, 4, () => [0.4, 0.3, 0.2], {});
    const px = -Math.sin(a), py = Math.cos(a);
    const i0 = gb.vert(cx + ex * 0.2, cy + ey * 0.2, cz + 0.05, 0, 0, 1, 0.95, 0.93, 0.88, 0.1, 0, 0);
    const i1 = gb.vert(cx + ex, cy + ey, cz + 0.05, 0, 0, 1, 0.95, 0.93, 0.88, 0.1, 0, 0);
    const i2 = gb.vert(cx + ex + px * 1.3, cy + ey + py * 1.3, cz + 0.05, 0, 0, 1, 0.9, 0.88, 0.84, 0.1, 0, 0);
    const i3 = gb.vert(cx + ex * 0.2 + px * 1.3, cy + ey * 0.2 + py * 1.3, cz + 0.05, 0, 0, 1, 0.9, 0.88, 0.84, 0.1, 0, 0);
    gb.quad(i0, i1, i2, i3); gb.quad(i0, i3, i2, i1);
  }
};

GEO.sailboat = function (gb, x, y, z, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  GEO.box(gb, x, y + 0.3, z, 1.6, 0.6, 6, [0.95, 0.95, 0.97], { yaw });
  GEO.tube(gb, [x, y + 0.6, z], [x, y + 9, z], 0.08, 0.06, 5, () => [0.8, 0.8, 0.8], {});
  const i0 = gb.vert(x, y + 9, z, c, 0, -s, 0.98, 0.97, 0.94, 0, 0, 0), i1 = gb.vert(x, y + 1.2, z, c, 0, -s, 0.98, 0.97, 0.94, 0, 0, 0);
  const i2 = gb.vert(x + s * -3.2, y + 1.2, z + c * -3.2, c, 0, -s, 0.95, 0.93, 0.9, 0, 0, 0);
  gb.tri(i0, i1, i2); gb.tri(i0, i2, i1);
};

GEO.umbrella = function (gb, x, y, z, col) {
  GEO.tube(gb, [x, y, z], [x, y + 2.2, z], 0.03, 0.03, 5, () => [0.9, 0.9, 0.9], {});
  const b = gb.vcount; const top = gb.vert(x, y + 2.5, z, 0, 1, 0, ...col, 0, 0, 0);
  for (let i = 0; i <= 10; i++) { const a = i / 10 * TAU; const cc = i % 2 ? col : [0.97, 0.97, 0.95]; gb.vert(x + Math.cos(a) * 1.3, y + 2.05, z + Math.sin(a) * 1.3, Math.cos(a) * 0.4, 0.9, Math.sin(a) * 0.4, ...cc, 0, 0, 0); }
  for (let i = 0; i < 10; i++) { gb.tri(top, b + i + 2, b + i + 1); gb.tri(top, b + i + 1, b + i + 2); }
};

GEO.chalet = function (gb, x, y, z, yaw) {
  const wood = [0.45, 0.28, 0.16], stone = [0.55, 0.53, 0.5];
  GEO.box(gb, x, y + 1.5, z, 22, 4, 12, stone, { yaw });
  GEO.house(gb, x, y + 3.5, z, 22, 12, 6.5, yaw, wood, [0.28, 0.2, 0.16], { roofH: 4.5, floors: 2, chimney: true, window: [1.0, 0.82, 0.5] });
  // balcony
  const c = Math.cos(yaw), s = Math.sin(yaw);
  GEO.box(gb, x - s * 6.6, y + 6.6, z - c * 6.6, 20, 0.25, 1.4, wood, { yaw });
  GEO.box(gb, x - s * 7.2, y + 7.3, z - c * 7.2, 20, 0.9, 0.12, [0.35, 0.22, 0.13], { yaw });
};

GEO.cableCar = function (gb, ax, ay, az, bx, by, bz) {
  // two pylons and a cable with a gondola
  for (const [x, y, z] of [[ax, ay, az], [bx, by, bz]]) {
    GEO.tube(gb, [x, y - 1, z], [x, y + 14, z], 0.5, 0.3, 6, () => [0.55, 0.55, 0.58], {});
    GEO.box(gb, x, y + 14.2, z, 4, 0.4, 0.6, [0.5, 0.5, 0.52], {});
  }
  GEO.tube(gb, [ax + 1.8, ay + 14.4, az], [bx + 1.8, by + 14.4, bz], 0.04, 0.04, 4, () => [0.2, 0.2, 0.2], {});
  GEO.tube(gb, [ax - 1.8, ay + 14.4, az], [bx - 1.8, by + 14.4, bz], 0.04, 0.04, 4, () => [0.2, 0.2, 0.2], {});
  const t = 0.4; const gx = ax + (bx - ax) * t + 1.8, gy = ay + (by - ay) * t + 14.4 - 3.2, gz = az + (bz - az) * t;
  GEO.box(gb, gx, gy, gz, 2.2, 2.2, 2.6, [0.85, 0.15, 0.15], {});
  GEO.box(gb, gx, gy + 0.3, gz, 2.25, 0.9, 2.65, [0.7, 0.85, 0.95], {});
  GEO.tube(gb, [gx, gy + 1.1, gz], [gx, gy + 3.2, gz], 0.06, 0.06, 4, () => [0.3, 0.3, 0.3], {});
};

GEO.bridge = function (gb, x0, y0, z0, x1, y1, z1, w) {
  const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz); const yaw = Math.atan2(dx, dz);
  const n = Math.ceil(L / 0.5); const wood = [0.5, 0.33, 0.2];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n; const arch = Math.sin(t * PI) * 0.8;
    GEO.box(gb, x0 + dx * t, lerp(y0, y1, t) + arch, z0 + dz * t, w, 0.08, 0.42, wood.map(c => c * (0.9 + (i % 3) * 0.05)), { yaw });
  }
  for (const side of [-1, 1]) for (let i = 0; i <= 6; i++) {
    const t = i / 6; const arch = Math.sin(t * PI) * 0.8; const px = Math.cos(yaw) * side * w * 0.48, pz = -Math.sin(yaw) * side * w * 0.48;
    GEO.box(gb, x0 + dx * t + px, lerp(y0, y1, t) + arch + 0.45, z0 + dz * t + pz, 0.08, 0.9, 0.08, wood, { yaw });
  }
};

// distant mountain ring (far scenery, rendered with heavy fog)
GEO.mountainRing = function (cfg) {
  const gb = new GeoBuilder(); const NA = 160, NR = 7; const rng = mulberry32(cfg.seed || 3);
  const R0 = cfg.r0 || 1400, R1 = cfg.r1 || 3200;
  for (let j = 0; j <= NR; j++) for (let i = 0; i <= NA; i++) {
    const a = i / NA * TAU; const t = j / NR; const r = lerp(R0, R1, t);
    const ca = Math.cos(a), sa = Math.sin(a);
    let h = ridged(ca * 3 + 11, sa * 3 + t * 2.3, 5) * cfg.height * Math.sin(t * PI) * (0.55 + 0.45 * vnoise(ca * 1.3, sa * 1.3 + 4));
    h *= cfg.mask ? cfg.mask(a) : 1;
    h += cfg.base || 0;
    if (j === 0 || j === NR) h = (cfg.base || 0) - 30;
    const snow = h > cfg.snow ? 1 : 0;
    const col = snow ? [0.92, 0.94, 0.98] : (cfg.color || [0.35, 0.4, 0.42]);
    gb.vert(ca * r, h, sa * r, 0, 1, 0, col[0], col[1], col[2], 0, 0, 0);
  }
  for (let j = 0; j < NR; j++) for (let i = 0; i < NA; i++) { const a = j * (NA + 1) + i; gb.quad(a, a + 1, a + NA + 2, a + NA + 1); }
  gb.computeNormals();
  return gb;
};

GEO.skySphere = function () {
  const ico = GEO.icosphere(3); const gb = new GeoBuilder();
  for (const p of ico.v) gb.vert(p[0], p[1], p[2], 0, 0, 0, 1, 1, 1, 1, 0, 0);
  for (const [a, b, c] of ico.f) gb.tri(a, c, b);
  return gb;
};

GEO.quad = function (w, h) { // UI quad centred, uv in ext
  const gb = new GeoBuilder();
  gb.vert(-w / 2, -h / 2, 0, 0, 0, 1, 1, 1, 1, 1, 0, 1); gb.vert(w / 2, -h / 2, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1);
  gb.vert(w / 2, h / 2, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0); gb.vert(-w / 2, h / 2, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0);
  gb.quad(0, 1, 2, 3); return gb;
};

GEO.controller = function (hand) { // stylised Quest-like controller (shown when not holding club)
  const gb = new GeoBuilder(); const sx = hand === 'left' ? -1 : 1;
  GEO.tube(gb, [0, -0.05, 0.05], [0, 0.0, -0.03], 0.018, 0.022, 10, () => [0.92, 0.92, 0.94], { capBottom: true, capTop: true });
  // tracking ring
  GEO.tube(gb, [sx * 0.0, 0.02, -0.05], [sx * 0.0, 0.035, -0.06], 0.045, 0.045, 16, () => [0.95, 0.95, 0.96], {});
  GEO.blob(gb, 0, 0.012, -0.035, 0.03, 0.014, 0.03, 1, () => [0.15, 0.15, 0.17], {});
  for (let i = 0; i < gb.vcount; i++) gb.c[i * 4 + 3] = 90;
  return gb;
};
