// node cli.ts --seed 3 --view iso --family aisc --out x.svg
//   [--detail members|plates|bolts] [--arms 5] [--height 6000] [--load 20]
//   [--form mix|tree|portal|box] [--animate] [--frames] [--painter] [--flat] [--size px]
//   [--shapes 0.35] (the chance of a channel, double angle or tee member, 0 for none)
//   the look (see Params in generate.ts): [--storeys 0|1|2] [--span 1] [--bracing auto|none|knee|chevron|diagonal]
//   [--conn auto|shear_tab|end_plate|flange_plates|welded|clip_angles|seated|stiffened_seat|tee|end_plate_stiffened]
//   [--arm-length 0.3,0.7] [--arm-height 0.35,0.95]
//   [--braces 0.3] [--secondaries 0.35] [--posts 0.3] [--beam-splices 0.3] [--trusses 1] [--rods 0.4] [--col-splice 0.6] [--conn-kinds 0.35] [--skew 0.3]
// node cli.ts --specimen specimens/Chi_and_Uang_2002_DC2.json --view iso
//   a real test from a JSON file (specimen.ts), with the same view and drawing options
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { loadCatalog, type Family } from './sections.ts';
import { DEFAULTS, floating, generate, type Detail, type Params } from './generate.ts';
import { render as painter, VIEWS } from './steel.ts';
import { renderHLR } from './hlr.ts';
import { readTables } from './tables.ts';
import { toSpecimen } from './hub.ts';


const args = process.argv.slice(2);
const opt = (k: string, d: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const specFile = opt('specimen', '');
const spec = specFile ? toSpecimen(JSON.parse(readFileSync(specFile, 'utf8'))) : undefined;
const family = opt('family', spec?.family ?? 'aisc') as Family;
const view = opt('view', 'iso');
const [az, el] = VIEWS[view] ?? view.split(',').map(Number);
const out = opt('out', `steel-${spec ? spec.id : opt('seed', '1')}-${view}.svg`);
const detail = opt('detail', 'bolts') as Detail;
// exact hidden lines by default; --painter for the old, fast painter's trick
const render = args.includes('--painter') ? painter : renderHLR;

const t0 = performance.now();
const cat = loadCatalog(family, ...readTables(family));
const t1 = performance.now();
const num = (k: string, d: number) => +opt(k, `${d}`);
const pair = (k: string, d: [number, number]) => opt(k, d.join(',')).split(',').map(Number) as [number, number];
const r = generate(
  {
    seed: +opt('seed', '1'), form: opt('form', 'mix') as Params['form'], arms: num('arms', DEFAULTS.arms), height: num('height', DEFAULTS.height),
    load: num('load', DEFAULTS.load), shapeP: num('shapes', DEFAULTS.shapeP), fy: family === 'eu' ? 355 : 345, specimen: spec,
    storeys: num('storeys', DEFAULTS.storeys) as Params['storeys'], spanK: num('span', DEFAULTS.spanK),
    bracing: opt('bracing', DEFAULTS.bracing) as Params['bracing'], conn: opt('conn', DEFAULTS.conn) as Params['conn'],
    armL: pair('arm-length', DEFAULTS.armL), armZ: pair('arm-height', DEFAULTS.armZ),
    braceP: num('braces', DEFAULTS.braceP), secondaryP: num('secondaries', DEFAULTS.secondaryP), postP: num('posts', DEFAULTS.postP),
    beamSpliceP: num('beam-splices', DEFAULTS.beamSpliceP), trussK: num('trusses', DEFAULTS.trussK), rodP: num('rods', DEFAULTS.rodP),
    colSpliceP: num('col-splice', DEFAULTS.colSpliceP), connKindsP: num('conn-kinds', DEFAULTS.connKindsP), skewP: num('skew', DEFAULTS.skewP),
  },
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
const beams = r.st.arms.map((a) => `${a.sec.id} ${a.conn}${a.braces.map((b) => ' + brace ' + b.sec.id).join('')}`).join('; ');
console.log(
  [
    `${out}: ${spec ? `specimen ${spec.id}` : `seed ${opt('seed', '1')}`}, ${family}, view ${view}, detail ${detail}, ${render === painter ? 'painter' : 'hlr'}`,
    r.st.brace
      ? `  structure: specimen, brace test ${r.st.brace.frame}, ${r.st.col.id} ${r.st.brace.L} mm at ${r.st.brace.angle}°, ${r.st.brace.ends} ends`
      : r.st.link
      ? `  structure: specimen, link test ${r.st.link.config} ${r.st.link.at}, ${r.st.col.id} e ${r.st.link.e} mm, ${r.st.link.stiffeners} stiffeners` +
        (r.st.link.span ? `, frame ${r.st.link.span} x ${r.st.link.height} mm` : '')
      : r.st.columnTest
      ? `  structure: specimen, column test ${r.st.columnTest.ends}, ${r.st.col.id} ${r.st.columnTest.L} mm, pushed at ${r.st.columnTest.angle}° from the web`
      : spec
      ? `  structure: specimen, column ${r.st.col.id} ${r.st.H} mm high, ${r.st.arms.length} beam${r.st.arms.length === 1 ? '' : 's'} (${beams})${r.st.continuity === false ? ', no continuity plates' : ''}, ${r.st.load} loaded`
      : `  structure: ${r.st.form}, ${r.st.cols.length} × column ${r.st.col.id}, ${r.st.arms.length} arms (${beams})` +
        (r.st.secs.length ? `, ${r.st.secs.length} secondary (${r.st.secs.map((s) => `${s.sec.id} ${s.conn}`).join('; ')})` : ''),
    `  solver: ${r.ok ? 'stable' : 'MECHANISM'}, ${r.nodes} nodes, ${r.solves} solves, max ratio ${r.ratio.toFixed(2)}, alphaCr ${r.alpha === Infinity ? '-' : r.alpha.toFixed(1)}`,
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
