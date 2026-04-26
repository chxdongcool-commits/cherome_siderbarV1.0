import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const manifestSrc = join(rootDir, 'src/manifest.json');
const manifestDst = join(rootDir, 'dist/manifest.json');

if (!existsSync(join(rootDir, 'dist'))) {
  mkdirSync(join(rootDir, 'dist'), { recursive: true });
}

copyFileSync(manifestSrc, manifestDst);
console.log('Copied manifest.json to dist/');
