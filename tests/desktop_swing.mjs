import { chromium } from '/usr/local/lib/node_modules_global/playwright/index.mjs';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 640, height: 360 } }); const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.addInitScript(() => { window.__FG_TEST = true; });
await p.goto('http://localhost:8766/index.html'); await p.waitForTimeout(300);
await p.evaluate(() => FG.desktop()); await p.evaluate(() => FG.waitState('menu', 90000));
await p.evaluate(() => FG.game.startRound('practice')); await p.evaluate(() => FG.waitState('playing', 90000));
for (const club of [4, 8]) {
  const r = await p.evaluate(async (club) => {
    const g = FG.game, m = g.input.mouse; g.ball.placeAt(g.hole.tee[0], g.hole.tee[1], 0.028); g.ball.events.length = 0; g.clubs.lastImpact = null; g.clubs.setClub(club, true); g.goToBall(true);
    await new Promise(r => setTimeout(r, 120)); FG.step(1 / 60, 20); const phantom = g.ball.moving; g.settings.autoClub = false;
    m.down = true; const back = club === 8 ? -6 : -14, fwd = club === 8 ? 9 : 34;
    for (let i = 0; i < 14; i++) { m.dy = back; FG.step(1 / 60); }
    let hit = false; for (let i = 0; i < 30 && !hit; i++) { m.dy = fwd; FG.step(1 / 60); hit = g.ball.moving; }
    m.down = false; for (let i = 0; i < 5; i++) FG.step(1 / 60);
    const res = g.clubs.lastImpact; const out = FG.simulateUntilRest();
    return { phantom, club: g.clubs.club.id, hit, head: res && res.headSpeed.toFixed(1), ball: res && res.ballSpeed.toFixed(1), launch: res && res.launch.toFixed(1), total: g.shotInfo && g.shotInfo.total.toFixed(1) };
  }, club);
  console.log(JSON.stringify(r));
}
console.log(errs.join('\n') || 'no errors'); await b.close();
