// node tools/steel-generator/cli.ts --seed 3 --view iso --family aisc --out x.svg
//   [--detail members|plates|bolts] [--arms 5] [--height 6000] [--load 20]
//   [--form mix|tree|portal|box] [--animate] [--frames] [--painter] [--flat] [--size px]
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog, type Family } from './sections.ts';
import { DEFAULTS, floating, generate, type Detail, type Params } from './generate.ts';
import { render as painter, VIEWS } from './steel.ts';
import { renderHLR } from './hlr.ts';

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, '../../frontend/src/assets');
export const tables = {
  aisc: [readFileSync(join(assets, 'connection/aisc-sections.csv'), 'utf8'), readFileSync(join(assets, 'hss/hss-aisc-sections.csv'), 'utf8')],
  eu: [readFileSync(join(assets, 'connection/european-sections.csv'), 'utf8'), readFileSync(join(assets, 'hss/hss-european-sections.csv'), 'utf8')],
};

const args = process.argv.slice(2);
const opt = (k: string, d: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const family = opt('family', 'aisc') as Family;
const view = opt('view', 'iso');
const [az, el] = VIEWS[view] ?? view.split(',').map(Number);
const out = opt('out', `steel-${opt('seed', '1')}-${view}.svg`);
const detail = opt('detail', 'bolts') as Detail;
// exact hidden lines by default; --painter for the old, fast painter's trick
const render = args.includes('--painter') ? painter : renderHLR;

const t0 = performance.now();
const cat = loadCatalog(family, ...(tables[family] as [string, string]));
const t1 = performance.now();
const r = generate(
  { seed: +opt('seed', '1'), form: opt('form', 'mix') as Params['form'], arms: +opt('arms', `${DEFAULTS.arms}`), height: +opt('height', `${DEFAULTS.height}`), load: +opt('load', `${DEFAULTS.load}`), fy: family === 'eu' ? 355 : 345 },
  cat,
  detail,
);
const t2 = performance.now();
const weights = !args.includes('--flat');
const size = opt('size', '') ? +opt('size', '') : undefined;
const svg = render(r.parts, { az, el, animate: args.includes('--animate'), weights, size });
const t3 = performance.now();
writeFileSync(out, svg.svg);

const kb = (s: string) => (Buffer.byteLength(s) / 1024).toFixed(1);
const lost = floating(r.parts);
console.log(
  [
    `${out}: seed ${opt('seed', '1')}, ${family}, view ${view}, detail ${detail}, ${render === painter ? 'painter' : 'hlr'}`,
    `  structure: ${r.st.form}, ${r.st.cols.length} × column ${r.st.col.id}, ${r.st.arms.length} arms (${r.st.arms.map((a) => `${a.sec.id} ${a.conn}${a.braces.map((b) => ' + brace ' + b.sec.id).join('')}`).join('; ')})` +
      (r.st.secs.length ? `, ${r.st.secs.length} secondary (${r.st.secs.map((s) => `${s.sec.id} ${s.conn}`).join('; ')})` : ''),
    `  solver: ${r.ok ? 'stable' : 'MECHANISM'}, ${r.nodes} nodes, ${r.solves} solves`,
    ...r.log.map((l) => '    ' + l),
    `  drawing: ${r.parts.length} parts, ${svg.faces} faces, ${svg.dots} bolts, ${kb(svg.svg)} kB, gzip ${(gzipSync(svg.svg).length / 1024).toFixed(1)} kB`,
    `  build order: ${lost.length ? 'FLOATING ' + lost.join(', ') : 'ok'} (${Math.max(...r.parts.map((p) => p.step)) + 1} steps)`,
    `  ms: tables ${(t1 - t0).toFixed(1)}, topology ${r.ms.topology.toFixed(1)}, solve+size ${r.ms.solve.toFixed(1)}, geometry ${r.ms.geometry.toFixed(1)}, render ${(t3 - t2).toFixed(1)}, total generate+render ${(t3 - t1).toFixed(1)}`,
  ].join('\n'),
);

if (args.includes('--frames')) {
  const last = Math.max(...r.parts.map((p) => p.step));
  for (const pct of [25, 50, 75, 100]) {
    const f = out.replace(/\.svg$/, `-${pct}.svg`);
    writeFileSync(f, render(r.parts, { az, el, maxStep: Math.round((last * pct) / 100), weights }).svg);
    console.log(`  frame ${pct}%: ${f}`);
  }
}
