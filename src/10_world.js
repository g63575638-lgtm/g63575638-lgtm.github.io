'use strict';
// ============================================================================
// World: builds all GPU resources for a course and renders it (per eye),
// including cascaded shadow maps, instanced vegetation with 3 LODs, grass,
// water, sky, far mountains, props, flags, ball, club, particles and trail.
// ============================================================================

GLX.prototype.drawInstancedN = function (mesh, n) {
  const gl = this.gl; gl.bindVertexArray(mesh.vao);
  if (mesh.itype) gl.drawElementsInstanced(gl.TRIANGLES, mesh.count, mesh.itype, 0, n); else gl.drawArraysInstanced(gl.TRIANGLES, 0, mesh.count, n);
  this.stats.draws++; this.stats.tris += mesh.count / 3 * n;
};
GLX.prototype.dynMesh = function (geo, extraFloats) {
  const gl = this.gl; const m = this.mesh(geo);
  // replace position buffer with a dynamic one we can update
  gl.bindVertexArray(m.vao);
  m.posBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, m.posBuf); gl.bufferData(gl.ARRAY_BUFFER, geo.pos, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(ATTR.pos); gl.vertexAttribPointer(ATTR.pos, 3, gl.FLOAT, false, 0, 0);
  if (geo.nrm) { m.nrmBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, m.nrmBuf); gl.bufferData(gl.ARRAY_BUFFER, geo.nrm, gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(ATTR.nrm); gl.vertexAttribPointer(ATTR.nrm, 3, gl.FLOAT, false, 0, 0); }
  if (geo.col) { m.colBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, m.colBuf); gl.bufferData(gl.ARRAY_BUFFER, geo.col, gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(ATTR.col); gl.vertexAttribPointer(ATTR.col, 4, gl.UNSIGNED_BYTE, true, 0, 0); }
  gl.bindVertexArray(null); return m;
};
GLX.prototype.updateDyn = function (m, pos, nrm, col, count) {
  const gl = this.gl;
  gl.bindBuffer(gl.ARRAY_BUFFER, m.posBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos);
  if (nrm && m.nrmBuf) { gl.bindBuffer(gl.ARRAY_BUFFER, m.nrmBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, nrm); }
  if (col && m.colBuf) { gl.bindBuffer(gl.ARRAY_BUFFER, m.colBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, col); }
  if (count !== undefined) m.count = count;
};

let NOISE_TEX = null;
function makeNoiseTexture(glx) {
  if (NOISE_TEX) return NOISE_TEX;
  const S = 256, data = new Uint8Array(S * S * 4);
  // tileable value noise: sample a periodic lattice
  const lattice = (seed, P) => { const r = mulberry32(seed); const a = new Float32Array(P * P); for (let i = 0; i < P * P; i++) a[i] = r(); return a; };
  for (let c = 0; c < 4; c++) {
    const octs = [[8, 0.5], [16, 0.25], [32, 0.15], [64, 0.1]].map(([P, w], k) => ({ P, w, L: lattice(c * 31 + k * 7 + 1, P) }));
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let v = 0;
      for (const o of octs) {
        const fx = x / S * o.P, fy = y / S * o.P; const ix = Math.floor(fx), iy = Math.floor(fy); const tx = fx - ix, ty = fy - iy;
        const u = tx * tx * (3 - 2 * tx), w = ty * ty * (3 - 2 * ty);
        const a = o.L[(iy % o.P) * o.P + ix % o.P], b = o.L[(iy % o.P) * o.P + (ix + 1) % o.P], cc = o.L[((iy + 1) % o.P) * o.P + ix % o.P], d = o.L[((iy + 1) % o.P) * o.P + (ix + 1) % o.P];
        v += o.w * (a + (b - a) * u + (cc - a) * w + (a - b - cc + d) * u * w);
      }
      data[(y * S + x) * 4 + c] = clamp(v / 1.0 * 255, 0, 255);
    }
  }
  NOISE_TEX = glx.texture(S, S, { data, repeat: true, mip: true });
  return NOISE_TEX;
}

class World {
  constructor(glx, P, course, settings) {
    this.glx = glx; this.gl = glx.gl; this.P = P; this.course = course; this.settings = settings;
    this.def = course.def; this.time = 0;
    this.frustum = new Frustum();
    this.tmpM = M4.new(); this.vp = M4.new();
  }

  async build(progress) {
    const glx = this.glx, gl = this.gl, c = this.course, def = this.def;
    const tod = TIMES[c.time]; this.tod = tod;
    this.sunDir = sunFrom(def.sunAz[c.time], tod.el);
    const pal = def.palette; this.pal = pal;
    // ------------------------------------------------ vegetation meshes (3 LODs) + dims
    const vrng = mulberry32(def.seed + 99);
    this.vegGroups = []; this.treeDims = {};
    for (const spId of def.species) {
      const sp = SPECIES[spId]; this.treeDims[spId] = [];
      for (let v = 0; v < sp.variants; v++) {
        const seed = vrng() * 1e9 | 0;
        const g0 = sp.gen(mulberry32(seed), def.vegPal, false);
        const g1 = sp.gen(mulberry32(seed), def.vegPal, true);
        const g2 = World.ultraLOD(spId, g0, def.vegPal);
        this.treeDims[spId].push({ trunkR: g0.trunkR, trunkH: g0.trunkH, canopyY: g0.canopyY, canopyR: g0.canopyR, height: g0.height, lean: g0.trunkLean || null });
        const lods = [glx.instancing(glx.mesh(g0.build()), 1500), glx.instancing(glx.mesh(g1.build()), 3000), glx.instancing(glx.mesh(g2.build()), 6000)];
        const proxyGeo = g2.build();
        this.vegGroups.push({ kind: 'tree', sp: spId, v, lods, shadowProxy: [glx.shareInstances(proxyGeo, lods[0]), glx.shareInstances(proxyGeo, lods[1])], items: [] });
      }
    }
    await nextFrame(); progress && progress(0.76, 'load_veg');
    c.placeVegetation(this.sunDir);
    for (const t of c.trees) { const g = this.vegGroups.find(g => g.sp === t.sp && g.v === t.v); if (g) g.items.push(t); }
    const smallGroup = (kind, gen, list, maxN, variants = 3) => {
      for (let v = 0; v < variants; v++) {
        const seed = vrng() * 1e9 | 0;
        const g0 = gen(mulberry32(seed), def.vegPal, false), g1 = gen(mulberry32(seed), def.vegPal, true);
        this.vegGroups.push({ kind, v, lods: [glx.instancing(glx.mesh(g0.build()), maxN), glx.instancing(glx.mesh(g1.build()), maxN)], items: list.filter(i => i.v === v) });
      }
    };
    smallGroup('bush', GEO.bush, c.bushes, 2000);
    smallGroup('rock', GEO.rock, c.rocks, 2000);
    smallGroup('flower', (r, p) => GEO.flowers(r, p), c.flowers, 2500);
    // cell index for fast culling
    for (const g of this.vegGroups) {
      g.data = [new Float32Array(g.lods[0].instMax * 8), new Float32Array(g.lods[1].instMax * 8), g.lods[2] ? new Float32Array(g.lods[2].instMax * 8) : null];
      g.flat = new Float32Array(g.items.length * 8);
      g.items.forEach((t, i) => { g.flat.set([t.x, t.y, t.z, t.s, t.rot, t.tint, g.kind === 'rock' ? 0 : (g.kind === 'tree' ? 1 : 0.6), t.ph], i * 8); });
    }
    // ------------------------------------------------ terrain
    progress && progress(0.8, 'load_meshes'); await nextFrame();
    const vdata = c.bakeVertexData(this.sunDir, this.treeDims);
    this.terrain = new TerrainRenderer(glx, c, vdata);
    const N = c.N;
    this.surfTex = glx.texture(N, N, { data: c.surfTex, mip: false });
    this.heightTex = glx.texture(N, N, { internal: gl.R32F, format: gl.RED, type: gl.FLOAT, data: c.H, nearest: true });
    this.noiseTex = makeNoiseTexture(glx);
    // ------------------------------------------------ water
    this.waters = [];
    for (const L of c.lakes) this.waters.push(this.buildWater(L.x - L.r * 1.45, L.z - L.r * 1.45, L.x + L.r * 1.45, L.z + L.r * 1.45, 2, L.level));
    if (def.ocean) this.waters.push(this.buildOcean(def.ocean.level));
    await nextFrame(); progress && progress(0.86, 'load_meshes');
    // ------------------------------------------------ static props (landmarks + tee furniture)
    const pg = new GeoBuilder();
    def.landmarks(c, pg);
    for (const h of c.holes) {
      const y = h.teePos[1]; const d = h.dir0; const px = -d[2], pz = d[0];
      for (const s of [-1, 1]) GEO.teeMarker(pg, h.tee[0] + px * s * 3 - d[0] * 2, y, h.tee[1] + pz * s * 3 - d[2] * 2, def.palette.flag);
      const bx = h.tee[0] - px * 8 - d[0] * 6, bz = h.tee[1] - pz * 8 - d[2] * 6;
      GEO.bench(pg, bx, c.height(bx, bz), bz, h.teeYaw + PI / 2);
      const sx = h.tee[0] + px * 7.5 - d[0] * 4, sz = h.tee[1] + pz * 7.5 - d[2] * 4;
      h.signPos = [sx, c.height(sx, sz), sz]; GEO.signPost(pg, sx, h.signPos[1], sz);
      const wx = h.tee[0] + px * 6 - d[0] * 7, wz = h.tee[1] + pz * 6 - d[2] * 7; GEO.ballWasher(pg, wx, c.height(wx, wz), wz);
    }
    // sink prop bottoms slightly into the ground (avoid floating on slopes)
    this.props = glx.mesh(pg.build());
    // far mountains
    this.mountains = glx.mesh(GEO.mountainRing(def.far).build());
    // ------------------------------------------------ dynamic objects
    this.ballMesh = glx.mesh(GEO.golfBall(true).build());
    this.ballMeshLow = glx.mesh(GEO.golfBall(false).build());
    this.clubMeshes = CLUBS.map(cl => glx.mesh(GEO.club(cl).build()));
    this.poleMesh = glx.mesh(GEO.flagPole().build());
    const cloth = GEO.flagCloth(def.palette.flag); this.clothGeo = cloth; this.clothBase = cloth.build();
    this.clothMesh = glx.dynMesh(this.clothBase); this.clothPos = new Float32Array(this.clothBase.pos); this.clothNrm = new Float32Array(this.clothBase.nrm);
    this.cupMesh = glx.mesh(GEO.cup().build());
    const peg = new GeoBuilder(); GEO.tube(peg, [0, -0.04, 0], [0, 0.0, 0], 0.0025, 0.0055, 8, () => [0.98, 0.98, 0.96], { capTop: true }); GEO.tube(peg, [0, 0, 0], [0, 0.003, 0], 0.0085, 0.0085, 10, () => [0.98, 0.98, 0.96], { capTop: true }); this.pegMesh = glx.mesh(peg.build());
    this.ctrlMeshes = { left: glx.mesh(GEO.controller('left').build()), right: glx.mesh(GEO.controller('right').build()) };
    this.skyMesh = glx.mesh(GEO.skySphere().build());
    const pillar = new GeoBuilder(); GEO.tube(pillar, [0, 0, 0], [0, 40, 0], 0.12, 0.05, 10, (t) => [1, 0.85, 0.5], { rings: 6 }); for (let i = 0; i < pillar.vcount; i++) pillar.c[i * 4 + 3] = Math.round(255 * Math.pow(1 - pillar.p[i * 3 + 1] / 40, 2)); this.pillarMesh = glx.mesh(pillar.build());
    const ring = new GeoBuilder(); for (let i = 0; i <= 48; i++) { const a = i / 48 * TAU; ring.vert(Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3, 0, 1, 0, 0.6, 0.9, 1, 1); ring.vert(Math.cos(a) * 0.38, 0, Math.sin(a) * 0.38, 0, 1, 0, 0.6, 0.9, 1, 0); }
    for (let i = 0; i < 48; i++) ring.quad(i * 2, i * 2 + 1, i * 2 + 3, i * 2 + 2); this.tpRing = glx.mesh(ring.build());
    const disc = new GeoBuilder(); const dc = disc.vert(0, 0, 0, 0, 1, 0, 0.6, 0.9, 1, 0.25); for (let i = 0; i <= 32; i++) { const a = i / 32 * TAU; disc.vert(Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3, 0, 1, 0, 0.6, 0.9, 1, 0.05); } for (let i = 0; i < 32; i++) disc.tri(dc, dc + i + 2, dc + i + 1); this.tpDisc = glx.mesh(disc.build());
    // vignette ring (head-locked)
    const vg = new GeoBuilder(); for (let i = 0; i <= 48; i++) { const a = i / 48 * TAU; vg.vert(Math.cos(a) * 0.16, Math.sin(a) * 0.16, -0.3, 0, 0, 1, 0, 0, 0, 0); vg.vert(Math.cos(a) * 1.2, Math.sin(a) * 1.2, -0.3, 0, 0, 1, 0, 0, 0, 1); }
    for (let i = 0; i < 48; i++) vg.quad(i * 2, i * 2 + 1, i * 2 + 3, i * 2 + 2); this.vignetteMesh = glx.mesh(vg.build());
    const fade = new GeoBuilder(); GEO.box(fade, 0, 0, 0, 1, 1, 1, [0, 0, 0], { alpha: 1, aoBottom: 1 }); for (let i = 0; i < fade.vcount; i++) fade.c[i * 4 + 3] = 255; this.fadeMesh = glx.mesh(fade.build());
    // trail (dynamic ribbon) and teleport arc
    this.trailMax = 160; const tg = { pos: new Float32Array(this.trailMax * 2 * 3), col: new Uint8Array(this.trailMax * 2 * 4) };
    const tidx = []; for (let i = 0; i < this.trailMax - 1; i++) { const a = i * 2; tidx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    tg.idx = new Uint16Array(tidx); this.trailMesh = glx.dynMesh(tg); this.trailPts = []; this.trailPos = tg.pos; this.trailCol = tg.col;
    this.arcMax = 60; const ag = { pos: new Float32Array(this.arcMax * 2 * 3), col: new Uint8Array(this.arcMax * 2 * 4) };
    const aidx = []; for (let i = 0; i < this.arcMax - 1; i++) { const a = i * 2; aidx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    ag.idx = new Uint16Array(aidx); this.arcMesh = glx.dynMesh(ag); this.arcPos = ag.pos; this.arcCol = ag.col;
    // particles
    const pq = new GeoBuilder(); pq.vert(-1, -1, 0, 0, 0, 1, 1, 1, 1, 1); pq.vert(1, -1, 0, 0, 0, 1, 1, 1, 1, 1); pq.vert(1, 1, 0, 0, 0, 1, 1, 1, 1, 1); pq.vert(-1, 1, 0, 0, 0, 1, 1, 1, 1, 1); pq.quad(0, 1, 2, 3);
    this.partMesh = glx.instancing(glx.mesh(pq.build()), 800); this.particles = []; this.partData = new Float32Array(800 * 8);
    // grass
    this.grassMesh = glx.mesh(GEO.grassClump().build());
    // shadows
    this.setShadowQuality(this.settings.shadows);
    // sky
    progress && progress(0.94, 'load_sky'); await nextFrame();
    this.renderSky();
    this.wind = def.wind.slice();
    progress && progress(1.0, 'load_done');
  }

  static ultraLOD(sp, g0, pal) {
    const gb = new GeoBuilder();
    if (sp === 'pine') {
      GEO.tube(gb, [0, -0.3, 0], [0, g0.height * 0.25, 0], 0.3, 0.2, 4, () => pal.bark || [0.3, 0.2, 0.15], {});
      GEO.tube(gb, [0, g0.height * 0.2, 0], [0, g0.height, 0], g0.canopyR * 1.15, 0.05, 6, () => (pal.needle || [0.1, 0.28, 0.15]).map(c => c * 0.75), { wind: 0.4, foliage: true });
    } else if (sp === 'palm') {
      const top = g0.trunkLean || [0, g0.height, 0];
      GEO.tube(gb, [0, -0.3, 0], top, 0.22, 0.16, 4, () => [0.5, 0.42, 0.32], {});
      GEO.blob(gb, top[0], top[1] - 0.3, top[2], 2.6, 0.7, 2.6, 0, () => (pal.palm || [0.25, 0.48, 0.15]).map(c => c * 0.8), { foliage: true, wind: 0.6 });
    } else {
      GEO.tube(gb, [0, -0.3, 0], [0, g0.trunkH, 0], 0.28, 0.18, 4, () => pal.bark || [0.35, 0.25, 0.17], {});
      const col = sp === 'birch' ? (pal.birch || pal.leaf) : pal.leaf;
      GEO.blob(gb, 0, g0.canopyY, 0, g0.canopyR, g0.canopyR * 0.85, g0.canopyR, 0, (nx, ny) => { const a = 0.6 + 0.4 * Math.max(ny, 0); return [col[0] * a, col[1] * a, col[2] * a]; }, { foliage: true, wind: 0.5, noise: 0.15, rng: mulberry32(5) });
    }
    return gb;
  }

  buildWater(x0, z0, x1, z1, step, level) {
    const c = this.course; const nx = Math.ceil((x1 - x0) / step) + 1, nz = Math.ceil((z1 - z0) / step) + 1;
    const pos = [], ext = [], idx = [];
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const x = x0 + i * step, z = z0 + j * step; pos.push(x, level, z); ext.push(level - c.height(x, z), 0); }
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, cc = a + nx, d = cc + 1;
      if (Math.max(ext[a * 2], ext[b * 2], ext[cc * 2], ext[d * 2]) < -0.3) continue;
      idx.push(a, cc, b, b, cc, d);
    }
    if (!idx.length) return null;
    return this.glx.mesh({ pos: new Float32Array(pos), ext: new Float32Array(ext), idx: new Uint32Array(idx) });
  }
  buildOcean(level) {
    const c = this.course; const pos = [], ext = [], idx = [];
    // inner grid over the map (depth from terrain) + outer rings to the horizon
    const step = 6, half = c.half; const n = Math.floor(half * 2 / step) + 1;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const x = -half + i * step, z = -half + j * step; pos.push(x, level, z); ext.push(level - c.height(x, z), 0); }
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, cc = a + n, d = cc + 1;
      if (Math.max(ext[a * 2], ext[b * 2], ext[cc * 2], ext[d * 2]) < -0.5) continue; idx.push(a, cc, b, b, cc, d);
    }
    // outer: square annulus to 9 km, depth large
    const base = pos.length / 3; const R = [half, 900, 2500, 9000];
    for (let r = 0; r < R.length; r++) for (let k = 0; k < 64; k++) {
      const a = k / 64 * TAU; const cx = Math.cos(a), sz = Math.sin(a); const m = R[r] / Math.max(Math.abs(cx), Math.abs(sz));
      const rr = r === 0 ? m : R[r]; pos.push(cx * rr, level, sz * rr); ext.push(r === 0 ? Math.max(level - c.height(clamp(cx * rr, -half + 1, half - 1), clamp(sz * rr, -half + 1, half - 1)), 0) + 0 : 40, 0);
    }
    for (let r = 0; r < R.length - 1; r++) for (let k = 0; k < 64; k++) { const a = base + r * 64 + k, b = base + r * 64 + (k + 1) % 64, cc = a + 64, d = b + 64; idx.push(a, cc, b, b, cc, d); }
    return this.glx.mesh({ pos: new Float32Array(pos), ext: new Float32Array(ext), idx: new Uint32Array(idx) });
  }

  renderSky() {
    const gl = this.gl, glx = this.glx, P = this.P, tod = this.tod;
    if (!this.skyTarget) this.skyTarget = glx.colorTarget(1024, 512);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.skyTarget.fb); gl.viewport(0, 0, 1024, 512);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    const p = glx.use(P.skyGen);
    gl.uniform3fv(p.u.u_sunDir, this.sunDir); gl.uniform3fv(p.u.u_sunCol, tod.sunCol); gl.uniform3fv(p.u.u_zenith, tod.zenith); gl.uniform3fv(p.u.u_horizon, tod.horizon);
    gl.uniform3fv(p.u.u_horizonSun, tod.horizonSun); gl.uniform3fv(p.u.u_cloudCol, tod.cloud); gl.uniform3fv(p.u.u_cloudShadow, tod.cloudShadow);
    gl.uniform4f(p.u.u_cloud, tod.coverage, 0.95, 1.35, this.def.seed % 97);
    if (!this.fsTri) { const g = { pos: new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]) }; this.fsTri = glx.mesh(g); }
    glx.draw(this.fsTri);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, this.skyTarget.tex); gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.enable(gl.DEPTH_TEST);
  }

  setShadowQuality(q) {
    const size = q === 'off' ? 0 : q === 'low' ? 1024 : q === 'high' ? 2048 : 1536;
    if (this.shadowSize === size) return;
    this.shadowSize = size;
    if (size) this.shadow = this.glx.depthTarget(size * 2, size); else this.shadow = null;
    this.shadowMats = [M4.new(), M4.new()]; this.shadowVP = [M4.new(), M4.new()];
    this.shadowR = [14, q === 'high' ? 95 : 75];
  }

  // ------------------------------------------------------------------ per-frame updates
  update(dt, headPos, headFwd) {
    this.time += dt;
    // wind gusts
    this.gust = Math.sin(this.time * 0.37) * 0.5 + Math.sin(this.time * 0.13 + 1) * 0.5;
    this.cullVegetation(headPos, headFwd);
    this.updateCloth(dt);
    this.updateParticles(dt);
  }

  cullVegetation(cam, fwd) {
    const q = this.settings.quality; const k = q === 'low' ? 0.7 : q === 'high' ? 1.25 : 1.0;
    const d0 = 55 * k, d1 = 210 * k, d2 = 480 * k;
    const smallD = { bush: [30 * k, 160 * k], rock: [40 * k, 260 * k], flower: [18 * k, 55 * k] };
    const fx = fwd[0], fz = fwd[2]; const fl = Math.hypot(fx, fz) || 1;
    this.shadowCasters = [];
    for (const g of this.vegGroups) {
      const n = [0, 0, 0]; const fl8 = g.flat; const lim = g.kind === 'tree' ? [d0, d1, d2] : smallD[g.kind].concat([0]);
      for (let i = 0; i < g.items.length; i++) {
        const o = i * 8; const dx = fl8[o] - cam[0], dz = fl8[o + 2] - cam[2]; const d = Math.hypot(dx, dz);
        // broad view cone culling (both eyes) except close by
        if (d > 25 && (dx * fx + dz * fz) / (d * fl) < -0.35) continue;
        let lod = d < lim[0] ? 0 : d < lim[1] ? 1 : (g.lods[2] && d < lim[2]) ? 2 : -1;
        if (lod < 0) continue;
        if (n[lod] >= g.lods[lod].instMax) continue;
        g.data[lod].set(fl8.subarray(o, o + 8), n[lod] * 8); n[lod]++;
      }
      for (let l = 0; l < g.lods.length; l++) if (g.lods[l]) this.glx.setInstances(g.lods[l], g.data[l], n[l]);
    }
  }

  updateCloth(dt) {
    const g = this.clothGeo; const NX = g.NX, NY = g.NY; const p = this.clothPos, base = this.clothBase.pos, nrm = this.clothNrm; const t = this.time;
    const w = Math.hypot(this.wind[0], this.wind[2]) / 4 + 0.3;
    for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) {
      const k = (j * (NX + 1) + i) * 3; const u = i / NX;
      const wave = Math.sin(u * 7 - t * 7 * w) * 0.045 * u * w + Math.sin(u * 13 - t * 11 + j * 0.5) * 0.012 * u;
      p[k] = base[k] * (1 - 0.06 * u * Math.abs(Math.sin(t * 2.1))); p[k + 1] = base[k + 1] - u * u * 0.02 * (1 - w * 0.5); p[k + 2] = wave;
    }
    // normals
    for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) {
      const k = (j * (NX + 1) + i) * 3; const i0 = Math.max(i - 1, 0), i1 = Math.min(i + 1, NX);
      const a = (j * (NX + 1) + i0) * 3, b = (j * (NX + 1) + i1) * 3; const dz = p[b + 2] - p[a + 2], dx = p[b] - p[a];
      const l = Math.hypot(dz, dx) || 1; nrm[k] = -dz / l; nrm[k + 1] = 0; nrm[k + 2] = dx / l;
    }
    this.glx.updateDyn(this.clothMesh, p, nrm);
  }

  // ------------------------------------------------------------------ particles & trail
  emit(type, pos, count, opts = {}) {
    const cols = { grass: [[0.35, 0.6, 0.2], [0.25, 0.45, 0.12]], dirt: [[0.4, 0.3, 0.2], [0.3, 0.22, 0.15]], sand: [[0.92, 0.84, 0.66], [0.85, 0.76, 0.58]], water: [[0.9, 0.95, 1.0], [0.75, 0.85, 0.95]], leaf: [[0.3, 0.5, 0.15], [0.45, 0.55, 0.2]], confetti: [[1, 0.4, 0.3], [1, 0.8, 0.2], [0.3, 0.8, 1], [0.6, 1, 0.4], [1, 1, 1]], spark: [[1, 0.9, 0.6]] };
    const pal = cols[type] || cols.grass; const r = Math.random;
    for (let i = 0; i < count && this.particles.length < 800; i++) {
      const c = pal[(r() * pal.length) | 0]; const sp = opts.speed || 2; const dir = opts.dir || [0, 1, 0];
      const v = [dir[0] * sp * (0.5 + r()) + (r() - 0.5) * sp, dir[1] * sp * (0.5 + r()) + r() * sp * 0.5, dir[2] * sp * (0.5 + r()) + (r() - 0.5) * sp];
      this.particles.push({ p: pos.slice(), v, c, life: (opts.life || 1) * (0.6 + r() * 0.6), age: 0, size: (opts.size || 0.02) * (0.6 + r() * 0.8), drag: opts.drag || 1.5, grav: opts.grav !== undefined ? opts.grav : 9.81, add: !!opts.add });
    }
  }
  updateParticles(dt) {
    const ps = this.particles; let n = 0; const d = this.partData;
    for (let i = ps.length - 1; i >= 0; i--) {
      const q = ps[i]; q.age += dt; if (q.age > q.life) { ps.splice(i, 1); continue; }
      q.v[1] -= q.grav * dt; const k = Math.exp(-q.drag * dt); q.v[0] *= k; q.v[1] *= k; q.v[2] *= k;
      q.p[0] += q.v[0] * dt; q.p[1] += q.v[1] * dt; q.p[2] += q.v[2] * dt;
      const gh = this.course.height(q.p[0], q.p[2]); if (q.p[1] < gh + 0.005) { q.p[1] = gh + 0.005; q.v[0] *= 0.5; q.v[2] *= 0.5; q.v[1] = 0; }
      const a = 1 - q.age / q.life;
      d.set([q.p[0], q.p[1], q.p[2], q.size, q.c[0], q.c[1], q.c[2], Math.min(1, a * 2)], n * 8); n++;
    }
    this.glx.setInstances(this.partMesh, d, n);
  }
  trailReset() { this.trailPts = []; }
  trailPush(p) { this.trailPts.push(p.slice()); if (this.trailPts.length > this.trailMax) this.trailPts.shift(); }

  buildRibbon(pts, camPos, width, posArr, colArr, colorFn) {
    const n = pts.length; if (n < 2) return 0;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[Math.min(i + 1, n - 1)], o = pts[Math.max(i - 1, 0)];
      const t = [q[0] - o[0], q[1] - o[1], q[2] - o[2]]; const v = [camPos[0] - p[0], camPos[1] - p[1], camPos[2] - p[2]];
      const s = V3.norm([0, 0, 0], V3.cross([0, 0, 0], t, v)); const w = width(i / (n - 1), V3.len(v));
      posArr.set([p[0] + s[0] * w, p[1] + s[1] * w, p[2] + s[2] * w, p[0] - s[0] * w, p[1] - s[1] * w, p[2] - s[2] * w], i * 6);
      const c = colorFn(i / (n - 1)); colArr.set([c[0], c[1], c[2], c[3], c[0], c[1], c[2], c[3]], i * 8);
    }
    return (n - 1) * 6;
  }

  // ------------------------------------------------------------------ frame uniforms
  setCommon(p, viewProj, camPos) {
    const gl = this.gl, tod = this.tod, u = p.u;
    if (u.u_viewProj) gl.uniformMatrix4fv(u.u_viewProj, false, viewProj);
    if (u.u_camPos) gl.uniform3fv(u.u_camPos, camPos);
    if (u.u_sunDir) gl.uniform3fv(u.u_sunDir, this.sunDir);
    if (u.u_sunCol) gl.uniform3fv(u.u_sunCol, tod.sunCol);
    if (u.u_skyCol) gl.uniform3fv(u.u_skyCol, tod.sky);
    if (u.u_gndCol) gl.uniform3fv(u.u_gndCol, tod.gnd);
    if (u.u_fogCol) gl.uniform3fv(u.u_fogCol, tod.fog);
    if (u.u_fogSunCol) gl.uniform3fv(u.u_fogSunCol, tod.fogSun);
    if (u.u_fog) gl.uniform4f(u.u_fog, this.def.id === 'mountain' ? 0.00055 : 0.0007, 0.012, 0, this.def.id === 'coast' ? 0.85 : 0.9);
    if (u.u_time) gl.uniform1f(u.u_time, this.time);
    if (u.u_wind) { const wl = Math.hypot(this.wind[0], this.wind[2]) || 1; gl.uniform4f(u.u_wind, this.wind[0] / wl, this.wind[2] / wl, clamp(wl / 4, 0.3, 1.6), this.gust || 0); }
    if (u.u_exposure) gl.uniform1f(u.u_exposure, tod.exposure);
    if (u.u_shadowParams) {
      if (this.shadow) {
        gl.uniformMatrix4fv(u.u_shadowMat0, false, this.shadowMats[0]); gl.uniformMatrix4fv(u.u_shadowMat1, false, this.shadowMats[1]);
        gl.uniform4f(u.u_shadowParams, this.shadowR[0], 1 / (this.shadowSize * 2), 1, this.shadowR[1]); gl.uniform3fv(u.u_shadowCenter, this.shadowCenter);
        this.glx.tex(p, 'u_shadow', this.shadow.tex);
      } else { gl.uniform4f(u.u_shadowParams, 1, 1, 0, 1); if (!this.dummyShadow) this.dummyShadow = this.glx.depthTarget(4, 4); this.glx.tex(p, 'u_shadow', this.dummyShadow.tex); }
    }
  }

  // ------------------------------------------------------------------ shadow pass
  renderShadows(center, drawDynamic) {
    if (!this.shadow) return;
    const gl = this.gl, glx = this.glx, S = this.shadowSize;
    this.shadowCenter = center.slice();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadow.fb);
    gl.viewport(0, 0, S * 2, S); gl.clear(gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.colorMask(false, false, false, false); gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(2.0, 4.0);
    const t0s = this.glx.stats.tris;
    for (let ci = 0; ci < 2; ci++) {
      const r = this.shadowR[ci];
      // texel snapping to avoid shimmering
      const up = Math.abs(this.sunDir[1]) > 0.98 ? [0, 0, 1] : [0, 1, 0];
      const view = M4.lookAt(M4.new(), [0, 0, 0], [-this.sunDir[0], -this.sunDir[1], -this.sunDir[2]], up);
      const cLS = M4.transformPoint([0, 0, 0], view, center); const texel = 2 * r / S;
      cLS[0] = Math.floor(cLS[0] / texel) * texel; cLS[1] = Math.floor(cLS[1] / texel) * texel;
      const proj = M4.ortho(M4.new(), cLS[0] - r, cLS[0] + r, cLS[1] - r, cLS[1] + r, -cLS[2] - 350, -cLS[2] + 350);
      const vp = M4.mul(this.shadowVP[ci], proj, view);
      // bias to atlas half
      const B = new Float32Array([0.25, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.5, 0, 0.25 + ci * 0.5, 0.5, 0.5, 1]);
      M4.mul(this.shadowMats[ci], B, vp);
      gl.viewport(ci * S, 0, S, S);
      this.frustum.fromMatrix(vp);
      this.drawCasters(vp, ci, drawDynamic);
    }
    gl.disable(gl.POLYGON_OFFSET_FILL); gl.colorMask(true, true, true, true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    (this.prof || (this.prof = {})).shadows = this.glx.stats.tris - t0s;
  }
  drawCasters(vp, ci, drawDynamic) {
    const gl = this.gl, glx = this.glx, P = this.P;
    let p = glx.use(P.depthInst);
    gl.uniformMatrix4fv(p.u.u_viewProj, false, vp); gl.uniform1f(p.u.u_time, this.time);
    const wl = Math.hypot(this.wind[0], this.wind[2]) || 1; gl.uniform4f(p.u.u_wind, this.wind[0] / wl, this.wind[2] / wl, clamp(wl / 4, 0.3, 1.6), this.gust || 0);
    for (const g of this.vegGroups) {
      if (g.kind === 'flower') continue;
      if (ci === 0) { glx.draw(g.lods[0]); continue; }
      if (g.kind === 'tree') { glx.draw(g.shadowProxy[0]); glx.draw(g.shadowProxy[1]); }
      else glx.draw(g.lods[1]);
    }
    p = glx.use(P.depth); gl.uniformMatrix4fv(p.u.u_viewProj, false, vp);
    gl.uniformMatrix4fv(p.u.u_model, false, M4.identity(this.tmpM)); glx.draw(this.props);
    if (drawDynamic) drawDynamic(p, ci);
  }

  // ------------------------------------------------------------------ main view
  renderView(viewProj, camPos, opts) {
    const gl = this.gl, glx = this.glx, P = this.P, pal = this.pal;
    this.frustum.fromMatrix(viewProj);
    const S = glx.stats; const prof = this.prof || (this.prof = {}); let t0 = S.tris; const mark = k => { prof[k] = (prof[k] || 0) + S.tris - t0; t0 = S.tris; };
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.BLEND); gl.depthMask(true);
    // ---- terrain
    let p = glx.use(P.terrain); this.setCommon(p, viewProj, camPos);
    const c = this.course;
    gl.uniform4f(p.u.u_mapRect, c.min - 0.5, c.min - 0.5, 1 / c.N, 1 / c.N);
    gl.uniform3fv(p.u.u_cRough, pal.rough); gl.uniform3fv(p.u.u_cRough2, pal.rough2); gl.uniform3fv(p.u.u_cFair, pal.fair); gl.uniform3fv(p.u.u_cGreen, pal.green);
    gl.uniform3fv(p.u.u_cSand, pal.sand); gl.uniform3fv(p.u.u_cTee, pal.tee); gl.uniform3fv(p.u.u_cRock, pal.rock); gl.uniform3fv(p.u.u_cDirt, pal.dirt); gl.uniform3fv(p.u.u_cSnow, pal.snow);
    const sd = opts.stripeDir || [0.7071, 0.7071];
    gl.uniform4f(p.u.u_terr, 0, pal.snowLine, sd[0], sd[1]);
    const cup = opts.cup || [0, -1000, 0]; gl.uniform4f(p.u.u_cup, cup[0], cup[1], cup[2], PHYS.CUP_R);
    const bp = opts.ballPos || [0, -1000, 0]; gl.uniform4f(p.u.u_ball, bp[0], bp[1], bp[2], PHYS.R);
    gl.uniform4f(p.u.u_ballGlow, opts.ballGlow || 0, this.time, 0, 0);
    glx.tex(p, 'u_surf', this.surfTex); glx.tex(p, 'u_noise', this.noiseTex);
    this.terrain.draw(this.frustum, camPos, this.settings.quality === 'low' ? 1.4 : this.settings.quality === 'high' ? 0.8 : 1); mark('terrain');
    // ---- static props + far mountains + vegetation
    p = glx.use(P.lit); this.setCommon(p, viewProj, camPos);
    gl.uniform4f(p.u.u_tint, 1, 1, 1, 1); gl.uniform3f(p.u.u_emissive, 0, 0, 0); gl.uniform2f(p.u.u_spec, 0.25, 24);
    gl.uniformMatrix4fv(p.u.u_model, false, M4.identity(this.tmpM)); glx.draw(this.props);
    gl.uniform2f(p.u.u_spec, 0, 1); glx.draw(this.mountains); mark('props+far');
    p = glx.use(P.litInst); this.setCommon(p, viewProj, camPos);
    gl.uniform4f(p.u.u_tint, 1, 1, 1, 1); gl.uniform3f(p.u.u_emissive, 0, 0, 0); gl.uniform2f(p.u.u_spec, 0.0, 8);
    for (const g of this.vegGroups) { for (const m of g.lods) if (m) glx.draw(m); mark('veg_' + g.kind); }
    // ---- grass
    const gq = this.settings.grass; if (gq !== 'off') {
      p = glx.use(P.grass); this.setCommon(p, viewProj, camPos);
      const spacing = 0.44, R = gq === 'low' ? 9 : gq === 'high' ? 18 : 13; const N = Math.ceil(R * 1.55 / spacing);
      const fw = opts.headFwd || [0, 0, -1]; const fl = Math.hypot(fw[0], fw[2]) || 1;
      const gcx = camPos[0] + fw[0] / fl * R * 0.5, gcz = camPos[2] + fw[2] / fl * R * 0.5;
      gl.uniform4f(p.u.u_grid, Math.floor(gcx / spacing) * spacing, Math.floor(gcz / spacing) * spacing, spacing, N);
      gl.uniform1f(p.u.u_radius, R); gl.uniform4f(p.u.u_mapRect, c.min - 0.5, c.min - 0.5, 1 / c.N, 1 / c.N); gl.uniform4f(p.u.u_hmInfo, c.N, c.N, 1, 0);
      // hmInfo uses min (not -0.5) for exact vertex alignment
      gl.uniform3fv(p.u.u_cBase, pal.grassBase); gl.uniform3fv(p.u.u_cTip, pal.grassTip);
      gl.uniform4f(p.u.u_cup, cup[0], cup[1], cup[2], PHYS.CUP_R); gl.uniform4f(p.u.u_ball, bp[0], bp[1], bp[2], PHYS.R);
      gl.uniform1f(p.u.u_waterLevel, this.def.ocean ? this.def.ocean.level : -1e6);
      glx.tex(p, 'u_height', this.heightTex); glx.tex(p, 'u_surf', this.surfTex);
      this._grassMin = c.min;
      glx.drawInstancedN(this.grassMesh, N * N); mark('grass');
    }
    // ---- dynamic opaque (ball, club, flags, controllers) via callback
    opts.drawOpaque && opts.drawOpaque(viewProj, camPos); mark('dynamic');
    // ---- sky (last opaque: early-z rejects hidden pixels)
    p = glx.use(P.sky); this.setCommon(p, viewProj, camPos);
    gl.uniform1f(p.u.u_skyRot, this.time * 0.0006); gl.uniform3f(p.u.u_sunDisc, this.tod.disc[0], this.tod.disc[1], 0);
    glx.tex(p, 'u_sky', this.skyTarget.tex); glx.draw(this.skyMesh);
    // ---- water (blended)
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    p = glx.use(P.water); this.setCommon(p, viewProj, camPos);
    glx.tex(p, 'u_noise', this.noiseTex); glx.tex(p, 'u_sky', this.skyTarget.tex); gl.uniform1f(p.u.u_skyRot, this.time * 0.0006);
    for (let i = 0; i < this.waters.length; i++) {
      const wm = this.waters[i]; if (!wm) continue;
      const ocean = this.def.ocean && i === this.waters.length - 1;
      const sh = ocean ? pal.waterShallow : pal.waterShallow, dp = pal.waterDeep;
      gl.uniform3fv(p.u.u_cShallow, sh); gl.uniform3fv(p.u.u_cDeep, dp);
      gl.uniform4f(p.u.u_waterP, ocean ? 0.6 : 1.2, ocean ? 1.0 : 0.5, ocean ? 1.5 : 1.0, ocean ? 1.0 : 0.6);
      glx.draw(wm);
    }
    // ---- particles, trail, transparent effects via callback
    opts.drawTransparent && opts.drawTransparent(viewProj, camPos);
    gl.depthMask(true); gl.disable(gl.BLEND);
  }
}
