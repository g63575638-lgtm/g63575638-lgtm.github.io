// Writes dist/.well-known/assetlinks.json for the signing certificate (Digital Asset Links).
// usage: node tools/make-assetlinks.js <SHA256 fingerprint AA:BB:...>
const fs = require('fs'), path = require('path');
const fp = (process.argv[2] || '').trim().toUpperCase();
if (!/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(fp)) { console.error('Usage: node tools/make-assetlinks.js AA:BB:..(32 bytes)'); process.exit(1); }
const json = [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: 'com.futongroup.golfvr', sha256_cert_fingerprints: [fp] } }];
const dir = path.join(__dirname, '../dist/.well-known'); fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'assetlinks.json'), JSON.stringify(json, null, 2));
console.log('wrote dist/.well-known/assetlinks.json');
