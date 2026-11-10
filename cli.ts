// node cli.ts --seed 3 --view iso --family aisc --out x.svg
//   [--detail members|plates|bolts] [--arms 5] [--height 6000] [--load 20]
//   [--form mix|tree|portal|box] [--animate] [--frames] [--painter] [--flat] [--size px]
//   [--speed 1] (with --animate: how fast each part comes, as "Part speed" in the playground, default 1)
//   [--duration 8] (with --animate: the build lasts this many seconds, as "Build time"; none: its own length at this speed)
//   [--shapes 0.35] (the chance of a channel, double angle or tee member, 0 for none)
//   [--round-tubes 0.3] (the chance of round tube braces on an arm, 0 for none)
//   [--short-braces 0.5] (the chance of a short brace on a tree arm with no room for a full one, 0 for none)
//   the look (see Params in generate.ts): [--storeys 0|1|2] [--span 1] [--bracing auto|none|knee|chevron|diagonal|x]
//   [--x-kind auto|flat|rod|angle] [--x-braces 0.3] (the chance that an auto diagonal is an X)
//   [--conn auto|shear_tab|end_plate|flange_plates|welded|clip_angles|seated|stiffened_seat|tee|end_plate_stiffened|welded_tab]
//   [--arm-length 0.3,0.7] [--arm-height 0.35,0.95]
//   [--braces 0.3] [--secondaries 0.35] [--posts 0.3] [--beam-splices 0.3] [--trusses 1] [--rods 0.4] [--col-splice 0.6] [--conn-kinds 0.35] [--skew 0.3]
//   [--gable 0.35] (the chance of a pitched roof on the top bay beam of a portal, 0 for none)
// node cli.ts --specimen specimens/Chi_and_Uang_2002_DC2.json --view iso
// node cli.ts --specimen connections/Lee_et_al_2002_CR1 --view iso
//   a real test, from a JSON file (specimen.ts) or as <table>/<id> (read like the
//   page: from resslab-hub-data, or with none, from the examples of specimens/)
//   [--step 440] the deformed shape at this step, from 0 as the slider of the
//   playground. The same SVG as "Copy SVG at this step" (the playground rounds
//   the angle of a named view: give --view 225,35 for its iso).
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import type { DeformState } from './deform.ts';
import { DEFORMS, shapeAt, shapeSvg } from './deforms.ts';
import { DEFAULTS, floating, generate, type Detail, type Params, type Result } from './generate.ts';
import { renderHLR } from './hlr.ts';
import { hubTable, toSpecimen, type HubRecord } from './hub.ts';
import { loadCatalog, type Family } from './sections.ts';
import type { Specimen } from './specimen.ts';
import { buildEnd, render as painter, timeline, VIEWS } from './steel.ts';
import { findHubData, findRecord, loadCurves, readTables, responseDir, rowId, stepsOf } from './tables.ts';

// ---- the flags that go together: the test, its step, the animation
export type CliArgs = {
  specimen?: string; // a JSON file, or <table>/<id>
  step?: number;
  animate: boolean;
  speed?: number;
  duration?: number; // s
  frames: boolean;
  painter: boolean;
};

function number(flag: string, text: string | undefined, ok: (n: number) => boolean, kind: string): number {
  const n = Number(text);
  if (text === undefined || text.trim() === '' || !Number.isFinite(n) || !ok(n)) throw new Error(`${flag} needs ${kind}, not "${text ?? ''}"`);
  return n;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const has = (k: string) => argv.includes(`--${k}`);
  const value = (k: string) => (has(k) ? argv[argv.indexOf(`--${k}`) + 1] : undefined);
  const a: CliArgs = { specimen: value('specimen'), animate: has('animate'), frames: has('frames'), painter: has('painter') };
  if (has('specimen') && !a.specimen) throw new Error('--specimen needs a JSON file or <table>/<id>');
  if (has('step')) {
    if (a.specimen === undefined) throw new Error('--step is for a test (--specimen), a seed has no steps');
    a.step = number('--step', value('step'), (n) => Number.isInteger(n) && n >= 0, 'a whole number from 0');
    for (const k of ['animate', 'frames', 'painter'] as const) if (a[k]) throw new Error(`--step draws one deformed frame, not with --${k}`);
  }
  for (const k of ['speed', 'duration'] as const) {
    if (!has(k)) continue;
    if (!a.animate) throw new Error(`--${k} is for --animate`);
    if (a.painter) throw new Error(`--${k} is for the exact renderer, not --painter`);
    a[k] = number(`--${k}`, value(k), (n) => n > 0, 'a number above 0');
  }
  return a;
}

// ---- the test: a JSON file, or <table>/<id> read like the page
export function readSpecimen(arg: string, hubData: string | undefined): { record: HubRecord; spec: Specimen } {
  let record: HubRecord;
  if (arg.endsWith('.json')) record = JSON.parse(readFileSync(arg, 'utf8')) as HubRecord;
  else {
    const at = arg.indexOf('/');
    if (at <= 0 || at === arg.length - 1) throw new Error(`--specimen needs a JSON file or <table>/<id>, not "${arg}"`);
    record = findRecord(arg.slice(0, at), arg.slice(at + 1), hubData);
  }
  return { record, spec: toSpecimen(record) }; // it says which field it can't read
}

// The shape at one step, as the playground makes it: the same response files,
// the same steps, the auto scale.
export function readStep(record: HubRecord, spec: Specimen, r: Result, step: number, hubData: string | undefined): { n: number; scale: number; state: DeformState } {
  const [table, id] = [hubTable(record), rowId(record)];
  if (!Object.hasOwn(DEFORMS, table)) throw new Error(`no deformed shape for the table ${table || 'of this record'} yet, so no --step`);
  let p;
  try {
    p = stepsOf(loadCurves(table, id, hubData), `${table}/${id}`);
  } catch (e) {
    throw new Error(`${(e as Error).message} (looked in ${responseDir(table, hubData)})`);
  }
  if (step > p.n - 1) throw new Error(`--step ${step} is over the last step of this test, ${p.n - 1}`);
  const scale = DEFORMS[table].autoScale(p);
  return { n: p.n, scale, state: shapeAt(table, r, spec, record, p, step, scale) };
}

export function main(argv: string[]) {
  const a = parseCliArgs(argv);
  const opt = (k: string, d: string) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
  // a <table>/<id> and the response files come from the hub data, as on the page
  const hubData = a.specimen && (!a.specimen.endsWith('.json') || a.step !== undefined) ? findHubData() : undefined;
  const test = a.specimen ? readSpecimen(a.specimen, hubData) : undefined;
  const spec = test?.spec;
  const family = opt('family', spec?.family ?? 'aisc') as Family;
  const view = opt('view', 'iso');
  const [az, el] = VIEWS[view] ?? view.split(',').map(Number);
  const out = opt('out', `steel-${spec ? spec.id : opt('seed', '1')}-${view}${a.step !== undefined ? `-step${a.step}` : ''}.svg`);
  const detail = opt('detail', 'bolts') as Detail;
  // exact hidden lines by default; --painter for the old, fast painter's trick
  const render = a.painter ? painter : renderHLR;

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
      bracing: opt('bracing', DEFAULTS.bracing) as Params['bracing'], xKind: opt('x-kind', DEFAULTS.xKind) as Params['xKind'], xP: num('x-braces', DEFAULTS.xP),
      conn: opt('conn', DEFAULTS.conn) as Params['conn'],
      armL: pair('arm-length', DEFAULTS.armL), armZ: pair('arm-height', DEFAULTS.armZ),
      braceP: num('braces', DEFAULTS.braceP), secondaryP: num('secondaries', DEFAULTS.secondaryP), postP: num('posts', DEFAULTS.postP),
      beamSpliceP: num('beam-splices', DEFAULTS.beamSpliceP), trussK: num('trusses', DEFAULTS.trussK), rodP: num('rods', DEFAULTS.rodP),
      colSpliceP: num('col-splice', DEFAULTS.colSpliceP), connKindsP: num('conn-kinds', DEFAULTS.connKindsP), skewP: num('skew', DEFAULTS.skewP),
      gableP: num('gable', DEFAULTS.gableP),
      roundP: num('round-tubes', DEFAULTS.roundP),
      shortBraceP: num('short-braces', DEFAULTS.shortBraceP),
    },
    cat,
    detail,
  );
  const t2 = performance.now();
  const weights = !argv.includes('--flat');
  const size = opt('size', '') ? +opt('size', '') : undefined;
  // the knobs of the playground: speed as "Part speed", duration in s as "Build time"
  const anim = { speed: a.speed, duration: a.duration === undefined ? undefined : a.duration * 1000 };
  const shape = a.step !== undefined ? readStep(test!.record, spec!, r, a.step, hubData) : undefined;
  const svg = shape
    ? shapeSvg(r.parts, shape.state, { az, el, weights, size })
    : render(r.parts, { az, el, animate: a.animate, weights, size, ...(a.painter ? {} : anim) });
  const t3 = performance.now();
  writeFileSync(out, svg.svg);

  const kb = (s: string) => (Buffer.byteLength(s) / 1024).toFixed(1);
  const lost = floating(r.parts);
  const beams = r.st.arms.map((a) => `${a.sec.id} ${a.gable ? 'gable ' : ''}${a.conn}${a.braces.map((b) => ' + brace ' + b.sec.id).join('')}`).join('; ');
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

  if (shape) {
    const { n, scale, state } = shape;
    console.log(`  step ${a.step} of 0..${n - 1} (the page shows ${a.step! + 1} / ${n}), schematic shape ×${scale}, from ${hubData ?? 'the examples of specimens/'}`);
    for (const z of state.zones) console.log(`    zone ${z.label}: ${z.ratio}, level ${z.level.toFixed(2)}`);
    for (const note of state.notes ?? []) console.log(`    note: ${note}`);
  }
  if (a.animate && !a.painter) {
    const end = buildEnd(timeline(r.parts, anim));
    console.log(`  animation: speed ×${a.speed ?? 1}, the build lasts ${(end / 1000).toFixed(1)} s${a.duration === undefined ? ' (its own length)' : ''}`);
  }

  if (a.frames) {
    const last = Math.max(...r.parts.map((p) => p.step));
    for (const pct of [25, 50, 75, 100]) {
      const f = out.replace(/\.svg$/, `-${pct}.svg`);
      writeFileSync(f, render(r.parts, { az, el, maxStep: Math.round((last * pct) / 100), weights }).svg);
      console.log(`  frame ${pct}%: ${f}`);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`cli: ${(e as Error).message}`);
    process.exit(1);
  }
}
