import { chromium } from '/usr/local/lib/node_modules_global/playwright/index.mjs';
import fs from 'fs';
const out = process.argv[2] || '/tmp/pages'; fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1100, height: 690 } });
const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await p.addInitScript(() => { window.__FG_TEST = true; });
await p.goto('http://localhost:8766/index.html'); await p.waitForTimeout(300);
await p.evaluate(() => FG.desktop()); await p.evaluate(() => FG.waitState('menu', 90000));
// render the menu panel canvas directly (crisp) for each page
const dump = async (name) => { const d = await p.evaluate(() => { const P = FG.game.menuPanel; P.pageT = 5; P.redraw(); return P.canvas.toDataURL(); }); fs.writeFileSync(`${out}/${name}.png`, Buffer.from(d.split(',')[1], 'base64')); };
for (const lang of ['en', 'ru']) {
  await p.evaluate((l) => FG.game.set('lang', l), lang);
  for (const page of ['main', 'play', 'maps', 'credits']) { await p.evaluate((pg) => FG.game.go(pg), page); await dump(`${lang}_${page}`); }
  for (const tab of [0, 1, 2, 3, 4]) { await p.evaluate((t) => { FG.game.settingsTab = t; FG.game.go('settings'); }, tab); await dump(`${lang}_settings${tab}`); }
}
// in-round panels
await p.evaluate(() => FG.game.set('lang', 'ru'));
await p.evaluate(() => FG.game.startRound('stroke')); await p.evaluate(() => FG.waitState('playing', 90000)); await p.waitForTimeout(500);
await p.evaluate(() => { FG.shot(0, 44, 3); FG.simulateUntilRest(); });
const panels = await p.evaluate(() => { const g = FG.game; const res = {}; for (const P of [g.wristPanel, g.signPanel, g.toastPanel, g.pinPanel]) { P.setPage(P.draw); P.pageT = 5; P.redraw(); res[P.name] = P.canvas.toDataURL(); } return res; });
for (const k in panels) fs.writeFileSync(`${out}/panel_${k}.png`, Buffer.from(panels[k].split(',')[1], 'base64'));
await p.evaluate(() => { const g = FG.game; g.round.holes[0].strokes = 4; g.round.holes[0].done = true; g.round.holes[1].strokes = 2; g.round.holes[1].done = true; g.holeIndex = 1; g.go('holeEnd'); });
await dump('ru_holeEnd');
await p.evaluate(() => { const g = FG.game; g.togglePause(); g.state = 'paused'; g.go('pause'); }); await dump('ru_pause');
console.log(errors.join('\n') || 'no errors'); await b.close();
