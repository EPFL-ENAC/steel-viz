// The deformed shape of a column test: the two tables of deform-column.ts. The
// last test reads every moment file of the hub, so it needs a copy of
// resslab-hub-data next to the repo (skipped in CI).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { deformParts, movePoint, protocol, readResponse, type Curve, type DeformTable, type Move, type Samples } from './deform.ts';
import { columnLevel, hssLevel } from './deform-column.ts';
import { DEFORMS } from './deforms.ts';
import { generate, type Result } from './generate.ts';
import { toSpecimen, type HubRecord } from './hub.ts';
import { hingeSize } from './rig.ts';
import { loadCatalog, parseCsv } from './sections.ts';
import type { ColumnSpecimen } from './specimen.ts';
import { findHubData, HUB_TABLES, readTables } from './tables.ts';
import { add, dot, mul, norm, sub, type V } from './vec.ts';

const cat = loadCatalog('aisc', ...readTables('aisc'));
const COL: DeformTable = DEFORMS.columns;
const HSS: DeformTable = DEFORMS.hss_columns;
const [STRONG, WEAK, SHORT, MR] = ['moment_rotation_strong', 'moment_rotation_weak', 'axial_shortening_rotation', 'Moment_Rotation'];
const [CANTILEVER, DOUBLE, BIAXIAL] = ['MacRae_C3', 'Nakashima_et_al_S105604', 'Cheng_Chen_Niu_Nethercot_B-H4-0.2-15'];
const [HSS_CF, HSS_DC, HSS_3PB] = ['Tsuda_Matsui_1998__Matsui-943', 'Sugiyama_Igarashi_1986__Igarashi-14', 'Nakajima_et_al_2009__L-T16-45'];
const FIXTURES: [string, string][] = [
  ...[CANTILEVER, DOUBLE, BIAXIAL].map((id): [string, string] => ['columns', id]),
  ...[HSS_CF, HSS_DC, HSS_3PB].map((id): [string, string] => ['hss_columns', id]),
];

const record = (id: string): HubRecord => JSON.parse(readFileSync(new URL(`./specimens/${id}.json`, import.meta.url), 'utf8'));
function curves(table: string, id: string) {
  const out: Record<string, Curve> = {};
  for (const { folder } of DEFORMS[table].responses) {
    const f = new URL(`./specimens/responses/${table}/${folder}/${id}.csv`, import.meta.url);
    if (existsSync(f)) out[folder] = readResponse(readFileSync(f, 'utf8'));
  }
  return out;
}
function build(rec: HubRecord, change: Partial<ColumnSpecimen> = {}) {
  const spec = { ...(toSpecimen(rec) as ColumnSpecimen), ...change };
  return { rec, spec, r: generate({ specimen: spec }, cat) as Result };
}
const load = (id: string) => build(record(id));
const sample = (x: number, y = 0) => ({ x, y, along: Math.abs(x) });
const near = (a: V, b: V, tol: number, what: string) => assert.ok(Math.hypot(...sub(a, b)) < tol, `${what}: ${a} is not ${b}`);
// where a point of the axis goes, minus where it was
const moved = (m: Move, p: V) => sub(movePoint(p, m), p);
const top = (L: number): V => [0, 0, L];

test('at zero rotation no point moves', () => {
  for (const [table, id] of FIXTURES) {
    const { rec, spec, r } = load(id);
    const at: Samples = Object.fromEntries(Object.keys(curves(table, id)).map((k) => [k, sample(0)]));
    const d = DEFORMS[table].shape(r, spec, rec, at, 5);
    const after = deformParts(r.parts, d);
    r.parts.forEach((p, i) => p.faces.forEach((f, j) => f.pts.forEach((x, k) => near(after[i].faces[j].pts[k], x, 1e-6, `${id} ${p.id}`))));
  }
});

test('every step of the examples: moves of real parts, finite, inside the limits of the viewer', () => {
  for (const [table, id] of FIXTURES) {
    const T = DEFORMS[table];
    const { rec, spec, r } = load(id);
    const p = protocol(curves(table, id));
    const ids = new Set(r.parts.map((q) => q.id));
    const scale = T.autoScale(p);
    assert.ok([1, 2, 5, 10, 20].includes(scale), `${id}: scale ${scale}`);
    for (const k of [0, 0.25, 0.5, 0.75, 1]) {
      const d = T.shape(r, spec, rec, p.at(Math.round(k * (p.n - 1))), scale);
      assert.ok(d.zones.length >= 1 && d.zones.length <= 4, `${id}: zones`);
      assert.ok(d.zones.every((z) => Number.isFinite(z.level)), `${id}: level`);
      for (const [name, m] of Object.entries(d.moves)) {
        assert.ok(ids.has(name), `${id}: ${name} is not a part`);
        assert.ok(m.knots.length <= 8, `${id} ${name}: knots`);
        assert.ok(movePoint(add(m.o, mul(m.u, 500)), m).every(Number.isFinite), `${id} ${name}: not finite`);
      }
    }
  }
});

test('the actuators have their own move, and their pin stays on the part they push', () => {
  for (const id of [CANTILEVER, DOUBLE]) {
    const { rec, spec, r } = load(id);
    const d = COL.shape(r, spec, rec, { [STRONG]: sample(0.03) }, 5);
    const rig = r.st.columnRig!;
    assert.ok(rig.struts.length >= 1);
    for (const s of rig.struts) {
      const m = d.moves[s.id];
      assert.notEqual(m, d.moves.column);
      const pin = add(s.to, mul(norm(sub(s.to, s.from)), -hingeSize(s.D).pin));
      near(movePoint(pin, m), movePoint(pin, d.moves.column), 1e-6, `${id} ${s.id}`);
      const foot = add(s.from, mul(norm(sub(s.to, s.from)), hingeSize(s.D).pin));
      near(movePoint(foot, m), foot, 1e-6, `${id} ${s.id} on its reaction`);
    }
  }
  const { r } = load(DOUBLE);
  assert.deepEqual(r.st.columnRig!.struts.map((s) => s.id), ['rig-actuator', 'rig-axial', 'rig-axial2']);
});

test('the cap and the head take the move of the column, the foot and the wall stay', () => {
  const { rec, spec, r } = load(CANTILEVER);
  const d = COL.shape(r, spec, rec, { [STRONG]: sample(0.03) }, 5);
  assert.equal(d.moves['column-cap'], d.moves.column);
  assert.equal(d.moves['rig-head'], d.moves.column);
  for (const id of ['column-foot', 'rig-floor', 'rig-wall', 'rig-crosshead']) assert.equal(d.moves[id], undefined, id);
});

test('the top moves θ L times the scale, along the push', () => {
  for (const id of [CANTILEVER, DOUBLE]) {
    const { rec, spec, r } = load(id);
    const [theta, scale] = [0.02, 5];
    const d = COL.shape(r, spec, rec, { [STRONG]: sample(theta), [SHORT]: sample(theta, 0) }, scale);
    near(moved(d.moves.column, top(spec.length)), [0, theta * spec.length * scale, 0], 1e-6, id);
    const neg = COL.shape(r, spec, rec, { [STRONG]: sample(-theta), [SHORT]: sample(theta, 0) }, scale);
    near(moved(neg.moves.column, top(spec.length)), [0, -theta * spec.length * scale, 0], 1e-6, id);
  }
  const { rec, spec, r } = load(HSS_CF);
  const d = HSS.shape(r, spec, rec, { [MR]: sample(0.02) }, 2);
  near(moved(d.moves.column, top(spec.length)), [0, 0.02 * spec.length * 2, 0], 1e-6, 'hss');
});

test('the top slope: 1.5, 1.2 and 0 times δ / L, from l_sc', () => {
  const slope = (rec: HubRecord) => {
    const { spec, r } = build(rec);
    const d = COL.shape(r, spec, rec, { [STRONG]: sample(0.01) }, 1);
    const k = d.moves.column.knots.at(-1)!;
    assert.equal(k.r, k.t);
    return (k.t * spec.length) / k.w;
  };
  assert.ok(Math.abs(slope(record(CANTILEVER)) - 1.5) < 1e-9);
  assert.ok(Math.abs(slope(record(DOUBLE))) < 1e-9);
  const flexible = record('Elkady_and_Lignos_C6');
  assert.equal(flexible.boundary_condition, 'Fixed-Flexible');
  assert.ok(Math.abs(slope({ ...flexible, l_sc: 0.75 * Number(flexible.l_c) }) - 1.2) < 1e-9);
});

test('a double curvature column: the head stays level, its sections turn on the way', () => {
  const { rec, spec, r } = load(DOUBLE);
  const m = COL.shape(r, spec, rec, { [STRONG]: sample(0.02) }, 5).moves.column;
  assert.ok(Math.abs(m.knots.at(-1)!.r) < 1e-12);
  assert.ok(m.knots[2].r > 0.01);
  const [a, b] = [movePoint([100, 0, spec.length], m), movePoint([-100, 0, spec.length], m)];
  assert.ok(Math.abs(a[2] - b[2]) < 1e-9);
});

test('a bad l_sc falls back on the ends', () => {
  const rec = { ...record(CANTILEVER), l_sc: '1' };
  const { spec, r } = build(rec);
  const k = COL.shape(r, spec, rec, { [STRONG]: sample(0.01) }, 1).moves.column.knots.at(-1)!;
  assert.ok(Math.abs((k.t * spec.length) / k.w - 1.5) < 1e-9);
});

test('3pb: mid span moves θ L/2 down, the rollers stay, the ends lift', () => {
  const { rec, spec, r } = load(HSS_3PB);
  assert.equal(spec.ends, '3pb');
  const [theta, scale, L] = [0.02, 5, spec.length];
  const m = HSS.shape(r, spec, rec, { [MR]: sample(theta) }, scale).moves.column;
  const z = m.o[2];
  near(moved(m, [0, 0, z]), [0, 0, (-theta * L * scale) / 2], 1e-6, 'mid span');
  near(moved(m, [-L / 2, 0, z]), [0, 0, 0], 1e-6, 'roller');
  near(moved(m, [L / 2, 0, z]), [0, 0, 0], 1e-6, 'roller');
  assert.ok(moved(m, [-L / 2 - 100, 0, z])[2] > 0);
  assert.ok(moved(m, [L / 2 + 100, 0, z])[2] > 0);
  const [k0, k1, k2] = m.knots;
  assert.ok(Math.abs(k0.t - (1.5 * k2.w) / (L / 2)) < 1e-9);
  assert.ok(Math.abs(k2.t) < 1e-12 && k1.w > 0 && k1.w < k2.w);
  assert.equal(HSS.shape(r, spec, rec, { [MR]: sample(theta, 5) }, scale).zones[0].label, 'Mid span hinge');
});

test('3pb with axial load: the mount stays on its block, the tongue turns about its pin', () => {
  const { rec, spec, r } = build(record(HSS_3PB), { axial: true });
  const d = HSS.shape(r, spec, rec, { [MR]: sample(0.02) }, 5);
  const { pin, end } = r.parts.find((p) => p.id === 'rig-pin-mount')!.joint!;
  assert.ok(!d.moves['rig-pin-mount'], 'the mount stays');
  near(movePoint(pin, d.moves['rig-pin']), pin, 1e-9, 'the pin');
  // one true turn: the tongue keeps its length and points at the end plate
  const [q, want] = [movePoint(end, d.moves['rig-pin']), movePoint(end, d.moves.column)];
  const len = Math.hypot(...sub(end, pin));
  assert.ok(Math.abs(Math.hypot(...sub(q, pin)) - len) < 1e-6, 'its length');
  near(norm(sub(q, pin)), norm(sub(want, pin)), 1e-9, 'its direction');
  assert.ok(Math.hypot(...sub(q, want)) < 5, 'the tongue end stays near the end plate');
  assert.equal(d.moves['column-end'], d.moves.column);
  const s = r.st.columnRig!.struts.find((q) => q.id === 'rig-axial')!;
  const p1 = add(s.to, mul(norm(sub(s.to, s.from)), -hingeSize(s.D).pin));
  near(movePoint(p1, d.moves['rig-axial']), movePoint(p1, d.moves.column), 1e-6, 'axial actuator');
});

test('the shortening: a negative file value lowers the top, and the axial actuator follows', () => {
  const { rec, spec, r } = load(CANTILEVER);
  const d = COL.shape(r, spec, rec, { [STRONG]: sample(0), [SHORT]: sample(0, -3) }, 5);
  const L = spec.length;
  near(moved(d.moves.column, top(L)), [0, 0, -15], 1e-6, 'top');
  near(moved(d.moves.column, top(L / 2)), [0, 0, -7.5], 1e-6, 'mid height');
  near(moved(d.moves.column, [0, 0, 0]), [0, 0, 0], 1e-6, 'base');
  const s = r.st.columnRig!.struts.find((q) => q.id === 'rig-axial')!;
  const pin = add(s.to, mul(norm(sub(s.to, s.from)), -hingeSize(s.D).pin));
  near(moved(d.moves['rig-axial'], pin), [0, 0, -15], 1e-6, 'axial actuator');
  assert.ok(!d.notes?.some((n) => /shortening/.test(n)));
});

test('a shortening too big for the scale stops at half the length, and the rail says so', () => {
  const { rec, spec, r } = load(CANTILEVER);
  const d = COL.shape(r, spec, rec, { [STRONG]: sample(0), [SHORT]: sample(0, -65) }, 20);
  near(moved(d.moves.column, top(spec.length)), [0, 0, -spec.length / 2], 1e-6, 'top');
  assert.ok(d.notes?.some((n) => /cut at half the length/.test(n)));
});

test('the head goes past the wall: the actuator stays on the head and does not turn over', () => {
  // DOUBLE stays exactly in line with the actuator, so turning over gave NaN
  for (const id of [DOUBLE, CANTILEVER]) {
    const { rec, spec, r } = load(id);
    const s = r.st.columnRig!.struts[0];
    const { pin, reach } = hingeSize(s.D);
    const u = norm(sub(s.to, s.from));
    const [p0, p1] = [add(s.from, mul(u, pin)), add(s.to, mul(u, -pin))];
    const gap = Math.hypot(...sub(p1, p0));
    // from just before the limit to far past it, and exactly on the wall pin
    for (const push of [gap - 2 * (reach - pin) - 1, gap, gap + 400]) {
      const theta = -push / spec.length;
      const d = COL.shape(r, spec, rec, { [STRONG]: sample(theta) }, 1);
      const m = d.moves[s.id];
      near(movePoint(p1, m), movePoint(p1, d.moves.column), 1e-6, `${id}: on the head`);
      assert.ok(movePoint(p0, m).every(Number.isFinite), `${id}: NaN at ${push}`);
      const left = dot(sub(movePoint(p1, m), movePoint(p0, m)), u);
      assert.ok(left >= 2 * (reach - pin) - 1e-6, `${id}: ${left} left at ${push}`);
    }
    const far = COL.shape(r, spec, rec, { [STRONG]: sample(-(gap + 400) / spec.length) }, 1);
    assert.ok(far.notes?.some((n) => /its foot leaves its support/.test(n)));
    const near0 = COL.shape(r, spec, rec, { [STRONG]: sample(-1 / spec.length) }, 1);
    near(movePoint(p0, near0.moves[s.id]), p0, 1e-9, `${id}: the foot stays while it can`);
    assert.ok(!near0.notes?.some((n) => /its foot leaves its support/.test(n)));
  }
});

test('no shortening file: no shortening, and the rail says so', () => {
  const note = 'No axial shortening file: no shortening drawn.';
  const a = load(DOUBLE);
  const d = COL.shape(a.r, a.spec, a.rec, { [STRONG]: sample(0.01) }, 5);
  assert.equal(d.moves.column.B, undefined);
  assert.ok(d.notes?.includes(note));
  const b = load(HSS_CF);
  assert.ok(HSS.shape(b.r, b.spec, b.rec, { [MR]: sample(0.01) }, 5).notes?.includes(note));
});

test('bi-axial: Move.n follows the two rotations, with their real signs', () => {
  const { rec, spec, r } = load(BIAXIAL);
  const { web, minor } = r.st.columnRig!;
  const L = spec.length;
  for (const [s, w] of [[0.03, 0.04], [0.03, -0.04], [-0.03, 0.04], [-0.03, -0.04]]) {
    // along is the same each time: it must not change the answer
    const d = COL.shape(r, spec, rec, { [STRONG]: sample(s), [WEAK]: sample(w) }, 2);
    const want = add(mul(web, s * L * 2), mul(minor, w * L * 2));
    near(moved(d.moves.column, top(L)), want, 1e-6, `${s} ${w}`);
    assert.ok(Math.abs(Math.hypot(...d.moves.column.n) - 1) < 1e-9);
  }
  const zero = COL.shape(r, spec, rec, { [STRONG]: sample(0), [WEAK]: sample(0) }, 2);
  assert.deepEqual(zero.moves.column.n, r.st.columnRig!.push);
});

test('bi-axial with the strong file only: along the web, and the rail says so', () => {
  const rec = record('Elkady_and_Lignos_C6');
  const { spec, r } = build(rec);
  assert.equal(rec.axis_of_bending, 'Bi-axial');
  const d = COL.shape(r, spec, rec, { [STRONG]: sample(-0.02) }, 1);
  near(moved(d.moves.column, top(spec.length)), mul(r.st.columnRig!.web, -0.02 * spec.length), 1e-6, 'top');
  assert.ok(d.notes?.some((n) => /No weak axis file/.test(n)));
});

test('a test at an angle: the push stays on y, the zone turns with the section', () => {
  const { rec, spec, r } = load(HSS_DC);
  assert.equal(spec.angle, 45);
  const d = HSS.shape(r, spec, rec, { [MR]: sample(0.02, 1) }, 2);
  near(moved(d.moves.column, top(spec.length)), [0, 0.04 * spec.length, 0], 1e-6, 'top');
  const [x] = d.zones[0].axes;
  assert.ok(Math.abs(dot(x, [0, 1, 0]) - Math.SQRT1_2) < 1e-9);
  assert.ok(d.notes?.some((n) => /face of the tube/.test(n)));
});

test('the hinges: at the base, and also at the top for fixed-fixed, above the plates', () => {
  const a = load(CANTILEVER);
  const one = COL.shape(a.r, a.spec, a.rec, { [STRONG]: sample(0.01, 100) }, 5).zones;
  assert.deepEqual(one.map((z) => z.label), ['Base hinge']);
  const b = load(DOUBLE);
  const d = COL.shape(b.r, b.spec, b.rec, { [STRONG]: sample(0.01, 100) }, 5);
  assert.deepEqual(d.zones.map((z) => z.label), ['Base hinge', 'Top hinge']);
  assert.equal(d.zones[0].level, d.zones[1].level);
  assert.ok(d.notes?.some((n) => /top hinge/.test(n)));
  const [base, head] = d.zones;
  assert.ok(Math.abs(base.c[2] - base.half[2] - 1) < 1e-9, 'the base box stops 1 mm from the end');
  assert.ok(Math.abs(head.c[2] + head.half[2] + 1 - b.spec.length) < 1e-9, 'the top box stops 1 mm from the end');
});

test('the level, columns: M in kN mm over Z fy, Z from axis_of_bending and not from the folder', () => {
  const base = { ...record(CANTILEVER), z_xc: 1000, z_yc: 500, f_ymf: 100 };
  assert.equal(columnLevel(base, { [STRONG]: sample(0, -25) }), 0.25);
  assert.equal(columnLevel({ ...base, axis_of_bending: 'Weak' }, { [STRONG]: sample(0, 25) }), 0.5);
  assert.equal(columnLevel({ ...base, axis_of_bending: 'Weak' }, { [WEAK]: sample(0, 25) }), 0.5);
  const both = columnLevel({ ...base, axis_of_bending: 'Bi-axial' }, { [STRONG]: sample(0, 30), [WEAK]: sample(0, 20) })!;
  assert.ok(Math.abs(both - 0.5) < 1e-12); // hypot of 0.3 and 0.4
  assert.equal(columnLevel({ ...base, f_ymf: '' }, { [STRONG]: sample(0, 25) }), undefined);
});

test('the level, HSS: the file is in kN m, Mp in kN mm', () => {
  const rec = { ...record(HSS_CF), mp_measured__knmm: 12600 };
  assert.ok(Math.abs(hssLevel(rec, { [MR]: sample(0, 12.6) })! - 1) < 1e-12);
  assert.equal(HSS.responses[0].yUnit, 'kN m');
});

test('the rail says that Mp is not reduced, with P / Py', () => {
  const a = load(CANTILEVER);
  const d = COL.shape(a.r, a.spec, a.rec, { [STRONG]: sample(0.01, 1) }, 5);
  assert.ok(d.notes?.some((n) => /not reduced .*P \/ Py = 0\.31/.test(n)), String(d.notes));
  const b = load(HSS_CF);
  const e = HSS.shape(b.r, b.spec, b.rec, { [MR]: sample(0.01, 1) }, 5);
  assert.ok(e.notes?.some((n) => /not reduced .*P \/ Py = 0\.30/.test(n)), String(e.notes));
});

test('no Mp: no zone, and the rail says so', () => {
  const a = load(CANTILEVER);
  const rec = { ...a.rec, f_ymf: '' };
  const d = COL.shape(a.r, a.spec, rec, { [STRONG]: sample(0.01, 1) }, 5);
  assert.equal(d.zones.length, 0);
  assert.ok(d.notes?.some((n) => /no hinge zone/.test(n)));
});

test('the scale comes from the rotation files', () => {
  assert.equal(COL.autoScale(protocol({ [STRONG]: { x: [0, 0.02], y: [0, 1] } })), 5);
  assert.equal(HSS.autoScale(protocol({ [MR]: { x: [0, 0.1], y: [0, 1] } })), 1);
});

// ---- with the hub data
const median = (x: number[]) => [...x].sort((a, b) => a - b)[x.length >> 1];
const dir = findHubData();
for (const [table, level] of [['columns', columnLevel], ['hss_columns', hssLevel]] as const) {
  test(`hub ${table}: every test gives a finite level, the median is near 1`, { skip: dir ? false : 'no resslab-hub-data folder next to the repo' }, (t) => {
    const T = DEFORMS[table];
    const root = join(dir!, table);
    const rows = parseCsv(readFileSync(join(dir!, HUB_TABLES[table]), 'utf8'));
    // the moment files only: the shortening files are 37 MB and give no level
    const files = new Map(T.responses.filter((f) => f.slot !== undefined).map(({ folder }) => [folder, new Set(readdirSync(join(root, folder)))]));
    const peaks: [string, number][] = [];
    for (const rec of rows) {
      const id = String(rec.id);
      const c: Record<string, Curve> = {};
      for (const [folder, names] of files) if (names.has(`${id}.csv`)) c[folder] = readResponse(readFileSync(join(root, folder, `${id}.csv`), 'utf8'));
      if (!Object.values(c).some((k) => k.x.length)) continue;
      const p = protocol(c);
      let peak = 0;
      for (let i = 0; i < p.n; i++) {
        const x = level(rec, p.at(i));
        assert.ok(x !== undefined && Number.isFinite(x), `${id}: level ${x} at step ${i}`);
        peak = Math.max(peak, x);
      }
      peaks.push([id, peak]);
    }
    const m = median(peaks.map(([, x]) => x));
    t.diagnostic(`${peaks.length} tests, median peak level ${m.toFixed(2)}`);
    for (const [id, x] of peaks) if (x < 0.6 || x > 1.4) t.diagnostic(`${x.toFixed(2)} ${id}`);
    assert.ok(peaks.length > 100);
    assert.ok(m > 0.8 && m < 1.25, `median ${m}`);
  });
}
