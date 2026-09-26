import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const www = path.join(root, 'www');

if (!fs.existsSync(www)) {
  throw new Error('www directory does not exist');
}

const required = ['index.html', 'style.css', 'app.js', 'manifest.json', 'sw.js', 'ghost-icon.svg'];
const missing = required.filter((file) => !fs.existsSync(path.join(www, file)));

if (missing.length) {
  throw new Error(`Missing web assets: ${missing.join(', ')}`);
}

console.log(`GHOST web shell ready: ${required.length} assets`);
const vendorDir = path.join(www, 'vendor');
console.log(fs.existsSync(vendorDir) ? 'Local vendor directory: present' : 'Local vendor directory: not prepared yet (run npm run prepare:vendor)');
