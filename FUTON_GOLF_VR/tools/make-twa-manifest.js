// Generates android/twa-manifest.json (Meta Quest immersive PWA) for Bubblewrap.
// usage: node tools/make-twa-manifest.js https://your-domain.example/ [versionCode]
const fs = require('fs'), path = require('path');
const site = process.argv[2]; const code = parseInt(process.argv[3] || '1', 10);
if (!site || !/^https:\/\//.test(site)) { console.error('Usage: node tools/make-twa-manifest.js https://your-domain/ [versionCode]'); process.exit(1); }
const u = new URL(site.endsWith('/') ? site : site + '/');
const base = u.origin + u.pathname;
const m = {
  packageId: 'com.futongroup.golfvr',
  host: u.host,
  name: 'FUTON GOLF VR',
  launcherName: 'FUTON GOLF',
  display: 'standalone',
  orientation: 'landscape',
  themeColor: '#0B0F12', themeColorDark: '#0B0F12',
  navigationColor: '#0B0F12', navigationColorDark: '#0B0F12', navigationDividerColor: '#0B0F12', navigationDividerColorDark: '#0B0F12',
  backgroundColor: '#0B0F12',
  enableNotifications: false,
  startUrl: u.pathname + 'index.html?autoxr=1',
  iconUrl: base + 'icons/icon-512.png',
  maskableIconUrl: base + 'icons/icon-maskable-512.png',
  splashScreenFadeOutDuration: 300,
  signingKey: { path: './android.keystore', alias: 'futon' },
  appVersionName: '1.0.' + code,
  appVersionCode: code,
  shortcuts: [],
  generatorApp: 'bubblewrap-cli',
  webManifestUrl: base + 'manifest.webmanifest',
  fallbackType: 'customtabs',
  features: {},
  alphaDependencies: { enabled: false },
  enableSiteSettingsShortcut: false,
  isChromeOSOnly: false,
  isMetaQuest: true,
  horizonOSAppMode: 'immersive',
  fullScopeUrl: base,
  minSdkVersion: 29,
  retainedBundles: [],
  appVersion: '1.0.' + code,
};
const out = path.join(__dirname, '../android/twa-manifest.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(m, null, 2));
console.log('wrote', out, 'for', base);
