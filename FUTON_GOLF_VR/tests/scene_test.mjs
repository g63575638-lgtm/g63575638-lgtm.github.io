import { chromium } from '/usr/local/lib/node_modules_global/playwright/index.mjs';
import fs from 'fs';
const shots = process.argv[2] || '/tmp/shots'; const maps = (process.argv[3] || '0').split(',').map(Number); const extra = process.argv[4] || '';
fs.mkdirSync(shots, { recursive: true });
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
p.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 1500)); if (m.text().startsWith('LOG')) console.log(m.text()); });
p.on('pageerror', e => errors.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '').slice(0, 900)));
await p.addInitScript(() => { window.__FG_TEST = true; });
await p.goto('http://localhost:8765/index.html');
await p.waitForTimeout(500);
await p.evaluate(() => FG.desktop());
await p.evaluate(() => FG.waitState('menu', 90000));
await p.waitForTimeout(1200);
await p.screenshot({ path: `${shots}/menu.png` });
for (const mi of maps) {
  await p.evaluate((mi) => { FG.game.settings.map = mi; FG.game.startRound('stroke'); }, mi);
  await p.evaluate(() => FG.waitState('playing', 90000));
  await p.waitForTimeout(3500);
  await p.screenshot({ path: `${shots}/m${mi}_tee.png` });
  // look down the fairway from behind the tee
  await p.evaluate(() => { const g = FG.game, h = g.hole; const d = h.dir0; g.desktopCtl.pitch = -0.08; FG.view([h.tee[0] - d[0] * 8, 1.75, h.tee[1] - d[2] * 8], Math.atan2(-d[0], -d[2]), -0.06); });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${shots}/m${mi}_fairway.png` });
  const info = await p.evaluate(() => { const r = FG.shot(0, 44, 3, 0, 0); return JSON.stringify({ bs: r.ballSpeed.toFixed(1), launch: r.launch.toFixed(1), rpm: r.rpm | 0 }); });
  console.log('map', mi, 'driver', info);
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `${shots}/m${mi}_flight.png` });
  const rest = await p.evaluate(() => { const r = FG.simulateUntilRest(); const g = FG.game; return JSON.stringify({ t: r.t.toFixed(1), state: r.state, dist: g.shotInfo ? g.shotInfo.total.toFixed(1) : null, carry: g.shotInfo ? g.shotInfo.carry.toFixed(1) : null, strokes: g.strokes }); });
  console.log('map', mi, 'rest', rest);
  await p.evaluate(() => FG.game.goToBall(true));
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${shots}/m${mi}_ball.png` });
  // view toward the green from 30 m
  await p.evaluate(() => { const g = FG.game, c = g.hole.cupPos, a = g.hole.appr; FG.view([c[0] - a[0] * 25, 1.7, c[2] - a[2] * 25], Math.atan2(-a[0], -a[2]), -0.12); });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${shots}/m${mi}_green.png` });
  // sky view
  await p.evaluate(() => { FG.game.desktopCtl.pitch = 0.5; });
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${shots}/m${mi}_sky.png` });
  if (extra.includes('pause')) { await p.evaluate(() => FG.game.togglePause()); await p.waitForTimeout(1200); await p.screenshot({ path: `${shots}/m${mi}_pause.png` }); await p.evaluate(() => FG.game.togglePause()); }
  console.log('frame stats', await p.evaluate(() => JSON.stringify(FG.APP.glx.stats)));
}
console.log(errors.slice(0, 10).join('\n') || 'no console errors');
await b.close();
