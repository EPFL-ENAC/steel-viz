// The HSS column tests: the two hub records in specimens/, the 3pb rig
// (lying on two rollers), the tests with no axial load, and the readings and
// errors of fromHubHssColumn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadCatalog } from './sections.ts';
import { floating, generate, type Detail } from './generate.ts';
import { clashes } from './clash.ts';
import { readTables } from './tables.ts';
import type { ColumnSpecimen } from './specimen.ts';
import { fromHubHssColumn, toSpecimen, type HubRecord } from './hub.ts';
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
const spread = (p: Part, n: V) => range(p, n)[1] - range(p, n)[0];
const [X, Z]: V[] = [[1, 0, 0], [0, 0, 1]];

const sound = (r: ReturnType<typeof generate>) => {
  assert.ok(r.ok, r.log.join('\n'));
  assert.deepEqual(clashes(r.parts), []);
  assert.deepEqual(floating(r.parts), []);
};
const logs = (r: { log: string[] } | { notes?: string[] }, re: RegExp) => {
  const lines = 'log' in r ? r.log : r.notes ?? [];
  assert.ok(lines.some((l) => re.test(l)), `${re} not in\n${lines.join('\n')}`);
};

test('Kuwada DT16-LD24-A45-ny03: a cantilever tube at 45°, with its rig', () => {
  const rec = record('Kuwada_et_al_2015__DT16-LD24-A45-ny03');
  const spec = toSpecimen(rec) as ColumnSpecimen;
  assert.deepEqual([spec.test, spec.ends, spec.angle, spec.axial, spec.length], ['column', 'fixed-free', 45, true, 485]);
  const r = generate({ specimen: spec }, cat);
  sound(r);
  assert.equal(r.st.col.kind, 'RHS');
  assert.equal(r.st.col.id, 'HSS-200x200x12');
  near(r.st.col.d, 200, 'tube depth');
  near(r.st.col.tf, 12, 'tube wall');
  assert.deepEqual(r.st.columnTest, { ends: 'fixed-free', L: 485, angle: 45 });
  assert.deepEqual(range(part(r.parts, 'column'), Z).map(Math.round), [0, 485]);
  for (const id of ['rig-floor', 'rig-head', 'rig-wall', 'rig-actuator', 'rig-crosshead', 'rig-axial']) assert.equal(part(r.parts, id).kind, 'rig', id);
  // the plates are not in the table: a default, and the log says so
  logs(r, /top end plate thickness not given, drawn 25 mm/);
});

test('Yamada No-14: a tube on two rollers (3pb), with the axial load', () => {
  const rec = record('Yamada_et_al_2012__No-14');
  const spec = toSpecimen(rec) as ColumnSpecimen;
  assert.deepEqual([spec.ends, spec.angle, spec.axial], ['3pb', 0, true]);
  // stiffness_coefficient 3: length__mm is half the span
  assert.equal(spec.length, 2 * Number(rec.length__mm));
  logs(spec, /length__mm 1265 is half the span, drawn 2530 mm/);
  const r = generate({ specimen: spec }, cat);
  sound(r);
  assert.equal(r.st.H, 2530);
  logs(r, /column test 3pb/);

  // the tube lies along x, on z = 0, past each roller
  const col = part(r.parts, 'column');
  near(range(col, Z)[0], 0, 'tube bottom', 0.5);
  near(spread(col, Z), 200, 'tube depth', 0.5);
  assert.ok(spread(col, X) > 2530);
  assert.deepEqual(col.supports, ['rig-roller', 'rig-roller2']);
  for (const [id, x] of [['rig-roller', -1265], ['rig-roller2', 1265]] as const) {
    const ro = part(r.parts, id);
    near((range(ro, X)[0] + range(ro, X)[1]) / 2, x, `${id} at x`, 0.5);
    near(range(ro, Z)[1], 0, `${id} top`, 0.5);
  }
  // the push down at mid span, the axial load along x
  const act = part(r.parts, 'rig-actuator');
  assert.deepEqual(act.supports, ['rig-crosshead', 'rig-saddle']);
  near(range(act, Z)[0], range(part(r.parts, 'rig-saddle'), Z)[1], 'actuator on the loading block', 0.5);
  assert.deepEqual(part(r.parts, 'rig-saddle').supports, ['column']);
  assert.deepEqual(part(r.parts, 'rig-axial').supports, ['rig-wall', 'column-end2']);
  assert.deepEqual(part(r.parts, 'rig-pin').supports, ['rig-block']);
  assert.ok(spread(part(r.parts, 'rig-axial'), X) >= 1000 - 0.5);
  for (const id of ['column-end', 'column-end2']) {
    assert.equal(part(r.parts, id).kind, 'plate');
    assert.deepEqual(part(r.parts, id).supports, ['column']);
  }
  for (const p of r.parts) assert.ok(['column', 'plate', 'rig'].includes(p.kind ?? ''), `${p.id}: kind ${p.kind}`);

  // every level of detail stands up (members: no plate)
  for (const detail of ['members', 'plates'] as Detail[]) {
    const rd = generate({ specimen: spec }, cat, detail);
    sound(rd);
    if (detail === 'members') assert.ok(rd.parts.every((p) => p.kind !== 'plate'));
  }
});

// a column record, with changes
const column = (o: Partial<ColumnSpecimen>): ColumnSpecimen => ({
  test: 'column', id: 'test', section: { id: 'HSS 203x152x9.5', shape: 'RHS', d: 203.2, bf: 152.4, tf: 9.5, tw: 9.5 },
  length: 2000, ends: '3pb', angle: 0, ...o,
});

for (const axial of [true, false])
  for (const angle of [0, 90, 45, 30])
    test(`3pb ${axial ? 'with' : 'no'} axial load, a rectangular tube at ${angle}°: no clash, no floating part`, () => {
      const r = generate({ specimen: column({ angle, axial }) }, cat);
      sound(r);
      // the depth runs along (0, sin a, cos a): at 0° it is vertical, in the push
      const a = (angle * Math.PI) / 180;
      const col = part(r.parts, 'column');
      near(spread(col, [0, Math.sin(a), Math.cos(a)]), 203.2, 'depth along the web', 0.5);
      near(spread(col, [0, Math.cos(a), -Math.sin(a)]), 152.4, 'width across the web', 0.5);
      near(range(col, Z)[0], 0, 'tube bottom', 0.5);
      for (const id of ['column-end', 'column-end2', 'rig-block', 'rig-pin', 'rig-wall', 'rig-axial']) assert.equal(has(r.parts, id), axial, id);
      if (axial)
        for (const id of ['column-end', 'column-end2'])
          for (const n of [[0, 1, 0], [0, 0, 1]] as V[]) assert.ok(spread(part(r.parts, id), n) > spread(col, n), `${id} too small`);
    });

test('3pb: an I section and a large tube draw too', () => {
  sound(generate({ specimen: column({ section: 'W14X90', angle: 90 }) }, cat));
  sound(generate({ specimen: column({ section: { id: 'big', shape: 'RHS', d: 550, bf: 550, tf: 25, tw: 25 }, length: 6000 }) }, cat));
});

test('no axial load: a cantilever has no vertical actuator, fixed-fixed keeps its two', () => {
  const cf = generate({ specimen: column({ ends: 'fixed-free', axial: false }) }, cat);
  sound(cf);
  assert.ok(!has(cf.parts, 'rig-axial') && !has(cf.parts, 'rig-crosshead'));
  logs(cf, /no axial load/);
  const dc = generate({ specimen: column({ ends: 'fixed-fixed', axial: false, angle: 45 }) }, cat);
  sound(dc);
  assert.equal(dc.parts.filter((p) => /^rig-axial/.test(p.id)).length, 2);
  logs(dc, /the two vertical actuators only hold the top straight/);
});

// a hub row with only the fields fromHubHssColumn reads
const ROW: HubRecord = {
  id: 'row', tube_section: 'HSS-200x200x6.0', depth__mm: 200, width__mm: 200, flange_thickness__mm: 6, web_thickness__mm: 6,
  test_configuration: 'CF', stiffness_coefficient: 3, length__mm: 750, loading_angle: 0, axial_load_ratio: 0.3, axial_load_sequence: 'Constant',
};
const read = (o: HubRecord) => fromHubHssColumn({ ...ROW, ...o });

test('fromHubHssColumn: the tube from the numbers, the name as id', () => {
  const s = read({});
  assert.deepEqual(s.section, { id: 'HSS-200x200x6.0', shape: 'RHS', d: 200, bf: 200, tf: 6, tw: 6 });
  assert.deepEqual([s.ends, s.length, s.angle, s.axial, s.plates], ['fixed-free', 750, 0, true, undefined]);
  assert.deepEqual(s.notes, []);
  const f = read({ tube_section: 'NR', depth__mm: 203.2, width__mm: 152.4, flange_thickness__mm: 9.5, web_thickness__mm: 9.5 });
  assert.deepEqual(f.section, { id: 'HSS 203.2x152.4x9.5', shape: 'RHS', d: 203.2, bf: 152.4, tf: 9.5, tw: 9.5 });
});

test('fromHubHssColumn: the length from the configuration and stiffness_coefficient', () => {
  const len = (test_configuration: string, stiffness_coefficient: number) => read({ test_configuration, stiffness_coefficient }).length;
  assert.equal(len('CF', 3), 750);
  assert.equal(len('DC', 6), 750);
  assert.equal(len('DC', 3), 1500);
  assert.equal(len('3PB', 6), 750);
  assert.equal(len('3PB', 3), 1500);
  logs(read({ test_configuration: 'DC' }), /length__mm 750 is half the column, drawn 1500 mm/);
  assert.equal(read({ test_configuration: 'DC' }).ends, 'fixed-fixed');
  assert.equal(read({ test_configuration: '3PB' }).ends, '3pb');
});

test('fromHubHssColumn: no axial load only when the ratio is 0 all along', () => {
  assert.equal(read({ axial_load_ratio: 0 }).axial, false);
  assert.equal(read({ axial_load_ratio: 0, axial_load_sequence: 'Varying' }).axial, true);
  assert.equal(read({ axial_load_ratio: 'NR' }).axial, true);
  assert.equal(read({ loading_angle: 45 }).angle, 45);
});

test('fromHubHssColumn: an error names the field it cannot read', () => {
  const fails = (o: HubRecord, msg: RegExp) => assert.throws(() => read(o), msg);
  fails({ depth__mm: 'NR' }, /^Error: row: depth__mm is missing$/);
  fails({ web_thickness__mm: '' }, /^Error: row: web_thickness__mm is missing$/);
  fails({ test_configuration: 'NA' }, /^Error: row: test_configuration is missing$/);
  fails({ test_configuration: '4PB' }, /^Error: row: test_configuration "4PB" is not supported yet$/);
  fails({ stiffness_coefficient: 'NR' }, /^Error: row: stiffness_coefficient is missing$/);
  fails({ stiffness_coefficient: 6 }, /^Error: row: stiffness_coefficient "6" is not supported yet$/);
  fails({ test_configuration: 'DC', stiffness_coefficient: 4 }, /^Error: row: stiffness_coefficient "4" is not supported yet$/);
  fails({ length__mm: 'NR' }, /^Error: row: length__mm is missing$/);
  fails({ loading_angle: '' }, /^Error: row: loading_angle is missing$/);
});

test('toSpecimen: an hss record goes to fromHubHssColumn', () => {
  const s = toSpecimen(ROW) as ColumnSpecimen;
  assert.deepEqual([s.test, s.section], ['column', read({}).section]);
  assert.throws(() => toSpecimen({ id: 'x' }), /"test_configuration"/);
});
