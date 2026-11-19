'use strict';
// ============================================================================
// Boot, WebXR session, render loop, per-eye rendering, landing page.
// ============================================================================

M4.rotAxis = function (o, axis, a) {
  const [x, y, z] = axis, c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  o[0] = t * x * x + c; o[1] = t * x * y + s * z; o[2] = t * x * z - s * y; o[3] = 0;
  o[4] = t * x * y - s * z; o[5] = t * y * y + c; o[6] = t * y * z + s * x; o[7] = 0;
  o[8] = t * x * z + s * y; o[9] = t * y * z - s * x; o[10] = t * z * z + c; o[11] = 0; o[12] = o[13] = o[14] = 0; o[15] = 1; return o;
};

const APP = {
  canvas: null, gl: null, glx: null, P: null, game: null, xr: null, refSpace: null, last: 0, ballRot: M4.new(), frameTimes: [], perfStep: 0,
  tmp: { vp: M4.new(), view: M4.new(), m: M4.new(), m2: M4.new(), inv: M4.new() },
};

function initGL() {
  const canvas = document.getElementById('gl');
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, depth: true, stencil: false, xrCompatible: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!window.__FG_TEST });
  if (!gl) throw new Error('WebGL2 not supported');
  APP.canvas = canvas; APP.gl = gl; APP.glx = new GLX(gl); APP.P = buildShaders(APP.glx);
  APP.game = new Game(APP.glx, APP.P, canvas);
  APP.game.applyXRSettings = applyXRSettings;
  APP.game.onExit = () => showLanding();
  AUDIO.setVolumes({ master: APP.game.settings.master, sfx: APP.game.settings.sfx, amb: APP.game.settings.amb, ui: APP.game.settings.ui });
}

// ------------------------------------------------------------------ XR
async function startXR() {
  const game = APP.game; AUDIO.init();
  const session = await navigator.xr.requestSession('immersive-vr', { requiredFeatures: ['local-floor'], optionalFeatures: ['bounded-floor', 'hand-tracking'] });
  APP.xr = session; game.xrSession = session; game.desktop = false;
  await APP.gl.makeXRCompatible();
  const layer = new XRWebGLLayer(session, APP.gl, { antialias: true, alpha: false, framebufferScaleFactor: game.settings.resScale || 1 });
  session.updateRenderState({ baseLayer: layer, depthNear: 0.08, depthFar: 9000 });
  APP.refSpace = await session.requestReferenceSpace('local-floor');
  applyXRSettings();
  session.addEventListener('end', () => { APP.xr = null; game.xrSession = null; AUDIO.stopAmbience(); showLanding(); });
  hideLanding();
  session.requestAnimationFrame(onXRFrame);
  bootGame();
}
function applyXRSettings() {
  const s = APP.game.settings; const session = APP.xr; if (!session) return;
  const layer = session.renderState.baseLayer;
  if (layer && 'fixedFoveation' in layer) { try { layer.fixedFoveation = s.foveation; } catch (e) { } }
  if (session.updateTargetFrameRate && session.supportedFrameRates) {
    const rates = Array.from(session.supportedFrameRates); const want = rates.includes(s.refresh) ? s.refresh : rates.filter(r => r <= s.refresh).pop();
    if (want) session.updateTargetFrameRate(want).catch(() => { });
  }
}

async function bootGame() {
  const g = APP.game; g.state = 'intro';
  g.loadPanel.setPage((ctx, P) => g.drawLoading(ctx, P)); g.loadPanel.show();
  await sleep(1600);
  await g.enterMenu('main');
}

function onXRFrame(t, frame) {
  const session = frame.session; session.requestAnimationFrame(onXRFrame);
  const game = APP.game; const dt = APP.last ? Math.min((t - APP.last) / 1000, 0.05) : 1 / 72; APP.last = t;
  const pose = frame.getViewerPose(APP.refSpace); if (!pose) return;
  game.player.updateRig();
  game.player.setHead(pose.transform.matrix);
  game.input.updateXR(frame, APP.refSpace, game.player.rig, dt);
  game.update(dt);
  game.player.setHead(pose.transform.matrix);
  perfMonitor(dt);
  APP.glx.stats.draws = 0; APP.glx.stats.tris = 0;
  const gl = APP.gl; const layer = session.renderState.baseLayer;
  renderShadows();
  gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
  gl.clearColor(0.02, 0.025, 0.03, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  for (const view of pose.views) {
    const vp = layer.getViewport(view); gl.viewport(vp.x, vp.y, vp.width, vp.height);
    M4.mul(APP.tmp.m, game.player.rig, view.transform.matrix);
    const camPos = M4.getPos([0, 0, 0], APP.tmp.m);
    M4.invert(APP.tmp.view, APP.tmp.m);
    M4.mul(APP.tmp.vp, view.projectionMatrix, APP.tmp.view);
    renderEye(APP.tmp.vp, camPos, APP.tmp.m);
  }
}

function perfMonitor(dt) {
  const ft = APP.frameTimes; ft.push(dt); if (ft.length > 120) ft.shift();
  const game = APP.game; if (ft.length < 120 || game.state !== 'playing') return;
  const avg = ft.reduce((a, b) => a + b, 0) / ft.length; const target = 1 / (game.settings.refresh || 72);
  if (avg > target * 1.22 && APP.perfStep < 3) {
    const s = game.settings; APP.perfStep++; ft.length = 0;
    if (s.grass === 'high') s.grass = 'med'; else if (s.grass === 'med') s.grass = 'low'; else if (s.shadows === 'high' || s.shadows === 'med') { s.shadows = 'low'; game.world && game.world.setShadowQuality('low'); } else s.quality = 'low';
    game.toast(T('perf_warn'), '', 2);
  }
}

// ------------------------------------------------------------------ desktop
function startDesktop() {
  AUDIO.init(); const game = APP.game; game.desktop = true;
  if (!game.desktopCtl) game.desktopCtl = new DesktopControls(game, APP.canvas);
  hideLanding(); if (!window.__FG_TEST) { document.getElementById('help').style.display = 'block'; } document.getElementById('help').textContent = T('desktop_help');
  requestAnimationFrame(onDesktopFrame);
  if (game.state === 'boot') bootGame(); else game.enterMenu('main');
}
function onDesktopFrame(t) {
  if (APP.xr) return; requestAnimationFrame(onDesktopFrame);
  const game = APP.game; const dt = APP.last ? Math.min((t - APP.last) / 1000, 0.05) : 1 / 60; APP.last = t;
  desktopStep(dt);
}
function desktopStep(dt) {
  const game = APP.game, canvas = APP.canvas, gl = APP.gl;
  APP.glx.stats.draws = 0; APP.glx.stats.tris = 0;
  const w = canvas.clientWidth * Math.min(devicePixelRatio, 2) | 0, h = canvas.clientHeight * Math.min(devicePixelRatio, 2) | 0;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  if (game.desktopCtl) game.desktopCtl.update(dt);
  game.update(dt);
  if (game.desktopCtl) game.desktopCtl.update(0);
  renderShadows();
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h);
  gl.clearColor(0.02, 0.025, 0.03, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const proj = M4.perspective(M4.new(), deg(68), w / h, 0.05, 9000);
  M4.copy(APP.tmp.m, game.player.head); M4.invert(APP.tmp.view, APP.tmp.m); M4.mul(APP.tmp.vp, proj, APP.tmp.view);
  M4.invert(APP.tmp.inv, APP.tmp.vp); game.lastInvVP = APP.tmp.inv;
  renderEye(APP.tmp.vp, game.player.headPos.slice(), APP.tmp.m);
}

// ------------------------------------------------------------------ rendering
function renderShadows() {
  const game = APP.game, world = game.world; if (!world) return;
  world.prof = {};
  const P = game.player; const c = [P.headPos[0] + P.headFwd[0] * 4, P.headPos[1] - 1, P.headPos[2] + P.headFwd[2] * 4];
  world.renderShadows(c, (prog, ci) => drawDynamic(prog, true));
}

function drawDynamic(prog, depthOnly, viewProj, camPos) {
  const game = APP.game, world = game.world, gl = APP.gl, glx = APP.glx; const m = APP.tmp.m2;
  const setM = (mat) => gl.uniformMatrix4fv(prog.u.u_model, false, mat);
  const mat = (tint, spec, emissive) => { if (depthOnly) return; gl.uniform4f(prog.u.u_tint, tint[0], tint[1], tint[2], tint[3] === undefined ? 1 : tint[3]); gl.uniform2f(prog.u.u_spec, spec[0], spec[1]); gl.uniform3fv(prog.u.u_emissive, emissive || [0, 0, 0]); };
  // ball
  const b = game.ball;
  if (b && b.state !== 'water' && !(game.pendingDrop && b.state === 'ob')) {
    M4.copy(m, APP.ballRot); m[12] = b.p[0]; m[13] = b.p[1]; m[14] = b.p[2];
    const near = camPos ? V3.dist(camPos, b.p) < 7 : true;
    const glow = game.ballGlow ? (0.6 + 0.4 * Math.sin(game.time * 5)) : 0;
    // keep the ball visible at distance: grow it slightly far away (still physically 4.27 cm)
    if (camPos) { const d = V3.dist(camPos, b.p); const s = clamp(d / 40, 1, 2.2); m[0] *= s; m[1] *= s; m[2] *= s; m[4] *= s; m[5] *= s; m[6] *= s; m[8] *= s; m[9] *= s; m[10] *= s; }
    setM(m); mat([1, 1, 1, 1], [0.55, 70], [glow * 1.2, glow * 0.95, glow * 0.5]); glx.draw(near ? world.ballMesh : world.ballMeshLow);
    if (b.teeHeight > 0 && b.atRest) { M4.identity(m); m[12] = b.p[0]; m[13] = b.p[1] - PHYS.R - b.teeHeight + 0.0; m[14] = b.p[2]; m[13] = game.course.height(b.p[0], b.p[2]) + b.teeHeight - 0.003; setM(m); mat([1, 1, 1, 1], [0.3, 30]); glx.draw(world.pegMesh); }
  }
  // club
  if (game.state !== 'boot') { setM(game.clubs.matrix); mat([1, 1, 1, 1], [0.95, 90]); glx.draw(world.clubMeshes[game.clubs.index]); }
  // flags on every hole (current hole: animated pull-out)
  if (game.course) for (const h of game.course.holes) {
    const cur = h === game.hole; const k = cur ? game.flagAnim : 1;
    if (k > 0.98 || !cur) { M4.identity(m); m[12] = h.cupPos[0]; m[13] = h.cupPos[1]; m[14] = h.cupPos[2]; }
    else { // lifted out and laid beside the hole
      const lie = M4.rotAxis(M4.new(), [1, 0, 0], (1 - k) * PI / 2 * 0.98); M4.copy(m, lie);
      m[12] = h.cupPos[0] + (1 - k) * 0.6; m[13] = h.cupPos[1] + (1 - k) * 0.03 + Math.sin((1 - k) * PI) * 0.4; m[14] = h.cupPos[2] + (1 - k) * 0.25;
    }
    const ws = world.wind; const wy = Math.atan2(ws[0], ws[2]) - PI / 2; const r = M4.rotAxis(M4.new(), [0, 1, 0], wy); const fm = M4.mul(M4.new(), m, r);
    if (!depthOnly && camPos && V3.dist(camPos, h.cupPos) > 700) continue;
    setM(fm); mat([1, 1, 1, 1], [0.4, 40]); glx.draw(world.poleMesh); mat([1, 1, 1, 1], [0.05, 8]); glx.draw(world.clothMesh);
  }
  if (game.hole && !depthOnly) { M4.identity(m); m[12] = game.hole.cupPos[0]; m[13] = game.hole.cupPos[1]; m[14] = game.hole.cupPos[2]; setM(m); mat([1, 1, 1, 1], [0, 1]); glx.draw(world.cupMesh); }
  // controllers (not the hand holding the club)
  if (!game.desktop) for (const hand of ['left', 'right']) {
    const H = game.input.hands[hand]; if (!H.present || game.clubs.held === hand) continue;
    setM(H.grip); mat([1, 1, 1, 1], [0.4, 40]); glx.draw(world.ctrlMeshes[hand]);
  }
}

function renderEye(viewProj, camPos, camMat) {
  const game = APP.game, world = game.world, gl = APP.gl, glx = APP.glx, P = APP.P;
  if (!world) { drawPanels(viewProj, camPos, true); drawOverlays(viewProj, camPos, camMat); return; }
  const b = game.ball; const h = game.hole;
  const stripe = h ? [h.dir0[0], h.dir0[2]] : [0.7, 0.7];
  world.renderView(viewProj, camPos, {
    cup: h ? h.cupPos : null, ballPos: b ? b.p : null, ballGlow: game.ballGlow, stripeDir: stripe, headFwd: game.player.headFwd,
    drawOpaque: (vp, cp) => { const p = glx.use(P.lit); world.setCommon(p, vp, cp); drawDynamic(p, false, vp, cp); },
    drawTransparent: (vp, cp) => drawTransparent(vp, cp, camMat),
  });
  drawPanels(viewProj, camPos, false);
  drawOverlays(viewProj, camPos, camMat);
}

function drawTransparent(vp, cp, camMat) {
  const game = APP.game, world = game.world, gl = APP.gl, glx = APP.glx, P = APP.P; const m = APP.tmp.m2;
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
  // particles
  let p = glx.use(P.part); gl.uniformMatrix4fv(p.u.u_viewProj, false, vp);
  gl.uniform3f(p.u.u_camRight, camMat[0], camMat[1], camMat[2]); gl.uniform3f(p.u.u_camUp, camMat[4], camMat[5], camMat[6]);
  glx.draw(world.partMesh);
  p = glx.use(P.unlit); gl.uniformMatrix4fv(p.u.u_viewProj, false, vp); gl.uniformMatrix4fv(p.u.u_model, false, M4.identity(m));
  // ball trail
  const pts = world.trailPts;
  if (game.settings.trail && pts.length > 1) {
    const tail = pts.concat(game.ball.state === 'flight' ? [game.ball.p] : []);
    const n = Math.min(tail.length, world.trailMax);
    const cnt = world.buildRibbon(tail.slice(-n), cp, (t, d) => 0.012 + d * 0.0016 * t, world.trailPos, world.trailCol, t => [255, 225 - t * 60, 190 - t * 120, Math.round(200 * Math.pow(t, 1.5))]);
    glx.updateDyn(world.trailMesh, world.trailPos, null, world.trailCol, cnt); gl.uniform4f(p.u.u_color, 1, 1, 1, 1); if (cnt) glx.draw(world.trailMesh);
  }
  // teleport arc
  const tp = game.player.tp;
  if (tp.active && tp.pts.length > 1) {
    const ok = tp.valid; const cnt = world.buildRibbon(tp.pts.slice(0, world.arcMax), cp, () => 0.012, world.arcPos, world.arcCol, t => ok ? [120, 220, 255, 200] : [255, 90, 80, 160]);
    glx.updateDyn(world.arcMesh, world.arcPos, null, world.arcCol, cnt); gl.uniform4f(p.u.u_color, 1, 1, 1, 1); glx.draw(world.arcMesh);
    if (tp.target && ok) { M4.identity(m); m[12] = tp.target[0]; m[13] = tp.target[1] + 0.03; m[14] = tp.target[2]; gl.uniformMatrix4fv(p.u.u_model, false, m); const pulse = 1 + 0.1 * Math.sin(game.time * 8); m[0] = m[10] = pulse; gl.uniformMatrix4fv(p.u.u_model, false, m); glx.draw(world.tpRing); glx.draw(world.tpDisc); }
  }
  // ball finder light pillar (visible across the course)
  if (game.ballGlow && game.ball && game.ball.atRest) {
    M4.identity(m); m[12] = game.ball.p[0]; m[13] = game.ball.p[1]; m[14] = game.ball.p[2];
    const d = V3.dist(cp, game.ball.p); const s = clamp(d / 25, 0.6, 6); m[0] = m[10] = s;
    gl.uniformMatrix4fv(p.u.u_model, false, m); gl.uniform4f(p.u.u_color, 1, 1, 1, 0.35 + 0.15 * Math.sin(game.time * 4)); glx.draw(world.pillarMesh);
  }
  // putting aim line (straight alignment aid)
  if (game.settings.aimLine && game.ball && game.ball.atRest && game.hole && game.clubs.club.type === 'putter' && game.state === 'playing') {
    const b = game.ball.p, c = game.hole.cupPos; const d = V3.norm([0, 0, 0], [c[0] - b[0], 0, c[2] - b[2]]); const L = Math.min(2.0, game.distToPin());
    const line = []; for (let i = 0; i <= 20; i++) { const x = b[0] + d[0] * L * i / 20, z = b[2] + d[2] * L * i / 20; line.push([x, game.course.height(x, z) + 0.004, z]); }
    const cnt = world.buildRibbon(line, [b[0], b[1] + 50, b[2]], () => 0.006, world.arcPos, world.arcCol, t => [255, 255, 255, Math.round(120 * (1 - t))]);
    glx.updateDyn(world.arcMesh, world.arcPos, null, world.arcCol, cnt); gl.uniformMatrix4fv(p.u.u_model, false, M4.identity(m)); gl.uniform4f(p.u.u_color, 1, 1, 1, 1); glx.draw(world.arcMesh);
  }
  gl.depthMask(true); gl.disable(gl.BLEND);
}

function drawPanels(vp, cp, noWorld) {
  const game = APP.game, gl = APP.gl, glx = APP.glx, P = APP.P;
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
  const p = glx.use(P.ui); gl.uniformMatrix4fv(p.u.u_viewProj, false, vp);
  for (const pass of [false, true]) {
    if (pass) gl.disable(gl.DEPTH_TEST); else gl.enable(gl.DEPTH_TEST);
    for (const panel of game.ui.panels) {
      if (!panel.visible || !panel.tex || !!panel.overlay !== pass) continue;
      if (noWorld && !panel.overlay) continue;
      gl.uniformMatrix4fv(p.u.u_model, false, panel.matrix); gl.uniform1f(p.u.u_opacity, panel.opacity); glx.tex(p, 'u_tex', panel.tex); glx.draw(panel.mesh);
    }
  }
  // laser pointers
  const u = glx.use(P.unlit); gl.uniformMatrix4fv(u.u.u_viewProj, false, vp);
  for (const hand of ['left', 'right']) {
    const ptr = game.ui.pointers[hand]; if (!ptr || game.desktop) continue;
    const z = V3.scale([0, 0, 0], ptr.dir, -1); const x = V3.norm([0, 0, 0], V3.cross([0, 0, 0], [0, 1, 0], z)); const y = V3.cross([0, 0, 0], z, x);
    const m = M4.fromBasis(M4.new(), ptr.origin, x, y, z, 1); m[8] *= ptr.t; m[9] *= ptr.t; m[10] *= ptr.t;
    gl.uniformMatrix4fv(u.u.u_model, false, m); gl.uniform4f(u.u.u_color, 1, 1, 1, 0.9); glx.draw(game.ui.beam);
  }
  gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.BLEND);
}

function drawOverlays(vp, cp, camMat) {
  const game = APP.game, gl = APP.gl, glx = APP.glx, P = APP.P; const pl = game.player;
  const world = game.world; if (!world && pl.fade < 0.01) return;
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
  const u = glx.use(P.unlit); gl.uniformMatrix4fv(u.u.u_viewProj, false, vp);
  if (world && pl.vignette > 0.02 && !game.desktop) { gl.uniformMatrix4fv(u.u.u_model, false, camMat); gl.uniform4f(u.u.u_color, 1, 1, 1, pl.vignette); glx.draw(world.vignetteMesh); }
  if (world && pl.fade > 0.01) { const m = M4.copy(M4.new(), camMat); for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) m[i] *= 0.5; gl.uniformMatrix4fv(u.u.u_model, false, m); gl.uniform4f(u.u.u_color, 1, 1, 1, pl.fade); glx.draw(world.fadeMesh); }
  gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.BLEND);
}

// ball visual rotation integrates its spin vector each frame
function updateBallRot(dt) {
  const b = APP.game.ball; if (!b || !b.moving) return;
  const w = b.w; const wl = V3.len(w); if (wl < 0.01) return;
  const r = M4.rotAxis(M4.new(), [w[0] / wl, w[1] / wl, w[2] / wl], wl * dt);
  M4.mul(APP.ballRot, r, APP.ballRot); APP.ballRot[12] = APP.ballRot[13] = APP.ballRot[14] = 0;
}
const _gameUpdate = Game.prototype.update;
Game.prototype.update = function (dt) { _gameUpdate.call(this, dt); updateBallRot(dt); };

// ------------------------------------------------------------------ landing page (2D)
function showLanding() {
  document.getElementById('landing').style.display = 'flex'; document.getElementById('help').style.display = 'none';
  APP.landingT = performance.now(); requestAnimationFrame(drawLandingLogo);
  refreshLandingText();
}
function hideLanding() { document.getElementById('landing').style.display = 'none'; }
function refreshLandingText() {
  document.getElementById('btn-vr').textContent = T('enter_vr');
  document.getElementById('btn-desktop').textContent = T('play_desktop');
  document.getElementById('dev').textContent = T('developed_by');
  document.getElementById('lang-toggle').textContent = LANG === 'en' ? 'RU' : 'EN';
  const note = document.getElementById('note'); note.textContent = APP.vrSupported ? T('vr_hint') : T('vr_unsupported');
  document.getElementById('btn-vr').style.display = APP.vrSupported ? 'block' : 'none';
}
function drawLandingLogo() {
  const el = document.getElementById('landing'); if (el.style.display === 'none') return;
  const c = document.getElementById('logo'); const ctx = c.getContext('2d'); const dpr = Math.min(devicePixelRatio, 2);
  const w = c.clientWidth * dpr, h = c.clientHeight * dpr; if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  ctx.clearRect(0, 0, w, h); const t = (performance.now() - APP.landingT) / 1000; const s = Math.min(w / 900, h / 420);
  drawFutonLogo(ctx, w / 2 + 40 * s, h * 0.3, 92 * s, clamp(t / 1.5, 0, 1));
  ctx.globalAlpha = clamp((t - 1.2) / 0.8, 0, 1); drawGameTitle(ctx, w / 2, h * 0.72, 84 * s, 1); ctx.globalAlpha = 1;
  if (t < 4) requestAnimationFrame(drawLandingLogo);
}

async function main() {
  try { initGL(); } catch (e) { document.getElementById('note').textContent = 'WebGL2 error: ' + e.message; console.error(e); return; }
  APP.vrSupported = !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-vr').catch(() => false));
  document.getElementById('btn-vr').onclick = () => startXR().catch(e => { console.error(e); alert('VR: ' + e.message); });
  document.getElementById('btn-desktop').onclick = () => startDesktop();
  document.getElementById('lang-toggle').onclick = () => { APP.game.set('lang', LANG === 'en' ? 'ru' : 'en'); refreshLandingText(); };
  showLanding();
  // Installed Meta Quest PWA (immersive package): launch straight into VR like a native app
  const installed = 'getDigitalGoodsService' in window || window.matchMedia('(display-mode: standalone)').matches;
  if (APP.vrSupported && (installed || /[?&]autoxr=1/.test(location.search))) {
    if (navigator.xr.addEventListener) navigator.xr.addEventListener('sessiongranted', () => { if (!APP.xr) startXR().catch(console.error); });
    setTimeout(() => { if (!APP.xr) startXR().catch(e => console.warn('auto XR needs a click:', e.message)); }, 250);
  }
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
}

// ------------------------------------------------------------------ test / debug API
window.FG = {
  APP,
  util: { inv: a => M4.invert(M4.new(), a), mul: (a, b) => M4.mul(M4.new(), a, b), cross: (a, b) => V3.cross([0, 0, 0], a, b), norm: a => V3.norm([0, 0, 0], a), rot: (ax, a) => M4.rotAxis(M4.new(), ax, a), tdir: (m, v) => M4.transformDir([0, 0, 0], m, v), tp: (m, v) => M4.transformPoint([0, 0, 0], m, v) },
  get game() { return APP.game; },
  async desktop() { startDesktop(); },
  step(dt = 1 / 60, n = 1) { for (let i = 0; i < n; i++) desktopStep(dt); },
  async waitState(s, ms = 60000) { const t0 = performance.now(); while (APP.game.state !== s && performance.now() - t0 < ms) await sleep(50); return APP.game.state; },
  view(pos, yaw, pitch) { const d = APP.game.desktopCtl; const P = APP.game.player; P.pos[0] = pos[0]; P.pos[2] = pos[2]; P.smoothY = null; if (pos[1] !== undefined) d.height = pos[1]; d.yaw = yaw; d.pitch = pitch; },
  // simulate a real club impact through the full impact model
  shot(clubIdx, headSpeed, attackDeg = -3, pathDeg = 0, faceDeg = 0) {
    const g = APP.game; const b = g.ball; const club = CLUBS[clubIdx]; g.clubs.setClub(clubIdx, true);
    const tgt = g.aimTarget(); const t = V3.norm([0, 0, 0], [tgt[0] - b.p[0], 0, tgt[2] - b.p[2]]); const yaw0 = Math.atan2(t[0], t[2]);
    const a = deg(attackDeg), p = yaw0 + deg(pathDeg), f = yaw0 + deg(faceDeg);
    const v = [Math.sin(p) * Math.cos(a) * headSpeed, Math.sin(a) * headSpeed, Math.cos(p) * Math.cos(a) * headSpeed];
    const face0 = [Math.sin(f), 0, Math.cos(f)], sole = [Math.cos(f), 0, -Math.sin(f)];
    const surf = g.course.surface(b.p[0], b.p[2]); const lie = b.teeHeight > 0 ? [1, 1] : SURF_PHYS[surf].lie;
    const res = ClubImpact.compute(club, v, face0, [0, 1, 0], sole, 0, 0, lie, {});
    g.onImpact(res, b.p, surf, false); AUDIO.impact(club.type === 'putter' ? 'putter' : club.type === 'wood' ? 'wood' : 'iron', 0.8, b.p);
    return res;
  },
  simulateUntilRest(maxS = 40) { const g = APP.game; let t = 0; while (g.ball.moving && t < maxS) { g.update(1 / 60); t += 1 / 60; } return { t, state: g.ball.state, pos: g.ball.p.slice() }; },
};

window.addEventListener('load', main);
