// The column tests: the two hub records in specimens/, then each end type and
// each axis, the end plates, and the errors of fromHubColumn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadCatalog } from './sections.ts';
import { floating, generate, type Detail } from './generate.ts';
import { clashes } from './clash.ts';
import { readTables } from './tables.ts';
import type { ColumnSpecimen } from './specimen.ts';
import { fromHubColumn, toSpecimen, type HubRecord } from './hub.ts';
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
const points = (p: Part) => p.faces.flatMap((f) => f.pts);
// the lowest and highest point of a part along the direction n
const range = (p: Part, n: V) => {
  const xs = points(p).map((v) => v[0] * n[0] + v[1] * n[1] + v[2] * n[2]);
  return [Math.min(...xs), Math.max(...xs)];
};
const spread = (p: Part, n: V) => range(p, n)[1] - range(p, n)[0];
// a pin joint as one part: the moving part and its mounts
const joint = (ps: Part[], id: string): Part => ({ ...part(ps, id), faces: ps.filter((p) => p.id === id || p.joint?.of === id).flatMap((p) => p.faces) });
const Z: V = [0, 0, 1];

const sound = (r: ReturnType<typeof generate>) => {
  assert.ok(r.ok, r.log.join('\n'));
  assert.deepEqual(clashes(r.parts), []);
  assert.deepEqual(floating(r.parts), []);
};

const CASES = [
  { id: 'Elkady_and_Lignos_C1', ends: 'fixed-fixed', angle: 0, axial: 2 },
  { id: 'Elkady_and_Lignos_C6', ends: 'fixed-flexible', angle: 45, axial: 1, notes: [/Bi-axial/, /Fixed-Flexible/] },
] as const;

for (const c of CASES)
  test(`${c.id}: the column in its rig, no clash, no floating part`, () => {
    const rec = record(c.id);
    const spec = toSpecimen(rec) as ColumnSpecimen;
    assert.equal(spec.test, 'column');
    assert.equal(spec.ends, c.ends);
    assert.equal(spec.angle, c.angle);
    const r = generate({ specimen: spec }, cat);
    sound(r);
    assert.equal(r.st.id, c.id);
    assert.equal(r.st.col.kind, 'I');
    near(r.st.col.d, Number(rec.d_c), 'column d');
    near(r.st.col.bf, Number(rec.b_cf), 'column bf');
    assert.deepEqual(r.st.columnTest, { ends: c.ends, L: rec.l_c, angle: c.angle });
    if ('notes' in c) for (const n of c.notes) assert.ok(r.log.some((l) => n.test(l)), `${n} not in\n${r.log.join('\n')}`);

    // the column stands on z = 0, as long as l_c, its end plates outside it
    const L = Number(rec.l_c);
    const col = part(r.parts, 'column');
    assert.equal(col.kind, 'column');
    assert.deepEqual(range(col, Z).map(Math.round), [0, Math.round(L)]);
    const foot = part(r.parts, 'column-foot');
    const cap = part(r.parts, 'column-cap');
    assert.deepEqual(range(foot, Z).map(Math.round), [-Number(rec.t_bottom_plate), 0]);
    assert.deepEqual(range(cap, Z).map(Math.round), [Math.round(L), Math.round(L + Number(rec.t_top_plate))]);
    assert.deepEqual(foot.supports, ['rig-floor']);
    assert.deepEqual(col.supports, ['column-foot']);
    assert.deepEqual(cap.supports, ['column']);
    assert.equal(foot.dots.length, 8);

    // the rig: every part that is not the specimen
    const axial = c.axial === 2 ? ['rig-spreader', 'rig-axial', 'rig-axial2'] : ['rig-axial'];
    for (const id of ['rig-floor', 'rig-head', 'rig-wall', 'rig-actuator', 'rig-crosshead', ...axial]) assert.equal(part(r.parts, id).kind, 'rig', id);
    assert.equal(r.parts.filter((p) => /^rig-axial\d?$/.test(p.id)).length, c.axial);
    for (const p of r.parts) assert.ok(['column', 'plate', 'rig'].includes(p.kind ?? ''), `${p.id}: kind ${p.kind}`);
    // the push along y, from the wall to the head; the axial load on the head
    assert.deepEqual(part(r.parts, 'rig-actuator').supports, ['rig-wall', 'rig-head']);
    assert.ok(spread(joint(r.parts, 'rig-actuator'), [0, 1, 0]) > 1000);
    for (const id of axial.filter((a) => a.startsWith('rig-axial'))) {
      assert.ok(part(r.parts, id).supports.includes('rig-head'), id);
      near(range(part(r.parts, `${id}-mount-to`), Z)[0], range(part(r.parts, 'rig-head'), Z)[1], `${id} on the head`, 0.5);
    }

    // every level of detail stands up (members: no plate)
    for (const detail of ['members', 'plates'] as Detail[]) {
      const rd = generate({ specimen: spec }, cat, detail);
      sound(rd);
      if (detail === 'members') {
        assert.ok(rd.parts.every((p) => p.kind !== 'plate'));
        assert.deepEqual(part(rd.parts, 'column').supports, ['rig-floor']);
        assert.deepEqual(part(rd.parts, 'rig-head').supports, ['column']);
      } else assert.ok(rd.parts.every((p) => p.dots.length === 0));
    }
  });

// a column record, with changes
const column = (o: Partial<ColumnSpecimen>): ColumnSpecimen => ({
  test: 'column', id: 'test', section: 'W14X90', length: 3000, ends: 'fixed-free', angle: 0, plates: { top: 40, bottom: 50 }, ...o,
});

for (const ends of ['fixed-free', 'fixed-fixed', 'fixed-flexible'] as const)
  for (const angle of [0, 90, 45, 30])
    test(`${ends}, pushed at ${angle}° from the web: no clash, no floating part`, () => {
      const r = generate({ specimen: column({ ends, angle }) }, cat);
      sound(r);
      assert.equal(r.parts.filter((p) => /^rig-axial\d?$/.test(p.id)).length, ends === 'fixed-fixed' ? 2 : 1);
      // the web is turned by the angle: the depth runs along (sin a, cos a)
      const a = (angle * Math.PI) / 180;
      const col = part(r.parts, 'column');
      near(spread(col, [Math.sin(a), Math.cos(a), 0]), r.st.col.d, 'depth along the web', 0.5);
      near(spread(col, [Math.cos(a), -Math.sin(a), 0]), r.st.col.bf, 'width across the web', 0.5);
      // the end plates cover the turned column
      for (const id of ['column-foot', 'column-cap'])
        for (const n of [[1, 0, 0], [0, 1, 0]] as V[]) assert.ok(spread(part(r.parts, id), n) > spread(col, n), `${id} too small`);
    });

test('a small and a large section both draw', () => {
  for (const section of ['W4X13', 'W36X925']) sound(generate({ specimen: column({ section, ends: 'fixed-fixed', length: 1000 }) }, cat));
});

test('no plate thickness: a default, and the log says so', () => {
  const r = generate({ specimen: column({ plates: undefined }) }, cat);
  sound(r);
  assert.ok(r.log.some((l) => /top end plate thickness not given/.test(l)), r.log.join('\n'));
  assert.ok(r.log.some((l) => /bottom end plate thickness not given/.test(l)), r.log.join('\n'));
  assert.ok(spread(part(r.parts, 'column-cap'), Z) >= 25);
});

test('buildColumn: a bad length, end type or angle throws', () => {
  assert.throws(() => generate({ specimen: column({ length: 0 }) }, cat), /test: length must be a number above 0/);
  assert.throws(() => generate({ specimen: column({ ends: 'pinned' as ColumnSpecimen['ends'] }) }, cat), /test: ends must be one of/);
  assert.throws(() => generate({ specimen: column({ angle: NaN }) }, cat), /test: angle must be a number/);
});

// a hub row with only the fields fromHubColumn reads
const ROW: HubRecord = {
  id: 'row', section_c: 'W14X90', d_c: 356, b_cf: 369, t_cf: 18, t_cw: 11.2, h_c: 300, l_c: 3000,
  boundary_condition: 'Fixed-Free', axis_of_bending: 'Strong', t_top_plate: 50, t_bottom_plate: 'NR', test_procedure: 'Axial load first.',
};
const read = (o: HubRecord) => fromHubColumn({ ...ROW, ...o });

test('fromHubColumn: the section from the numbers, the length from l_c', () => {
  const s = read({ section_c: 'Built Up S10' });
  assert.deepEqual(s.section, { id: 'H 356x369x11.2x18', d: 356, bf: 369, tf: 18, tw: 11.2 });
  assert.equal(s.length, 3000);
  assert.deepEqual(s.plates, { top: 50, bottom: undefined });
  assert.deepEqual(read({}).notes, []);
});

test('fromHubColumn: the end types, the axes and their notes', () => {
  assert.equal(read({ boundary_condition: 'Fixed-Fixed' }).ends, 'fixed-fixed');
  const fl = read({ boundary_condition: 'Fixed-Flexible' });
  assert.equal(fl.ends, 'fixed-flexible');
  assert.ok(fl.notes?.some((n) => /spring that holds the top is not drawn/.test(n)));
  assert.equal(read({ axis_of_bending: 'Weak' }).angle, 90);
  const bi = read({ axis_of_bending: 'Bi-axial' });
  assert.equal(bi.angle, 45);
  assert.ok(bi.notes?.some((n) => /no loading angle, drawn at 45°/.test(n)));
  const lying = read({ test_procedure: 'The column was tested in a horizontal configuration.' });
  assert.ok(lying.notes?.some((n) => /tested lying down/.test(n)));
});

test('fromHubColumn: an error names the field it cannot read', () => {
  const fails = (o: HubRecord, msg: RegExp) => assert.throws(() => read(o), msg);
  fails({ d_c: 'NA' }, /^Error: row: d_c is missing$/);
  fails({ t_cw: '' }, /^Error: row: t_cw is missing$/);
  fails({ l_c: 'NR' }, /^Error: row: l_c is missing$/);
  fails({ boundary_condition: 'NA' }, /^Error: row: boundary_condition is missing$/);
  fails({ boundary_condition: 'Pinned-Pinned' }, /^Error: row: boundary_condition "Pinned-Pinned" is not supported yet$/);
  fails({ axis_of_bending: '' }, /^Error: row: axis_of_bending is missing$/);
  fails({ axis_of_bending: 'Torsion' }, /^Error: row: axis_of_bending "Torsion" is not supported yet$/);
});

test('toSpecimen: a column record goes to fromHubColumn, a hand-written one goes through', () => {
  assert.equal(toSpecimen(ROW).test, 'column');
  const s = column({ id: 'mine' });
  assert.deepEqual(toSpecimen(JSON.parse(JSON.stringify(s))), s);
});
