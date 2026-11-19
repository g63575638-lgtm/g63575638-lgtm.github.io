'use strict';
// ============================================================================
// GOLF BALL PHYSICS
//  * Flight: gravity, quadratic drag with drag crisis, Magnus lift from spin
//    (Cl(S) fitted to wind-tunnel data), spin decay, height-dependent wind,
//    per-map air density (mountain air carries further).
//  * Impact with ground: impulse model with restitution + Coulomb friction at
//    the contact point incl. spin (backspin checks / spins back on greens).
//  * Rolling: skid -> pure roll transition, rolling resistance per surface,
//    5/7 g slope acceleration of a rolling sphere, crest take-off.
//  * Cup: real geometry — rim edge collisions (lip-outs), walls, bottom,
//    flagstick; trees (trunks + canopy), rocks, water hazards, OB.
// ============================================================================

const PHYS = {
  R: 0.02135, M: 0.04593, G: 9.81, CUP_R: 0.054, CUP_D: 0.1016, FLAG_R: 0.0125,
  DT: 1 / 600, SPIN_TAU: 24, RIM_E: 0.8, RIM_MU: 1.1,
};
PHYS.A = Math.PI * PHYS.R * PHYS.R;

class BallPhysics {
  constructor(course) {
    this.course = course;
    this.p = [0, 0, 0]; this.v = [0, 0, 0]; this.w = [0, 0, 0];
    this.state = 'rest';           // rest | flight | roll | holed | water | ob
    this.grounded = false; this.teeHeight = 0;
    this.wind = [0, 0, 0]; this.rho = course.def.airDensity || 1.225;
    this.hole = null;              // {cupPos, flagIn}
    this.events = [];
    this.obst = []; this._obstAt = [1e9, 1e9]; this._canopyHit = new Set();
    this.rng = mulberry32(99);
    this.time = 0; this.maxHeight = 0; this.start = [0, 0, 0]; this.firstLand = null; this.lastDry = [0, 0, 0];
    this._n = [0, 0, 0]; this._t = [0, 0, 0]; this._t2 = [0, 0, 0];
    this.rollTime = 0; this.inCupTime = 0; this.holed = false; this.rotQ = [0, 0, 0, 1]; this.rotAxisAngle = 0;
  }
  emit(type, data) { this.events.push(Object.assign({ type }, data || {})); }

  placeAt(x, z, teed) {
    const h = this.course.height(x, z);
    this.teeHeight = teed ? (typeof teed === 'number' ? teed : 0.025) : 0;
    V3.set(this.p, x, h + PHYS.R + this.teeHeight, z); V3.set(this.v, 0, 0, 0); V3.set(this.w, 0, 0, 0);
    this.state = 'rest'; this.grounded = true; this.holed = false; this.inCupTime = 0; this.lastDry = [x, h, z];
  }
  get atRest() { return this.state === 'rest'; }
  get moving() { return this.state === 'flight' || this.state === 'roll'; }

  launch(v, w) {
    V3.copy(this.v, v); V3.copy(this.w, w);
    this.state = 'flight'; this.grounded = false; this.teeHeight = 0; this.time = 0; this.rollTime = 0;
    this.start = this.p.slice(); this.maxHeight = this.p[1]; this.firstLand = null; this._canopyHit.clear();
    this.holed = false; this.inCupTime = 0; this.bounces = 0;
    this.rng = mulberry32((Math.abs(v[0] * 1000 + v[2] * 7777) | 0) + 1);
  }

  // advance by dt seconds (variable frame dt -> fixed substeps)
  update(dt) {
    if (!this.moving) return;
    this.acc = (this.acc || 0) + Math.min(dt, 0.05);
    while (this.acc >= PHYS.DT) { this.acc -= PHYS.DT; this.substep(PHYS.DT); if (!this.moving) { this.acc = 0; break; } }
    // visual rolling rotation (accumulate angle along spin axis)
    const wl = V3.len(this.w); this.spinVis = (this.spinVis || 0) + wl * dt;
  }

  windAt(hag, out) {
    const f = clamp(0.35 + 0.065 * hag, 0.35, 1.25);
    out[0] = this.wind[0] * f; out[1] = 0; out[2] = this.wind[2] * f; return out;
  }

  substep(dt) {
    const c = this.course, p = this.p, v = this.v, w = this.w, R = PHYS.R;
    this.time += dt;
    const gh = c.height(p[0], p[2]);
    const hag = p[1] - R - gh;
    // ---------------------------------------------------------- forces
    if (!this.grounded) {
      const wv = this.windAt(Math.max(hag, 0), this._t);
      const vrx = v[0] - wv[0], vry = v[1] - wv[1], vrz = v[2] - wv[2];
      const sp = Math.hypot(vrx, vry, vrz);
      if (sp > 0.5) {
        const wl = V3.len(w); const S = R * wl / sp;
        const crisis = smoothstep(19, 11, sp);            // laminar regime below ~15 m/s
        const Cd = 0.225 + 0.2 * Math.min(S, 0.35) + 0.26 * crisis;
        let Cl = S < 0.3 ? 1.99 * S - 3.25 * S * S : 0.296;
        Cl = Math.max(Cl, 0) * (1 - 0.35 * crisis);
        const q = 0.5 * this.rho * PHYS.A / PHYS.M;
        // drag
        v[0] -= q * Cd * sp * vrx * dt; v[1] -= q * Cd * sp * vry * dt; v[2] -= q * Cd * sp * vrz * dt;
        // lift  (w x vr) direction, magnitude q Cl sp^2
        if (wl > 1) {
          let lx = w[1] * vrz - w[2] * vry, ly = w[2] * vrx - w[0] * vrz, lz = w[0] * vry - w[1] * vrx;
          const ll = Math.hypot(lx, ly, lz) || 1; const k = q * Cl * sp * sp / ll * dt;
          v[0] += lx * k; v[1] += ly * k; v[2] += lz * k;
        }
      }
      // spin decay in air
      const dec = Math.exp(-dt / PHYS.SPIN_TAU); w[0] *= dec; w[1] *= dec; w[2] *= dec;
    }
    v[1] -= PHYS.G * dt;
    p[0] += v[0] * dt; p[1] += v[1] * dt; p[2] += v[2] * dt;
    if (p[1] > this.maxHeight) this.maxHeight = p[1];

    // ---------------------------------------------------------- water / bounds
    const surf = c.surface(p[0], p[2]);
    if (surf === SURF.WATER) {
      const wl = c.waterLevelAt(p[0], p[2]);
      if (p[1] - R * 0.3 < wl) { this.state = 'water'; V3.set(v, 0, 0, 0); this.emit('water', { pos: [p[0], wl, p[2]], speed: V3.len(v) }); return; }
    } else if (hag < 25) { this.lastDry[0] = p[0]; this.lastDry[1] = gh; this.lastDry[2] = p[2]; }
    if (Math.abs(p[0]) > c.half - 2 || Math.abs(p[2]) > c.half - 2 || p[1] < gh - 5) { this.state = 'ob'; this.emit('ob', { pos: p.slice() }); return; }

    // ---------------------------------------------------------- obstacles (trees, rocks)
    if (hag < 30) this.obstacles(dt);

    // ---------------------------------------------------------- cup & flag
    let overHole = false;
    const hole = this.hole;
    if (hole) {
      const cp = hole.cupPos; const dx = p[0] - cp[0], dz = p[2] - cp[2]; const dxz = Math.hypot(dx, dz);
      if (dxz < 0.35) {
        overHole = dxz < PHYS.CUP_R;
        this.cupCollide(dx, dz, dxz, cp, dt);
        if (!this.moving) return;
      }
    }

    // ---------------------------------------------------------- ground contact
    if (!overHole) {
      const n = c.normal(p[0], p[2], this._n);
      const h = c.height(p[0], p[2]);
      const pen = (p[1] - h) * n[1] - R;
      if (pen < 0) {
        p[0] -= n[0] * pen; p[1] -= n[1] * pen; p[2] -= n[2] * pen;
        const vn = V3.dot(v, n);
        const sp = SURF_PHYS[surf] || SURF_PHYS[0];
        if (vn < -0.42) this.bounce(n, vn, sp, surf);
        else {
          if (vn < 0) { v[0] -= vn * n[0]; v[1] -= vn * n[1]; v[2] -= vn * n[2]; }
          if (!this.grounded) { this.grounded = true; if (this.state === 'flight') { this.state = 'roll'; this.emit('rollStart', {}); } }
        }
      } else if (pen > 0.004) {
        this.grounded = false;
      }
      if (this.grounded) this.rolling(n, SURF_PHYS[surf] || SURF_PHYS[0], surf, dt);
    } else {
      this.grounded = false;
    }
    if (this.time > 40) this.rest('timeout');
  }

  bounce(n, vn, sp, surf) {
    const v = this.v, w = this.w, R = PHYS.R;
    const speed = V3.len(v); const steep = -vn / (speed || 1);
    let e = sp.e / (1 + 0.035 * Math.max(-vn - 3, 0));
    if (surf === SURF.GREEN || surf === SURF.FRINGE) e *= lerp(1, 0.75, smoothstep(0.5, 0.95, steep));
    const mu = sp.mu * (1 + 0.7 * smoothstep(0.45, 0.9, steep) * (surf === SURF.GREEN ? 1.3 : 1));
    // tangential velocity and contact-point slip
    const vtx = v[0] - vn * n[0], vty = v[1] - vn * n[1], vtz = v[2] - vn * n[2];
    // w x (-R n)
    const cx = -(w[1] * n[2] - w[2] * n[1]) * R, cy = -(w[2] * n[0] - w[0] * n[2]) * R, cz = -(w[0] * n[1] - w[1] * n[0]) * R;
    const vcx = vtx + cx, vcy = vty + cy, vcz = vtz + cz; const vc = Math.hypot(vcx, vcy, vcz);
    let jt = 0;
    if (vc > 1e-4) {
      jt = Math.min(mu * (1 + e) * -vn, (2 / 7) * vc);
      const dvx = -vcx / vc * jt, dvy = -vcy / vc * jt, dvz = -vcz / vc * jt;
      v[0] = vtx + dvx; v[1] = vty + dvy; v[2] = vtz + dvz;
      // dw = -(5/2R) n x dv
      const k = -5 / (2 * R);
      w[0] += k * (n[1] * dvz - n[2] * dvy); w[1] += k * (n[2] * dvx - n[0] * dvz); w[2] += k * (n[0] * dvy - n[1] * dvx);
    } else { v[0] = vtx; v[1] = vty; v[2] = vtz; }
    // turf deformation absorbs part of the tangential speed (steeper landings lose more)
    const tl = 1 - (sp.tl || 0.2) * (0.4 + 0.6 * steep);
    v[0] *= tl; v[1] *= tl; v[2] *= tl;
    v[0] -= e * vn * n[0]; v[1] -= e * vn * n[1]; v[2] -= e * vn * n[2];
    // natural surface randomness (lumpy rough, grass blades)
    if (sp.bump > 0) { const r = this.rng; v[0] += (r() - 0.5) * sp.bump * 40 * steep; v[2] += (r() - 0.5) * sp.bump * 40 * steep; }
    this.bounces++;
    if (!this.firstLand) { this.firstLand = this.p.slice(); this.emit('land', { pos: this.p.slice(), surf }); }
    this.emit('bounce', { speed: -vn, surf, pos: this.p.slice() });
    this.grounded = false;
    if (surf === SURF.SAND || surf === SURF.BEACH) { V3.scale(v, v, 0.25); this.emit('sand', { pos: this.p.slice() }); }
  }

  // impulse against a static surface point with normal n (incl. spin/friction coupling)
  impactStatic(n, e, mu) {
    const v = this.v, w = this.w, R = PHYS.R;
    const vn = V3.dot(v, n); if (vn >= 0) return 0;
    const vtx = v[0] - vn * n[0], vty = v[1] - vn * n[1], vtz = v[2] - vn * n[2];
    const cx = -(w[1] * n[2] - w[2] * n[1]) * R, cy = -(w[2] * n[0] - w[0] * n[2]) * R, cz = -(w[0] * n[1] - w[1] * n[0]) * R;
    const vcx = vtx + cx, vcy = vty + cy, vcz = vtz + cz; const vc = Math.hypot(vcx, vcy, vcz);
    v[0] = vtx; v[1] = vty; v[2] = vtz;
    if (vc > 1e-4) {
      const jt = Math.min(mu * (1 + e) * -vn, (2 / 7) * vc);
      const dvx = -vcx / vc * jt, dvy = -vcy / vc * jt, dvz = -vcz / vc * jt;
      v[0] += dvx; v[1] += dvy; v[2] += dvz;
      const k = -5 / (2 * R);
      w[0] += k * (n[1] * dvz - n[2] * dvy); w[1] += k * (n[2] * dvx - n[0] * dvz); w[2] += k * (n[0] * dvy - n[1] * dvx);
    }
    v[0] -= e * vn * n[0]; v[1] -= e * vn * n[1]; v[2] -= e * vn * n[2];
    return -vn;
  }

  rolling(n, sp, surf, dt) {
    const v = this.v, w = this.w, R = PHYS.R, G = PHYS.G;
    // project velocity to tangent plane
    const vn = V3.dot(v, n); v[0] -= vn * n[0]; v[1] -= vn * n[1]; v[2] -= vn * n[2];
    // slip velocity at contact point
    const cx = -(w[1] * n[2] - w[2] * n[1]) * R, cy = -(w[2] * n[0] - w[0] * n[2]) * R, cz = -(w[0] * n[1] - w[1] * n[0]) * R;
    const vcx = v[0] + cx, vcy = v[1] + cy, vcz = v[2] + cz; const vc = Math.hypot(vcx, vcy, vcz);
    const normalAcc = G * n[1];
    if (vc > 0.03) { // skidding
      const dvm = Math.min(sp.mu * normalAcc * dt, vc * 2 / 7);
      const dvx = -vcx / vc * dvm, dvy = -vcy / vc * dvm, dvz = -vcz / vc * dvm;
      v[0] += dvx; v[1] += dvy; v[2] += dvz;
      const k = -5 / (2 * R);
      w[0] += k * (n[1] * dvz - n[2] * dvy); w[1] += k * (n[2] * dvx - n[0] * dvz); w[2] += k * (n[0] * dvy - n[1] * dvx);
    } else {
      // pure rolling: rotational inertia => only 5/7 of slope gravity accelerates the ball
      const gtx = -G * (0 - n[1] * n[0]), gty = -G * (1 - n[1] * n[1]), gtz = -G * (0 - n[1] * n[2]);
      v[0] -= (2 / 7) * gtx * dt; v[1] -= (2 / 7) * gty * dt; v[2] -= (2 / 7) * gtz * dt;
      const s = V3.len(v);
      // rolling resistance (surface + grain)
      const dec = sp.roll * normalAcc * dt * (1 + 0.6 * smoothstep(0.6, 0.05, s) * (surf === SURF.GREEN ? 0.3 : 1));
      if (s > dec) V3.scale(v, v, (s - dec) / s); else V3.set(v, 0, 0, 0);
      // lumpy turf
      if (sp.bump > 0 && s > 0.2) { const r = this.rng; const j = (r() - 0.5) * sp.bump * 3 * dt * 60; v[0] += -v[2] * j; v[2] += v[0] * j; }
      // spin follows rolling
      w[0] = (n[1] * v[2] - n[2] * v[1]) / R; w[1] = (n[2] * v[0] - n[0] * v[2]) / R; w[2] = (n[0] * v[1] - n[1] * v[0]) / R;
    }
    this.rollTime += dt;
    // rest test: slow and slope cannot overcome static resistance
    const s = V3.len(v);
    const slopeAcc = (5 / 7) * G * Math.sqrt(Math.max(0, 1 - n[1] * n[1]));
    if (s < 0.018 && slopeAcc < sp.roll * G * 1.08) this.rest('stopped');
    else if (surf === SURF.SAND && s < 0.12) this.rest('stopped');
  }

  rest(reason) {
    V3.set(this.v, 0, 0, 0); V3.set(this.w, 0, 0, 0);
    const c = this.course, p = this.p;
    if (!c.inBounds(p[0], p[2])) { this.state = 'ob'; this.emit('ob', { pos: p.slice() }); return; }
    this.state = this.holed ? 'holed' : 'rest';
    if (!this.holed) { const h = c.height(p[0], p[2]); p[1] = Math.max(p[1], h + PHYS.R * 0.98); }
    this.emit('rest', { pos: p.slice(), surf: c.surface(p[0], p[2]), reason });
  }

  cupCollide(dx, dz, dxz, cp, dt) {
    const p = this.p, v = this.v, w = this.w, R = PHYS.R, CR = PHYS.CUP_R;
    const cy = cp[1];
    // flagstick
    if (this.hole.flagIn && dxz < R + PHYS.FLAG_R && p[1] < cy + 2.3) {
      const nx = dx / (dxz || 1), nz = dz / (dxz || 1); const push = R + PHYS.FLAG_R - dxz;
      p[0] += nx * push; p[2] += nz * push;
      const vr = v[0] * nx + v[2] * nz;
      if (vr < 0) { v[0] -= 1.45 * vr * nx; v[2] -= 1.45 * vr * nz; V3.scale(v, v, 0.75); this.emit('flag', { speed: -vr }); }
    }
    // rim edge (circle) collision
    if (dxz > 1e-5 && dxz < CR + R) {
      const qx = cp[0] + dx / dxz * CR, qz = cp[2] + dz / dxz * CR, qy = cy;
      const ex = p[0] - qx, ey = p[1] - qy, ez = p[2] - qz; const d = Math.hypot(ex, ey, ez);
      if (d < R && (dxz < CR || p[1] < cy + R)) {
        const nx = ex / d, ny = ey / d, nz = ez / d;
        p[0] = qx + nx * R; p[1] = qy + ny * R; p[2] = qz + nz * R;
        const s = this.impactStatic([nx, ny, nz], PHYS.RIM_E, PHYS.RIM_MU);
        if (s > 0.15) this.emit('rim', { speed: s });
        this.grounded = false;
      }
    }
    // inside the cup
    if (dxz < CR && p[1] < cy + R * 0.2) {
      if (p[1] < cy - 0.005 && !this.holed) { this.holed = true; this.emit('holed', { speed: V3.len(v) }); }
      // walls
      if (dxz > CR - R) {
        const nx = -dx / dxz, nz = -dz / dxz; const push = dxz - (CR - R);
        if (p[1] < cy - R * 0.3) {
          p[0] += nx * push; p[2] += nz * push;
          const s = this.impactStatic([nx, 0, nz], 0.35, 0.4); if (s > 0.2) this.emit('cupWall', { speed: s });
        }
      }
      // bottom
      const by = cy - PHYS.CUP_D;
      if (p[1] - R < by) {
        p[1] = by + R;
        if (v[1] < 0) { const s = -v[1]; v[1] = s * 0.18; V3.scale(v, v, 0.6); if (s > 0.25) this.emit('cupBottom', { speed: s }); }
        this.grounded = false;
      }
      if (this.holed) {
        this.inCupTime += dt;
        V3.scale(v, v, Math.exp(-dt * 2.5)); V3.scale(w, w, Math.exp(-dt * 4));
        if (this.inCupTime > 2.5 || (V3.len(v) < 0.02 && p[1] < by + R + 0.002)) { this.state = 'holed'; V3.set(v, 0, 0, 0); this.emit('rest', { pos: p.slice(), surf: SURF.GREEN, reason: 'holed' }); }
      }
    }
  }

  obstacles(dt) {
    const p = this.p, v = this.v, R = PHYS.R, c = this.course;
    if (Math.abs(p[0] - this._obstAt[0]) > 4 || Math.abs(p[2] - this._obstAt[1]) > 4) { c.nearbyObstacles(p[0], p[2], this.obst); this._obstAt = [p[0], p[2]]; }
    for (const t of this.obst) {
      if (t.rock) {
        const cx = t.x, cy = t.y + 0.25 * t.s, cz = t.z, rr = t.s * 0.82;
        const dx = p[0] - cx, dy = p[1] - cy, dz = p[2] - cz; const d = Math.hypot(dx, dy, dz);
        if (d < rr + R) {
          const nx = dx / d, ny = dy / d, nz = dz / d; const push = rr + R - d;
          p[0] += nx * push; p[1] += ny * push; p[2] += nz * push;
          const s = this.impactStatic([nx, ny, nz], 0.55, 0.35);
          if (s > 0) { this.grounded = false; this.emit('rock', { speed: s, pos: p.slice() }); }
        }
        continue;
      }
      const dims = this.treeDims && this.treeDims[t.sp] ? this.treeDims[t.sp][t.v] : null; if (!dims) continue;
      const s = t.s;
      // trunk (vertical cylinder)
      const tr = dims.trunkR * s, th = dims.trunkH * s;
      const dx = p[0] - t.x, dz = p[2] - t.z; const dxz = Math.hypot(dx, dz);
      if (tr > 0 && dxz < tr + R && p[1] > t.y - 0.5 && p[1] < t.y + th) {
        const nx = dx / (dxz || 1), nz = dz / (dxz || 1); const push = tr + R - dxz;
        p[0] += nx * push; p[2] += nz * push;
        const s = this.impactStatic([nx, 0, nz], 0.42, 0.3);
        if (s > 0) { this.grounded = false; this.emit('trunk', { speed: s, pos: p.slice() }); }
      }
      // canopy (leaves & branches): probabilistic branch hits + drag
      const lean = dims.lean ? [dims.lean[0] * s, dims.lean[2] * s] : [0, 0];
      const ccx = t.x + lean[0], ccy = t.y + dims.canopyY * s, ccz = t.z + lean[1], cr = dims.canopyR * s * 0.9;
      const ddx = p[0] - ccx, ddy = (p[1] - ccy) * 1.15, ddz = p[2] - ccz;
      if (ddx * ddx + ddy * ddy + ddz * ddz < cr * cr) {
        const sp = V3.len(v);
        V3.scale(v, v, 1 - Math.min(0.9, 1.4 * dt));
        if (this.rng() < dt * sp * 0.22) {
          // branch deflection: random direction biased opposite of travel and downward
          const r = this.rng; const keep = 0.15 + r() * 0.3;
          const nx = (r() - 0.5) * 2 - v[0] / (sp || 1) * 0.8, ny = -r() * 1.2, nz = (r() - 0.5) * 2 - v[2] / (sp || 1) * 0.8; const nl = Math.hypot(nx, ny, nz) || 1;
          V3.set(v, nx / nl * sp * keep, ny / nl * sp * keep, nz / nl * sp * keep);
          V3.scale(this.w, this.w, 0.3);
          this.emit('leaves', { speed: sp, pos: p.slice() });
        } else if (!this._canopyHit.has(t)) { this._canopyHit.add(t); this.emit('leavesSoft', { speed: sp, pos: p.slice() }); }
      }
    }
  }
}

// ============================================================================
// CLUB–BALL IMPACT: oblique impact of a lofted face on a free ball.
//  normal:  u_n = v_n (1+e) M_eff / (M_eff + m)
//  tangent: ball rolls up the face -> u_t = 2/7 v_t, spin w = 5/(2r) u_t x n
//  off-centre hits reduce effective mass and add gear-effect spin.
// ============================================================================
const ClubImpact = {
  compute(club, headVel, face0W, upW, soleW, offCenter, vertOff, lie, opts = {}) {
    // orient face toward travel (makes the model robust to handedness)
    let f0 = face0W.slice(); if (V3.dot(f0, headVel) < 0) V3.scale(f0, f0, -1);
    const L = deg(club.loft + (club.dyn || 0));
    let n = V3.norm([0, 0, 0], [f0[0] * Math.cos(L) + upW[0] * Math.sin(L), f0[1] * Math.cos(L) + upW[1] * Math.sin(L), f0[2] * Math.cos(L) + upW[2] * Math.sin(L)]);
    // thin / topped contact: face edge, ball driven downward
    let quality = 1;
    if (vertOff > 0.55) { n = V3.norm(n, V3.madd([0, 0, 0], n, upW, -0.9 * smoothstep(0.55, 1.2, vertOff))); quality *= lerp(1, 0.55, smoothstep(0.55, 1.2, vertOff)); }
    const vn = V3.dot(headVel, n);
    if (vn <= 0.05) return null;
    const isWood = club.type === 'wood', isPutt = club.type === 'putter';
    const I = isWood ? 4.6e-4 : isPutt ? 4.5e-4 : 2.6e-4;
    const M = club.mass; const d = offCenter;
    const Meff = M / (1 + M * d * d / I);
    let e = club.cor * (1 - 0.0018 * Math.max(vn - 20, 0)) - Math.abs(d) * (isWood ? 1.2 : 2.2);
    e = clamp(e, 0.45, 0.86);
    if (isPutt) e = clamp(club.cor - Math.abs(d) * 2, 0.45, club.cor);
    const un = vn * (1 + e) * Meff / (Meff + PHYS.M) * quality;
    const vt = V3.madd([0, 0, 0], headVel, n, -vn);
    const ut = V3.scale([0, 0, 0], vt, 2 / 7);
    const ball = V3.madd([0, 0, 0], ut, n, un);
    const spin = V3.scale([0, 0, 0], V3.cross([0, 0, 0], ut, n), 5 / (2 * PHYS.R));
    // gear effect: toe hits hook (woods mostly)
    const gear = isWood ? 110 : isPutt ? 0 : 35;
    const axis = V3.norm([0, 0, 0], V3.cross([0, 0, 0], soleW, n)); // ~ vertical-ish axis on the face
    V3.madd(spin, spin, axis, d * gear * vn); // toe (+d) -> hook / draw spin
    // lie
    let sf = lie[0], wf = lie[1];
    if (opts.sandLie && (club.id === 'sw' || club.id === 'pw')) { sf = 0.82; wf = 0.7; }
    if (opts.fat) { sf *= 0.62; wf *= 0.6; }
    V3.scale(ball, ball, sf); V3.scale(spin, spin, wf);
    const bs = V3.len(ball);
    const launch = Math.asin(clamp(ball[1] / (bs || 1), -1, 1)) * 180 / PI;
    return { v: ball, w: spin, ballSpeed: bs, headSpeed: V3.len(headVel), smash: bs / Math.max(V3.len(headVel), 0.01), launch, rpm: V3.len(spin) * 60 / TAU, offCenter: d, quality };
  },
};
