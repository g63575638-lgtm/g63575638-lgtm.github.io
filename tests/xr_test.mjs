import { chromium } from '/usr/local/lib/node_modules_global/playwright/index.mjs';
import fs from 'fs';
const shots = process.argv[2] || '/tmp/xr'; fs.mkdirSync(shots, { recursive: true });
const mock = fs.readFileSync('/home/claude/futon/tests/xr_mock.js', 'utf8');
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 960, height: 480 } });
const errors = []; p.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 1200)); if (m.text().startsWith('LOG')) console.log(m.text()); });
p.on('pageerror', e => errors.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '').slice(0, 900)));
await p.addInitScript(() => { window.__FG_TEST = true; }); await p.addInitScript(mock);
await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(800);
const vrVisible = await p.evaluate(() => getComputedStyle(document.getElementById('btn-vr')).display);
console.log('ENTER VR button display:', vrVisible);
await p.click('#btn-vr');
// pump XR frames until menu
const tick = async (state, ms = 120000) => p.evaluate(async ([state, ms]) => { const t0 = performance.now(); while (FG.game.state !== state && performance.now() - t0 < ms) { __xrTick(1 / 72); await new Promise(r => setTimeout(r, 8)); } return FG.game.state; }, [state, ms]);
console.log('state:', await tick('menu'));
await p.evaluate(async () => { for (let i = 0; i < 90; i++) { __xrTick(1 / 72); await new Promise(r => setTimeout(r, 5)); } });
await p.screenshot({ path: shots + '/xr_menu.png' });
// ---- point the right controller at a menu button and pull the trigger
const press = async (regionId, hand = 'right') => p.evaluate(async ([regionId, hand]) => {
  const g = FG.game, P = g.menuPanel; const r = P.regions.find(r => r.id === regionId); if (!r) return 'no region ' + regionId + ' in ' + P.regions.map(r => r.id).join(',');
  const m = P.matrix; const sx = Math.hypot(m[0], m[1], m[2]);
  const lx = ((r.x + r.w / 2) / P.pxW - 0.5) * P.mW, ly = (0.5 - (r.y + r.h / 2) / P.pxH) * P.mH;
  const target = [m[12] + m[0] / sx * lx + m[4] / sx * ly, m[13] + m[1] / sx * lx + m[5] / sx * ly, m[14] + m[2] / sx * lx + m[6] / sx * ly];
  // controller pose in reference space: place hand 0.4 m in front-right of the head, -Z toward the target (world -> ref via inverse rig)
  const rigInv = FG.APP.game.player.rig.slice ? null : null;
  const Minv = new Float32Array(16); { const M = g.player.rig; const inv = (o, a) => { /* reuse engine */ }; }
  const invRig = (() => { const o = new Float32Array(16); FG.APP.glx; const M4i = window.__M4inv; return null; })();
  const head = g.player.headPos; const hw = [head[0] + 0.15, head[1] - 0.3, head[2]];
  const z = [hw[0] - target[0], hw[1] - target[1], hw[2] - target[2]]; const zl = Math.hypot(...z); z[0] /= zl; z[1] /= zl; z[2] /= zl;
  let x = [z[2], 0, -z[0]]; const xl = Math.hypot(...x); x = x.map(v => v / xl); const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  const world = new Float32Array([x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, hw[0], hw[1], hw[2], 1]);
  const ref = FG.util.mul(FG.util.inv(g.player.rig), world);
  __XR.hands[hand].m = ref;
  for (let i = 0; i < 4; i++) { __xrTick(1 / 72); await new Promise(r => setTimeout(r, 5)); }
  const hov = P.hoverId; __setBtn(hand, 0, 1); __xrTick(1 / 72); __setBtn(hand, 0, 0); __xrTick(1 / 72);
  return 'hover=' + hov;
}, [regionId, hand]);
console.log('press menu_play ->', await press('menu_play'), 'page:', await p.evaluate(() => FG.game.menuPage));
await p.evaluate(async () => { for (let i = 0; i < 40; i++) { __xrTick(1 / 72); await new Promise(r => setTimeout(r, 5)); } });
await p.screenshot({ path: shots + '/xr_modes.png' });
console.log('press mode_stroke ->', await press('mode_stroke'));
console.log('state:', await tick('playing'));
await p.evaluate(async () => { for (let i = 0; i < 60; i++) { __xrTick(1 / 72); await new Promise(r => setTimeout(r, 5)); } });
console.log('club held by:', await p.evaluate(() => FG.game.clubs.held), 'club:', await p.evaluate(() => FG.game.clubs.club.id));
await p.screenshot({ path: shots + '/xr_address.png' });
// ---- scripted physical swing (7-iron) through the ball
const swing = await p.evaluate(async () => {
  const g = FG.game; g.clubs.setClub(4, true); const U = FG.util; const club = g.clubs.club; const col = club.col;
  const ball = g.ball.p.slice(); const tgt = g.aimTarget(); let t = [tgt[0] - ball[0], 0, tgt[2] - ball[2]]; const tl = Math.hypot(t[0], t[2]); t = [t[0] / tl, 0, t[2] / tl];
  const toBall = [-t[2], 0, t[0]]; // golfer faces the ball; target on the golfer's left for a right-hander: toBall = cross(t, up)
  const dn = U.norm([toBall[0] * 0.62, -1, toBall[2] * 0.62]);
  // club frame at address: -Z shaft (hands->head), -X face normal -> target, +Y toe
  const X = [-t[0], 0, -t[2]], Z = [-dn[0], -dn[1], -dn[2]], Y = U.cross(Z, X);
  const R = (v) => [X[0] * v[0] + Y[0] * v[1] + Z[0] * v[2], X[1] * v[0] + Y[1] * v[1] + Z[1] * v[2], X[2] * v[0] + Y[2] * v[1] + Z[2] * v[2]];
  const sw = R(col.sweet); const headTarget = [ball[0] - t[0] * 0.03, ball[1] - 0.004, ball[2] - t[2] * 0.03];
  const o = [headTarget[0] - sw[0], headTarget[1] - sw[1], headTarget[2] - sw[2]];
  const pivot = [o[0] - toBall[0] * 0.25, o[1] + 0.45, o[2] - toBall[2] * 0.25];
  const axis = U.norm(U.cross(dn, t)); // rotation axis of the swing plane
  const clubAt = (ang) => { // rotate address frame about pivot
    const rot = U.rot(axis, ang); const Xr = U.tdir(rot, X), Yr = U.tdir(rot, Y), Zr = U.tdir(rot, Z);
    const rel = [o[0] - pivot[0], o[1] - pivot[1], o[2] - pivot[2]]; const rr = U.tdir(rot, rel);
    return new Float32Array([Xr[0], Xr[1], Xr[2], 0, Yr[0], Yr[1], Yr[2], 0, Zr[0], Zr[1], Zr[2], 0, pivot[0] + rr[0], pivot[1] + rr[1], pivot[2] + rr[2], 1]);
  };
  const setHand = (m) => { __XR.hands.right.m = U.mul(U.inv(g.player.rig), m); };
  // sign of rotation: positive angle should move the head toward the target
  const h0 = U.tp(clubAt(0), col.sweet), h1 = U.tp(clubAt(0.1), col.sweet); const sgn = ((h1[0] - h0[0]) * t[0] + (h1[2] - h0[2]) * t[2]) > 0 ? 1 : -1;
  const fps = 72, frames = []; let a = 0;
  // backswing 0.8 s to -1.9 rad, pause, downswing accelerating to ~24 rad/s at impact, follow-through
  for (let i = 0; i < 58; i++) frames.push(-1.9 * Math.sin((i / 57) * Math.PI / 2));
  for (let i = 0; i < 6; i++) frames.push(-1.9);
  const T = 0.26; for (let i = 1; i <= Math.round(T * fps) + 12; i++) { const tt = i / fps; const ang = -1.9 + 1.9 * Math.pow(Math.min(tt / T, 1.6), 2.2); frames.push(Math.min(ang, 1.6)); }
  let hitFrame = -1;
  for (let i = 0; i < frames.length; i++) { setHand(clubAt(sgn * frames[i])); __xrTick(1 / fps); if (hitFrame < 0 && g.ball.moving) hitFrame = i; await new Promise(r => setTimeout(r, 1)); }
  const res = g.clubs.lastImpact;
  return { hitFrame, frames: frames.length, strokes: g.strokes, state: g.ball.state, res: res && { head: res.headSpeed.toFixed(1), ball: res.ballSpeed.toFixed(1), launch: res.launch.toFixed(1), rpm: res.rpm | 0, off: (res.offCenter * 100).toFixed(1) + 'cm' } };
});
console.log('SWING:', JSON.stringify(swing));
await p.evaluate(async () => { for (let i = 0; i < 25; i++) { __xrTick(1 / 72); await new Promise(r => setTimeout(r, 5)); } });
await p.screenshot({ path: shots + '/xr_after_swing.png' });
const rest = await p.evaluate(async () => { const g = FG.game; let n = 0; while (g.ball.moving && n < 72 * 40) { g.ball.update(1 / 72); g.handleBallEvents(); n++; } __xrTick(1 / 72); return { s: n / 72, state: g.ball.state, info: g.shotInfo && { total: g.shotInfo.total.toFixed(1), carry: g.shotInfo.carry.toFixed(1) } }; });
console.log('REST:', JSON.stringify(rest));
// ---- drop the club (release grip), check it falls, then re-grab via recall (hold grip)
const drop = await p.evaluate(async () => {
  const g = FG.game; __setBtn('right', 1, 1); __xrTick(1 / 72); __setBtn('right', 1, 0);
  for (let i = 0; i < 40; i++) { __xrTick(1 / 72); await new Promise(r => setTimeout(r, 1)); }
  const lying = g.clubs.free && !g.clubs.held; const headY = U_y();
  function U_y() { const hp = g.clubs.headPos(); return (hp[1] - g.course.height(hp[0], hp[2])).toFixed(3); }
  // move the hand away and hold grip for recall
  __XR.hands.right.m = null; __XR.hands.right.pos = [0.3, 1.1, -0.2]; __setBtn('right', 1, 1);
  for (let i = 0; i < 70; i++) { __xrTick(1 / 72); await new Promise(r => setTimeout(r, 1)); }
  return { lying, headAboveGround: headY, heldAfterRecall: g.clubs.held };
});
console.log('DROP/RECALL:', JSON.stringify(drop));
// ---- pause with left Y
const pause = await p.evaluate(async () => { const g = FG.game; __setBtn('left', 5, 1); __xrTick(1 / 72); __setBtn('left', 5, 0); for (let i = 0; i < 30; i++) { __xrTick(1 / 72); await new Promise(r => setTimeout(r, 2)); } return g.state + '/' + g.menuPage; });
console.log('PAUSE:', pause);
await p.screenshot({ path: shots + '/xr_pause.png' });
console.log(errors.slice(0, 10).join('\n') || 'no console errors');
await b.close();
