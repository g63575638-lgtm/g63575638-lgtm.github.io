import { chromium } from '/usr/local/lib/node_modules_global/playwright/index.mjs';
import fs from 'fs';
const out = process.argv[2] || '/tmp/show'; fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } }); const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.addInitScript(() => { window.__FG_TEST = true; });
await p.goto('http://localhost:8766/index.html'); await p.waitForTimeout(300);
await p.evaluate(() => FG.desktop()); await p.evaluate(() => FG.waitState('menu', 90000));
const views = [
  [1, 'coast_ocean', [-226, 1.7, -46], 2.04, -0.07],
  [1, 'coast_hole2', [-232, 1.7, -60], Math.PI + 0.12, -0.03],
  [0, 'valley_lake', [-150, 1.7, 10], Math.PI * 0.8, -0.08],
  [0, 'valley_green', [-200, 1.7, 40], Math.PI * 0.95, -0.2],
  [2, 'mountain_lake', [-60, 22, -60], -Math.PI * 0.74, -0.35],
  [2, 'mountain_chalet', [-300, 1.7, -300], Math.PI * 0.25, 0.02],
];
let cur = -1;
for (const [mi, name, pos, yaw, pitch] of views) {
  if (mi !== cur) { await p.evaluate((mi) => { FG.game.settings.map = mi; FG.game.startRound('practice'); }, mi); await p.evaluate(() => FG.waitState('playing', 90000)); cur = mi; await p.evaluate(() => { FG.game.toastPanel.hide(); FG.game.hintPanel.hide(); FG.game.pinPanel.hide(); }); }
  await p.evaluate(([pos, yaw, pitch]) => { FG.view(pos, yaw, pitch); FG.game.settings.pinMarker = false; }, [pos, yaw, pitch]);
  await p.waitForTimeout(2200);
  await p.screenshot({ path: `${out}/${name}.png` });
}
console.log(errs.join('\n') || 'no errors'); await b.close();
