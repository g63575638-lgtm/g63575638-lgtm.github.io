// Build: concatenate engine sources into a single self-contained index.html (+ PWA files)
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'); const src = path.join(root, 'src'); const out = path.join(root, 'dist');
fs.mkdirSync(path.join(out, 'icons'), { recursive: true });
const files = fs.readdirSync(src).filter(f => f.endsWith('.js')).sort();
let js = files.map(f => `// ---- ${f}\n` + fs.readFileSync(path.join(src, f), 'utf8').replace(/^if \(typeof module !== 'undefined'\).*$/m, '')).join('\n');
js = '(function(){\n' + js + '\n})();';
fs.writeFileSync(path.join(out, 'game.js'), js);
const html = fs.readFileSync(path.join(root, 'web/index.template.html'), 'utf8').replace('/*__GAME_JS__*/', () => js);
fs.writeFileSync(path.join(out, 'index.html'), html);
for (const f of ['manifest.webmanifest', 'sw.js']) fs.copyFileSync(path.join(root, 'web', f), path.join(out, f));
fs.writeFileSync(path.join(out, '.nojekyll'), '');
(async () => {
  try {
    const sharp = require('/usr/local/lib/node_modules_global/sharp');
    const svg = fs.readFileSync(path.join(root, 'web/logo.svg'));
    await sharp(svg).resize(192, 192).png().toFile(path.join(out, 'icons/icon-192.png'));
    await sharp(svg).resize(512, 512).png().toFile(path.join(out, 'icons/icon-512.png'));
    const mask = Buffer.from(svg.toString().replace('<rect x="56" y="56" width="400" height="400" rx="96"', '<rect x="0" y="0" width="512" height="512" rx="0"'));
    await sharp(mask).resize(512, 512).png().toFile(path.join(out, 'icons/icon-maskable-512.png'));
  } catch (e) { if (!fs.existsSync(path.join(out, 'icons/icon-192.png'))) console.warn('icons: sharp unavailable, keeping existing icons', e.message); }
  console.log(`built dist/index.html (${(html.length / 1024).toFixed(0)} KB, ${files.length} modules)`);
})();
