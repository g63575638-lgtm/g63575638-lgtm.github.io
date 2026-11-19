'use strict';
// ============================================================================
// FUTON GOLF VR — math, noise and utility helpers (no dependencies)
// (c) FUTON GROUP
// ============================================================================

const PI = Math.PI, TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const deg = d => d * PI / 180;

// ---------------------------------------------------------------- vec3
const V3 = {
  new: (x = 0, y = 0, z = 0) => new Float32Array([x, y, z]),
  set: (o, x, y, z) => { o[0] = x; o[1] = y; o[2] = z; return o; },
  copy: (o, a) => { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; return o; },
  add: (o, a, b) => { o[0] = a[0] + b[0]; o[1] = a[1] + b[1]; o[2] = a[2] + b[2]; return o; },
  sub: (o, a, b) => { o[0] = a[0] - b[0]; o[1] = a[1] - b[1]; o[2] = a[2] - b[2]; return o; },
  scale: (o, a, s) => { o[0] = a[0] * s; o[1] = a[1] * s; o[2] = a[2] * s; return o; },
  madd: (o, a, b, s) => { o[0] = a[0] + b[0] * s; o[1] = a[1] + b[1] * s; o[2] = a[2] + b[2] * s; return o; },
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (o, a, b) => { const x = a[1] * b[2] - a[2] * b[1], y = a[2] * b[0] - a[0] * b[2], z = a[0] * b[1] - a[1] * b[0]; o[0] = x; o[1] = y; o[2] = z; return o; },
  len: a => Math.hypot(a[0], a[1], a[2]),
  dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  distXZ: (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]),
  norm: (o, a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; o[0] = a[0] / l; o[1] = a[1] / l; o[2] = a[2] / l; return o; },
  lerp: (o, a, b, t) => { o[0] = a[0] + (b[0] - a[0]) * t; o[1] = a[1] + (b[1] - a[1]) * t; o[2] = a[2] + (b[2] - a[2]) * t; return o; },
};

// ---------------------------------------------------------------- mat4 (column-major, like GL)
const M4 = {
  new: () => { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },
  identity: (o) => { o.fill(0); o[0] = o[5] = o[10] = o[15] = 1; return o; },
  copy: (o, a) => { o.set(a); return o; },
  mul: (o, a, b) => {
    const r = M4._t;
    for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) {
      r[c * 4 + rr] = a[rr] * b[c * 4] + a[4 + rr] * b[c * 4 + 1] + a[8 + rr] * b[c * 4 + 2] + a[12 + rr] * b[c * 4 + 3];
    }
    o.set(r); return o;
  },
  _t: new Float32Array(16),
  invert: (o, a) => {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
      a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11,
      b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30,
      b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return M4.identity(o);
    det = 1 / det;
    o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return o;
  },
  perspective: (o, fovy, aspect, near, far) => {
    const f = 1 / Math.tan(fovy / 2); o.fill(0);
    o[0] = f / aspect; o[5] = f; o[10] = (far + near) / (near - far); o[11] = -1; o[14] = 2 * far * near / (near - far); return o;
  },
  ortho: (o, l, r, b, t, n, f) => {
    o.fill(0); o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = -2 / (f - n);
    o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (f - n); o[15] = 1; return o;
  },
  lookAt: (o, eye, at, up) => {
    let zx = eye[0] - at[0], zy = eye[1] - at[1], zz = eye[2] - at[2];
    let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0; o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0;
    o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
    o[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]); o[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
    o[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]); o[15] = 1; return o;
  },
  // compose from position + basis vectors (x, y, z axes) + uniform scale
  fromBasis: (o, p, x, y, z, s = 1) => {
    o[0] = x[0] * s; o[1] = x[1] * s; o[2] = x[2] * s; o[3] = 0;
    o[4] = y[0] * s; o[5] = y[1] * s; o[6] = y[2] * s; o[7] = 0;
    o[8] = z[0] * s; o[9] = z[1] * s; o[10] = z[2] * s; o[11] = 0;
    o[12] = p[0]; o[13] = p[1]; o[14] = p[2]; o[15] = 1; return o;
  },
  fromTRS: (o, p, yaw, s = 1) => { // yaw-only rotation helper
    const c = Math.cos(yaw), si = Math.sin(yaw);
    o.fill(0); o[0] = c * s; o[2] = -si * s; o[5] = s; o[8] = si * s; o[10] = c * s; o[12] = p[0]; o[13] = p[1]; o[14] = p[2]; o[15] = 1; return o;
  },
  fromQuat: (o, q, p) => {
    const x = q[0], y = q[1], z = q[2], w = q[3];
    const x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, yx = y * x2, yy = y * y2, zx = z * x2, zy = z * y2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
    o[0] = 1 - yy - zz; o[1] = yx + wz; o[2] = zx - wy; o[3] = 0;
    o[4] = yx - wz; o[5] = 1 - xx - zz; o[6] = zy + wx; o[7] = 0;
    o[8] = zx + wy; o[9] = zy - wx; o[10] = 1 - xx - yy; o[11] = 0;
    o[12] = p[0]; o[13] = p[1]; o[14] = p[2]; o[15] = 1; return o;
  },
  transformPoint: (o, m, p) => {
    const x = p[0], y = p[1], z = p[2];
    o[0] = m[0] * x + m[4] * y + m[8] * z + m[12]; o[1] = m[1] * x + m[5] * y + m[9] * z + m[13]; o[2] = m[2] * x + m[6] * y + m[10] * z + m[14]; return o;
  },
  transformDir: (o, m, p) => {
    const x = p[0], y = p[1], z = p[2];
    o[0] = m[0] * x + m[4] * y + m[8] * z; o[1] = m[1] * x + m[5] * y + m[9] * z; o[2] = m[2] * x + m[6] * y + m[10] * z; return o;
  },
  getPos: (o, m) => { o[0] = m[12]; o[1] = m[13]; o[2] = m[14]; return o; },
};

// ---------------------------------------------------------------- quaternions (for smoothing / slerp)
const Q = {
  fromMat: (o, m) => {
    const tr = m[0] + m[5] + m[10]; let S;
    if (tr > 0) { S = Math.sqrt(tr + 1) * 2; o[3] = 0.25 * S; o[0] = (m[6] - m[9]) / S; o[1] = (m[8] - m[2]) / S; o[2] = (m[1] - m[4]) / S; }
    else if (m[0] > m[5] && m[0] > m[10]) { S = Math.sqrt(1 + m[0] - m[5] - m[10]) * 2; o[3] = (m[6] - m[9]) / S; o[0] = 0.25 * S; o[1] = (m[4] + m[1]) / S; o[2] = (m[8] + m[2]) / S; }
    else if (m[5] > m[10]) { S = Math.sqrt(1 + m[5] - m[0] - m[10]) * 2; o[3] = (m[8] - m[2]) / S; o[0] = (m[4] + m[1]) / S; o[1] = 0.25 * S; o[2] = (m[9] + m[6]) / S; }
    else { S = Math.sqrt(1 + m[10] - m[0] - m[5]) * 2; o[3] = (m[1] - m[4]) / S; o[0] = (m[8] + m[2]) / S; o[1] = (m[9] + m[6]) / S; o[2] = 0.25 * S; }
    return o;
  },
  slerp: (o, a, b, t) => {
    let bx = b[0], by = b[1], bz = b[2], bw = b[3];
    let c = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
    if (c < 0) { c = -c; bx = -bx; by = -by; bz = -bz; bw = -bw; }
    let s0 = 1 - t, s1 = t;
    if (1 - c > 1e-5) { const om = Math.acos(c), so = Math.sin(om); s0 = Math.sin((1 - t) * om) / so; s1 = Math.sin(t * om) / so; }
    o[0] = s0 * a[0] + s1 * bx; o[1] = s0 * a[1] + s1 * by; o[2] = s0 * a[2] + s1 * bz; o[3] = s0 * a[3] + s1 * bw; return o;
  },
};

// ---------------------------------------------------------------- deterministic RNG + noise
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function hash2(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

// value noise with permutation table + quintic fade (fast & smooth enough for terrain)
const _PERM = new Uint8Array(512), _VALS = new Float32Array(256);
(function () { const r = mulberry32(1337); const p = []; for (let i = 0; i < 256; i++) { p.push(i); _VALS[i] = r() * 2 - 1; }
  for (let i = 255; i > 0; i--) { const j = (r() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) _PERM[i] = p[i & 255]; })();
function vnoise(x, y) {
  const xf0 = Math.floor(x), yf0 = Math.floor(y); const xf = x - xf0, yf = y - yf0;
  const X = xf0 & 255, Y = yf0 & 255;
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const p0 = _PERM[X], p1 = _PERM[X + 1];
  const a = _VALS[_PERM[p0 + Y]], b = _VALS[_PERM[p1 + Y]], c = _VALS[_PERM[p0 + Y + 1]], d = _VALS[_PERM[p1 + Y + 1]];
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, oct = 4, lac = 2.03, gain = 0.5) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f); n += a; a *= gain; f *= lac; }
  return s / n;
}
function ridged(x, y, oct = 5) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { let v = 1 - Math.abs(vnoise(x * f, y * f)); v *= v; s += a * v; n += a; a *= 0.5; f *= 2.1; }
  return s / n;
}

// distance from point to polyline (xz), returns {d, t (0..1 along whole line), seg}
function distToPolyline(px, pz, pts) {
  let best = 1e9, bt = 0, total = 0; const lens = [];
  for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); lens.push(l); total += l; }
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
    let t = ((px - ax) * dx + (pz - az) * dz) / L2; t = clamp(t, 0, 1);
    const qx = ax + dx * t, qz = az + dz * t; const d = Math.hypot(px - qx, pz - qz);
    if (d < best) { best = d; bt = (acc + t * lens[i]) / (total || 1); }
    acc += lens[i];
  }
  return { d: best, t: bt, len: total };
}

function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const nextFrame = () => new Promise(r => setTimeout(r, 0));

if (typeof module !== 'undefined') module.exports = { PI, TAU, clamp, lerp, smoothstep, deg, V3, M4, Q, mulberry32, hash2, vnoise, fbm, ridged, distToPolyline, hexToRgb };
