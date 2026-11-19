const { load } = require('./harness');
const E = load(['00_math.js', '02_gl.js', '04_geometry.js', '05_terrain.js', '06_maps.js', '07_physics.js']);
const { V3, CLUBS, ClubImpact, BallPhysics, SURF, SURF_PHYS, deg } = E;
function flatCourse(surfFn, slope = [0, 0]) {
  return { def: { airDensity: 1.225 }, half: 2000, height: (x, z) => x * slope[0] + z * slope[1],
    normal: (x, z, o) => { o = o || [0,0,0]; const l = Math.hypot(slope[0], 1, slope[1]); o[0] = -slope[0]/l; o[1] = 1/l; o[2] = -slope[1]/l; return o; },
    surface: surfFn || (() => SURF.FAIRWAY), waterLevelAt: () => -1e9, inBounds: () => true, nearbyObstacles: (x, z, o) => { o.length = 0; return o; } };
}
function shot(clubId, headSpeed, attackDeg, pathDeg = 0, faceDeg = 0, surfFn, off = 0) {
  const club = CLUBS.find(c => c.id === clubId);
  const a = deg(attackDeg), p = deg(pathDeg), f = deg(faceDeg);
  const vh = [Math.cos(a) * Math.cos(p) * headSpeed, Math.sin(a) * headSpeed, Math.cos(a) * Math.sin(p) * headSpeed];
  const face0 = [Math.cos(f), 0, Math.sin(f)]; const up = [0, 1, 0]; const sole = [-Math.sin(f), 0, Math.cos(f)];
  const r = ClubImpact.compute(club, vh, face0, up, sole, off, 0, [1, 1], {});
  const b = new BallPhysics(flatCourse(surfFn)); b.placeAt(0, 0, clubId === 'driver' ? 0.03 : 0);
  b.launch(r.v, r.w); let carry = null, apex = 0, t = 0;
  while (b.moving && t < 60) { b.update(1 / 72); t += 1 / 72; apex = Math.max(apex, b.p[1]); if (!carry && b.firstLand) carry = Math.hypot(b.firstLand[0], b.firstLand[2]); }
  const total = Math.hypot(b.p[0], b.p[2]);
  console.log(`${clubId.padEnd(6)} head ${headSpeed} att ${attackDeg} | ball ${r.ballSpeed.toFixed(1)} m/s smash ${r.smash.toFixed(2)} launch ${r.launch.toFixed(1)}° spin ${r.rpm.toFixed(0)} rpm | carry ${(carry||0).toFixed(1)} m apex ${apex.toFixed(1)} m total ${total.toFixed(1)} m side ${b.p[2].toFixed(1)} t=${t.toFixed(1)}s`);
  return { carry, total, side: b.p[2] };
}
console.log('--- full swings (fairway landing)');
shot('driver', 45, 3); shot('driver', 40, 2); shot('wood3', 42, 0); shot('hybrid', 39, -2); shot('iron5', 38, -3); shot('iron7', 35, -4); shot('iron9', 33, -4.5); shot('pw', 32, -5); shot('sw', 28, -5);
console.log('--- green landing (check)'); shot('pw', 32, -5, 0, 0, (x) => x > 90 ? SURF.GREEN : SURF.FAIRWAY); shot('sw', 26, -5, 0, 0, () => SURF.GREEN);
console.log('--- face/path: open face 4° (fade/slice), closed 4° (draw)'); shot('iron7', 35, -4, 0, 4); shot('iron7', 35, -4, 0, -4); shot('driver', 45, 3, -3, 0);
console.log('--- toe hit driver 2cm'); shot('driver', 45, 3, 0, 0, null, 0.02);
console.log('--- rough'); shot('iron7', 35, -4, 0, 0, () => SURF.ROUGH);
console.log('--- putts on green (stimp check: 1.83 m/s release should roll ~3 m)');
for (const vs of [1.83]) { const b = new BallPhysics(flatCourse(() => SURF.GREEN)); b.placeAt(0, 0); b.launch([vs, 0, 0], [0, 0, -vs / 0.02135]); let t = 0; while (b.moving && t < 30) { b.update(1/72); t += 1/72; } console.log(`roll release ${vs} m/s -> ${b.p[0].toFixed(2)} m in ${t.toFixed(1)} s`); }
for (const hs of [0.5, 1.0, 1.5, 2.0, 2.5]) shot('putter', hs, 0, 0, 0, () => SURF.GREEN);
console.log('--- cup capture test (straight putts at cup 3 m away, various speeds)');
for (const vs of [0.6, 1.0, 1.4, 1.6, 1.8, 2.0, 2.4]) for (const offs of [0, 0.03]) {
  const c = flatCourse(() => SURF.GREEN); const b = new BallPhysics(c); b.placeAt(0, 0);
  b.hole = { cupPos: [1.5, 0, offs], flagIn: false };
  b.launch([vs, 0, 0], [0, 0, -vs / 0.02135]); let t = 0; while (b.moving && t < 30) { b.update(1/72); t += 1/72; }
  const ev = b.events.map(e => e.type).filter(x => ['holed','rim','cupWall','cupBottom'].includes(x));
  console.log(`speed ${vs} off ${offs}: state ${b.state} holed ${b.holed} pos ${b.p.map(v=>v.toFixed(2))} events ${[...new Set(ev)]}`);
}
console.log('--- slope roll (2% downhill green, ball released 0.5 m/s)');
{ const b = new BallPhysics(flatCourse(() => SURF.GREEN, [-0.02, 0])); b.placeAt(0, 0); b.launch([0.5, 0, 0], [0,0,-0.5/0.02135]); let t=0; while (b.moving && t < 60) { b.update(1/72); t+=1/72; } console.log('roll', b.p[0].toFixed(2), 'state', b.state, t.toFixed(1)); }
