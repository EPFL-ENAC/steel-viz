// Real specimens: the two hub records in specimens/, and hand-written ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadCatalog, type Family } from './sections.ts';
import { floating, generate } from './generate.ts';
import { clashes } from './clash.ts';
import { readTables } from './tables.ts';
import { findSection, type Specimen } from './specimen.ts';
import { fromHubConnection, toSpecimen } from './hub.ts';

const cats = { aisc: loadCatalog('aisc', ...readTables('aisc')), eu: loadCatalog('eu', ...readTables('eu')) };
const record = (id: string) => JSON.parse(readFileSync(new URL(`./specimens/${id}.json`, import.meta.url), 'utf8'));
const near = (a: number, b: number, msg: string) => assert.ok(Math.abs(a - b) < 0.01, `${msg}: ${a} is not ${b}`);
const plates = (ids: string[]) => ids.filter((id) => /^column-stiffener/.test(id));

// the hub records, and what each one must give
const CASES: { id: string; family: Family; beams: number; L: number; conn: string; note?: RegExp }[] = [
  { id: 'Chi_and_Uang_2002_DC2', family: 'aisc', beams: 1, L: 3581.4, conn: 'welded', note: /RBS/ },
  { id: 'Ciutina_and_Dubina_2008_CP-R-M', family: 'eu', beams: 2, L: 1605, conn: 'welded' },
];

for (const c of CASES)
  test(`${c.id}: stands up, no clash, no floating part, the record dimensions`, () => {
    const rec = record(c.id);
    const r = generate({ specimen: toSpecimen(rec) }, cats[c.family]);
    assert.ok(r.ok, r.log.join('\n'));
    assert.equal(r.st.form, 'specimen');
    assert.equal(r.st.id, c.id);
    assert.deepEqual(clashes(r.parts), []);
    assert.deepEqual(floating(r.parts), []);
    // the column
    near(r.st.H, rec.h_c, 'column height');
    for (const [k, f] of [['d', 'd_c'], ['bf', 'b_cf'], ['tf', 't_cf'], ['tw', 't_cw']] as const) near(r.st.col[k], rec[f], `column ${k}`);
    assert.equal(r.st.col.id, rec.section_c);
    // the beams: on the two flange faces, at mid height
    assert.equal(r.st.arms.length, c.beams);
    assert.deepEqual(r.st.arms.map((a) => a.bearing), c.beams === 1 ? [0] : [0, 180]);
    for (const a of r.st.arms) {
      for (const [k, f] of [['d', 'd_b'], ['bf', 'b_bf'], ['tf', 't_bf'], ['tw', 't_bw']] as const) near(a.sec[k], rec[f], `${a.id} ${k}`);
      near(a.L, c.L, `${a.id} length`);
      near(a.z, rec.h_c / 2 + rec.d_b / 2, `${a.id} top of steel`);
      assert.equal(a.conn, c.conn);
    }
    if (c.note) assert.ok(r.log.some((l) => c.note!.test(l)), r.log.join('\n'));
    // t_cp > 0: continuity plates at the two flange levels, on both sides of the web
    assert.equal(plates(r.parts.map((p) => p.id)).length, 4);
    assert.ok(r.parts.some((p) => p.id === 'column-cap'));
  });

test('t_cp 0: no continuity plates', () => {
  const r = generate({ specimen: toSpecimen({ ...record('Chi_and_Uang_2002_DC2'), t_cp: 0 }) }, cats.aisc);
  assert.ok(r.ok);
  assert.equal(r.st.continuity, false);
  assert.deepEqual(plates(r.parts.map((p) => p.id)), []);
});

test('a CSV row (strings, NA) gives the same specimen as the API record', () => {
  const rec = record('Ciutina_and_Dubina_2008_CP-R-M');
  const row = Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, v === null ? 'NA' : v === false ? 'NO' : String(v)]));
  assert.deepEqual(fromHubConnection(row), fromHubConnection(rec));
  // the float noise of the CSV is rounded off
  const s = fromHubConnection({ ...row, d_b: '359.9999996', l_b: '3209.999997' });
  assert.equal(s.beams[0].length, 1605);
  assert.equal((s.beams[0].section as { d: number }).d, 360);
});

test('the hub connection types and the notes', () => {
  const base = record('Chi_and_Uang_2002_DC2');
  const conn = (ct: string) => fromHubConnection({ ...base, connection_type: ct });
  assert.equal(conn('WUF-W').beams[0].connection, 'welded');
  assert.deepEqual(conn('WUF-W').notes, []);
  assert.equal(conn('BFP').beams[0].connection, 'flange_plates');
  assert.equal(conn('BEEP').beams[0].connection, 'end_plate');
  assert.match(conn('KBB').notes!.join(), /Kaiser/);
  assert.match(conn('XYZ').notes!.join(), /not known/);
  const s = fromHubConnection({ ...base, n_dp: 2, slab: true });
  assert.match(s.notes!.join(), /doubler/);
  assert.match(s.notes!.join(), /slab/);
  // a free text name: the id comes from the dimensions
  assert.equal((fromHubConnection({ ...base, section_c: 'build up H section' }).column.section as { id: string }).id, 'H 713.74x355.6x19.05x34.036');
});

test('a hub record that we cannot draw throws a clear error', () => {
  const base = record('Chi_and_Uang_2002_DC2');
  assert.throws(() => fromHubConnection({ ...base, specimen_type: 'Exterior - Frame' }), /Exterior - Frame.*not supported/);
  assert.throws(() => fromHubConnection({ ...base, d_b: null }), /d_b is missing/);
  assert.throws(() => fromHubConnection({ ...base, h_c: 'NR' }), /h_c is missing/);
  assert.throws(() => toSpecimen([]), /JSON object/);
  assert.throws(() => toSpecimen({ foo: 1 }), /not a specimen/);
});

test('findSection: table names written the hub way, built-up names, errors', () => {
  assert.equal(findSection('W14x82', cats.aisc).id, 'W14X82');
  assert.equal(findSection('w 36 x 150', cats.aisc).id, 'W36X150'); // deeper than the random generator takes
  assert.equal(findSection('HEB 300', cats.eu).id, 'HE 300 B');
  assert.equal(findSection('HEAA 300', cats.eu).id, 'HE 300 AA');
  assert.equal(findSection('IPE360', cats.eu).id, 'IPE 360');
  const h = findSection('H-700x300x13x24', cats.aisc);
  assert.deepEqual([h.kind, h.d, h.bf, h.tw, h.tf], ['I', 700, 300, 13, 24]);
  const t = findSection({ id: 'box', shape: 'RHS', d: 300, bf: 200, tf: 10, tw: 10 }, cats.eu);
  assert.deepEqual([t.kind, t.d, t.bf], ['RHS', 300, 200]);
  assert.throws(() => findSection('HEB 300', cats.aisc), /not in the aisc table \(try the eu family/);
  assert.throws(() => findSection({ id: 'x', d: 100, bf: 100, tf: 60, tw: 10 }, cats.aisc), /too thick/);
  assert.throws(() => findSection({ id: 'x', d: 100, bf: -1, tf: 6, tw: 10 }, cats.aisc), /bf must be a number above 0/);
});

// hand-written specimens, in our own format
const column = (beams: Specimen['beams']): Specimen => ({ id: 'test', column: { section: 'W14X90', height: 3000 }, beams });

test('a column alone stands up', () => {
  const r = generate({ specimen: column([]) }, cats.aisc);
  assert.ok(r.ok);
  assert.deepEqual(r.parts.map((p) => p.id), ['base', 'column', 'column-cap']);
});

test('beams on the web, at a given height, with bolts', () => {
  const r = generate({ specimen: column([
    { section: 'W12X26', bearing: 90, length: 2000, at: 1800, connection: 'end_plate' },
    { section: 'W12X26', bearing: 270, length: 1500, at: 1800, connection: 'flange_plates' },
    { section: 'W16X31', bearing: 0, length: 2500, connection: 'welded' },
  ]) }, cats.aisc);
  assert.ok(r.ok, r.log.join('\n'));
  assert.deepEqual(clashes(r.parts), []);
  assert.deepEqual(floating(r.parts), []);
  near(r.st.arms[0].z, 1800 + r.st.arms[0].sec.d / 2, 'top of steel');
  assert.ok(r.parts.some((p) => p.id === 'beam1-bolts'));
});

test('a cantilever on a shear tab is a mechanism, not a crash', () => {
  const r = generate({ specimen: column([{ section: 'W16X31', bearing: 0, length: 2000, connection: 'shear_tab' }]) }, cats.aisc);
  assert.equal(r.ok, false);
  assert.match(r.log.join(), /mechanism/);
  assert.ok(r.parts.some((p) => p.id === 'beam1'));
});

test('a specimen that does not fit throws a clear error', () => {
  const beam = { section: 'W16X31', bearing: 0, length: 2000, connection: 'welded' } as const;
  const fails = (beams: Specimen['beams'], msg: RegExp) => assert.throws(() => generate({ specimen: column(beams) }, cats.aisc), msg);
  fails([beam, { ...beam, at: 1600 }], /beam1 and beam2 are on the same face/);
  fails([{ ...beam, at: 2900 }], /not inside the column height/);
  fails([{ ...beam, length: 200 }], /too short/);
  fails([{ ...beam, bearing: 45 as 0 }], /bearing must be/);
  fails([{ ...beam, connection: 'gusset' }], /connection must be/);
  fails([{ ...beam, section: 'W36X150', bearing: 90 }], /does not fit between the column flanges/);
  assert.throws(() => generate({ specimen: { ...column([]), column: { section: 'W14X90', height: 0 } } }, cats.aisc), /column height/);
});
