const { load } = require('./harness');
const E = load(['00_math.js', '02_gl.js', '04_geometry.js', '05_terrain.js', '06_maps.js']);
(async () => {
  for (const def of E.MAPS) {
    const c = new E.Course(def, {});
    const t = Date.now();
    await c.generate();
    const counts = new Array(11).fill(0); for (const s of c.surfT) counts[s]++;
    console.log(`\n== ${def.id}: gen ${Date.now() - t} ms, heights ${Math.min(...c.H.slice(0, 1e5)).toFixed(1)}..`);
    console.log('surface %:', E.SURF_NAMES.map((n, i) => n + ' ' + (100 * counts[i] / c.surfT.length).toFixed(1)).join(', '));
    console.log('lakes:', c.lakes.map(l => `(${l.x},${l.z}) lvl ${l.level.toFixed(1)}`).join(' '));
    for (const h of c.holes) {
      const st = E.SURF_NAMES[c.surface(h.tee[0], h.tee[1])], sg = E.SURF_NAMES[c.surface(h.cup[0], h.cup[1])];
      // sample along path for water
      let water = 0; for (let k = 0; k <= 50; k++) { const p = c.pointAlong(h.path, k / 50); if (c.surface(p[0], p[1]) === E.SURF.WATER) water++; }
      console.log(` hole ${h.index + 1} par ${h.par} len ${h.len.toFixed(0)}m tee:${st} cup:${sg} teeH ${h.teePos[1].toFixed(1)} cupH ${h.cupPos[1].toFixed(1)} water-on-line ${water}/51 bunkers ${h.bunkers.length}`);
    }
    const t2 = Date.now(); const sun = E.sunFrom(160, 50);
    c.placeVegetation(sun);
    console.log(`veg: ${c.trees.length} trees, ${c.bushes.length} bushes, ${c.rocks.length} rocks, ${c.flowers.length} flowers (${Date.now() - t2} ms)`);
  }
})();
