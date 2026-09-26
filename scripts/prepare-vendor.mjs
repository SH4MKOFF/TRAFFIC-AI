import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = process.cwd();
const vendorDir = path.join(root, 'www', 'vendor');
const require = createRequire(import.meta.url);

fs.mkdirSync(vendorDir, { recursive: true });

const packages = [
  { pkg: '@tensorflow/tfjs', version: '4.22.0', file: ['dist', 'tf.min.js'], out: 'tf.min.js' },
  { pkg: '@tensorflow-models/coco-ssd', version: '2.2.3', file: ['dist', 'coco-ssd.min.js'], out: 'coco-ssd.min.js' },
  { pkg: 'peerjs', version: '1.5.4', file: ['dist', 'peerjs.min.js'], out: 'peerjs.min.js' },
  { pkg: 'qrcodejs', version: '1.0.0', file: ['qrcode.min.js'], out: 'qrcode.min.js' },
  { pkg: 'jsqr', version: '1.4.0', file: ['dist', 'jsQR.js'], out: 'jsQR.js' },
];

function resolvePackageRoot(pkg) {
  const packageJson = require.resolve(`${pkg}/package.json`);
  return path.dirname(packageJson);
}

const copied = [];
const missing = [];

for (const item of packages) {
  let packageRoot;
  try {
    packageRoot = resolvePackageRoot(item.pkg);
  } catch {
    missing.push(`${item.pkg}@${item.version}`);
    continue;
  }

  const source = path.join(packageRoot, ...item.file);
  const target = path.join(vendorDir, item.out);

  if (!fs.existsSync(source)) {
    throw new Error(`Installed package found, but browser file is missing: ${source}`);
  }

  fs.copyFileSync(source, target);
  copied.push({ package: `${item.pkg}@${item.version}`, file: `vendor/${item.out}` });
}

if (missing.length) {
  console.error('GHOST local vendor FAILED: dependencies are not installed.');
  console.error('Run this once: npm.cmd install');
  for (const item of missing) console.error(` - ${item}`);
  process.exit(1);
}

const manifest = {
  generatedAt: new Date().toISOString(),
  packages: copied,
};

fs.writeFileSync(
  path.join(vendorDir, 'vendor-manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n'
);

console.log(`GHOST local vendor ready: ${copied.length} libraries`);
for (const item of copied) console.log(` - ${item.package} -> ${item.file}`);
