import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const required = [
  'www/index.html',
  'www/style.css',
  'www/app.js',
  'www/ghost-native-bridge.js',
  'www/manifest.json',
  'www/sw.js',
  'www/ghost-icon.svg',
  'www/vendor/tf.min.js',
  'www/vendor/coco-ssd.min.js',
  'www/vendor/peerjs.min.js',
  'www/vendor/qrcode.min.js',
  'www/vendor/jsQR.js'
];

const missing = required.filter(file => !fs.existsSync(path.join(root, file)));
if (missing.length) {
  console.error('iOS preflight FAILED. Missing:');
  for (const file of missing) console.error(` - ${file}`);
  process.exit(1);
}

const html = fs.readFileSync(path.join(root, 'www/index.html'), 'utf8');
const forbiddenCdn = ['cdn.jsdelivr.net/npm/@tensorflow', 'cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd', 'cdn.jsdelivr.net/npm/peerjs', 'cdn.jsdelivr.net/npm/qrcodejs', 'cdn.jsdelivr.net/npm/jsqr'];
const leftovers = forbiddenCdn.filter(x => html.includes(x));
if (leftovers.length) {
  console.error('iOS preflight FAILED: CDN references remain in index.html');
  process.exit(1);
}

console.log('GHOST iOS preflight: OK');
console.log('Local AI/WebRTC/QR assets: OK');
console.log('Native bridge: OK');
