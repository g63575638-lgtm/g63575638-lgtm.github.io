import { chromium } from '/usr/local/lib/node_modules_global/playwright/index.mjs';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 640, height: 360 } });
p.on('pageerror', e => console.log('ERR', e.message));
await p.addInitScript(() => { window.__FG_TEST = true; });
await p.goto('http://localhost:8766/index.html'); await p.waitForTimeout(300);
await p.evaluate(() => FG.desktop()); await p.evaluate(() => FG.waitState('menu', 90000));
for (const mi of [0, 1, 2]) {
  await p.evaluate((mi) => { FG.game.settings.map = mi; FG.game.startRound('stroke'); }, mi);
  await p.evaluate(() => FG.waitState('playing', 90000)); await p.waitForTimeout(1500);
  for (const where of ['tee', 'mid']) {
    const r = await p.evaluate((where) => {
      const g = FG.game, h = g.hole; let pos;
      if (where === 'tee') { const d = h.dir0; FG.view([h.tee[0] - d[0] * 3, 1.7, h.tee[1] - d[2] * 3], Math.atan2(-d[0], -d[2]), -0.05); }
      else { const q = g.course.pointAlong(h.path, 0.55); FG.view([q[0], 1.7, q[1]], Math.atan2(-q[2], -q[3]), -0.05); }
      // emulate a wide VR eye FOV by measuring at 100 deg: approximate using the desktop projection (68 deg) -> report raw
      FG.step(1 / 60, 3); const s = FG.APP.glx.stats; const pr = g.world.prof; const out = { draws: s.draws, tris: s.tris };
      for (const k in pr) out[k] = Math.round(pr[k] / 1000) + 'k';
      return JSON.stringify(out);
    }, where);
    console.log('map', mi, where, r);
  }
}
await b.close();
