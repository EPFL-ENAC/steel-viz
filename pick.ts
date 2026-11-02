// Scan many seeds and list the ones that read best as a logo (score.ts).
// node tools/steel-generator/pick.ts --count 300 [--from 1] [--arms 4,5,6]
//   [--view iso] [--family aisc] [--top 12] [--sheet best.html] [--size 160]
// --sheet writes a page with the best drawings, at --size px.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog, type Family } from './sections.ts';
import { DEFAULTS, generate } from './generate.ts';
import { VIEWS } from './steel.ts';
import { renderHLR } from './hlr.ts';
import { logoScore } from './score.ts';

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, '../../frontend/src/assets');
const files = {
  aisc: ['connection/aisc-sections.csv', 'hss/hss-aisc-sections.csv'],
  eu: ['connection/european-sections.csv', 'hss/hss-european-sections.csv'],
};

const args = process.argv.slice(2);
const opt = (k: string, d: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const family = opt('family', 'aisc') as Family;
const view = opt('view', 'iso');
const [az, el] = VIEWS[view] ?? view.split(',').map(Number);
const [from, count, top] = [+opt('from', '1'), +opt('count', '200'), +opt('top', '12')];
const armsList = opt('arms', `${DEFAULTS.arms}`).split(',').map(Number);
const cat = loadCatalog(family, ...(files[family].map((f) => readFileSync(join(assets, f), 'utf8')) as [string, string]));
const params = (seed: number, arms: number) => ({ seed, arms, height: DEFAULTS.height, load: DEFAULTS.load, fy: family === 'eu' ? 355 : 345 });

const t0 = performance.now();
const found = [];
for (const arms of armsList)
  for (let seed = from; seed < from + count; seed++) {
    const r = generate(params(seed, arms), cat, 'members');
    if (!r.ok) continue;
    found.push({ seed, arms, ...logoScore(r.parts, az, el) });
  }
found.sort((a, b) => b.score - a.score);
const best = found.slice(0, top);
const p2 = (x: number) => x.toFixed(2);
console.log(`${found.length} stable structures in ${((performance.now() - t0) / 1000).toFixed(1)} s, best ${top}:`);
console.log('seed  arms  score  fill  aspect  balance  members  crossings');
for (const b of best) console.log(`${String(b.seed).padStart(4)}  ${String(b.arms).padStart(4)}  ${p2(b.score)}   ${p2(b.fill)}  ${p2(b.aspect)}    ${p2(b.balance)}     ${b.members}        ${b.crossings}`);

const sheet = opt('sheet', '');
if (sheet) {
  const size = +opt('size', '160');
  const cells = best.map((b) => {
    const r = generate(params(b.seed, b.arms), cat, 'bolts');
    const svg = renderHLR(r.parts, { az, el, size }).svg;
    return `<figure>${svg}<figcaption>seed ${b.seed}, ${b.arms} arms, ${p2(b.score)}</figcaption></figure>`;
  });
  writeFileSync(
    sheet,
    `<!doctype html><meta charset="utf-8"><title>Best seeds</title><style>body{font:13px system-ui;margin:24px;display:flex;flex-wrap:wrap;gap:24px}` +
      `figure{margin:0;width:${size}px}figure svg{width:${size}px;height:auto;display:block}figcaption{color:#666;margin-top:6px}</style>${cells.join('\n')}`,
  );
  console.log(`wrote ${sheet}`);
}
