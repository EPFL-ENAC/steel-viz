// The EBF link tests: the two hub records in specimens/, the stiffener rule,
// every rig (TF1, the link in the middle of a frame, the link at its edge),
// and the readings and errors of fromHubEbf.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadCatalog } from './sections.ts';
import { floating, generate, type Detail } from './generate.ts';
import { clashes } from './clash.ts';
import { readTables } from './tables.ts';
import { LINK_CONFIGS, type LinkSpecimen } from './specimen.ts';
import { fromHubEbf, linkStiffeners, toSpecimen, type HubRecord } from './hub.ts';
import type { Part } from './steel.ts';
import type { V } from './vec.ts';

const cat = loadCatalog('aisc', ...readTables('aisc'));
const record = (id: string): HubRecord => JSON.parse(readFileSync(new URL(`./specimens/${id}.json`, import.meta.url), 'utf8'));
const near = (a: number, b: number, msg: string, tol = 0.01) => assert.ok(Math.abs(a - b) < tol, `${msg}: ${a} is not ${b}`);
const part = (ps: Part[], id: string) => {
  const p = ps.find((q) => q.id === id);
  assert.ok(p, `no part ${id} in ${ps.map((q) => q.id).join(', ')}`);
  return p;
};
const has = (ps: Part[], id: string) => ps.some((p) => p.id === id);
const points = (p: Part) => p.faces.flatMap((f) => f.pts);
// the lowest and highest point of a part along the direction n
const range = (p: Part, n: V) => {
  const xs = points(p).map((v) => v[0] * n[0] + v[1] * n[1] + v[2] * n[2]);
  return [Math.min(...xs), Math.max(...xs)];
};
const mid = (p: Part, n: V) => (range(p, n)[0] + range(p, n)[1]) / 2;
const [Y, Z]: V[] = [[0, 1, 0], [0, 0, 1]];

const sound = (r: ReturnType<typeof generate>) => {
  assert.ok(r.ok, r.log.join('\n'));
  assert.deepEqual(clashes(r.parts), []);
  assert.deepEqual(floating(r.parts), []);
};
const logs = (r: { log: string[] } | { notes?: string[] }, re: RegExp) => {
  const lines = 'log' in r ? r.log : r.notes ?? [];
  assert.ok(lines.some((l) => re.test(l)), `${re} not in\n${lines.join('\n')}`);
};
// the stiffener centres along y, on the front (+x) or the back (-x), from the link start
const stiffeners = (ps: Part[], side: 1 | -1, y0: number) =>
  ps.filter((p) => p.info?.type === 'Stiffener' && p.from?.[0] === side).map((p) => Math.round((mid(p, Y) - y0) * 100) / 100).sort((a, b) => a - b);

test('Hjelmstad & Popov 4: an isolated link (TF1), between a block and a loading beam', () => {
  const spec = toSpecimen(record('Hjelmstad_and_Popov_1983_4')) as LinkSpecimen;
  assert.deepEqual([spec.test, spec.id, spec.config, spec.at, spec.e, spec.ends], ['link', 'ebf-18', 'TF1', 'middle', 711, 'bolted']);
  assert.deepEqual(spec.section, { id: 'W18x40', d: 455, bf: 153, tf: 13.3, tw: 8 });
  assert.deepEqual(spec.stiffeners, { t: 9.5, front: [177.75, 355.5, 533.25], back: [177.75, 355.5, 533.25] });
  assert.equal(spec.frame, undefined);
  const r = generate({ specimen: spec }, cat);
  sound(r);
  assert.deepEqual(r.st.link, { config: 'TF1', at: 'middle', e: 711, stiffeners: 10 });

  // the link along y from 0 to e, its axis at 910 mm (2 d)
  const link = part(r.parts, 'link');
  assert.deepEqual(range(link, Y).map((v) => Math.round(v)), [0, 711]);
  near(mid(link, Z), 910, 'link axis', 0.5);
  // an end stiffener at each end, the three of the data, on both faces
  for (const side of [1, -1] as const) assert.deepEqual(stiffeners(r.parts, side, 0), [4.75, 177.75, 355.5, 533.25, 706.25]);

  // end plate A on the block, end plate B under the loading beam, pushed from the crosshead
  assert.deepEqual(part(r.parts, 'link-endA').supports, ['rig-block']);
  near(range(part(r.parts, 'rig-block'), Y)[1], range(part(r.parts, 'link-endA'), Y)[0], 'block on end plate A', 0.5);
  assert.deepEqual(part(r.parts, 'rig-load').supports, ['link-endB']);
  near(range(part(r.parts, 'rig-load'), Y)[0], range(part(r.parts, 'link-endB'), Y)[1], 'loading beam on end plate B', 0.5);
  assert.deepEqual(part(r.parts, 'rig-actuator').supports, ['rig-crosshead', 'rig-load']);
  for (const id of ['rig-block', 'rig-load', 'rig-crosshead', 'rig-actuator']) assert.equal(part(r.parts, id).kind, 'rig', id);
  logs(r, /end plate thickness not given, drawn 20 mm/);
  logs(r, /link test TF1 \(middle\), e 711 mm, end plates, not solved/);
});

test('Volynkin & Clifton AL-4C: a link at the edge of a frame (TF4)', () => {
  const spec = toSpecimen(record('Volynkin_and_Clifton_2016_AL-4C')) as LinkSpecimen;
  assert.deepEqual([spec.config, spec.at, spec.e, spec.endPlate, spec.brace], ['TF4', 'edge', 862, 45, 56.4]);
  assert.deepEqual(spec.frame, { span: 3000, height: 2800 });
  assert.deepEqual(spec.stiffeners.front, [172.4, 344.8, 517.2, 689.6]);
  assert.deepEqual(spec.notes, []);
  const r = generate({ specimen: spec }, cat);
  sound(r);
  assert.deepEqual(r.st.link, { config: 'TF4', at: 'edge', e: 862, stiffeners: 12, span: 3000, height: 2800 });
  // the data says it all: no default, no note
  assert.deepEqual(r.log.filter((l) => !l.startsWith('link test')), []);

  // the link against colA, its axis at the frame height
  const [link, endA, colA] = [part(r.parts, 'link'), part(r.parts, 'link-endA'), part(r.parts, 'rig-colA')];
  near(range(endA, Y)[0], range(colA, Y)[1], 'end plate A on colA', 0.5);
  near(range(endA, Y)[1] - range(endA, Y)[0], 45, 'end plate A thickness', 0.5);
  near(mid(link, Z), 2800, 'link axis', 0.5);
  near(range(link, Y)[1] - range(link, Y)[0], 862, 'link length', 0.5);
  for (const side of [1, -1] as const) assert.deepEqual(stiffeners(r.parts, side, range(link, Y)[0]), [4.75, 172.4, 344.8, 517.2, 689.6, 857.25]);
  // the frame brace up from near the foot of colB, its top just under the link end
  const brace = part(r.parts, 'rig-brace');
  near(range(brace, Z)[1], 2800 - 350 / 2 - 2, 'brace top', 0.5);
  assert.ok(Math.abs(range(brace, Y)[0] - range(link, Y)[1]) < 300, 'brace top near the link end');
  assert.ok(!has(r.parts, 'rig-brace2') && !has(r.parts, 'rig-beamA'));
  assert.deepEqual(part(r.parts, 'rig-beamB').supports, ['link-endB', 'rig-colB']);
  // pushed on colB, from a wall at +y
  assert.deepEqual(part(r.parts, 'rig-actuator').supports, ['rig-wall', 'rig-colB']);
  assert.ok(range(part(r.parts, 'rig-wall'), Y)[0] > range(part(r.parts, 'rig-colB'), Y)[1]);
});

// a link spec, with changes
const link = (o: Partial<LinkSpecimen>): LinkSpecimen => ({
  test: 'link', id: 'test', section: 'W18X40', e: 711, at: 'middle', config: 'TF2', stiffeners: { front: [], back: [] }, ...o,
});

for (const config of LINK_CONFIGS)
  for (const e of [152, 711, 3556])
    test(`${config}, e ${e} mm: no clash, no floating part, at every level of detail`, () => {
      const front = [...Array(3).keys()].map((k) => ((k + 1) * e) / 4);
      const spec = link({ config, e, at: /TF4/.test(config) ? 'edge' : 'middle', ends: 'bolted', stiffeners: { front, back: front } });
      for (const detail of ['members', 'plates', 'bolts'] as Detail[]) {
        const r = generate({ specimen: spec }, cat, detail);
        sound(r);
        if (detail === 'members') assert.ok(r.parts.every((p) => p.kind !== 'plate'));
      }
      const r = generate({ specimen: spec }, cat);
      near(range(part(r.parts, 'link'), Y)[1] - range(part(r.parts, 'link'), Y)[0], e, 'link length', 0.5);
      assert.equal(has(r.parts, 'rig-brace'), config !== 'TF1');
      assert.equal(has(r.parts, 'rig-brace2'), config !== 'TF1' && !/TF4/.test(config));
    });

test('frame rigs: welded ends, a short frame, a flat brace, a default size', () => {
  // welded: no end plate, the link on the beam piece
  const w = generate({ specimen: link({ ends: 'welded' }) }, cat);
  sound(w);
  assert.ok(!has(w.parts, 'link-endA'));
  assert.deepEqual(part(w.parts, 'link').supports, ['rig-beamA']);
  // too small for the link: drawn bigger, the log says so
  const s = generate({ specimen: link({ e: 2000, frame: { span: 2000, height: 500 } }) }, cat);
  sound(s);
  logs(s, /frame span 2000 mm is too short for the link and the frame columns, drawn \d+ mm/);
  logs(s, /frame height 500 mm is too low for the frame braces, drawn \d+ mm/);
  // no frame size: from the brace angle when there is one
  const a = generate({ specimen: link({ brace: 45 }) }, cat);
  sound(a);
  logs(a, /l_st, h_st not given: frame drawn 3000 x 1145 mm \(the height from the brace angle 45°\)/);
  assert.ok(!a.log.some((l) => l.startsWith('brace angle')));
  const f = generate({ specimen: link({ brace: 25, config: 'TF4', at: 'edge' }) }, cat);
  sound(f);
  logs(f, /frame drawn \d+ x 1455 mm to keep the brace angle 25°/);
  const d = generate({ specimen: link({}) }, cat);
  logs(d, /l_st, h_st not given: frame drawn 3000 x 1800 mm$/);
  logs(d, /stiffener thickness not given, drawn 10 mm/);
  // a brace angle that the frame sizes don't give
  logs(generate({ specimen: link({ frame: { span: 5000, height: 2700 }, e: 600, brace: 31.5 }) }, cat), /brace angle 31.5° given, the frame sizes give 50.8°/);
});

test('buildLink: an error for a bad spec', () => {
  assert.throws(() => generate({ specimen: link({ e: 0 }) }, cat), /test: e must be a number above 0/);
  assert.throws(() => generate({ specimen: link({ config: 'TF5' as LinkSpecimen['config'] }) }, cat), /test: config must be one of TF1/);
  assert.throws(() => generate({ specimen: link({ section: 'HSS6X6X3/8' }) }, cat), /must be an I section/);
});

// ------------------------------------------------------------- the reader
// a hub row with only the fields fromHubEbf reads
const ROW: HubRecord = {
  id: 1, profile: 'W12x16', h_n: 304.5, bf_n: 101.3, tf_n: 6.7, tw_n: 5.6, e: 300, l_confi: 'TF2', link_loc: 'middle', l_con_typ: 'welded',
  l_s_side: 'single', l_s_reg: 'regular', l_s_no_f: 2, l_s_d_pnl_1_f: 100, l_s_d_pnl_2_f: 'NA', l_s_no_b: 'NA', l_s_d_pnl_1_b: 'NA', l_s_d_pnl_2_b: 'NA',
  t_s: 6.4, t_e_s: 'NA', l_st: 'NA', h_st: 'NA', a_b_b: 'NA', tf_add_n: 'NA',
};
const read = (o: HubRecord) => fromHubEbf({ ...ROW, ...o });
const stiff = (o: HubRecord, e = 300) => linkStiffeners({ ...ROW, ...o }, e);

test('fromHubEbf: the link from the nominal sizes', () => {
  const s = read({});
  assert.deepEqual(s.section, { id: 'W12x16', d: 304.5, bf: 101.3, tf: 6.7, tw: 5.6 });
  assert.deepEqual([s.id, s.e, s.config, s.at, s.ends, s.endPlate, s.frame, s.brace], ['ebf-1', 300, 'TF2', 'middle', 'welded', undefined, undefined, undefined]);
  assert.deepEqual(s.stiffeners, { t: 6.4, front: [100, 200], back: [] });
  assert.deepEqual(s.notes, []);
  const b = read({ l_con_typ: 'bolted', t_e_s: 30, l_st: 4000, h_st: 2500, a_b_b: 40 });
  assert.deepEqual([b.ends, b.endPlate, b.frame, b.brace], ['bolted', 30, { span: 4000, height: 2500 }, 40]);
  // the hub code writes TF2C, the data TF2c
  assert.equal(read({ l_confi: 'TF2C' }).config, 'TF2c');
  logs(read({ l_confi: 'TF2c' }), /the concrete slab is not drawn yet/);
  logs(read({ l_confi: 'TF3c' }), /link in a system: drawn as TF2/);
  logs(read({ l_confi: 'TF1', link_loc: 'edge' }), /l_confi TF1 is an isolated link, link_loc says edge: drawn as TF1/);
  logs(read({ profile: 'C 200x75' }), /built up from channels, drawn as an I/);
  logs(read({ tf_add_n: 12 }), /extra flange plates \(tf_add_n 12 mm\) not drawn/);
});

test('TF1 at the edge, no frame size: drawn, with the notes', () => {
  const r = generate({ specimen: read({ l_confi: 'TF1', link_loc: 'edge' }) }, cat);
  sound(r);
  assert.equal(r.st.link?.config, 'TF1');
  logs(r, /link_loc says edge/);
});

test('linkStiffeners: regular, non-regular, and what does not add up', () => {
  // regular: n at e / (n + 1)
  assert.deepEqual(stiff({}), { front: [100, 200], back: [], notes: [] });
  // non-regular (id 19): end panels p1, inner panels p2
  assert.deepEqual(stiff({ l_s_reg: 'non-regular', l_s_no_f: 2, l_s_d_pnl_1_f: 215.9, l_s_d_pnl_2_f: 279.4 }, 711.2).front, [215.9, 495.3]);
  // more than 3 % off e: at equal spacing, with a note
  const off = stiff({ l_s_no_f: 3, l_s_d_pnl_1_f: 203.2 }, 737);
  assert.deepEqual(off.front, [184.25, 368.5, 552.75]);
  assert.deepEqual(off.notes, ['front stiffeners: 3 at 203.2 mm does not fill e 737 mm, drawn at equal spacing']);
  // double, the front and the back different (id 155)
  const d = stiff({ l_s_side: 'double', l_s_no_f: 2, l_s_d_pnl_1_f: 216.4, l_s_d_pnl_2_f: 432.8, l_s_no_b: 3, l_s_d_pnl_1_b: 432.8 }, 837);
  assert.deepEqual([d.front, d.back], [[279, 558], [209.25, 418.5, 627.75]]);
  assert.deepEqual(d.notes, [
    'front stiffeners: 2 with panels 216.4 and 432.8 mm do not fill e 837 mm, drawn at equal spacing',
    'back stiffeners: 3 at 432.8 mm does not fill e 837 mm, drawn at equal spacing',
  ]);
  // single: no back stiffener even when the row has counts there
  assert.deepEqual(stiff({ l_s_no_b: 2, l_s_d_pnl_1_b: 100 }).back, []);
  // NA: none, NR: none, with a note, no spacing: none, with a note
  assert.deepEqual(stiff({ l_s_side: 'NA', l_s_no_f: 'NA', l_s_d_pnl_1_f: 'NA' }), { front: [], back: [], notes: [] });
  assert.deepEqual(stiff({ l_s_side: 'NR' }), { front: [], back: [], notes: ['stiffeners not reported: only the end stiffeners are drawn'] });
  assert.deepEqual(stiff({ l_s_d_pnl_1_f: 'NR' }).notes, ['front stiffener spacing not reported: only the end stiffeners are drawn']);
});

test('fromHubEbf: an error names the field it cannot read', () => {
  const fails = (o: HubRecord, msg: RegExp) => assert.throws(() => read(o), msg);
  fails({ h_n: 'NR' }, /^Error: ebf-1: h_n is missing$/);
  fails({ tw_n: '' }, /^Error: ebf-1: tw_n is missing$/);
  fails({ e: 'NA' }, /^Error: ebf-1: e is missing$/);
  fails({ l_confi: 'NA' }, /^Error: ebf-1: l_confi is missing$/);
  fails({ l_confi: 'TF5' }, /^Error: ebf-1: l_confi "TF5" is not supported yet$/);
  fails({ link_loc: '' }, /^Error: ebf-1: link_loc is missing$/);
  fails({ link_loc: 'top' }, /^Error: ebf-1: link_loc "top" is not supported yet$/);
});

test('toSpecimen: an EBF record goes to fromHubEbf, our own link JSON goes through', () => {
  const s = toSpecimen(ROW) as LinkSpecimen;
  assert.deepEqual([s.test, s.section], ['link', read({}).section]);
  const own = toSpecimen(JSON.parse(JSON.stringify(link({ config: 'TF4', at: 'edge' }))));
  sound(generate({ specimen: own }, cat));
  assert.throws(() => toSpecimen({ id: 'x' }), /"link_loc"/);
});
