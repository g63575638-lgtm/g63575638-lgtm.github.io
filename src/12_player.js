'use strict';
// ============================================================================
// Input (WebXR controllers + desktop fallback) and the player rig:
// smooth locomotion, snap/smooth turn, parabolic teleport, terrain following,
// comfort vignette, "go to ball" address positioning.
// ============================================================================

class Btn {
  constructor() { this.down = false; this.pressed = false; this.released = false; this.value = 0; }
  set(v, thr = 0.5) { const d = v > thr; this.pressed = d && !this.down; this.released = !d && this.down; this.down = d; this.value = v; }
}
class Hand {
  constructor(hand) {
    this.hand = hand; this.present = false; this.grip = M4.new(); this.pos = [0, 0, 0]; this.rayO = [0, 0, 0]; this.rayD = [0, 0, -1];
    this.trigger = new Btn(); this.squeeze = new Btn(); this.stick = new Btn(); this.a = new Btn(); this.b = new Btn(); this.axes = [0, 0];
    this.vel = [0, 0, 0]; this.angVel = [0, 0, 0]; this.hasVel = false; this.prevPos = null; this.gamepad = null;
  }
}

class Input {
  constructor() { this.hands = { left: new Hand('left'), right: new Hand('right') }; this.keys = {}; this.mouse = { dx: 0, dy: 0, down: false, x: 0, y: 0, clicked: false, locked: false }; }
  updateXR(frame, refSpace, rig, dt) {
    for (const h of Object.values(this.hands)) h.present = false;
    const session = frame.session;
    for (const src of session.inputSources) {
      const H = this.hands[src.handedness]; if (!H || !src.gripSpace) continue;
      const pose = frame.getPose(src.gripSpace, refSpace); if (!pose) continue;
      H.present = true; H.source = src; H.gamepad = src.gamepad;
      M4.mul(H.grip, rig, pose.transform.matrix);
      const np = M4.getPos([0, 0, 0], H.grip);
      if (pose.linearVelocity && pose.angularVelocity) {
        const lv = pose.linearVelocity, av = pose.angularVelocity;
        M4.transformDir(H.vel, rig, [lv.x, lv.y, lv.z]); M4.transformDir(H.angVel, rig, [av.x, av.y, av.z]); H.hasVel = true;
      } else if (H.prevPos && dt > 0) { V3.scale(H.vel, V3.sub([0, 0, 0], np, H.prevPos), 1 / dt); H.hasVel = false; }
      H.prevPos = np; H.pos = np;
      const rp = src.targetRaySpace ? frame.getPose(src.targetRaySpace, refSpace) : null;
      if (rp) { const m = M4.mul(M4.new(), rig, rp.transform.matrix); M4.getPos(H.rayO, m); V3.norm(H.rayD, M4.transformDir([0, 0, 0], m, [0, 0, -1])); }
      const gp = src.gamepad;
      if (gp) {
        const b = gp.buttons; const val = i => b[i] ? (b[i].value || (b[i].pressed ? 1 : 0)) : 0;
        H.trigger.set(val(0), 0.55); H.squeeze.set(val(1), 0.5); H.stick.set(val(3)); H.a.set(val(4)); H.b.set(val(5));
        H.axes[0] = gp.axes[2] || 0; H.axes[1] = gp.axes[3] || 0;
      }
    }
  }
}

class Player {
  constructor(game) {
    this.game = game; this.pos = [0, 0, 0]; this.yaw = 0; this.rig = M4.new(); this.heightOff = 0;
    this.head = M4.new(); this.headPos = [0, 1.7, 0]; this.headFwd = [0, 0, -1];
    this.snapReady = true; this.tp = { active: false, valid: false, pts: [], target: null }; this.fade = 0; this.fadeTarget = 0; this.pendingMove = null;
    this.vignette = 0; this.moving = false; this.smoothY = null;
  }
  updateRig() {
    const s = this.game.settings; const y = this.pos[1] + (s.heightOffset || 0) + (s.seated ? 0.45 : 0);
    M4.fromTRS(this.rig, [this.pos[0], y, this.pos[2]], this.yaw, 1);
    if (this.headLocal) { M4.mul(this.head, this.rig, this.headLocal); M4.getPos(this.headPos, this.head); V3.norm(this.headFwd, M4.transformDir([0, 0, 0], this.head, [0, 0, -1])); }
  }
  // place the player so that the head ends up at (x,z) facing yaw direction "faceYaw" (world)
  teleportTo(x, z, faceYaw, instant) {
    const go = () => {
      this.jumped = true;
      if (this.game.desktop && this.game.desktopCtl) {
        const d = this.game.desktopCtl; if (faceYaw !== undefined) d.yaw = faceYaw;
        this.pos[0] = x; this.pos[2] = z; this.pos[1] = this.game.course.height(x, z); this.smoothY = this.pos[1];
        this.updateRig(); d.update(0); return;
      }
      // keep the physical head offset in mind: move rig so head lands at target
      const hx = this.headPos[0] - this.pos[0], hz = this.headPos[2] - this.pos[2];
      if (faceYaw !== undefined) {
        const headYaw = Math.atan2(-this.headFwd[0], -this.headFwd[2]);
        const dy = faceYaw - headYaw; this.yaw += dy;
        // rotate head offset by dy
        const c = Math.cos(dy), s = Math.sin(dy); const rx = c * hx + s * hz, rz = -s * hx + c * hz;
        this.pos[0] = x - rx; this.pos[2] = z - rz;
      } else { this.pos[0] = x - hx; this.pos[2] = z - hz; }
      this.pos[1] = this.game.course.height(x, z); this.smoothY = this.pos[1];
      this.updateRig();
    };
    if (instant) go(); else { this.fadeTarget = 1; this.pendingMove = go; AUDIO.teleport(); }
  }
  update(dt, input, frameInfo) {
    const g = this.game, s = g.settings, c = g.course;
    // fades
    if (this.pendingMove && this.fade > 0.98) { this.pendingMove(); this.pendingMove = null; this.fadeTarget = 0; }
    this.fade += (this.fadeTarget - this.fade) * Math.min(1, dt * 16); if (this.fadeTarget === 1 && this.fade > 0.97) this.fade = 1;
    if (!c) return;
    const L = input.hands.left, R = input.hands.right;
    const locoHand = s.handed === 'left' ? R : L, turnHand = s.handed === 'left' ? L : R;
    this.moving = false;
    const canMove = g.state === 'playing' || g.state === 'menu';
    // -------------------------------------------- smooth locomotion (head relative)
    if (canMove && locoHand.present && s.locomotion !== 'teleport') {
      const ax = locoHand.axes[0], ay = locoHand.axes[1]; const mag = Math.hypot(ax, ay);
      if (mag > 0.15) {
        const fy = Math.atan2(-this.headFwd[0], -this.headFwd[2]);
        const sp = (s.walkSpeed || 2.5) * (locoHand.stick.down ? 2.2 : 1) * smoothstep(0.15, 1, mag) / mag;
        const fx = -Math.sin(fy), fz = -Math.cos(fy); const rx = Math.cos(fy), rz = -Math.sin(fy);
        const mx = (fx * -ay + rx * ax) * sp * dt, mz = (fz * -ay + rz * ax) * sp * dt;
        const nx = this.headPos[0] + mx, nz = this.headPos[2] + mz;
        if (this.walkable(nx, nz)) { this.pos[0] += mx; this.pos[2] += mz; this.moving = true; }
      }
    }
    // -------------------------------------------- turning + teleport (right stick)
    if (canMove && turnHand.present) {
      const ax = turnHand.axes[0], ay = turnHand.axes[1];
      if (s.turn === 'smooth' && Math.abs(ax) > 0.2 && !this.tp.active) { this.rotateAroundHead(-ax * 2.2 * dt); this.moving = true; }
      else if (s.turn !== 'smooth') {
        if (Math.abs(ax) > 0.7 && this.snapReady && !this.tp.active) { this.rotateAroundHead(-Math.sign(ax) * deg(s.snapAngle || 30)); this.snapReady = false; this.vignette = Math.max(this.vignette, 0.6); }
        if (Math.abs(ax) < 0.3) this.snapReady = true;
      }
      // teleport aim
      if (ay < -0.65 && Math.abs(ax) < 0.6) { this.tp.active = true; this.aimTeleport(turnHand); }
      else if (this.tp.active && ay > -0.3) {
        if (this.tp.valid) this.teleportTo(this.tp.target[0], this.tp.target[2]);
        this.tp.active = false;
      }
    } else this.tp.active = false;
    // -------------------------------------------- terrain following (under the head)
    const th = c.height(this.headPos[0], this.headPos[2]);
    if (this.smoothY === null) this.smoothY = th;
    this.smoothY += (th - this.smoothY) * Math.min(1, dt * 10);
    this.pos[1] = this.smoothY;
    // clamp to map
    const b = c.half - 25; this.pos[0] = clamp(this.pos[0], -b, b); this.pos[2] = clamp(this.pos[2], -b, b);
    // trees: push out of trunks
    const obs = c.nearbyObstacles(this.headPos[0], this.headPos[2], this._obs || (this._obs = []));
    for (const t of obs) { if (t.rock) continue; const dx = this.headPos[0] - t.x, dz = this.headPos[2] - t.z; const d = Math.hypot(dx, dz); const r = 0.55; if (d < r && d > 1e-3) { this.pos[0] += dx / d * (r - d); this.pos[2] += dz / d * (r - d); } }
    this.updateRig();
    // vignette
    const vt = this.moving && s.vignette ? 0.85 : 0; this.vignette += (vt - this.vignette) * Math.min(1, dt * 6);
  }
  walkable(x, z) {
    const c = this.game.course; if (!c.inBounds(x, z)) return false;
    if (c.surface(x, z) === SURF.WATER && c.waterLevelAt(x, z) - c.height(x, z) > 0.35) return false;
    return true;
  }
  rotateAroundHead(a) {
    if (Math.abs(a) > 0.05) this.jumped = true;
    const hx = this.headPos[0], hz = this.headPos[2];
    const dx = this.pos[0] - hx, dz = this.pos[2] - hz; const c = Math.cos(a), s = Math.sin(a);
    this.pos[0] = hx + c * dx + s * dz; this.pos[2] = hz - s * dx + c * dz; this.yaw += a;
    this.updateRig();
  }
  aimTeleport(H) {
    const c = this.game.course; const pts = []; const p = H.rayO.slice(); const v = V3.scale([0, 0, 0], H.rayD, 10);
    let hit = null;
    for (let i = 0; i < 60; i++) {
      pts.push(p.slice()); const dt = 0.045;
      const np = [p[0] + v[0] * dt, p[1] + v[1] * dt, p[2] + v[2] * dt]; v[1] -= 9.81 * dt;
      const h = c.height(np[0], np[2]);
      if (np[1] <= h) { // refine
        let lo = 0, hi = 1; for (let k = 0; k < 8; k++) { const m = (lo + hi) / 2; const q = V3.lerp([0, 0, 0], p, np, m); if (q[1] > c.height(q[0], q[2])) lo = m; else hi = m; }
        hit = V3.lerp([0, 0, 0], p, np, hi); hit[1] = c.height(hit[0], hit[2]); pts.push(hit.slice()); break;
      }
      V3.copy(p, np);
    }
    this.tp.pts = pts; this.tp.target = hit;
    this.tp.valid = !!hit && this.walkable(hit[0], hit[2]) && c.normal(hit[0], hit[2])[1] > 0.75;
  }
  setHead(viewerMatrix) {
    this.headLocal = this.headLocal || M4.new(); M4.copy(this.headLocal, viewerMatrix);
    M4.mul(this.head, this.rig, viewerMatrix); M4.getPos(this.headPos, this.head);
    V3.norm(this.headFwd, M4.transformDir([0, 0, 0], this.head, [0, 0, -1]));
  }
}

// ---------------------------------------------------------------- desktop emulation
// Mouse look + WASD; right hand = club controlled by mouse swing (hold LMB, drag).
class DesktopControls {
  constructor(game, canvas) {
    this.game = game; this.canvas = canvas; this.yaw = 0; this.pitch = -0.15; this.swing = 0; this.swingV = 0; this.aimYaw = 0; this.height = 1.68;
    const inp = game.input; this.inp = inp;
    window.addEventListener('keydown', e => { inp.keys[e.code] = true; if (e.code === 'Escape') game.togglePause(); });
    window.addEventListener('keyup', e => { inp.keys[e.code] = false; });
    canvas.addEventListener('mousedown', e => {
      inp.mouse.x = e.clientX; inp.mouse.y = e.clientY;
      if (e.button === 0) { inp.mouse.down = true; inp.mouse.clicked = true; }
      if (e.button === 2 && document.pointerLockElement !== canvas) canvas.requestPointerLock && canvas.requestPointerLock();
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('mouseup', e => { if (e.button === 0) inp.mouse.down = false; });
    window.addEventListener('mousemove', e => { inp.mouse.x = e.clientX; inp.mouse.y = e.clientY; inp.mouse.dx += e.movementX || 0; inp.mouse.dy += e.movementY || 0; });
  }
  update(dt) {
    const g = this.game, inp = this.inp, k = inp.keys, m = inp.mouse; const P = g.player;
    const locked = document.pointerLockElement === this.canvas;
    if (locked || k.KeyQ || k.KeyE) { this.yaw -= m.dx * 0.0025 * (locked ? 1 : 0) + (k.KeyQ ? 1.6 * dt : 0) - (k.KeyE ? 1.6 * dt : 0); if (locked) this.pitch = clamp(this.pitch - m.dy * 0.0022, -1.3, 1.2); }
    // move
    let mx = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0), mz = (k.KeyS ? 1 : 0) - (k.KeyW ? 1 : 0);
    if ((mx || mz) && g.course && (g.state === 'playing' || g.state === 'menu')) {
      const sp = (g.settings.walkSpeed || 2.5) * (k.ShiftLeft ? 3 : 1) * dt; const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
      const nx = P.pos[0] + (c * mx + s * mz) * sp, nz = P.pos[2] + (-s * mx + c * mz) * sp;
      if (P.walkable(nx, nz)) { P.pos[0] = nx; P.pos[2] = nz; }
    }
    P.yaw = 0; // rig yaw unused on desktop; camera yaw is in the head matrix
    if (g.course) { const th = g.course.height(P.pos[0], P.pos[2]); P.smoothY = P.smoothY === null ? th : P.smoothY + (th - P.smoothY) * Math.min(1, dt * 10); P.pos[1] = P.smoothY; }
    P.updateRig();
    // head matrix
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp2 = Math.sin(this.pitch);
    const fwd = [-sy * cp, sp2, -cy * cp]; const right = [cy, 0, -sy]; const up = V3.cross([0, 0, 0], right, fwd);
    const eye = [0, this.height, 0];
    const view = M4.fromBasis(M4.new(), eye, right, up, [-fwd[0], -fwd[1], -fwd[2]], 1);
    P.setHead(view);
    // ---- virtual right hand holding the club: swing in the plane of the aim direction
    const H = inp.hands.right; H.present = true; const L = inp.hands.left; L.present = true;
    const swinging = m.down && g.state === 'playing' && !g.uiCapturingMouse;
    if (swinging) { this.swingV = -m.dy * 0.012 / Math.max(dt, 1e-3); this.swing = clamp(this.swing + m.dy * 0.012, -2.6, 2.0); }
    else { this.swing *= Math.exp(-dt * 6); this.swingV = 0; }
    m.dx = 0; m.dy = 0;
    // shoulder pivot in front of the player; the club rotates around an axis perpendicular to the target line
    const aim = this.aimYaw; const ca = Math.cos(aim), sa = Math.sin(aim);
    const tgt = [-sa, 0, -ca];                       // target direction
    const toBall = [ca, 0, -sa];                     // golfer faces the ball (target is to the left)
    const pivot = [P.pos[0], P.pos[1] + 1.25, P.pos[2]];
    const planeTilt = 0.62; const down = V3.norm([0, 0, 0], [toBall[0] * planeTilt, -1, toBall[2] * planeTilt]);
    const gripAt = (a, off) => {
      const dir = V3.norm([0, 0, 0], [down[0] * Math.cos(a) + tgt[0] * Math.sin(a), down[1] * Math.cos(a), down[2] * Math.cos(a) + tgt[2] * Math.sin(a)]);
      const handPos = V3.add([0, 0, 0], V3.madd([0, 0, 0], pivot, dir, 0.55), off);
      const zAxis = V3.scale([0, 0, 0], dir, -1);
      let faceN = V3.norm([0, 0, 0], V3.madd([0, 0, 0], tgt, dir, -V3.dot(tgt, dir))); if (V3.len(faceN) < 0.1) faceN = tgt.slice();
      const xAxis = V3.scale([0, 0, 0], faceN, -1); const yAxis = V3.cross([0, 0, 0], zAxis, xAxis);
      return { m: M4.fromBasis(M4.new(), handPos, xAxis, yAxis, zAxis, 1), handPos };
    };
    // address calibration: shift the arc so that at a = 0 the sweet spot sits just behind the ball
    let off = [0, 0, 0];
    const ball = g.ball; const clubs = g.clubs;
    if (ball && V3.distXZ(ball.p, P.pos) < 2.5) {
      const g0 = gripAt(0, off).m; const head0 = M4.transformPoint([0, 0, 0], M4.mul(M4.new(), g0, clubs.localMatrix()), clubs.club.col.sweet);
      off = [ball.p[0] - tgt[0] * 0.035 - head0[0], ball.p[1] - head0[1] + (clubs.club.type === 'putter' ? 0.004 : -0.003), ball.p[2] - tgt[2] * 0.035 - head0[2]];
    }
    const a = this.swing;                            // 0 = address, negative = backswing
    const G = gripAt(a, off); M4.copy(H.grip, G.m); const handPos = G.handPos;
    if (H.prevPos) V3.scale(H.vel, V3.sub([0, 0, 0], handPos, H.prevPos), 1 / Math.max(dt, 1e-3)); H.prevPos = handPos.slice(); H.pos = handPos; H.hasVel = false;
    V3.copy(H.rayO, P.headPos); V3.copy(H.rayD, P.headFwd);
    M4.fromBasis(L.grip, V3.madd([0, 0, 0], P.headPos, [0, -0.45, 0], 1), right, up, [-fwd[0], -fwd[1], -fwd[2]], 1); L.pos = M4.getPos([0, 0, 0], L.grip);
    // buttons
    H.b.set(k.KeyB ? 1 : 0); L.a.set(k.KeyF ? 1 : 0); H.a.set(k.KeyC ? 1 : 0); L.b.set(k.KeyP ? 1 : 0);
    H.trigger.set(m.clicked ? 1 : 0); m.clicked = false;
    for (let i = 1; i <= 9; i++) if (k['Digit' + i]) { if (g.clubs.index !== i - 1) g.clubs.setClub(i - 1); }
  }
}
