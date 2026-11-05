// Real specimens: the two hub records in specimens/, and hand-written ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { loadCatalog, type Family } from './sections.ts';
import { floating, generate } from './generate.ts';
import { clashes } from './clash.ts';
import { HUB_TABLES, readTables } from './tables.ts';
import { findSection, type ConnSpecimen } from './specimen.ts';
import { READERS, fromHubConnection, hubTable, toSpecimen } from './hub.ts';
import { geo, memberFaces } from './steel.ts';

const cats = { aisc: loadCatalog('aisc', ...readTables('aisc')), eu: loadCatalog('eu', ...readTables('eu')) };
const record = (id: string) => JSON.parse(readFileSync(new URL(`./specimens/${id}.json`, import.meta.url), 'utf8'));
const near = (a: number, b: number, msg: string) => assert.ok(Math.abs(a - b) < 0.01, `${msg}: ${a} is not ${b}`);
const plates = (ids: string[]) => ids.filter((id) => /^column-stiffener/.test(id));

// the hub records, and what each one must give
const CASES: { id: string; family: Family; beams: number; L: number; conn: string; load: 'beam' | 'column'; note?: RegExp }[] = [
  { id: 'Chi_and_Uang_2002_DC2', family: 'aisc', beams: 1, L: 3581.4, conn: 'welded', load: 'beam', note: /RBS/ },
  { id: 'Ciutina_and_Dubina_2008_CP-R-M', family: 'eu', beams: 2, L: 1605, conn: 'welded', load: 'column' },
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
  });

for (const c of CASES)
  test(`${c.id}: the test rig, ${c.load} loaded`, () => {
    const r = generate({ specimen: toSpecimen(record(c.id)) }, cats[c.family]);
    const ids = r.parts.map((p) => p.id);
    const kind = (id: string) => r.parts.find((p) => p.id === id)?.kind;
    assert.equal(r.st.load, c.load);
    // no base plate: an end plate on each column end, on a pin at the foot
    assert.ok(!ids.includes('base'));
    for (const id of ['column-foot', 'column-cap']) assert.equal(kind(id), 'plate', id);
    for (const id of ['foot-block', 'foot-pin', 'head']) assert.equal(kind(id), 'rig', id);
    // beam loaded: a link holds the top, an actuator pushes each beam tip.
    // column loaded: an actuator pushes the top, each beam tip is on a link.
    const [top, tip] = c.load === 'beam' ? ['top-link', 'actuator'] : ['top-actuator', 'link'];
    assert.equal(kind(top), 'rig');
    assert.ok(ids.includes(c.load === 'beam' ? 'post' : 'wall'));
    for (const a of r.st.arms) {
      const p = r.parts.find((q) => q.id === `${a.id}-${tip}`);
      assert.ok(p, `${a.id}-${tip}`);
      assert.equal(p.kind, 'rig');
      assert.deepEqual(p.supports, [`${a.id}-block`, a.id]);
    }
    // the rig goes down first and on last, the specimen in between
    const steps = r.parts.filter((p) => p.kind !== 'rig').map((p) => p.step);
    assert.ok(r.parts.find((p) => p.id === 'foot-pin')!.step < Math.min(...steps));
    assert.ok(r.parts.find((p) => p.id === top)!.step > Math.max(...steps));
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
  assert.equal(fromHubConnection(base).load, 'beam');
  assert.equal(fromHubConnection({ ...base, specimen_type: 'Interior - Column Loaded - Subassembly' }).load, 'column');
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
  assert.throws(() => fromHubConnection({ ...base, specimen_type: 'Exterior - Subassembly' }), /specimen_type.*not supported/);
  assert.throws(() => fromHubConnection({ ...base, d_b: null }), /d_b is missing/);
  assert.throws(() => fromHubConnection({ ...base, h_c: 'NR' }), /h_c is missing/);
  assert.throws(() => toSpecimen([]), /JSON object/);
  assert.throws(() => toSpecimen({ foo: 1 }), /not a specimen/);
});

// the playground groups the files of specimens/ by hubTable(), and asks the
// dev server for the tables of HUB_TABLES: the names must be the same
test('hubTable: a table for every file of specimens/, the names of HUB_TABLES', () => {
  assert.deepEqual(READERS.map(([t]) => t), Object.keys(HUB_TABLES));
  for (const f of readdirSync(new URL('./specimens/', import.meta.url)).filter((f) => f.endsWith('.json')))
    assert.ok(Object.hasOwn(HUB_TABLES, hubTable(record(f.slice(0, -5)))), `${f}: no hub table`);
  assert.equal(hubTable({ column: 'W14X90', beams: [] }), '');
  assert.equal(hubTable({ test: 'brace', section: 'W8X35' }), '');
  assert.equal(hubTable([]), '');
  assert.equal(hubTable(null), '');
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
const column = (beams: ConnSpecimen['beams']): ConnSpecimen => ({ id: 'test', column: { section: 'W14X90', height: 3000 }, beams });

test('a column alone stands up, in its rig', () => {
  const r = generate({ specimen: column([]) }, cats.aisc);
  assert.ok(r.ok, r.log.join('\n'));
  assert.deepEqual(r.parts.map((p) => p.id), ['foot-block', 'post', 'foot-pin', 'column-foot', 'column', 'column-cap', 'head', 'top-link']);
  assert.deepEqual(clashes(r.parts), []);
  assert.deepEqual(floating(r.parts), []);
});

test('column loaded: the actuator at the top holds nothing, the beam tip links do', () => {
  const beam = { section: 'W16X31', bearing: 0, length: 2000 } as const;
  const load = (connection: 'welded' | 'shear_tab') => generate({ specimen: { ...column([{ ...beam, connection }]), load: 'column' } }, cats.aisc);
  assert.ok(load('welded').ok, load('welded').log.join('\n'));
  // a pinned beam on a link: the column sways about its foot pin
  assert.equal(load('shear_tab').ok, false);
  // alone, nothing holds it in plane
  assert.equal(generate({ specimen: { ...column([]), load: 'column' } }, cats.aisc).ok, false);
  assert.throws(() => generate({ specimen: { ...column([]), load: 'top' as 'beam' } }, cats.aisc), /load must be beam or column/);
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
  const fails = (beams: ConnSpecimen['beams'], msg: RegExp) => assert.throws(() => generate({ specimen: column(beams) }, cats.aisc), msg);
  fails([beam, { ...beam, at: 1600 }], /beam1 and beam2 are on the same face/);
  fails([{ ...beam, at: 2900 }], /not inside the column height/);
  fails([{ ...beam, length: 200 }], /too short/);
  fails([{ ...beam, bearing: 45 as 0 }], /bearing must be/);
  fails([{ ...beam, connection: 'gusset' }], /connection must be/);
  fails([{ ...beam, section: 'W36X150', bearing: 90 }], /does not fit between the column flanges/);
  assert.throws(() => generate({ specimen: { ...column([]), column: { section: 'W14X90', height: 0 } } }, cats.aisc), /column height/);
});

test('a round tube from its dimensions, drawn round', () => {
  const s = findSection({ id: 'CHS 168.3x7.1', shape: 'CHS', d: 168.3, t: 7.1 }, cats.eu);
  assert.deepEqual([s.kind, s.d, s.bf, s.tf], ['CHS', 168.3, 168.3, 7.1]);
  assert.throws(() => findSection({ id: 'x', shape: 'CHS', d: 100, t: 50 }, cats.eu), /wall is too thick/);
  assert.throws(() => findSection({ id: 'x', shape: 'CHS', d: 100, t: 0 }, cats.eu), /t must be a number above 0/);
  // like a round bar: no edge along the tube, only its outline
  const f = memberFaces(geo('t', s, [0, 0, 0], [0, 0, 3000], false), 1e9);
  const sides = f.filter((x) => x.pts.length === 4);
  assert.equal(sides.length, 16);
  assert.ok(sides.every((x) => x.edges.length === 2));
});
