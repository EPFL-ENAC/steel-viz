// node build-playground.ts : writes playground.html, one self-contained page.
// esbuild bundles playground.entry.ts (our modules and three.js) into one
// script, and the page script uses the globals it sets.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, '../../frontend/src/assets');

const bundle = await build({
  entryPoints: [join(here, 'playground.entry.ts')],
  bundle: true,
  format: 'iife',
  minify: true,
  target: 'es2022',
  write: false,
  logLevel: 'warning',
});
const code = bundle.outputFiles[0].text;

const csv = (p: string) => JSON.stringify(readFileSync(join(assets, p), 'utf8'));
const tables = `const TABLES = {
  aisc: [${csv('connection/aisc-sections.csv')}, ${csv('hss/hss-aisc-sections.csv')}],
  eu: [${csv('connection/european-sections.csv')}, ${csv('hss/hss-european-sections.csv')}],
};`;

const page = readFileSync(join(here, 'playground.template.html'), 'utf8').replace('/*__CODE__*/', () => `${tables}\n${code}`);
writeFileSync(join(here, 'playground.html'), page);
console.log(`playground.html: ${(Buffer.byteLength(page) / 1024).toFixed(0)} kB (script ${(code.length / 1024).toFixed(0)} kB)`);
