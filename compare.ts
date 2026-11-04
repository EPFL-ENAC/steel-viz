// Old hidden lines (hlr-old.ts, three-edge-projection) against the new ones
// (hlr.ts, our own). Temporary: it goes away with hlr-old.ts.
//
// node compare.ts [--sheet compare.html] [--only "aisc tree 5"] [--bench-only]
//
// Cases: the 240 structures of geometry.test.ts and the specimens, each in
// 3 views (iso animated, west, iso at 120 px). For each kind of line (thin,
// thick, hidden in the animation, bolt fills), it compares the line count,
// the length, and the length of lines that only one drawing has.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadCatalog, type Family } from './sections.ts';
import { generate, type Form } from './generate.ts';
import { VIEWS, type Part, type RenderOpts } from './steel.ts';
import { readTables } from './tables.ts';
import { toSpecimen } from './specimen.ts';
import { renderHLR as oldHLR } from './hlr-old.ts';
import { renderHLR as newHLR } from './hlr.ts';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const sheet = opt('sheet', 'compare.html');
const only = opt('only', '');

// A case above this limit fails, unless it is listed in EXPLAINED. The limit
// is for the lines only one drawing has, and for the double lines the new
// one adds, as a share of the length.
//
// The line count is printed, but it is not in the rule: the new renderer cuts
// lines at other points (a line on the side of a face in front, a gap probe
// on the side of a face), so a few lines become two, with the same length.
// And it shows short lines the old one hid by mistake, behind faces seen edge
// on. The double line check does what the count was for.
const MAX_DIFF = 0.01;
const SMALL = 1; // drawing units (10 mm): the count leaves out shorter pieces
const TOL = 0.2; // drawing units (2 mm): two lines closer than this are the same
const STEP = 0.5; // drawing units between two sample points
const EXPLAINED: Record<string, string> = {
  // the top edge of a column under its cap or splice plate is hidden in the
  // end. The old one dropped it from the animation, the new one shows it as
  // hidden until the plate comes in. The new one is right.
  'eu portal 35 iso': 'column top under the cap plate, kept in the animation',
  'eu box 7 iso': 'column tops under the splice plates, kept in the animation',
};

const cats = { aisc: loadCatalog('aisc', ...readTables('aisc')), eu: loadCatalog('eu', ...readTables('eu')) };
const VIEWSETS: [string, RenderOpts][] = [
  ['iso', { az: VIEWS.iso[0], el: VIEWS.iso[1], animate: true }],
  ['west', { az: VIEWS.west[0], el: VIEWS.west[1] }],
  ['iso120', { az: VIEWS.iso[0], el: VIEWS.iso[1], size: 120 }],
];

// ------------------------------------------------------------- read an SVG
type Seg = [number, number, number, number];
const KINDS = ['thin', 'thick', 'hidden', 'fill'] as const;
type Kind = (typeof KINDS)[number];
function read(svg: string): Record<Kind, Seg[]> {
  const out: Record<Kind, Seg[]> = { thin: [], thick: [], hidden: [], fill: [] };
  for (const m of svg.matchAll(/<path([^>]*?) d="([^"]*)"/g)) {
    const cls = /class="([^"]*)"/.exec(m[1])?.[1].split(' ') ?? [];
    const kind: Kind = cls.includes('h') ? 'hidden' : cls.includes('b') || cls.includes('r') ? 'fill' : cls.includes('o') ? 'thick' : 'thin';
    let start: [number, number] | null = null;
    let last: [number, number] | null = null;
    for (const t of m[2].matchAll(/([MLZ])([^MLZ]*)/g)) {
      if (t[1] === 'Z') {
        if (start && last) out[kind].push([...last, ...start]);
        last = start;
        continue;
      }
      const [x, y] = t[2].trim().split(/\s+/).map(Number);
      if (t[1] === 'M') start = last = [x, y];
      else {
        out[kind].push([...last!, x, y]);
        last = [x, y];
      }
    }
  }
  return out;
}

const len = (g: Seg) => Math.hypot(g[2] - g[0], g[3] - g[1]);
const total = (l: Seg[]) => l.reduce((s, g) => s + len(g), 0);

// the pieces of `a` (sampled every STEP) that are farther than TOL from every line of `b`
function only1(a: Seg[], b: Seg[]): { length: number; bits: Seg[] } {
  const C = 4; // cell size, drawing units
  const grid = new Map<string, Seg[]>();
  for (const g of b) {
    const [i0, i1] = [Math.floor((Math.min(g[0], g[2]) - TOL) / C), Math.floor((Math.max(g[0], g[2]) + TOL) / C)];
    const [j0, j1] = [Math.floor((Math.min(g[1], g[3]) - TOL) / C), Math.floor((Math.max(g[1], g[3]) + TOL) / C)];
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const k = `${i},${j}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k)!.push(g);
      }
  }
  const near = (x: number, y: number) => {
    for (const g of grid.get(`${Math.floor(x / C)},${Math.floor(y / C)}`) ?? []) {
      const [dx, dy] = [g[2] - g[0], g[3] - g[1]];
      const l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((x - g[0]) * dx + (y - g[1]) * dy) / l2)) : 0;
      if (Math.hypot(x - g[0] - t * dx, y - g[1] - t * dy) <= TOL) return true;
    }
    return false;
  };
  let length = 0;
  const bits: Seg[] = [];
  for (const g of a) {
    const l = len(g);
    const n = Math.max(1, Math.ceil(l / STEP));
    for (let k = 0; k < n; k++) {
      const [t0, t1] = [k / n, (k + 1) / n];
      const tm = (t0 + t1) / 2;
      if (near(g[0] + (g[2] - g[0]) * tm, g[1] + (g[3] - g[1]) * tm)) continue;
      length += l / n;
      bits.push([g[0] + (g[2] - g[0]) * t0, g[1] + (g[3] - g[1]) * t0, g[0] + (g[2] - g[0]) * t1, g[1] + (g[3] - g[1]) * t1]);
    }
  }
  return { length, bits };
}

// the length of `a` that lies on another line of `a`, or on a line of `under`
// (a double line). A sample closer than SMALL to the end of its line is not
// counted: lines that meet at a corner touch there.
function doubled(a: Seg[], under: Seg[]): number {
  let length = 0;
  a.forEach((g, i) => {
    const others = [...a.slice(0, i), ...a.slice(i + 1), ...under];
    const l = len(g);
    const n = Math.max(1, Math.ceil(l / STEP));
    const keep: Seg[] = [];
    for (let k = 0; k < n; k++) {
      const tm = (k + 0.5) / n;
      if (tm * l < SMALL || (1 - tm) * l < SMALL) continue;
      keep.push([g[0] + (g[2] - g[0]) * (k / n), g[1] + (g[3] - g[1]) * (k / n), g[0] + (g[2] - g[0]) * ((k + 1) / n), g[1] + (g[3] - g[1]) * ((k + 1) / n)]);
    }
    if (keep.length) length += total(keep) - only1(keep, others.filter((o) => near2(o, g))).length;
  });
  return length;
}
// the box of `o` touches the box of `g` (plus TOL)
const near2 = (o: Seg, g: Seg) =>
  Math.max(o[0], o[2]) >= Math.min(g[0], g[2]) - TOL && Math.min(o[0], o[2]) <= Math.max(g[0], g[2]) + TOL &&
  Math.max(o[1], o[3]) >= Math.min(g[1], g[3]) - TOL && Math.min(o[1], o[3]) <= Math.max(g[1], g[3]) + TOL;

// ------------------------------------------------------------- the cases
type Case = { name: string; parts: Part[] };
function cases(): Case[] {
  const list: Case[] = [];
  const forms: Form[] = ['tree', 'portal', 'box'];
  for (const fam of ['aisc', 'eu'] as Family[])
    for (const form of forms)
      for (let seed = 1; seed <= 40; seed++) list.push({ name: `${fam} ${form} ${seed}`, parts: generate({ seed, form }, cats[fam]).parts });
  for (const f of readdirSync('specimens').filter((f) => f.endsWith('.json'))) {
    const spec = toSpecimen(JSON.parse(readFileSync(`specimens/${f}`, 'utf8')));
    list.push({ name: `specimen ${spec.id}`, parts: generate({ seed: 1, specimen: spec }, cats[spec.family ?? 'aisc']).parts });
  }
  return only ? list.filter((c) => c.name === only) : list;
}

type Row = {
  name: string;
  score: number; // lines only one drawing has, share of the visible length
  hidden: number; // the same for the hidden pieces of the animation
  dbl: [number, number]; // length of double lines, old and new
  counts: Record<Kind, [number, number]>;
  lengths: Record<Kind, [number, number, number, number]>; // old, new, old only, new only
  bad: string[];
  svgs: [string, string];
  bits: [Seg[], Seg[]];
  hbits: [Seg[], Seg[]];
  ms: [number, number];
};

function compare(name: string, parts: Part[], o: RenderOpts): Row {
  const a = oldHLR(parts, o);
  const b = newHLR(parts, o);
  const [A, B] = [read(a.svg), read(b.svg)];
  const counts = {} as Row['counts'];
  const lengths = {} as Row['lengths'];
  const bits: [Seg[], Seg[]] = [[], []];
  const hbits: [Seg[], Seg[]] = [[], []];
  const bad: string[] = [];
  for (const k of KINDS) {
    const x = only1(A[k], B[k]);
    const y = only1(B[k], A[k]);
    const long = (l: Seg[]) => l.filter((g) => Math.hypot(g[2] - g[0], g[3] - g[1]) >= SMALL).length;
    counts[k] = [long(A[k]), long(B[k])];
    lengths[k] = [total(A[k]), total(B[k]), x.length, y.length];
    if (k !== 'hidden') bits[0].push(...x.bits), bits[1].push(...y.bits);
    else hbits[0].push(...x.bits), hbits[1].push(...y.bits);
  }
  // double lines: thin on thin or on thick, thick on thick
  const dbl: [number, number] = [doubled(A.thin, A.thick) + doubled(A.thick, []), doubled(B.thin, B.thick) + doubled(B.thick, [])];
  const vis = (['thin', 'thick', 'fill'] as const).reduce((s, k) => s + Math.max(lengths[k][0], lengths[k][1]), 0);
  const diff = (['thin', 'thick', 'fill'] as const).reduce((s, k) => s + lengths[k][2] + lengths[k][3], 0);
  const score = vis ? diff / vis : 0;
  const hl = lengths.hidden;
  const hidden = Math.max(hl[0], hl[1]) ? (hl[2] + hl[3]) / Math.max(hl[0], hl[1]) : 0;
  if (score > MAX_DIFF) bad.push(`lines ${(score * 100).toFixed(2)}%`);
  if (hidden > MAX_DIFF) bad.push(`hidden ${(hidden * 100).toFixed(2)}%`);
  if (dbl[1] - dbl[0] > MAX_DIFF * vis) bad.push(`double lines ${dbl[0].toFixed(0)} -> ${dbl[1].toFixed(0)}`);
  return { name, score, hidden, dbl, counts, lengths, bad, svgs: [a.svg, b.svg], bits, hbits, ms: [a.ms, b.ms] };
}

// ------------------------------------------------------------- run
const bench = () => {
  const cat = cats.aisc;
  const o = { az: VIEWS.iso[0], el: VIEWS.iso[1] };
  const t = { old: 0, new: 0, faces: 0 };
  oldHLR(generate({ seed: 1 }, cat).parts, o); // warm up
  newHLR(generate({ seed: 1 }, cat).parts, o);
  for (let seed = 1; seed <= 30; seed++) {
    const { parts } = generate({ seed }, cat);
    const a = oldHLR(parts, o);
    t.old += a.ms;
    t.new += newHLR(parts, o).ms;
    t.faces += a.faces;
  }
  console.log(`bench, 30 seeds (aisc, default params, iso): old ${(t.old / 30).toFixed(1)} ms, new ${(t.new / 30).toFixed(1)} ms, ${(t.faces / 30).toFixed(0)} faces`);
};

if (args.includes('--bench-only')) {
  bench();
  process.exit(0);
}

const rows: Row[] = [];
const sum = { old: 0, new: 0 };
for (const c of cases())
  for (const [v, o] of VIEWSETS) {
    const r = compare(`${c.name} ${v}`, c.parts, o);
    sum.old += r.ms[0];
    sum.new += r.ms[1];
    // keep the SVGs only for the worst ones
    rows.push(r);
  }
rows.sort((a, b) => b.score + b.hidden - (a.score + a.hidden));
for (const r of rows.slice(30)) r.svgs = ['', ''];

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
const fails = rows.filter((r) => r.bad.length && !EXPLAINED[r.name]);
const explained = rows.filter((r) => r.bad.length && EXPLAINED[r.name]);
const tot = (k: Kind, i: number) => rows.reduce((s, r) => s + r.lengths[k][i], 0);
const cnt = (k: Kind, i: number) => rows.reduce((s, r) => s + r.counts[k][i], 0);
console.log(`${rows.length} drawings (${rows.length / VIEWSETS.length} structures x ${VIEWSETS.length} views)`);
for (const k of KINDS)
  console.log(
    `  ${k.padEnd(6)} count ${cnt(k, 0)} -> ${cnt(k, 1)}, length ${tot(k, 0).toFixed(0)} -> ${tot(k, 1).toFixed(0)}, ` +
      `old only ${pct(tot(k, 2) / tot(k, 0))}, new only ${pct(tot(k, 3) / tot(k, 0))}`,
  );
console.log(`  double lines, length: old ${rows.reduce((s, r) => s + r.dbl[0], 0).toFixed(0)}, new ${rows.reduce((s, r) => s + r.dbl[1], 0).toFixed(0)}`);
for (const r of [...rows].sort((p, q) => q.dbl[1] - q.dbl[0] - (p.dbl[1] - p.dbl[0])).slice(0, 8)) console.log(`    ${r.name}: ${r.dbl.map((v) => v.toFixed(1)).join(' -> ')}`);
console.log(`  worst lines ${pct(Math.max(...rows.map((r) => r.score)))}, worst hidden ${pct(Math.max(...rows.map((r) => r.hidden)))}`);
console.log(`  time, all drawings: old ${(sum.old / 1000).toFixed(1)} s, new ${(sum.new / 1000).toFixed(1)} s`);
for (const r of explained) console.log(`  explained: ${r.name}: ${r.bad.join(', ')} (${EXPLAINED[r.name]})`);
for (const r of fails.slice(0, args.includes('--all') ? Infinity : 40)) console.log(`  FAIL ${r.name}: ${r.bad.join(', ')}`);
if (fails.length > 40 && !args.includes('--all')) console.log(`  ... and ${fails.length - 40} more`);

// the sheet: the worst drawings, old, new, and what only one of them has
const diffSvg = (r: Row) => {
  const vb = /viewBox="([^"]*)"/.exec(r.svgs[0])![1];
  const d = (l: Seg[]) => l.map((g) => `M${g[0].toFixed(1)} ${g[1].toFixed(1)}L${g[2].toFixed(1)} ${g[3].toFixed(1)}`).join('');
  const base = r.svgs[0].replace(/<svg[^>]*>/, '').replace('</svg>', '');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="steel" viewBox="${vb}"><g style="opacity:.25">${base}</g>` +
    `<path d="${d(r.bits[0])}" style="fill:none;stroke:#e30713;stroke-width:3"/><path d="${d(r.bits[1])}" style="fill:none;stroke:#1060ff;stroke-width:3"/>` +
    `<path d="${d(r.hbits[0])}" style="fill:none;stroke:#e30713;stroke-width:2;stroke-dasharray:3 2"/><path d="${d(r.hbits[1])}" style="fill:none;stroke:#1060ff;stroke-width:2;stroke-dasharray:3 2"/></svg>`
  );
};
const html = [
  '<!doctype html><meta charset="utf-8"><title>Old against new hidden lines</title>',
  '<style>body{font:14px sans-serif;margin:16px}.row{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:24px}svg{width:100%;height:auto;border:1px solid #ddd}h3{margin:8px 0}</style>',
  `<p>Red: only in the old drawing. Blue: only in the new one.</p>`,
  ...rows.slice(0, 12).map(
    (r) =>
      `<h3>${r.name}: lines ${pct(r.score)}, hidden ${pct(r.hidden)} ${r.bad.length ? `(${r.bad.join(', ')})` : ''}</h3>` +
      `<p>${KINDS.map((k) => `${k} ${r.counts[k][0]} -> ${r.counts[k][1]}`).join(', ')}</p>` +
      `<div class="row"><div>old${r.svgs[0]}</div><div>new${r.svgs[1]}</div><div>difference${diffSvg(r)}</div></div>`,
  ),
].join('\n');
writeFileSync(sheet, html);
// one case: also its difference as an SVG file, next to the sheet
if (only) for (const r of rows) writeFileSync(sheet.replace(/\.html$/, `-${r.name.split(' ').pop()}.svg`), diffSvg(r));
console.log(`  sheet: ${sheet}`);
bench();
console.log(fails.length ? `NOT GREEN: ${fails.length} drawings fail` : 'GREEN');
process.exit(fails.length ? 1 : 0);
