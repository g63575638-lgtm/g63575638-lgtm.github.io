// loads engine sources (non-GL parts) into a Node VM context for testing
const fs = require('fs'), vm = require('vm'), path = require('path');
function load(files) {
  const ctx = { console, performance: require('perf_hooks').performance, setTimeout, Math, Float32Array, Uint8Array, Int8Array, Uint16Array, Uint32Array, Map, Promise, module: undefined };
  vm.createContext(ctx);
  let src = files.map(f => fs.readFileSync(path.join(__dirname, '../src', f), 'utf8')).join('\n');
  // expose top-level const/class declarations
  src += '\n;globalThis.__exp = {' + ['V3','M4','Q','clamp','lerp','smoothstep','deg','mulberry32','fbm','vnoise','GEO','GeoBuilder','Course','SURF','SURF_NAMES','SURF_PHYS','MAPS','TIMES','sunFrom','SPECIES','CLUBS','BallPhysics','ClubImpact','PHYS'].map(n => `${n}: typeof ${n} !== 'undefined' ? ${n} : undefined`).join(',') + '};';
  vm.runInContext(src, ctx);
  return ctx.__exp;
}
module.exports = { load };
