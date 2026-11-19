'use strict';
// ============================================================================
// Game: state machine, modes, golf scoring, hole flow, menus, HUD, settings.
// ============================================================================

const DEFAULT_SETTINGS = {
  lang: 'en', handed: 'right', autoClub: true, aimLine: true, trail: true, pinMarker: true, assist: 0, clubAngle: 0, units: 'm',
  locomotion: 'both', walkSpeed: 2.5, turn: 'snap', snapAngle: 30, vignette: true, heightOffset: 0, seated: false,
  quality: 'med', shadows: 'med', grass: 'med', refresh: 72, foveation: 1, resScale: 1.0,
  master: 0.9, sfx: 1.0, amb: 0.7, ui: 0.7, map: 0, time: 'default', mode: 'stroke',
};
const QUALITY_PRESETS = { low: { shadows: 'low', grass: 'low', foveation: 1, resScale: 0.9, refresh: 72 }, med: { shadows: 'med', grass: 'med', foveation: 1, resScale: 1.0, refresh: 72 }, high: { shadows: 'high', grass: 'high', foveation: 0.5, resScale: 1.1, refresh: 72 } };

function store(key, val) { try { if (val === undefined) return JSON.parse(localStorage.getItem('futon_golf_' + key)); localStorage.setItem('futon_golf_' + key, JSON.stringify(val)); } catch (e) { return null; } }

class Game {
  constructor(glx, P, canvas) {
    this.glx = glx; this.P = P; this.canvas = canvas;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, store('settings') || {});
    LANG = this.settings.lang;
    this.input = new Input(); this.player = new Player(this); this.clubs = new ClubSystem(this);
    this.ui = new UIManager(glx); this.ui.onHaptic = (h, i, d) => this.haptic(h, i, d);
    this.state = 'boot'; this.time = 0; this.course = null; this.world = null; this.ball = null;
    this.menuPage = 'main'; this.settingsTab = 0; this.desktop = false; this.toasts = [];
    this.round = null; this.holeIndex = 0; this.strokes = 0; this.bestScores = store('best') || {};
    this.ballGlow = 0; this.prevLie = null; this.pendingDrop = null; this.shotInfo = null;
    this.flagIn = true; this.flagAnim = 1; this.loadingProgress = 0; this.loadingLabel = '';
    this.makePanels();
  }

  // ------------------------------------------------------------------ panels
  makePanels() {
    const ui = this.ui;
    this.menuPanel = ui.add(new Panel(ui, 'menu', 1600, 1000, 1.5, {}));
    this.toastPanel = ui.add(new Panel(ui, 'toast', 1100, 300, 0.95, { interactive: false }));
    this.wristPanel = ui.add(new Panel(ui, 'wrist', 560, 340, 0.155, { interactive: false, mip: true }));
    this.signPanel = ui.add(new Panel(ui, 'sign', 900, 620, 0.88, { interactive: false }));
    this.pinPanel = ui.add(new Panel(ui, 'pin', 320, 160, 1.0, { interactive: false }));
    this.loadPanel = ui.add(new Panel(ui, 'load', 1600, 900, 2.4, { interactive: false, always: true }));
    this.hintPanel = ui.add(new Panel(ui, 'hint', 1200, 110, 0.9, { interactive: false }));
    this.menuPanel.overlay = true; this.toastPanel.overlay = true; this.loadPanel.overlay = true; this.hintPanel.overlay = true;
  }
  saveSettings() { store('settings', this.settings); }
  set(k, v) {
    this.settings[k] = v;
    if (k === 'lang') LANG = v;
    if (k === 'quality') Object.assign(this.settings, QUALITY_PRESETS[v]);
    if (['shadows', 'quality'].includes(k) && this.world) this.world.setShadowQuality(this.settings.shadows);
    if (['master', 'sfx', 'amb', 'ui'].includes(k)) AUDIO.setVolumes({ master: this.settings.master, sfx: this.settings.sfx, amb: this.settings.amb, ui: this.settings.ui });
    if (['refresh', 'foveation', 'quality'].includes(k)) this.applyXRSettings && this.applyXRSettings();
    this.saveSettings(); this.menuPanel.dirty = true; this.wristDirty = true;
  }
  haptic(hand, intensity, ms) {
    if (!hand) return; const H = this.input.hands[hand]; const gp = H && H.gamepad;
    if (gp && gp.hapticActuators && gp.hapticActuators[0]) { try { gp.hapticActuators[0].pulse(clamp(intensity, 0, 1), ms); } catch (e) { } }
  }
  uiCapturing(hand) { return this.menuPanel.visible && this.menuPanel.targetOpacity > 0; }
  toast(title, sub, dur = 2.4, color) { this.toastData = { title, sub, color, t: 0, dur }; this.toastPanel.setPage((ctx, P) => this.drawToast(ctx, P)); this.toastPanel.show(); this.toastFollow = null; }

  // ------------------------------------------------------------------ course loading
  async loadCourse(mapIndex, timeKey, purpose) {
    const def = MAPS[mapIndex];
    this.state = 'loading'; this.loadingProgress = 0; this.loadingLabel = T('load_terrain'); this.loadMapName = T(def.key);
    this.menuPanel.hide(); this.signPanel.hide(); this.pinPanel.hide(); this.wristPanel.hide(); this.hole = null;
    this.loadPanel.setPage((ctx, P) => this.drawLoading(ctx, P)); this.loadPanel.show();
    this.player.fadeTarget = 0;
    if (this.world) this.disposeWorld();
    await sleep(60);
    const time = (timeKey && timeKey !== 'default') ? timeKey : def.defaultTime;
    const course = new Course(def, { time });
    const prog = (p, label) => { this.loadingProgress = p; if (label) this.loadingLabel = T(label); else this.loadingLabel = p < 0.4 ? T('load_terrain') : p < 0.72 ? T('load_surface') : T('load_meshes'); };
    await course.generate(prog);
    const world = new World(this.glx, this.P, course, this.settings);
    await world.build(prog);
    this.course = course; this.world = world; this.mapIndex = mapIndex;
    this.ball = new BallPhysics(course); this.ball.treeDims = world.treeDims;
    AUDIO.startAmbience(def.ambience, course);
    await sleep(250);
    this.loadPanel.hide();
  }
  disposeWorld() { /* GPU memory is reclaimed by GC of WebGL objects; drop references */ this.world = null; this.course = null; this.ball = null; }

  // ------------------------------------------------------------------ menu flow
  async enterMenu(page = 'main') {
    if (!this.course) await this.loadCourse(this.settings.map || 0, this.settings.time, 'menu');
    this.state = 'menu'; this.menuPage = page; this.round = null;
    // stand on hole 1 tee looking down the fairway
    const h = this.course.holes[0];
    this.player.teleportTo(h.tee[0] - h.dir0[0] * 6, h.tee[1] - h.dir0[2] * 6, Math.atan2(-h.dir0[0], -h.dir0[2]), true);
    this.ball.placeAt(h.tee[0], h.tee[1], 0.028); this.setHole(0, true);
    this.clubs.dropAt([h.tee[0] - h.dir0[0] * 4 + h.dir0[2] * 1.5, 0, h.tee[1] - h.dir0[2] * 4 - h.dir0[0] * 1.5], [h.dir0[2], 0, -h.dir0[0]]);
    this.openMenu(page);
  }
  openMenu(page) {
    this.menuPage = page; AUDIO.uiOpen();
    this.placeMenuPanel();
    this.menuPanel.setPage((ctx, P) => this.drawMenu(ctx, P)); this.menuPanel.show();
  }
  placeMenuPanel() {
    const P = this.player; const f = [P.headFwd[0], 0, P.headFwd[2]]; V3.norm(f, f);
    const pos = [P.headPos[0] + f[0] * 1.75, P.headPos[1] - 0.12, P.headPos[2] + f[2] * 1.75];
    this.menuPanel.placeFacing(pos, [P.headPos[0], pos[1] + 0.25, P.headPos[2]], 1);
  }
  closeMenu() { this.menuPanel.hide(); AUDIO.uiBack(); }
  togglePause() {
    if (this.state === 'playing') { this.state = 'paused'; this.openMenu('pause'); }
    else if (this.state === 'paused') { this.state = 'playing'; this.closeMenu(); }
  }

  // ------------------------------------------------------------------ round / holes
  async startRound(mode) {
    this.settings.mode = mode; this.saveSettings();
    const needLoad = !this.course || this.mapIndex !== this.settings.map || (this.course.time !== ((this.settings.time && this.settings.time !== 'default') ? this.settings.time : MAPS[this.settings.map].defaultTime));
    this.menuPanel.hide();
    if (needLoad) await this.loadCourse(this.settings.map, this.settings.time);
    const n = mode === 'quick' ? 3 : this.course.holes.length;
    this.round = { mode, holes: this.course.holes.slice(0, n).map(h => ({ par: h.par, strokes: 0, pen: 0, done: false })), start: performance.now(), time: 0, map: this.mapIndex };
    this.state = 'playing'; this.startHole(0);
    this.showHint(T('hint_grab') + '   ·   ' + T('hint_goto'), 8);
  }
  setHole(i, quiet) {
    this.holeIndex = i; const h = this.course.holes[i]; this.hole = h;
    this.ball.hole = { cupPos: h.cupPos, flagIn: true }; this.flagIn = true; this.flagAnim = 1;
    // per-hole wind variation
    const r = mulberry32(this.course.def.seed + i * 13 + (this.round ? Math.floor(this.round.start) % 1000 : 0));
    const w = this.course.def.wind; const ang = Math.atan2(w[1], w[0]) + (r() - 0.5) * 1.4; const mag = w[2] * (0.5 + r() * 0.9);
    this.ball.wind = [Math.cos(ang) * mag, 0, Math.sin(ang) * mag]; this.world.wind = this.ball.wind.slice();
    this.signPanel.setPage((ctx, P) => this.drawTeeSign(ctx, P)); this.signPanel.show();
    const sp = h.signPos; this.signPanel.placeFacing([sp[0], sp[1] + 1.25, sp[2]], [h.tee[0], sp[1] + 1.25, h.tee[1]]);
    // the board faces the tee; offset slightly in front of the wooden board
    const m = this.signPanel.matrix; m[12] += m[8] * 0.04; m[13] += m[9] * 0.04; m[14] += m[10] * 0.04;
    this.pinPanel.setPage((ctx, P) => this.drawPin(ctx, P)); this.pinPanel.show();
    this.wristDirty = true;
  }
  startHole(i) {
    this.setHole(i);
    const h = this.hole; this.strokes = 0; this.holeDone = false; this.shotInfo = null; this.pendingDrop = null;
    this.ball.placeAt(h.tee[0], h.tee[1], 0.028); this.prevLie = { x: h.tee[0], z: h.tee[1], teed: true };
    this.world.trailReset();
    this.goToBall(true);
    if (this.settings.autoClub) this.autoClub();
    this.toast(T('hole') + ' ' + (i + 1), T('par') + ' ' + h.par + '  ·  ' + this.fmtDist(h.len), 3.2);
  }
  autoClub() {
    const d = this.distToPin(); const surf = this.course.surface(this.ball.p[0], this.ball.p[2]);
    if (surf === SURF.GREEN || (surf === SURF.FRINGE && d < 18)) { this.clubs.setClub(8, true); return; }
    // typical carry+roll per club for a solid VR swing
    const table = [[230, 0], [205, 1], [185, 2], [168, 3], [148, 4], [124, 5], [105, 6], [70, 7]];
    let pick = 7; for (const [dist, idx] of table) if (d >= dist * 0.92) { pick = idx; break; }
    if (this.ball.teeHeight === 0 && pick === 0) pick = 1; // no driver off the deck
    if (surf === SURF.SAND && d < 60) pick = 7;
    if (this.strokes === 0 && this.hole.par >= 4 && pick > 0 && d > 210) pick = 0;
    this.clubs.setClub(pick, true);
  }
  distToPin() { return Math.hypot(this.ball.p[0] - this.hole.cupPos[0], this.ball.p[2] - this.hole.cupPos[2]); }
  fmtDist(m) { return this.settings.units === 'yd' ? Math.round(m * 1.0936) + ' yd' : (m < 10 ? m.toFixed(1) : Math.round(m)) + ' m'; }
  canHit() { return (this.state === 'playing' || this.state === 'menu') && this.ball && this.ball.atRest && !this.holeDone && !this.pendingDrop && this.player.fade < 0.5; }

  // stand at address next to the ball facing it, target to the golfer's lead side
  goToBall(instant) {
    const b = this.ball.p; const tgt = this.aimTarget(); const t = V3.norm([0, 0, 0], [tgt[0] - b[0], 0, tgt[2] - b[2]]);
    const lefty = this.settings.handed === 'left';
    const f = lefty ? V3.scale([0, 0, 0], V3.cross([0, 0, 0], t, [0, 1, 0]), -1) : V3.cross([0, 0, 0], t, [0, 1, 0]); // facing the ball
    const club = this.clubs.club; const stand = club.type === 'putter' ? 0.62 : club.type === 'wood' ? 1.05 : 0.86;
    const x = b[0] - f[0] * stand, z = b[2] - f[2] * stand;
    const yaw = Math.atan2(-f[0], -f[2]);
    this.player.teleportTo(x, z, yaw, instant);
    if (this.desktop && this.desktopCtl) { this.desktopCtl.pitch = -0.75; this.desktopCtl.aimYaw = Math.atan2(-t[0], -t[2]); }
    // bring the club along to the hand (QoL)
    const after = () => {
      if (!this.clubs.held) { const hand = this.desktop ? 'right' : (this.settings.handed === 'left' ? 'left' : 'right'); if (this.input.hands[hand].present) this.clubs.grab(hand); }
    };
    if (instant) setTimeout(after, 50); else setTimeout(after, 250);
  }
  aimTarget() {
    const h = this.hole; const b = this.ball.p; const d = this.distToPin();
    // aim along the hole routing for long holes (dogleg), straight at the pin otherwise
    if (d > 230 && h.path.length > 2) {
      let best = h.cupPos, bd = 1e9;
      for (const p of h.path.slice(1, -1)) { const dp = Math.hypot(p[0] - b[0], p[1] - b[2]); const remain = Math.hypot(p[0] - h.cupPos[0], p[1] - h.cupPos[2]); if (dp > 60 && remain < d && dp < bd) { bd = dp; best = [p[0], 0, p[1]]; } }
      return best;
    }
    return h.cupPos;
  }

  // ------------------------------------------------------------------ shots
  onImpact(res, cp, surf, fat) {
    const b = this.ball;
    if (this.state === 'menu') { /* practice swings in the menu are allowed */ }
    this.prevLie = { x: b.p[0], z: b.p[2], teed: b.teeHeight > 0 };
    b.launch(res.v, res.w);
    if (this.round) { this.strokes++; this.round.holes[this.holeIndex].strokes++; }
    this.shotStart = b.p.slice(); this.shotRes = res; this.shotInfo = null; this.world.trailReset();
    this.lastShotFat = fat; this.wristDirty = true; this.ballGlow = 0;
    this.flagIn = !(surf === SURF.GREEN); this.ball.hole.flagIn = this.flagIn;
  }
  handleBallEvents() {
    const b = this.ball, w = this.world;
    for (const e of b.events) {
      switch (e.type) {
        case 'bounce': AUDIO.bounce(e.speed, e.surf, e.pos); if (e.speed > 3) w.emit(e.surf === SURF.SAND || e.surf === SURF.BEACH ? 'sand' : 'grass', e.pos, Math.min(12, e.speed | 0), { speed: e.speed * 0.12, size: 0.012, life: 0.8 }); break;
        case 'sand': w.emit('sand', e.pos, 30, { speed: 1.8, size: 0.018, life: 1.2 }); break;
        case 'water': AUDIO.splash(e.pos); w.emit('water', e.pos, 60, { speed: 3.2, size: 0.05, life: 1.3, dir: [0, 1, 0], drag: 0.8 }); this.onHazard('water'); break;
        case 'ob': this.onHazard('ob'); break;
        case 'rim': AUDIO.cup('rim', e.speed, this.hole.cupPos); break;
        case 'cupWall': AUDIO.cup('wall', e.speed, this.hole.cupPos); break;
        case 'cupBottom': AUDIO.cup('bottom', e.speed, this.hole.cupPos); break;
        case 'flag': AUDIO.flagHit(this.hole.cupPos); break;
        case 'holed': this.onHoled(); break;
        case 'trunk': case 'rock': AUDIO.knock(e.pos, clamp(e.speed / 20, 0.2, 1)); break;
        case 'leaves': AUDIO.leaves(e.pos, clamp(e.speed / 30, 0.3, 1)); w.emit('leaf', e.pos, 10, { speed: 1.5, size: 0.03, life: 2.0, grav: 1.5, drag: 2.5 }); break;
        case 'leavesSoft': AUDIO.leaves(e.pos, 0.4); w.emit('leaf', e.pos, 5, { speed: 1, size: 0.03, life: 2.0, grav: 1.5, drag: 2.5 }); break;
        case 'rest': this.onRest(e); break;
      }
    }
    b.events.length = 0;
  }
  onHazard(kind) {
    if (!this.round && this.state !== 'menu') return;
    AUDIO.penalty();
    if (this.round) { this.strokes++; this.round.holes[this.holeIndex].strokes++; this.round.holes[this.holeIndex].pen++; }
    this.toast(kind === 'water' ? T('water') : T('ob'), kind === 'water' ? T('water_pen') : '+1', 2.6, COL.red);
    const b = this.ball; let drop;
    if (kind === 'water') {
      // lateral relief: nearest dry spot to where the ball last crossed land, 1-2 m away from the water
      const ld = b.lastDry; drop = this.findDryNear(ld[0], ld[2], this.prevLie);
    } else drop = { x: this.prevLie.x, z: this.prevLie.z, teed: this.prevLie.teed };
    this.pendingDrop = { t: 1.6, drop };
    AUDIO.silenceBall();
  }
  findDryNear(x, z, toward) {
    const c = this.course; const dx = toward.x - x, dz = toward.z - z; const L = Math.hypot(dx, dz) || 1;
    for (let r = 1.5; r < 60; r += 1.5) {
      const px = x + dx / L * r, pz = z + dz / L * r; const s = c.surface(px, pz);
      if (s !== SURF.WATER && c.surface(px + 1.5, pz) !== SURF.WATER && c.surface(px - 1.5, pz) !== SURF.WATER && c.surface(px, pz + 1.5) !== SURF.WATER && c.surface(px, pz - 1.5) !== SURF.WATER && c.inBounds(px, pz)) return { x: px, z: pz, teed: false };
    }
    return { x: toward.x, z: toward.z, teed: toward.teed };
  }
  onHoled() {
    if (this.holeDone) return; this.holeDone = true;
    const strokes = this.strokes, par = this.hole.par;
    const diff = strokes - par;
    let key = diff <= -3 ? 'sc_albatross' : diff === -2 ? 'sc_eagle' : diff === -1 ? 'sc_birdie' : diff === 0 ? 'sc_par' : diff === 1 ? 'sc_bogey' : diff === 2 ? 'sc_double' : diff === 3 ? 'sc_triple' : 'sc_over';
    if (strokes === 1) key = 'sc_ace';
    const title = this.round ? T(key, { n: diff }) : T('in_hole');
    setTimeout(() => {
      AUDIO.chime(diff <= -1 ? 2 : diff === 0 ? 1 : 0); if (diff <= -1 || strokes === 1) AUDIO.applause(strokes === 1 ? 1.6 : 1);
      this.world.emit('confetti', [this.hole.cupPos[0], this.hole.cupPos[1] + 0.3, this.hole.cupPos[2]], diff <= 0 ? 120 : 40, { speed: 3.5, size: 0.025, life: 3, grav: 2.5, drag: 1.2 });
      this.toast(title, this.round ? T('strokes') + ': ' + strokes + '  ·  ' + T('par') + ' ' + par : '', 3.5, diff < 0 ? COL.gold : diff === 0 ? COL.green : null);
    }, 350);
    if (this.round) {
      this.round.holes[this.holeIndex].done = true;
      setTimeout(() => { if (this.state === 'playing') { this.state = 'holeEnd'; this.openMenu('holeEnd'); } }, 3200);
    } else setTimeout(() => { if (this.state === 'menu') { this.ball.placeAt(this.hole.tee[0], this.hole.tee[1], 0.028); this.holeDone = false; } }, 3500);
  }
  onRest(e) {
    if (e.reason === 'holed' || this.holeDone) return;
    const b = this.ball; const start = this.shotStart || b.p;
    const total = Math.hypot(b.p[0] - start[0], b.p[2] - start[2]);
    const carry = b.firstLand ? Math.hypot(b.firstLand[0] - start[0], b.firstLand[2] - start[2]) : total;
    this.shotInfo = { total, carry, res: this.shotRes, surf: e.surf };
    this.wristDirty = true; AUDIO.silenceBall();
    if (e.surf === SURF.GREEN) { this.flagIn = false; this.ball.hole.flagIn = false; }
    if (this.round && this.strokes >= 10 && !this.holeDone) { // pick up to keep pace
      this.toast(T('picked_up'), '', 2); this.holeDone = true; this.round.holes[this.holeIndex].done = true;
      setTimeout(() => { if (this.state === 'playing') { this.state = 'holeEnd'; this.openMenu('holeEnd'); } }, 2000);
      return;
    }
    if (this.shotRes && this.shotRes.ballSpeed > 8) this.toast(this.fmtDist(total), T('surf_' + SURF_NAMES[e.surf]) + '  ·  ' + T('to_pin') + ' ' + this.fmtDist(this.distToPin()), 2.2);
    if (this.settings.autoClub) this.autoClub();
  }
  nextHole() {
    const n = this.round.holes.length;
    if (this.holeIndex + 1 < n) { this.state = 'playing'; this.closeMenu(); this.startHole(this.holeIndex + 1); }
    else this.finishRound();
  }
  finishRound() {
    const r = this.round; r.time = (performance.now() - r.start) / 1000;
    const total = r.holes.reduce((a, h) => a + h.strokes, 0), par = r.holes.reduce((a, h) => a + h.par, 0);
    const key = MAPS[r.map].id + '_' + r.mode; const prev = this.bestScores[key];
    const score = r.mode === 'time' ? total * 30 + r.time : total;
    r.newBest = r.mode !== 'practice' && (prev === undefined || score < prev);
    if (r.newBest) { this.bestScores[key] = score; store('best', this.bestScores); }
    r.total = total; r.par = par;
    this.state = 'roundEnd'; this.openMenu('roundEnd'); AUDIO.chime(2);
  }

  // ------------------------------------------------------------------ hints
  showHint(text, dur) { this.hintText = text; this.hintT = dur; this.hintPanel.setPage((ctx, P) => { UIDraw.rr(ctx, 10, 10, P.pxW - 20, P.pxH - 20, 45); ctx.fillStyle = 'rgba(10,14,18,0.72)'; ctx.fill(); UIDraw.text(ctx, this.hintText, P.pxW / 2, P.pxH / 2, 34, { align: 'center', weight: 500, maxW: P.pxW - 60 }); }); this.hintPanel.show(); }

  // ------------------------------------------------------------------ per-frame update
  update(dt) {
    this.time += dt;
    if (this.course && (!this.world || !this.ball)) return; // mid-load
    const inp = this.input; const P = this.player;
    if (this.round && this.state === 'playing') this.round.time = (performance.now() - this.round.start) / 1000;
    const L = inp.hands.left, R = inp.hands.right;
    const clubHand = this.clubs.held; const offHand = clubHand === 'left' ? R : L; const mainHand = clubHand === 'left' ? L : R;
    // ---------------- buttons
    if (this.course && this.hole && (this.state === 'playing' || this.state === 'menu')) {
      if ((R.b.pressed) && this.ball.atRest && !(this.round && this.round.mode === 'practice' && R.trigger.down)) this.goToBall();
      if (L.a.pressed) { this.ballGlow = this.ballGlow > 0.5 ? 0 : 1; this.glowT = 12; if (this.ballGlow) this.toast(T('ball_found'), this.fmtDist(V3.dist(this.ball.p, P.headPos)), 1.5); }
      if (R.a.pressed) this.clubs.setClub(this.clubs.index + 1);
      const turnHand = this.settings.handed === 'left' ? L : R; if (turnHand.stick.pressed) this.clubs.setClub(this.clubs.index - 1);
      if (this.round && this.round.mode === 'practice' && R.b.pressed && R.trigger.down) { this.ball.placeAt(this.hole.tee[0], this.hole.tee[1], 0.028); this.toast(T('practice_reset'), '', 1.2); }
    }
    if (L.b.pressed && this.course) {
      if (this.state === 'playing' || this.state === 'paused') this.togglePause();
      else if (this.state === 'menu' && !this.menuPanel.visible) this.openMenu('main');
    }
    if (this.glowT > 0) { this.glowT -= dt; if (this.glowT <= 0) this.ballGlow = 0; }
    // ---------------- UI pointers
    const pointing = this.ui.anyVisible();
    for (const hand of ['left', 'right']) {
      const H = inp.hands[hand];
      if (!H.present || !pointing || (this.clubs.held === hand && !this.menuPanel.visible)) { this.ui.clearPointer(hand); continue; }
      if (this.desktop) continue;
      this.ui.point(hand, H.rayO, H.rayD, H.trigger.down, H.trigger.pressed);
    }
    if (this.desktop && pointing) this.desktopPointer();
    // ---------------- world simulation
    if (this.course) {
      P.update(dt, inp);
      this.clubs.update(dt, inp);
      if (this.state !== 'paused') {
        this.ball.update(dt);
        if (this.ball.moving) { if (this.settings.trail && (this.ball.state === 'flight' || this.world.trailPts.length)) { this._trailAcc = (this._trailAcc || 0) + dt; if (this._trailAcc > 1 / 40) { this._trailAcc = 0; if (this.ball.state === 'flight') this.world.trailPush(this.ball.p); } } }
        AUDIO.updateFlight(V3.len(this.ball.v), this.ball.p, this.ball.grounded, V3.len(this.ball.v), this.course.surface(this.ball.p[0], this.ball.p[2]));
        this.handleBallEvents();
      }
      if (this.pendingDrop) {
        this.pendingDrop.t -= dt;
        if (this.pendingDrop.t <= 0) { const d = this.pendingDrop.drop; this.ball.placeAt(d.x, d.z, d.teed ? 0.028 : 0); this.pendingDrop = null; this.world.trailReset(); if (this.settings.autoClub) this.autoClub(); this.wristDirty = true; }
      }
      // flag animation: pulled when on green
      this.flagAnim += ((this.flagIn ? 1 : 0) - this.flagAnim) * Math.min(1, dt * 3);
      this.world.update(dt, P.headPos, P.headFwd);
      AUDIO.tickAmbience(dt, P.headPos);
    }
    // ---------------- panels: toast follow, wrist, hint
    if (this.toastData) { this.toastData.t += dt; if (this.toastData.t > this.toastData.dur) { this.toastPanel.hide(); this.toastData = null; } }
    if (this.toastPanel.visible) this.followHead(this.toastPanel, 1.7, 0.28, dt);
    if (this.hintPanel.visible) { this.followHead(this.hintPanel, 1.5, -0.42, dt, 'hint'); this.hintT -= dt; if (this.hintT < 0) this.hintPanel.hide(); }
    if (this.loadPanel.visible) this.followHead(this.loadPanel, 3.0, 0.05, dt, 'load');
    for (const pn of [this.toastPanel, this.hintPanel, this.loadPanel]) if (!pn.visible) pn._wasVisible = false;
    this.updateWrist(dt);
    this.updatePin();
    this.ui.update(dt);
    AUDIO.listener(P.headPos, P.headFwd, M4.transformDir([0, 0, 0], P.head, [0, 1, 0]));
  }
  followHead(panel, dist, up, dt, key = 'toast') {
    const P = this.player; const f = V3.norm([0, 0, 0], [P.headFwd[0], 0, P.headFwd[2]]);
    const target = [P.headPos[0] + f[0] * dist, P.headPos[1] + up + P.headFwd[1] * dist * 0.4, P.headPos[2] + f[2] * dist];
    this._fol = this._fol || {}; let cur = this._fol[key] || target.slice();
    if (V3.dist(cur, target) > 2.0 || !panel._wasVisible) cur = target.slice();
    panel._wasVisible = true;
    const k = Math.min(1, dt * 3.5); V3.lerp(cur, cur, target, k); this._fol[key] = cur;
    panel.placeFacing(cur, P.headPos, 1);
  }
  updateWrist(dt) {
    const hand = this.clubs.held === 'left' ? 'right' : 'left'; const H = this.input.hands[hand];
    const show = this.course && H.present && (this.state === 'playing' || this.state === 'paused') && !this.desktop;
    if (!show) { this.wristPanel.hide(); return; }
    if (!this.wristPanel.visible || this.wristDirty) { this.wristPanel.setPage((ctx, P) => this.drawWrist(ctx, P)); this.wristPanel.show(); this.wristDirty = false; }
    this._wristTick = (this._wristTick || 0) + dt; if (this._wristTick > 0.5) { this._wristTick = 0; this.wristPanel.dirty = true; }
    // attach above the wrist, angled toward the face
    const g = H.grip; const sx = hand === 'left' ? 1 : -1;
    const pos = M4.transformPoint([0, 0, 0], g, [sx * 0.01, 0.045, 0.1]);
    this.wristPanel.placeFacing(pos, this.player.headPos, 1);
  }
  updatePin() {
    if (!this.course || !this.hole || !this.settings.pinMarker || !(this.state === 'playing' || this.state === 'paused')) { this.pinPanel.hide(); return; }
    const d = V3.dist(this.player.headPos, this.hole.cupPos);
    if (d < 8) { this.pinPanel.hide(); return; }
    this.pinPanel.show();
    const scale = clamp(d / 18, 1, 30);
    const pos = [this.hole.cupPos[0], this.hole.cupPos[1] + 2.6 + scale * 0.45, this.hole.cupPos[2]];
    this.pinPanel.placeFacing(pos, this.player.headPos, scale);
    const rd = Math.round(this.distToPin()); if (rd !== this._pinD) { this._pinD = rd; this.pinPanel.dirty = true; }
  }
  desktopPointer() {
    // mouse ray through the canvas for clicking menus in desktop mode
    const m = this.input.mouse; const rect = this.canvas.getBoundingClientRect();
    const nx = ((m.x - rect.left) / rect.width) * 2 - 1, ny = -(((m.y - rect.top) / rect.height) * 2 - 1);
    if (!this.lastInvVP) return;
    const a = M4.transformPoint([0, 0, 0], this.lastInvVP, [nx, ny, -1]), b = M4.transformPoint([0, 0, 0], this.lastInvVP, [nx, ny, 1]);
    // perspective divide
    const unproj = (v) => { const p = [nx, ny, v, 1]; const M = this.lastInvVP; const x = M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12], y = M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13], z = M[2] * p[0] + M[6] * p[1] + M[10] * p[2] + M[14], w = M[3] * p[0] + M[7] * p[1] + M[11] * p[2] + M[15]; return [x / w, y / w, z / w]; };
    const o = unproj(-1), f = unproj(1); const d = V3.norm([0, 0, 0], V3.sub([0, 0, 0], f, o));
    const click = this.input.hands.right.trigger.pressed;
    const hit = this.ui.point('right', o, d, click, click);
    this.uiCapturingMouse = !!hit;
  }

  // ==================================================================== DRAWING (pages)
  drawMenu(ctx, P) {
    const W0 = P.pxW, H0 = P.pxH; const t = easeOutCubic(clamp(P.pageT / 0.45, 0, 1));
    ctx.save(); ctx.globalAlpha = t; ctx.translate(0, (1 - t) * 24);
    UIDraw.glassPanel(ctx, 20, 20, W0 - 40, H0 - 40, 48);
    const page = this.menuPage;
    const back = (to) => W.button(ctx, P, 'back', 70, H0 - 150, 230, 80, '‹  ' + T('back'), () => { AUDIO.uiBack(); this.menuPage = to; P.setPage(P.draw); }, { size: 30 });
    if (page === 'main') this.pageMain(ctx, P);
    else if (page === 'play') { this.pageModes(ctx, P); back('main'); }
    else if (page === 'maps') { this.pageMaps(ctx, P); back('main'); }
    else if (page === 'settings') { this.pageSettings(ctx, P); back(this.state === 'paused' ? 'pause' : 'main'); }
    else if (page === 'language') { this.pageLanguage(ctx, P); back('main'); }
    else if (page === 'credits') { this.pageCredits(ctx, P); back('main'); }
    else if (page === 'pause') this.pagePause(ctx, P);
    else if (page === 'scorecard') { this.pageScorecard(ctx, P); back(this.state === 'paused' ? 'pause' : 'main'); }
    else if (page === 'holeEnd') this.pageHoleEnd(ctx, P);
    else if (page === 'roundEnd') this.pageRoundEnd(ctx, P);
    ctx.restore();
  }
  go(page) { this.menuPage = page; this.menuPanel.setPage(this.menuPanel.draw); }

  pageMain(ctx, P) {
    const W0 = P.pxW;
    drawFutonMark(ctx, 150, 130, 74, 1);
    UIDraw.text(ctx, 'FUTON GROUP', 210, 118, 26, { weight: 700, spacing: 6, color: COL.dim });
    UIDraw.text(ctx, T('developed_by'), 210, 150, 20, { color: COL.faint });
    drawGameTitle(ctx, W0 / 2 + 230, 290, 92, 1);
    UIDraw.text(ctx, T('subtitle'), W0 / 2 + 230, 370, 30, { align: 'center', color: COL.dim, spacing: 4 });
    // map preview on the left
    const m = MAPS[this.settings.map]; drawCourseArt(ctx, m.id, 80, 230, 520, 560, this.settings.time !== 'default' ? this.settings.time : null);
    UIDraw.text(ctx, T(m.key), 110, 730, 34, { weight: 800, spacing: 3, shadow: 10 });
    UIDraw.text(ctx, '6 ' + T('holes') + ' · ' + T('par') + ' ' + m.holes.reduce((a, h) => a + h.par, 0), 110, 768, 24, { color: COL.dim });
    const items = [['menu_play', () => this.go('play'), true], ['menu_maps', () => this.go('maps')], ['menu_settings', () => { this.settingsTab = 0; this.go('settings'); }], ['menu_language', () => this.go('language')], ['menu_credits', () => this.go('credits')], ['menu_exit', () => this.exitGame()]];
    items.forEach(([k, fn, primary], i) => {
      const y = 440 + i * 86; const dl = clamp((P.pageT - i * 0.05) / 0.3, 0, 1);
      ctx.save(); ctx.globalAlpha *= easeOutCubic(dl); ctx.translate((1 - easeOutCubic(dl)) * 40, 0);
      W.button(ctx, P, k, 820, y, 560, 70, T(k), fn, { primary, align: primary ? 'center' : 'left', size: 28, spacing: 3 });
      ctx.restore();
    });
    const best = this.bestScores[m.id + '_stroke'];
    if (best !== undefined) UIDraw.text(ctx, T('best') + ': ' + best, 1100, 960 - 40, 22, { align: 'center', color: COL.faint });
  }
  pageModes(ctx, P) {
    UIDraw.text(ctx, T('choose_mode'), 80, 100, 48, { weight: 800 });
    const modes = [['stroke', 'mode_stroke', 'mode_stroke_d'], ['quick', 'mode_quick', 'mode_quick_d'], ['time', 'mode_time', 'mode_time_d'], ['practice', 'mode_practice', 'mode_practice_d']];
    modes.forEach(([id, k, d], i) => {
      const x = 80 + (i % 2) * 730, y = 180 + Math.floor(i / 2) * 250, w = 700, h = 220;
      const hv = P.region('mode_' + id, x, y, w, h, () => this.startRound(id));
      UIDraw.rr(ctx, x - hv * 4, y - hv * 4, w + hv * 8, h + hv * 8, 28); ctx.fillStyle = `rgba(255,255,255,${0.05 + hv * 0.09})`; ctx.fill();
      ctx.strokeStyle = hv > 0.5 ? COL.accent : COL.line; ctx.lineWidth = 2; ctx.stroke();
      const ic = ['⛳', '⚡', '⏱', '🎯'][i];
      UIDraw.rr(ctx, x + 30, y + 30, 80, 80, 22); ctx.fillStyle = UIDraw.accentGrad(ctx, x + 30, y + 30, x + 110, y + 110); ctx.globalAlpha = 0.25 + hv * 0.5; ctx.fill(); ctx.globalAlpha = 1;
      UIDraw.text(ctx, ic, x + 70, y + 72, 44, { align: 'center' });
      UIDraw.text(ctx, T(k), x + 140, y + 70, 40, { weight: 750 });
      UIDraw.wrap(ctx, T(d), x + 140, y + 110, w - 180, 26, 34, { color: COL.dim });
    });
    // time-of-day chips
    UIDraw.text(ctx, T('choose_time'), 360, 735, 26, { color: COL.dim });
    ['default', 'morning', 'noon', 'sunset'].forEach((k, i) => {
      W.button(ctx, P, 'time_' + k, 360 + i * 230, 770, 215, 66, T(k === 'default' ? 'time_default' : 'time_' + k), () => this.set('time', k), { active: this.settings.time === k, size: 24 });
    });
    UIDraw.text(ctx, T(MAPS[this.settings.map].key), 1530, 100, 30, { align: 'right', color: COL.accent2, weight: 700, spacing: 3 });
  }
  pageMaps(ctx, P) {
    UIDraw.text(ctx, T('choose_map'), 80, 100, 48, { weight: 800 });
    MAPS.forEach((m, i) => {
      const x = 80 + i * 485, y = 170, w = 455, h = 640; const sel = this.settings.map === i;
      const hv = P.region('map_' + i, x, y, w, h, () => this.set('map', i));
      ctx.save(); ctx.translate(x + w / 2, y + h / 2); const s = 1 + hv * 0.02; ctx.scale(s, s); ctx.translate(-(x + w / 2), -(y + h / 2));
      drawCourseArt(ctx, m.id, x, y, w, h * 0.72, this.settings.time !== 'default' ? this.settings.time : null);
      UIDraw.rr(ctx, x, y, w, h, 22); ctx.strokeStyle = sel ? COL.accent : `rgba(255,255,255,${0.1 + hv * 0.3})`; ctx.lineWidth = sel ? 5 : 2; ctx.stroke();
      UIDraw.text(ctx, T(m.key), x + 26, y + h * 0.72 + 50, 29, { weight: 800, spacing: 1, maxW: w - 40 });
      UIDraw.wrap(ctx, T(m.key + '_d'), x + 26, y + h * 0.72 + 82, w - 52, 22, 30, { color: COL.dim });
      if (sel) { UIDraw.rr(ctx, x + w - 170, y + 20, 150, 46, 23); ctx.fillStyle = UIDraw.accentGrad(ctx, x + w - 170, 0, x + w - 20, 0); ctx.fill(); UIDraw.text(ctx, T('selected'), x + w - 95, y + 44, 22, { align: 'center', weight: 700 }); }
      ctx.restore();
    });
    W.button(ctx, P, 'tomodes', 1180, 850, 340, 80, T('menu_play') + '  ›', () => this.go('play'), { primary: true, size: 30 });
  }
  pageSettings(ctx, P) {
    UIDraw.text(ctx, T('settings'), 80, 100, 48, { weight: 800 });
    const tabs = ['tab_game', 'tab_comfort', 'tab_graphics', 'tab_audio', 'tab_lang'].map(k => T(k));
    W.tabs(ctx, P, 'tab', 70, 170, 380, 78, tabs, this.settingsTab, (i) => { this.settingsTab = i; this.menuPanel.dirty = true; });
    const s = this.settings; const x = 490, w = 1040, h = 74; let y = 170;
    const row = () => { const yy = y; y += h + 12; return yy; };
    const cyc = (k, vals, labels) => { const i = vals.indexOf(s[k]); const lab = labels[(i < 0 ? 0 : i)]; return [lab, () => this.set(k, vals[(i - 1 + vals.length) % vals.length]), () => this.set(k, vals[(i + 1) % vals.length])]; };
    const sel = (id, label, k, vals, labels) => { const [lab, p, n] = cyc(k, vals, labels); W.selector(ctx, P, id, x, row(), w, h, label, lab, p, n); };
    const tog = (id, label, k) => W.toggle(ctx, P, id, x, row(), w, h, label, !!s[k], () => this.set(k, !s[k]));
    const sld = (id, label, k, fmt) => W.slider(ctx, P, id, x, row(), w, h, label, s[k], (v) => this.set(k, v), fmt);
    if (this.settingsTab === 0) {
      sel('handed', T('s_handed'), 'handed', ['right', 'left'], [T('s_right'), T('s_left')]);
      tog('autoclub', T('s_auto_club'), 'autoClub'); tog('aim', T('s_aim'), 'aimLine'); tog('trail', T('s_trail'), 'trail'); tog('pin', T('s_pin'), 'pinMarker');
      sel('assist', T('s_assist'), 'assist', [0, 0.1, 0.2, 0.35], [T('off'), '+10%', '+20%', '+35%']);
      sel('cangle', T('s_club_angle'), 'clubAngle', [-30, -20, -10, 0, 10, 20, 30], ['-30°', '-20°', '-10°', '0°', '+10°', '+20°', '+30°']);
      sel('units', T('s_units'), 'units', ['m', 'yd'], [T('s_meters'), T('s_yards')]);
    } else if (this.settingsTab === 1) {
      sel('loco', T('s_move'), 'locomotion', ['both', 'teleport'], [T('s_move_both'), T('s_move_tp')]);
      sel('speed', T('s_speed'), 'walkSpeed', [1.5, 2.5, 3.5, 5], ['1.5 m/s', '2.5 m/s', '3.5 m/s', '5 m/s']);
      sel('turn', T('s_turn'), 'turn', ['snap', 'smooth'], [T('s_turn_snap'), T('s_turn_smooth')]);
      sel('snap', T('s_snap_angle'), 'snapAngle', [15, 30, 45, 90], ['15°', '30°', '45°', '90°']);
      tog('vig', T('s_vignette'), 'vignette'); tog('seated', T('s_seated'), 'seated');
      sel('hoff', T('s_height'), 'heightOffset', [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3], ['-30 cm', '-20 cm', '-10 cm', '0', '+10 cm', '+20 cm', '+30 cm']);
    } else if (this.settingsTab === 2) {
      sel('q', T('s_quality'), 'quality', ['low', 'med', 'high'], [T('q_low'), T('q_med'), T('q_high')]);
      sel('sh', T('s_shadows'), 'shadows', ['off', 'low', 'med', 'high'], [T('off'), T('low'), T('medium'), T('high')]);
      sel('gr', T('s_grass'), 'grass', ['off', 'low', 'med', 'high'], [T('off'), T('low'), T('medium'), T('high')]);
      sel('hz', T('s_refresh'), 'refresh', [72, 80, 90], ['72 Hz', '80 Hz', '90 Hz']);
      sel('fov', T('s_foveation'), 'foveation', [0, 0.5, 1], [T('off'), T('medium'), T('high')]);
      sel('res', T('s_res'), 'resScale', [0.8, 0.9, 1.0, 1.1, 1.2], ['80%', '90%', '100%', '110%', '120%']);
    } else if (this.settingsTab === 3) {
      sld('master', T('s_master'), 'master'); sld('sfx', T('s_sfx'), 'sfx'); sld('amb', T('s_amb'), 'amb'); sld('uiv', T('s_ui'), 'ui');
    } else {
      this.languageButtons(ctx, P, x, 190);
    }
  }
  languageButtons(ctx, P, x, y) {
    ['en', 'ru'].forEach((l, i) => {
      W.button(ctx, P, 'lang_' + l, x, y + i * 120, 520, 96, I18N[l].lang_name, () => this.set('lang', l), { active: this.settings.lang === l, size: 36, align: 'left' });
      if (this.settings.lang === l) { ctx.beginPath(); ctx.arc(x + 470, y + i * 120 + 48, 16, 0, TAU); ctx.fillStyle = COL.accent; ctx.fill(); }
    });
  }
  pageLanguage(ctx, P) { UIDraw.text(ctx, T('language'), 80, 100, 48, { weight: 800 }); this.languageButtons(ctx, P, 540, 300); }
  pageCredits(ctx, P) {
    const W0 = P.pxW;
    drawFutonLogo(ctx, W0 / 2 + 20, 210, 130, 1);
    UIDraw.wrap(ctx, T('credits_body'), W0 / 2, 360, 1100, 30, 44, { align: 'center', color: COL.dim });
  }
  pagePause(ctx, P) {
    const W0 = P.pxW;
    UIDraw.text(ctx, T('pause'), W0 / 2, 110, 56, { weight: 800, align: 'center' });
    if (this.round) UIDraw.text(ctx, T(MAPS[this.mapIndex].key) + '  ·  ' + T('hole') + ' ' + (this.holeIndex + 1) + '  ·  ' + T('strokes') + ' ' + this.strokes, W0 / 2, 170, 28, { align: 'center', color: COL.dim });
    const items = [['resume', () => this.togglePause(), true], ['restart_hole', () => { const h = this.round.holes[this.holeIndex]; h.strokes = 0; h.pen = 0; h.done = false; this.state = 'playing'; this.closeMenu(); this.startHole(this.holeIndex); }], ['scorecard', () => this.go('scorecard')], ['settings', () => { this.settingsTab = 0; this.go('settings'); }], ['main_menu', () => { this.round = null; this.state = 'menu'; this.enterMenu('main'); }]];
    if (this.round && this.round.mode === 'practice') {
      items.splice(2, 0, ['prev_hole', () => { const n = this.course.holes.length; this.state = 'playing'; this.closeMenu(); this.startHole((this.holeIndex - 1 + n) % n); }], ['skip_hole', () => { const n = this.course.holes.length; this.state = 'playing'; this.closeMenu(); this.startHole((this.holeIndex + 1) % n); }]);
    }
    items.forEach(([k, fn, pr], i) => W.button(ctx, P, k, W0 / 2 - 300, 230 + i * 92, 600, 76, T(k), fn, { primary: pr, size: 30 }));
  }
  scoreTable(ctx, P, x, y, w) {
    const r = this.round; if (!r) return;
    const n = r.holes.length; const cw = (w - 220) / (n + 1); const rh = 74;
    const rows = [[T('hole'), i => i + 1], [T('par'), i => r.holes[i].par], [T('strokes'), i => r.holes[i].strokes || (r.holes[i].done ? r.holes[i].strokes : '–')]];
    rows.forEach(([label, fn], ri) => {
      const yy = y + ri * rh; UIDraw.rr(ctx, x, yy, w, rh - 8, 14); ctx.fillStyle = ri === 0 ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)'; ctx.fill();
      UIDraw.text(ctx, label, x + 24, yy + rh / 2 - 4, 26, { color: COL.dim, weight: 600 });
      for (let i = 0; i < n; i++) {
        const cx = x + 220 + cw * (i + 0.5); const v = fn(i);
        if (ri === 2 && r.holes[i].done) {
          const d = r.holes[i].strokes - r.holes[i].par;
          ctx.lineWidth = 3; ctx.strokeStyle = d < 0 ? COL.gold : d > 0 ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0)';
          if (d < 0) { ctx.beginPath(); ctx.arc(cx, yy + rh / 2 - 4, 26, 0, TAU); ctx.stroke(); if (d < -1) { ctx.beginPath(); ctx.arc(cx, yy + rh / 2 - 4, 32, 0, TAU); ctx.stroke(); } }
          else if (d > 0) { ctx.strokeRect(cx - 24, yy + rh / 2 - 28, 48, 48); if (d > 1) ctx.strokeRect(cx - 30, yy + rh / 2 - 34, 60, 60); }
        }
        UIDraw.text(ctx, String(v), cx, yy + rh / 2 - 4, 30, { align: 'center', weight: ri === 0 ? 700 : 600, color: ri === 2 && i === this.holeIndex && !r.holes[i].done ? COL.accent2 : COL.text });
      }
      const tx = x + 220 + cw * (n + 0.5);
      const tot = ri === 0 ? T('total') : ri === 1 ? r.holes.reduce((a, h) => a + h.par, 0) : r.holes.reduce((a, h) => a + h.strokes, 0);
      UIDraw.text(ctx, String(tot), tx, yy + rh / 2 - 4, ri === 0 ? 24 : 32, { align: 'center', weight: 800, color: ri === 2 ? COL.accent2 : COL.text });
    });
    const played = r.holes.filter(h => h.done); const vs = played.reduce((a, h) => a + h.strokes - h.par, 0);
    UIDraw.text(ctx, T('score') + ': ' + (played.length ? (vs === 0 ? T('even') : (vs > 0 ? '+' : '') + vs) : '–') + '  ' + T('vs_par'), x, y + rh * 3 + 40, 32, { weight: 700 });
    if (r.mode === 'time') UIDraw.text(ctx, T('time_total') + ': ' + fmtTime(r.time), x + w, y + rh * 3 + 40, 32, { weight: 700, align: 'right', color: COL.accent2 });
  }
  pageScorecard(ctx, P) { UIDraw.text(ctx, T('scorecard'), 80, 100, 48, { weight: 800 }); this.scoreTable(ctx, P, 80, 200, 1440); }
  pageHoleEnd(ctx, P) {
    const W0 = P.pxW; const r = this.round; const h = r.holes[this.holeIndex];
    UIDraw.text(ctx, T('hole') + ' ' + (this.holeIndex + 1), W0 / 2, 110, 60, { weight: 800, align: 'center' });
    UIDraw.text(ctx, T('strokes') + ' ' + h.strokes + '  ·  ' + T('par') + ' ' + h.par + (h.pen ? '  ·  +' + h.pen : ''), W0 / 2, 175, 30, { align: 'center', color: COL.dim });
    this.scoreTable(ctx, P, 80, 260, 1440);
    const last = this.holeIndex + 1 >= r.holes.length;
    W.button(ctx, P, 'next', W0 / 2 - 260, 790, 520, 90, last ? T('finish') : T('next_hole') + '  ›', () => this.nextHole(), { primary: true, size: 34 });
  }
  pageRoundEnd(ctx, P) {
    const W0 = P.pxW; const r = this.round;
    UIDraw.text(ctx, T('round_complete'), W0 / 2, 100, 60, { weight: 800, align: 'center' });
    const vs = r.total - r.par;
    UIDraw.text(ctx, String(r.total) + '  (' + (vs === 0 ? T('even') : (vs > 0 ? '+' : '') + vs) + ')', W0 / 2, 180, 44, { align: 'center', color: COL.accent2, weight: 800 });
    if (r.newBest) UIDraw.text(ctx, '★ ' + T('new_best'), W0 / 2, 235, 28, { align: 'center', color: COL.gold, weight: 700 });
    this.scoreTable(ctx, P, 80, 290, 1440);
    W.button(ctx, P, 'again', W0 / 2 - 560, 810, 520, 86, T('play_again'), () => this.startRound(r.mode), { primary: true, size: 32 });
    W.button(ctx, P, 'tomenu', W0 / 2 + 40, 810, 520, 86, T('main_menu'), () => this.enterMenu('main'), { size: 32 });
  }
  drawToast(ctx, P) {
    const d = this.toastData; if (!d) return; const W0 = P.pxW, H0 = P.pxH;
    const a = clamp(d.t / 0.25, 0, 1) * clamp((d.dur - d.t) / 0.4, 0, 1); const e = easeOutBack(clamp(d.t / 0.35, 0, 1));
    ctx.save(); ctx.globalAlpha = a; ctx.translate(W0 / 2, H0 / 2); ctx.scale(0.9 + 0.1 * e, 0.9 + 0.1 * e); ctx.translate(-W0 / 2, -H0 / 2);
    ctx.font = `800 84px ${FONT}`; let tw = Math.max(ctx.measureText(d.title).width, 300); ctx.font = `500 38px ${FONT}`; if (d.sub) tw = Math.max(tw, ctx.measureText(d.sub).width); tw = Math.min(tw + 160, W0 - 20);
    UIDraw.rr(ctx, W0 / 2 - tw / 2, 20, tw, H0 - 40, 60); ctx.fillStyle = 'rgba(10,14,18,0.72)'; ctx.fill(); ctx.strokeStyle = d.color || 'rgba(255,255,255,0.12)'; ctx.lineWidth = 3; ctx.stroke();
    UIDraw.text(ctx, d.title, W0 / 2, d.sub ? 120 : H0 / 2, 84, { align: 'center', weight: 800, color: d.color || COL.text, shadow: 12, maxW: W0 - 80 });
    if (d.sub) UIDraw.text(ctx, d.sub, W0 / 2, 210, 38, { align: 'center', color: COL.dim, maxW: W0 - 100 });
    ctx.restore();
    this.toastPanel.dirty = true;
  }
  drawWrist(ctx, P) {
    if (!this.course || !this.ball || !this.hole) return;
    const W0 = P.pxW, H0 = P.pxH; UIDraw.rr(ctx, 6, 6, W0 - 12, H0 - 12, 40); ctx.fillStyle = 'rgba(10,14,18,0.86)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 3; ctx.stroke();
    if (!this.hole || !this.ball) return;
    const r = this.round; const hi = this.holeIndex;
    UIDraw.text(ctx, T('hole').toUpperCase() + ' ' + (hi + 1), 34, 52, 30, { weight: 800, spacing: 2 });
    UIDraw.text(ctx, T('par') + ' ' + this.hole.par, W0 - 34, 52, 30, { weight: 700, align: 'right', color: COL.dim });
    UIDraw.text(ctx, String(this.strokes), 34, 140, 88, { weight: 800 });
    UIDraw.text(ctx, T('strokes'), 36, 200, 22, { color: COL.dim });
    if (r) { const played = r.holes.filter((h, i) => h.done && i !== hi); const vs = played.reduce((a, h) => a + h.strokes - h.par, 0); UIDraw.text(ctx, (vs === 0 ? T('even') : (vs > 0 ? '+' : '') + vs), 200, 140, 52, { weight: 800, color: vs < 0 ? COL.gold : vs > 0 ? COL.text : COL.green }); UIDraw.text(ctx, T('total'), 200, 200, 22, { color: COL.dim }); }
    UIDraw.text(ctx, this.fmtDist(this.distToPin()), W0 - 34, 130, 50, { weight: 800, align: 'right', color: COL.accent2 });
    UIDraw.text(ctx, T('to_pin'), W0 - 34, 180, 22, { align: 'right', color: COL.dim });
    // bottom row: club, lie, wind, timer
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(30, 228, W0 - 60, 2);
    UIDraw.text(ctx, this.clubs.club.name, 34, 284, 40, { weight: 800, color: COL.accent });
    const lie = this.course.surface(this.ball.p[0], this.ball.p[2]); UIDraw.text(ctx, T('surf_' + SURF_NAMES[lie]), 130, 284, 26, { color: COL.dim, maxW: 150 });
    // wind arrow relative to the player view
    const w = this.ball.wind; const ws = Math.hypot(w[0], w[2]);
    const hy = Math.atan2(-this.player.headFwd[0], -this.player.headFwd[2]); const wa = Math.atan2(-w[0], -w[2]) - hy;
    ctx.save(); ctx.translate(W0 - 150, 284); ctx.rotate(-wa); ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(12, 12); ctx.lineTo(0, 5); ctx.lineTo(-12, 12); ctx.closePath(); ctx.fillStyle = COL.blue; ctx.fill(); ctx.restore();
    UIDraw.text(ctx, ws.toFixed(1) + ' m/s', W0 - 34, 284, 26, { align: 'right', weight: 600 });
    if (r && r.mode === 'time') UIDraw.text(ctx, fmtTime(r.time), W0 / 2, 52, 26, { align: 'center', color: COL.accent2, weight: 700 });
    if (this.shotInfo && this.shotInfo.res) { const s = this.shotInfo; UIDraw.text(ctx, this.fmtDist(s.total) + ' · ' + Math.round(s.res.headSpeed * 3.6) + '→' + Math.round(s.res.ballSpeed * 3.6) + ' km/h', W0 / 2 + 30, 214, 20, { align: 'center', color: COL.faint }); }
  }
  drawTeeSign(ctx, P) {
    const W0 = P.pxW, H0 = P.pxH; const h = this.hole; if (!h || !this.course) return; const c = this.course;
    ctx.fillStyle = '#1b2420'; UIDraw.rr(ctx, 0, 0, W0, H0, 30); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 6; UIDraw.rr(ctx, 14, 14, W0 - 28, H0 - 28, 22); ctx.stroke();
    UIDraw.text(ctx, String(h.index + 1), 70, 110, 150, { weight: 800 });
    UIDraw.text(ctx, T('par') + ' ' + h.par, 70, 230, 54, { weight: 700, color: COL.accent2 });
    UIDraw.text(ctx, this.fmtDist(h.len), 70, 300, 44, { weight: 600, color: COL.dim });
    UIDraw.wrap(ctx, T(c.def.key), 70, H0 - 120, 260, 28, 34, { weight: 700, color: COL.faint });
    // hole map (top-down)
    const mx = 360, my = 40, mw = W0 - mx - 40, mh = H0 - 80;
    ctx.save(); UIDraw.rr(ctx, mx, my, mw, mh, 20); ctx.clip(); ctx.fillStyle = 'rgb(46,78,38)'; ctx.fillRect(mx, my, mw, mh);
    let bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9; for (const p of h.path) { bx0 = Math.min(bx0, p[0]); bx1 = Math.max(bx1, p[0]); bz0 = Math.min(bz0, p[1]); bz1 = Math.max(bz1, p[1]); }
    const pad = 45; bx0 -= pad; bx1 += pad; bz0 -= pad; bz1 += pad;
    // orient so the hole plays "up" the card
    const ang = Math.atan2(h.green[0] - h.tee[0], h.green[1] - h.tee[1]); const ca = Math.cos(ang), sa = Math.sin(ang);
    const cx0 = (h.tee[0] + h.green[0]) / 2, cz0 = (h.tee[1] + h.green[1]) / 2; const span = Math.max(h.len * 0.62 + 60, 150);
    const sc = Math.min(mw, mh) / (span * 2) * 1.6;
    const toPx = (x, z) => { const dx = x - cx0, dz = z - cz0; const u = dx * ca - dz * sa, v = dx * sa + dz * ca; return [mx + mw / 2 + u * sc, my + mh / 2 - v * sc]; };
    const step = 3;
    for (let py = my; py < my + mh; py += step) for (let px = mx; px < mx + mw; px += step) {
      const u = (px - mx - mw / 2) / sc, v = -(py - my - mh / 2) / sc; const x = cx0 + u * ca + v * sa, z = cz0 - u * sa + v * ca;
      const s = c.surface(x, z); const col = s === SURF.FAIRWAY ? '#5f9e3f' : s === SURF.GREEN ? '#74c25a' : s === SURF.SAND || s === SURF.BEACH ? '#e6d6a6' : s === SURF.WATER ? '#4f8fc0' : s === SURF.TEE ? '#6aa84a' : s === SURF.FRINGE ? '#54903a' : s === SURF.ROCK ? '#7a746c' : s === SURF.DEEP ? '#355f2b' : '#41702f';
      ctx.fillStyle = col; ctx.fillRect(px, py, step, step);
    }
    const tp = toPx(h.tee[0], h.tee[1]), gp = toPx(h.cup[0], h.cup[1]);
    ctx.setLineDash([10, 10]); ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 3; ctx.beginPath(); const p0 = toPx(...h.path[0]); ctx.moveTo(p0[0], p0[1]); for (const p of h.path.slice(1)) { const q = toPx(p[0], p[1]); ctx.lineTo(q[0], q[1]); } ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(tp[0], tp[1], 9, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(gp[0], gp[1]); ctx.lineTo(gp[0], gp[1] - 40); ctx.stroke(); ctx.fillStyle = COL.accent; ctx.beginPath(); ctx.moveTo(gp[0], gp[1] - 40); ctx.lineTo(gp[0] + 26, gp[1] - 32); ctx.lineTo(gp[0], gp[1] - 24); ctx.fill();
    ctx.restore();
  }
  drawPin(ctx, P) {
    const W0 = P.pxW, H0 = P.pxH; UIDraw.rr(ctx, 4, 20, W0 - 8, H0 - 60, 40); ctx.fillStyle = 'rgba(10,14,18,0.7)'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(W0 / 2 - 18, H0 - 40); ctx.lineTo(W0 / 2 + 18, H0 - 40); ctx.lineTo(W0 / 2, H0 - 8); ctx.fill();
    ctx.fillStyle = COL.accent; ctx.beginPath(); ctx.moveTo(40, 50); ctx.lineTo(80, 64); ctx.lineTo(40, 78); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillRect(36, 46, 5, 60);
    UIDraw.text(ctx, this.hole ? this.fmtDist(this.distToPin()) : '', W0 / 2 + 30, 72, 52, { align: 'center', weight: 800 });
  }
  drawLoading(ctx, P) {
    const W0 = P.pxW, H0 = P.pxH; const t = P.t;
    ctx.fillStyle = 'rgba(8,10,12,0.0)'; ctx.fillRect(0, 0, W0, H0);
    drawFutonLogo(ctx, W0 / 2 + 40, 260, 120, clamp(t / 1.6, 0, 1));
    ctx.globalAlpha = clamp((t - 0.6) / 0.6, 0, 1);
    drawGameTitle(ctx, W0 / 2, 470, 70, 1);
    UIDraw.text(ctx, this.loadMapName || '', W0 / 2, 570, 34, { align: 'center', weight: 700, spacing: 6, color: COL.dim });
    const bw = 700, bx = W0 / 2 - bw / 2, by = 650;
    UIDraw.rr(ctx, bx, by, bw, 10, 5); ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fill();
    this._lp = lerp(this._lp || 0, this.loadingProgress, 0.25);
    UIDraw.rr(ctx, bx, by, Math.max(10, bw * this._lp), 10, 5); ctx.fillStyle = UIDraw.accentGrad(ctx, bx, 0, bx + bw, 0); ctx.fill();
    UIDraw.text(ctx, (this.loadingLabel || T('loading')) + '…', W0 / 2, 710, 28, { align: 'center', color: COL.faint });
    UIDraw.text(ctx, T('developed_by'), W0 / 2, H0 - 60, 24, { align: 'center', color: COL.faint, spacing: 3 });
    ctx.globalAlpha = 1;
  }
  exitGame() { if (this.xrSession) this.xrSession.end(); else { this.menuPanel.hide(); this.onExit && this.onExit(); } }
}
function fmtTime(s) { const m = Math.floor(s / 60), r = Math.floor(s % 60); return m + ':' + (r < 10 ? '0' : '') + r; }
