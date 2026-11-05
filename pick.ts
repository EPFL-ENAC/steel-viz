// Scan many seeds and list the best ones (score.ts): the ones that read best
// as a logo, or that show the most kinds of detail, or a mix of both.
// node pick.ts --count 300 [--from 1] [--arms 4,5,6] [--by logo|variety|mix]
//   [--form mix|tree|portal|box] [--view iso] [--family aisc] [--top 12]
//   [--sheet best.html] [--size 160] [--shapes 0.35]
// --by says what to sort by, logo if you don't give it.
// --sheet writes a page with the best drawings, at --size px.
import { writeFileSync } from 'node:fs';
import { loadCatalog, type Family } from './sections.ts';
import { DEFAULTS, generate, type Params } from './generate.ts';
import { VIEWS } from './steel.ts';
import { renderHLR } from './hlr.ts';
import { better, BY, logoScore, mixScore, variety, type By } from './score.ts';
import { readTables } from './tables.ts';


const args = process.argv.slice(2);
const opt = (k: string, d: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const family = opt('family', 'aisc') as Family;
const view = opt('view', 'iso');
const [az, el] = VIEWS[view] ?? view.split(',').map(Number);
const [from, count, top] = [+opt('from', '1'), +opt('count', '200'), +opt('top', '12')];
const armsList = opt('arms', `${DEFAULTS.arms}`).split(',').map(Number);
const cat = loadCatalog(family, ...readTables(family));
const form = opt('form', 'mix') as Params['form'];
const shapeP = +opt('shapes', `${DEFAULTS.shapeP}`);
const by = opt('by', 'logo') as By;
if (!BY.includes(by)) {
  console.error(`--by must be one of: ${BY.join(', ')}`);
  process.exit(1);
}
const params = (seed: number, arms: number) => ({ seed, arms, form, height: DEFAULTS.height, load: DEFAULTS.load, shapeP, fy: family === 'eu' ? 355 : 345 });

const t0 = performance.now();
const found = [];
for (const arms of armsList)
  for (let seed = from; seed < from + count; seed++) {
    const r = generate(params(seed, arms), cat, 'members');
    if (!r.ok) continue;
    found.push({ seed, arms, form: r.st.form, ...logoScore(r.parts, az, el), ...variety(r.st) });
  }
found.sort(better(by));
const best = found.slice(0, top);
const p2 = (x: number) => x.toFixed(2);
console.log(`${found.length} stable structures in ${((performance.now() - t0) / 1000).toFixed(1)} s, best ${top} by ${by}:`);
console.log('form    seed  arms  score  fill  aspect  balance  members  crossings  variety  mix   kinds');
for (const b of best)
  console.log(
    `${b.form.padEnd(6)}  ${String(b.seed).padStart(4)}  ${String(b.arms).padStart(4)}  ${p2(b.score)}   ${p2(b.fill)}  ${p2(b.aspect)}    ${p2(b.balance)}     ${b.members}        ${b.crossings}` +
      `          ${String(b.variety).padStart(2)}       ${p2(mixScore(b.score, b.variety))}  ${b.kinds.join('; ')}`,
  );

const sheet = opt('sheet', '');
if (sheet) {
  const size = +opt('size', '160');
  const cells = best.map((b) => {
    const r = generate(params(b.seed, b.arms), cat, 'bolts');
    const svg = renderHLR(r.parts, { az, el, size }).svg;
    return `<figure>${svg}<figcaption>${b.form} ${b.seed}, ${b.arms} arms, logo ${p2(b.score)}, ${b.variety} kinds<small>${b.kinds.join(', ')}</small></figcaption></figure>`;
  });
  writeFileSync(
    sheet,
    `<!doctype html><meta charset="utf-8"><title>Best seeds by ${by}</title><style>body{font:13px system-ui;margin:24px;display:flex;flex-wrap:wrap;gap:24px}` +
      `figure{margin:0;width:${size}px}figure svg{width:${size}px;height:auto;display:block}figcaption{color:#666;margin-top:6px}small{display:block;font-size:11px;margin-top:2px}</style>${cells.join('\n')}`,
  );
  console.log(`wrote ${sheet}`);
}
