'use strict';
// ============================================================================
// THE CLUB — a real interactive VR object.
//  * Grab with GRIP near the handle, release to drop / throw it; it falls,
//    bounces and lies on the ground (2-point rigid body with ground contact).
//  * While held it follows the controller 1:1 (grip space) — no smoothing lag.
//  * Swing detection: continuous (swept) collision of the club-head capsule
//    against the ball with sub-frame interpolation -> no tunnelling even at
//    50 m/s head speed. Head velocity from XR pose velocities when available,
//    else finite differences. Contact point, face angle, loft, path, speed and
//    ground contact (fat shots) all feed the impact model.
// ============================================================================

class ClubSystem {
  constructor(game) {
    this.game = game; this.index = 0; this.held = null; // 'left' | 'right' | null
    this.matrix = M4.new(); this.prevMatrix = M4.new(); this.hasPrev = false;
    // free body: butt (a) and head (b) points
    this.a = [0, 0, 0]; this.b = [0, 0, 0]; this.pa = [0, 0, 0]; this.pb = [0, 0, 0]; this.roll = [0, 1, 0];
    this.free = false; this.recallT = -1; this.recallFrom = null; this.gripHoldT = { left: 0, right: 0 };
    this.cool = 0; this.history = []; this.headSpeed = 0; this.lastImpact = null; this.groundBuzz = 0;
    this.prevSeg = null; this.headPrev = null;
  }
  get club() { return CLUBS[this.index]; }
  localMatrix() {
    // grip-space -> club local with user angle and handedness
    const s = this.game.settings; const a = deg(s.clubAngle || 0);
    const m = M4.new(); const c = Math.cos(a), sn = Math.sin(a);
    // rotate about X by angle a
    m[5] = c; m[6] = sn; m[9] = -sn; m[10] = c;
    if (s.handed === 'left') { const r = M4.new(); r[0] = -1; r[5] = -1; M4.mul(m, m, r); } // 180° about Z
    return m;
  }

  setClub(i, silent) {
    this.index = (i + CLUBS.length) % CLUBS.length;
    if (!silent) { AUDIO.grab(this.headPos()); this.game.haptic(this.held, 0.25, 25); }
    this.game.onClubChanged && this.game.onClubChanged();
  }
  headPos(out) { out = out || [0, 0, 0]; return M4.transformPoint(out, this.matrix, this.club.col.sweet); }
  // free-body points: a = butt end, b = club-head sweet spot (sole rests on the ground)
  buttLocal() { return M4.transformPoint([0, 0, 0], this.localMatrix(), [0, 0, 0.07]); }
  sweetLocal() { return M4.transformPoint([0, 0, 0], this.localMatrix(), this.club.col.sweet); }
  shaftLen() { return V3.dist(this.buttLocal(), this.sweetLocal()); }

  // place club lying on the ground near a position
  dropAt(pos, dir) {
    const h = this.game.course.height(pos[0], pos[2]);
    V3.set(this.a, pos[0], h + 0.03, pos[2]); const L = this.shaftLen();
    V3.set(this.b, pos[0] + dir[0] * L, this.game.course.height(pos[0] + dir[0] * L, pos[2] + dir[2] * L) + 0.03, pos[2] + dir[2] * L);
    V3.copy(this.pa, this.a); V3.copy(this.pb, this.b); this.free = true; this.held = null; this.roll = [0, 1, 0]; this.composeFree();
  }

  update(dt, input) {
    const g = this.game; const s = g.settings;
    this.cool = Math.max(0, this.cool - dt);
    // the rig jumped (teleport / snap turn / go-to-ball): the club moved with the player, not swung
    if (g.player.jumped) { g.player.jumped = false; this.hasPrev = false; this.headPrev = null; this.cool = Math.max(this.cool, 0.15); }
    M4.copy(this.prevMatrix, this.matrix);
    // ---------------------------------------------------- grab / release / recall
    for (const hand of ['left', 'right']) {
      const H = input.hands[hand]; if (!H || !H.present) continue;
      if (this.held === hand) {
        if (H.squeeze.released && !g.desktop) { this.release(H); }
        continue;
      }
      if (this.held) continue;
      if (H.squeeze.pressed && !g.uiCapturing(hand)) {
        const d = this.distToGrip(H.pos);
        if (d < 0.2 || this.recallT >= 0) { this.grab(hand); continue; }
      }
      if (H.squeeze.down && !g.uiCapturing(hand)) {
        this.gripHoldT[hand] += dt;
        if (this.gripHoldT[hand] > 0.45 && this.recallT < 0) { this.recallT = 0; this.recallHand = hand; this.recallFrom = [this.a.slice(), this.b.slice()]; }
      } else this.gripHoldT[hand] = 0;
    }
    if (this.recallT >= 0) {
      this.recallT += dt * 3.2; const H = input.hands[this.recallHand];
      if (!H || !H.squeeze.down) { this.recallT = -1; }
      else if (this.recallT >= 1) { this.grab(this.recallHand); this.recallT = -1; g.toast(T('club_recalled'), '', 1.2); }
      else { // fly toward the hand
        const t = easeInOut(this.recallT); const L = this.shaftLen();
        const target = H.pos; const down = [0, -1, 0];
        V3.lerp(this.a, this.recallFrom[0], target, t); V3.lerp(this.b, this.recallFrom[1], V3.madd([0, 0, 0], target, down, L), t); V3.copy(this.pa, this.a); V3.copy(this.pb, this.b);
        this.composeFree();
      }
    }
    // ---------------------------------------------------- held: follow hand exactly
    if (this.held) {
      const H = input.hands[this.held];
      M4.mul(this.matrix, H.grip, this.localMatrix());
      this.free = false;
    } else if (this.free && this.recallT < 0) {
      this.simulateFree(dt);
    }
    // ---------------------------------------------------- swing tracking & ball collision
    const head = this.headPos();
    if (this.headPrev && dt > 0 && this.hasPrev) { const sp = Math.min(V3.dist(head, this.headPrev) / dt, 80); this.headSpeed = lerp(this.headSpeed, sp, 0.5); } else this.headSpeed = 0;
    this.headPrev = head;
    if (this.held) {
      AUDIO.updateWhoosh(this.headSpeed, head);
      this.groundContact(dt, head);
      this.checkBall(dt, input);
    } else AUDIO.updateWhoosh(0, head);
    this.hasPrev = true;
  }

  distToGrip(p) {
    // distance from point to the grip segment (butt -> 25 cm down the shaft)
    const a = M4.transformPoint([0, 0, 0], this.matrix, [0, 0, 0.07]), b = M4.transformPoint([0, 0, 0], this.matrix, [0, 0, -0.3]);
    const ab = V3.sub([0, 0, 0], b, a); const t = clamp(V3.dot(V3.sub([0, 0, 0], p, a), ab) / V3.dot(ab, ab), 0, 1);
    return V3.dist(p, V3.madd([0, 0, 0], a, ab, t));
  }
  grab(hand) {
    this.held = hand; this.free = false; this.gripHoldT.left = this.gripHoldT.right = 0;
    AUDIO.grab(this.game.input.hands[hand].pos); this.game.haptic(hand, 0.5, 30);
    this.game.onGrab && this.game.onGrab(hand);
  }
  release(H) {
    // become a free rigid body with the hand's velocity (throwable)
    this.held = null; this.free = true;
    M4.transformPoint(this.a, this.matrix, [0, 0, 0.07]);
    M4.transformPoint(this.b, this.matrix, this.club.col.sweet);
    const va = H.vel || [0, 0, 0]; const w = H.angVel || [0, 0, 0]; const fdt = 1 / 72;
    // velocities of both ends (v + w x r)
    const ra = V3.sub([0, 0, 0], this.a, H.pos), rb = V3.sub([0, 0, 0], this.b, H.pos);
    const vA = V3.add([0, 0, 0], va, V3.cross([0, 0, 0], w, ra)), vB = V3.add([0, 0, 0], va, V3.cross([0, 0, 0], w, rb));
    V3.madd(this.pa, this.a, vA, -fdt); V3.madd(this.pb, this.b, vB, -fdt);
    this.roll = V3.norm([0, 0, 0], M4.transformDir([0, 0, 0], this.matrix, this.club.col.up));
    this.game.haptic(H.hand, 0.2, 15);
  }
  simulateFree(dt) {
    const c = this.game.course; const L = this.shaftLen();
    const steps = 4; const h = Math.min(dt, 0.05) / steps;
    for (let s = 0; s < steps; s++) {
      for (const [p, pp, r, fr] of [[this.a, this.pa, 0.015, 0.25], [this.b, this.pb, Math.max(this.club.col.radius, 0.012), 0.4]]) {
        const vx = (p[0] - pp[0]) * 0.995, vy = (p[1] - pp[1]) * 0.995, vz = (p[2] - pp[2]) * 0.995;
        V3.copy(pp, p); p[0] += vx; p[1] += vy - 9.81 * h * h; p[2] += vz;
        const gh = c.height(p[0], p[2]) + r;
        if (p[1] < gh) {
          const pen = gh - p[1]; p[1] = gh;
          // ground friction & bounce
          pp[0] = p[0] - vx * fr; pp[2] = p[2] - vz * fr; pp[1] = p[1] + vy * 0.25;
          if (-vy / h > 2.5 && pen > 0.001) { AUDIO.drop(p.slice()); }
        }
      }
      // distance constraint
      const d = V3.sub([0, 0, 0], this.b, this.a); const l = V3.len(d) || 1; const k = (l - L) / l * 0.5;
      this.a[0] += d[0] * k; this.a[1] += d[1] * k; this.a[2] += d[2] * k; this.b[0] -= d[0] * k; this.b[1] -= d[1] * k; this.b[2] -= d[2] * k;
    }
    this.composeFree();
  }
  composeFree() {
    // rigid transform mapping local (butt -> sweet spot) onto world (a -> b), with a roll vector for the head's "up"
    const bl = this.buttLocal(), sl = this.sweetLocal(), L = this.localMatrix();
    const upL = V3.norm([0, 0, 0], M4.transformDir([0, 0, 0], L, this.club.col.up));
    const e1 = V3.norm([0, 0, 0], V3.sub([0, 0, 0], sl, bl)); let e2 = V3.madd([0, 0, 0], upL, e1, -V3.dot(upL, e1)); V3.norm(e2, e2); const e3 = V3.cross([0, 0, 0], e1, e2);
    const f1 = V3.norm([0, 0, 0], V3.sub([0, 0, 0], this.b, this.a));
    // when resting, the head settles sole-down (roll relaxes toward world up)
    const still = V3.dist(this.b, this.pb) < 0.002;
    if (still) V3.norm(this.roll, V3.lerp([0, 0, 0], this.roll, [0, 1, 0], 0.08));
    let f2 = V3.madd([0, 0, 0], this.roll, f1, -V3.dot(this.roll, f1)); if (V3.len(f2) < 1e-3) f2 = Math.abs(f1[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    f2 = V3.madd(f2, f2, f1, -V3.dot(f2, f1)); V3.norm(f2, f2); this.roll = f2.slice(); const f3 = V3.cross([0, 0, 0], f1, f2);
    // R = F * E^T  (columns)
    const R = M4.new();
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) R[j * 4 + i] = f1[i] * e1[j] + f2[i] * e2[j] + f3[i] * e3[j];
    // grip-space matrix G with G * L * butt = a  ->  club matrix = G * L
    const club = M4.copy(M4.new(), R); const rb = M4.transformDir([0, 0, 0], R, bl);
    club[12] = this.a[0] - rb[0]; club[13] = this.a[1] - rb[1]; club[14] = this.a[2] - rb[2];
    // "club" is the grip-space -> world transform G; meshes are in club-local space -> matrix = G * L
    M4.mul(this.matrix, club, L);
  }

  groundContact(dt, head) {
    const c = this.game.course; const sole = M4.transformPoint([0, 0, 0], this.matrix, this.club.col.sweet);
    const gh = c.height(sole[0], sole[2]); const pen = gh - (sole[1] - 0.012);
    const now = this.game.time;
    this.history.push({ t: now, x: sole[0], z: sole[2], pen }); while (this.history.length && now - this.history[0].t > 0.25) this.history.shift();
    if (pen > 0.01) {
      this.groundBuzz += dt;
      if (this.headSpeed > 9 && this.groundBuzz < 0.1) {
        const surf = c.surface(sole[0], sole[2]);
        const type = surf === SURF.SAND || surf === SURF.BEACH ? 'sand' : surf === SURF.WATER ? 'water' : 'grass';
        this.game.world.emit(type, [sole[0], gh + 0.01, sole[2]], 6, { speed: this.headSpeed * 0.08, size: 0.012, life: 0.8 });
        if (type === 'grass') this.game.world.emit('dirt', [sole[0], gh + 0.01, sole[2]], 3, { speed: this.headSpeed * 0.06, size: 0.015, life: 0.8 });
        if (this.groundBuzz < dt * 1.5) AUDIO.divot(sole, clamp(this.headSpeed / 30, 0.2, 1));
      }
      this.game.haptic(this.held, clamp(pen * 8 + this.headSpeed * 0.01, 0.05, 0.4), 16);
    } else this.groundBuzz = 0;
  }

  // ---------------------------------------------------- swept head vs ball
  checkBall(dt, input) {
    const g = this.game; const ball = g.ball;
    if (!g.canHit() || this.cool > 0 || !this.hasPrev) return;
    const col = this.club.col; const R = PHYS.R;
    const h0 = M4.transformPoint([0, 0, 0], this.prevMatrix, col.heel), t0 = M4.transformPoint([0, 0, 0], this.prevMatrix, col.toe);
    const h1 = M4.transformPoint([0, 0, 0], this.matrix, col.heel), t1 = M4.transformPoint([0, 0, 0], this.matrix, col.toe);
    const bc = ball.p;
    // broad phase
    const mid = V3.lerp([0, 0, 0], h1, t1, 0.5); if (V3.dist(mid, bc) > 1.5 && V3.dist(V3.lerp([0, 0, 0], h0, t0, 0.5), bc) > 1.5) return;
    const travel = Math.max(V3.dist(h0, h1), V3.dist(t0, t1));
    if (travel > 1.1) return; // > ~80 m/s in one frame: tracking glitch / discontinuity, not a swing
    const steps = clamp(Math.ceil(travel / 0.006), 1, 80);
    const rad = col.radius + R;
    const hh = [0, 0, 0], tt = [0, 0, 0];
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      V3.lerp(hh, h0, h1, f); V3.lerp(tt, t0, t1, f);
      const seg = V3.sub([0, 0, 0], tt, hh); const segL2 = V3.dot(seg, seg);
      const u = clamp(V3.dot(V3.sub([0, 0, 0], bc, hh), seg) / segL2, 0, 1);
      const cp = V3.madd([0, 0, 0], hh, seg, u); const dist = V3.dist(cp, bc);
      if (dist < rad) {
        // velocity of that point on the club (prefer XR-reported pose velocities)
        const pPrev = V3.lerp([0, 0, 0], h0, t0, u), pNow = V3.lerp([0, 0, 0], h1, t1, u);
        let vel = V3.scale([0, 0, 0], V3.sub([0, 0, 0], pNow, pPrev), 1 / Math.max(dt, 1 / 120));
        const H = input.hands[this.held];
        if (H && H.vel && H.angVel && H.hasVel) {
          const r = V3.sub([0, 0, 0], cp, H.pos); const vx = V3.add([0, 0, 0], H.vel, V3.cross([0, 0, 0], H.angVel, r));
          // blend: XR velocity is lower-latency, finite difference captures true sweep; both agree on direction
          vel = V3.lerp(vel, vel, vx, 0.5);
        }
        const approach = V3.dot(vel, V3.sub([0, 0, 0], bc, cp));
        if (approach <= 0 || V3.len(vel) < 0.25) continue;
        this.impact(cp, vel, u, f);
        return;
      }
    }
  }

  impact(cp, vel, u, f) {
    const g = this.game, ball = g.ball, club = this.club, col = club.col;
    // world-space face frame at impact
    const M = M4.new(); for (let i = 0; i < 16; i++) M[i] = lerp(this.prevMatrix[i], this.matrix[i], f);
    const face0 = V3.norm([0, 0, 0], M4.transformDir([0, 0, 0], M, col.face0));
    const sole = V3.norm([0, 0, 0], M4.transformDir([0, 0, 0], M, col.sole));
    // "up" of the head perpendicular to the face, pointing away from the sole bottom
    let up = V3.norm([0, 0, 0], V3.cross([0, 0, 0], face0, sole)); if (up[1] < 0) V3.scale(up, up, -1);
    const off = (u - 0.5) * V3.dist(col.heel, col.toe); // + toward toe (physical, handedness-independent)
    const vertOff = V3.dot(V3.sub([0, 0, 0], ball.p, cp), up) / Math.max(col.radius, 0.01);
    const surf = g.course.surface(ball.p[0], ball.p[2]); const sp = SURF_PHYS[surf] || SURF_PHYS[0];
    let lie = sp.lie; if (ball.teeHeight > 0) lie = [1, 1];
    // fat shot: club dug into the ground just before reaching the ball
    let fat = false;
    for (const hsm of this.history) if (hsm.pen > 0.028 && Math.hypot(hsm.x - ball.p[0], hsm.z - ball.p[2]) < 0.35 && g.time - hsm.t < 0.15) fat = true;
    if (ball.teeHeight > 0 || surf === SURF.SAND || surf === SURF.BEACH) fat = false;
    const assist = 1 + (g.settings.assist || 0);
    const v = V3.scale([0, 0, 0], vel, assist);
    const res = ClubImpact.compute(club, v, face0, up, sole, off, vertOff, lie, { fat, sandLie: surf === SURF.SAND || surf === SURF.BEACH, lefty: g.settings.handed === 'left' });
    if (!res) return;
    this.cool = 0.6; this.lastImpact = res;
    g.onImpact(res, cp, surf, fat);
    // feedback
    const k = clamp(res.ballSpeed / 65, 0.15, 1);
    AUDIO.impact(club.type === 'putter' ? 'putter' : club.type === 'wood' ? 'wood' : 'iron', club.type === 'putter' ? clamp(res.ballSpeed / 6, 0.1, 1) : k * (fat ? 0.6 : 1), ball.p);
    const pure = 1 - clamp(Math.abs(off) / 0.03, 0, 1);
    g.haptic(this.held, club.type === 'putter' ? 0.35 + k * 0.4 : 0.5 + 0.5 * k, club.type === 'putter' ? 25 : 45 + 40 * (1 - pure));
    if (surf === SURF.SAND || surf === SURF.BEACH) g.world.emit('sand', ball.p, 40, { speed: 2.5, dir: V3.norm([0, 0, 0], [res.v[0], Math.abs(res.v[1]) + 2, res.v[2]]), size: 0.02, life: 1.4 });
    else if (club.type !== 'putter' && ball.teeHeight === 0) g.world.emit('grass', ball.p, 14, { speed: 2, dir: V3.norm([0, 0, 0], res.v), size: 0.012, life: 0.9 });
    g.world.emit('spark', ball.p, club.type === 'putter' ? 0 : 6, { speed: 1.2, size: 0.01, life: 0.25, grav: 0 });
  }
}
