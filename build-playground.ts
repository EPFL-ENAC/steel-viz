// node build-playground.ts : writes playground.html, one self-contained page.
// The modules are concatenated into one script: types stripped, imports and
// `export` removed. So a top-level name must be unique across the files.
import { readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, '../../frontend/src/assets');
const read = (p: string) => readFileSync(join(here, p), 'utf8');

const code = ['vec.ts', 'sections.ts', 'solver.ts', 'steel.ts', 'generate.ts']
  .map((f) => {
    const js = stripTypeScriptTypes(read(f), { mode: 'strip' })
      .replace(/^import [\s\S]*?from '[^']+';$/gm, '')
      .replace(/^export /gm, '');
    return `// ---- ${f}\n${js}`;
  })
  .join('\n');

const csv = (p: string) => JSON.stringify(readFileSync(join(assets, p), 'utf8'));
const tables = `const TABLES = {
  aisc: [${csv('connection/aisc-sections.csv')}, ${csv('hss/hss-aisc-sections.csv')}],
  eu: [${csv('connection/european-sections.csv')}, ${csv('hss/hss-european-sections.csv')}],
};`;

const page = read('playground.template.html').replace('/*__CODE__*/', () => `${tables}\n${code}`);
writeFileSync(join(here, 'playground.html'), page);
console.log(`playground.html: ${(Buffer.byteLength(page) / 1024).toFixed(0)} kB`);
