// The brace tests: the three hub records in specimens/, then each frame and
// each end type, the section shapes, and the errors of fromHubBrace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadCatalog } from './sections.ts';
import { floating, generate, type Detail } from './generate.ts';
import { clashes } from './clash.ts';
import { readTables } from './tables.ts';
import { findSection, type BraceSpecimen } from './specimen.ts';
import { fromHubBrace, toSpecimen, type HubRecord } from './hub.ts';
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
// the size of a part along the direction n
const spread = (p: Part, n: V) => {
  const xs = points(p).map((v) => v[0] * n[0] + v[1] * n[1] + v[2] * n[2]);
  return Math.max(...xs) - Math.min(...xs);
};

// how well the points of a part follow the line through w0 (in the plane
// x = x0) along the direction u: the largest distance to the line, and the
// part of the line they cover
function along(p: Part, x0: number, w0: [number, number], u: [number, number]) {
  let [far, t0, t1] = [0, Infinity, -Infinity];
  for (const v of points(p)) {
    const [dy, dz] = [v[1] - w0[0], v[2] - w0[1]];
    const t = dy * u[0] + dz * u[1];
    far = Math.max(far, Math.hypot(v[0] - x0, dy - t * u[0], dz - t * u[1]));
    [t0, t1] = [Math.min(t0, t), Math.max(t1, t)];
  }
  return { far, t0, t1 };
}

const sound = (r: ReturnType<typeof generate>) => {
  assert.ok(r.ok, r.log.join('\n'));
  assert.deepEqual(clashes(r.parts), []);
  assert.deepEqual(floating(r.parts), []);
};

const CASES = [
  { id: 'Fell_et_al_HSS1-1', frame: 'SB', ends: 'gusset', kind: 'RHS', t: 12.7, braces: 1 },
  { id: 'Takeuchi_Matsui_528', frame: 'SBF', ends: 'gusset', kind: 'CHS', t: 10, braces: 1, note: /t_b says "Pin-Pin Ended"/ },
  { id: 'Wakabayashi_DPC1-1', frame: 'DBF', ends: 'fixed', kind: 'CHS', t: 12, braces: 2 },
] as const;

for (const c of CASES)
  test(`${c.id}: the brace in its ${c.frame} rig, no clash, no floating part`, () => {
    const rec = record(c.id);
    const spec = toSpecimen(rec) as BraceSpecimen;
    assert.equal(spec.test, 'brace');
    assert.equal(spec.frame, c.frame);
    assert.equal(spec.ends, c.ends);
    const r = generate({ specimen: spec }, cat);
    sound(r);
    assert.equal(r.st.id, c.id);
    assert.equal(r.st.col.kind, c.kind);
    near(r.st.col.d, Number(rec.d_br), 'brace d');
    assert.deepEqual(r.st.brace, { frame: c.frame, L: rec.l_b, angle: rec.brace_angle, ends: c.ends });
    if ('note' in c) assert.ok(r.log.some((l) => c.note.test(l)), r.log.join('\n'));

    // each brace on its diagonal, between its end details
    const L = Number(rec.l_b);
    const a = (Number(rec.brace_angle) * Math.PI) / 180;
    const u: [number, number] = [Math.cos(a), Math.sin(a)];
    const braces = r.parts.filter((p) => p.info?.type === 'Brace');
    assert.equal(braces.length, c.braces);
    for (const b of braces) {
      assert.equal(b.kind, 'member');
      const x0 = (Math.max(...points(b).map((v) => v[0])) + Math.min(...points(b).map((v) => v[0]))) / 2;
      const fit = b.id === 'brace' ? along(b, x0, [0, 0], u) : along(b, x0, [L * u[0], 0], [-u[0], u[1]]);
      assert.ok(fit.far <= Math.hypot(r.st.col.d, r.st.col.bf) / 2 + 0.5, `${b.id}: ${fit.far} mm off its axis`);
      assert.ok(fit.t0 > 0 && fit.t1 < L, `${b.id}: from ${fit.t0} to ${fit.t1}, not inside the work points`);
      near((fit.t0 + fit.t1) / 2, L / 2, `${b.id} middle`, 0.5);
      // a gusset end: the tube runs past the clear length, into the gussets
      if (c.ends === 'gusset') assert.ok(fit.t1 - fit.t0 > Number(rec.l_b_clear), `${b.id}: shorter than the clear length`);
    }
    if (c.braces === 2) near(spread(part(r.parts, 'brace'), [1, 0, 0]) + spread(part(r.parts, 'brace2'), [1, 0, 0]), 2 * r.st.col.d, 'two tubes side by side');

    // the end plates (gussets or end plates), their thickness from t_t and t_b
    const ends = r.parts.filter((p) => p.kind === 'plate');
    assert.equal(ends.length, 2 * c.braces);
    // a gusset is in the brace plane, an end plate across the brace
    for (const e of ends) {
      const n: V = c.ends === 'gusset' ? [1, 0, 0] : e.id.startsWith('brace2') ? [0, -u[0], u[1]] : [0, u[0], u[1]];
      near(spread(e, n), c.t, `${e.id} thickness`, 0.05);
    }

    // the rig: every part that is not the specimen
    const rig = c.frame === 'SB' ? ['rig-floor', 'rig-beam', 'rig-wall', 'rig-actuator'] : ['rig-block', 'rig-block2', 'rig-base', 'rig-footA', 'rig-footB', 'rig-colA', 'rig-colB', 'rig-beam', 'rig-wall', 'rig-actuator'];
    for (const id of rig) assert.equal(part(r.parts, id).kind, 'rig', id);
    for (const p of r.parts) assert.ok(['member', 'plate', 'rig'].includes(p.kind ?? ''), `${p.id}: kind ${p.kind}`);
    // the actuator pushes the beam on top, from the wall
    assert.deepEqual(part(r.parts, 'rig-actuator').supports, ['rig-wall', 'rig-beam']);

    // every level of detail stands up (members: no plate)
    for (const detail of ['members', 'plates'] as Detail[]) {
      const rd = generate({ specimen: spec }, cat, detail);
      sound(rd);
      if (detail === 'members') assert.ok(rd.parts.every((p) => p.kind !== 'plate'));
    }
  });

// a brace record, with changes
const brace = (o: Partial<BraceSpecimen>): BraceSpecimen => ({
  test: 'brace', id: 'test', section: 'HSS6X6X3/8', length: 3000, clear: 2400, angle: 40, ends: 'gusset', frame: 'SB', ...o,
});

for (const frame of ['SB', 'SBF', 'DBF'] as const)
  for (const ends of ['gusset', 'fixed', 'pin'] as const)
    test(`${frame} with ${ends} ends: no clash, no floating part`, () => {
      const r = generate({ specimen: brace({ frame, ends }) }, cat);
      sound(r);
      const pins = r.parts.filter((p) => /-pin$/.test(p.id));
      assert.equal(pins.length, ends === 'pin' ? (frame === 'DBF' ? 4 : 2) : 0);
      for (const p of pins) assert.equal(p.kind, 'rig');
      assert.equal(r.parts.filter((p) => /-seat$/.test(p.id)).length, ends === 'gusset' ? 0 : frame === 'DBF' ? 4 : 2);
    });

test('every section shape draws, at a steep and a flat angle', () => {
  const shapes: BraceSpecimen['section'][] = [
    'W8X31', 'HSS6X6X3/8',
    { id: 'pipe', shape: 'CHS', d: 168, t: 7 },
    { id: 'bar', shape: 'ROD', d: 50 },
    { id: '2L', shape: '2L', d: 89, b: 64, t: 9.5 },
    { id: 'WT', shape: 'T', d: 125, bf: 254, tf: 16.4, tw: 9.1 },
  ];
  for (const section of shapes)
    for (const angle of [30, 60])
      for (const frame of ['SB', 'SBF'] as const) sound(generate({ specimen: brace({ section, angle, frame }) }, cat));
});

test('no clear length: each gusset gets a default length, and the log says so', () => {
  for (const clear of [undefined, 3000, 3500]) {
    const r = generate({ specimen: brace({ clear }) }, cat);
    sound(r);
    assert.ok(r.log.some((l) => /each gusset drawn \d+ mm long/.test(l)), r.log.join('\n'));
  }
});

test('a brace too short for its end details throws', () => {
  assert.throws(() => generate({ specimen: brace({ length: 300, ends: 'pin' }) }, cat), /test: length 300 mm is too short/);
  assert.throws(() => generate({ specimen: brace({ length: 0 }) }, cat), /test: length must be a number above 0/);
});

// ------------------------------------------------------------- the reader
const ROW: HubRecord = {
  id: 'row', cross_section_shape: 'Rectangular HSS', cross_section_size: 'HSS152x152x9.5', d_br: 152, b_br: 152, t_br: 9.5, w_br: 'na',
  configuration: 'SB', brace_angle: 45, l_b: 3000, l_b_clear: 2400, boundary_condition: 'Gusset plate', t_t: 12.7, t_b: 12.7,
};
const read = (o: HubRecord) => fromHubBrace({ ...ROW, ...o });

test('fromHubBrace: an I takes t_br as its flange and w_br as its web', () => {
  const s = read({ cross_section_shape: 'I-shaped', cross_section_size: 'W150X37', d_br: 162, b_br: 154, t_br: 11.6, w_br: 8.1 });
  const sec = findSection(s.section, cat);
  assert.equal(sec.kind, 'I');
  assert.deepEqual([sec.tf, sec.tw], [11.6, 8.1]);
});

test('fromHubBrace: a WT is drawn as a tee', () => {
  const s = read({ cross_section_shape: 'I-shaped', cross_section_size: 'WT125x33.5', d_br: 125, b_br: 254, t_br: 16.4, w_br: 9.1 });
  const sec = findSection(s.section, cat);
  assert.equal(sec.kind, 'T');
  assert.deepEqual([sec.d, sec.bf, sec.tf, sec.tw], [125, 254, 16.4, 9.1]);
  assert.ok(s.notes?.some((n) => /is a tee/.test(n)));
  sound(generate({ specimen: s }, cat));
});

test('fromHubBrace: double angles from the name, long legs back to back', () => {
  const two = (size: string, o: HubRecord = {}) => findSection(read({ cross_section_shape: 'Double Angle', cross_section_size: size, d_br: 1, b_br: 1, t_br: 'na', ...o }).section, cat);
  for (const [size, d, b, t] of [['2 L89x64x6.4', 89, 64, 6.4], ['L152x89x9.5', 152, 89, 9.5], ['49.7x3.88', 49.7, 49.7, 3.88]] as const) {
    const s = two(size);
    assert.equal(s.kind, '2L', size);
    assert.equal(s.d, d, size);
    assert.equal(s.tf, t, size);
    assert.ok(s.bf > 2 * b && s.bf < 2 * b + 20, `${size}: bf ${s.bf} is not two legs of ${b}`);
  }
  // t_br that does not match the name: the name wins, the log says so
  const a3 = read({ cross_section_shape: 'Double Angle', cross_section_size: '2 L89x64x9.5', t_br: 6.4 });
  assert.ok(a3.notes?.some((n) => /t_br 6.4 does not match/.test(n)));
  // no name to read: d_br is the long leg, b_br the two short legs
  const odd = read({ cross_section_shape: 'Double Angle', cross_section_size: 'two angles', d_br: 100, b_br: 150, t_br: 8 });
  const s = findSection(odd.section, cat);
  assert.equal(s.d, 100);
  assert.ok(odd.notes?.some((n) => /from d_br and b_br/.test(n)));
});

test('fromHubBrace: the end types and the plate thickness', () => {
  assert.equal(read({ boundary_condition: 'Fixed-fixed end' }).ends, 'fixed');
  assert.equal(read({ boundary_condition: 'Pin-Pin end' }).ends, 'pin');
  assert.deepEqual(read({}).plates, { top: 12.7, bottom: 12.7 });
  const pp = read({ t_b: 'Pin-Pin Ended' });
  assert.deepEqual(pp.plates, { top: 12.7, bottom: undefined });
  assert.ok(pp.notes?.some((n) => /t_b says "Pin-Pin Ended"/.test(n)));
  assert.ok(read({}).notes?.some((n) => /l_1t to l_8b are not used/.test(n)));
  const nr = read({ configuration: 'nr' });
  assert.equal(nr.frame, 'SB');
  assert.ok(nr.notes?.some((n) => /configuration is not given/.test(n)));
});

test('fromHubBrace: an error names the field it cannot read', () => {
  const fails = (o: HubRecord, msg: RegExp) => assert.throws(() => read(o), msg);
  fails({ cross_section_shape: 'na' }, /^Error: row: cross_section_shape is missing$/);
  fails({ cross_section_shape: 'Zed' }, /^Error: row: cross_section_shape "Zed" is not supported yet$/);
  fails({ d_br: 'na' }, /^Error: row: d_br is missing$/);
  fails({ l_b: 'nr' }, /^Error: row: l_b is missing$/);
  fails({ brace_angle: 90 }, /^Error: row: brace_angle "90" is not supported yet$/);
  fails({ configuration: 'K' }, /^Error: row: configuration "K" is not supported yet$/);
  fails({ boundary_condition: 'na' }, /^Error: row: boundary_condition is missing$/);
  fails({ boundary_condition: 'Welded' }, /^Error: row: boundary_condition "Welded" is not supported yet$/);
});

test('toSpecimen: a hand-written brace goes through as it is', () => {
  const s = brace({ id: 'mine' });
  assert.deepEqual(toSpecimen(JSON.parse(JSON.stringify(s))), s);
});
