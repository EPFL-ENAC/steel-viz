// The deformed shape: the response files, the steps, the moves of a
// beam-to-column test. The last test reads every response file of the hub, so
// it needs a copy of resslab-hub-data next to the repo (skipped in CI).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { deformParts, follow, I4, movePoint, protocol, readResponse, strut, thin, tilt, type Curve, type DeformTable, type Move, type Samples } from './deform.ts';
import { plasticMoment, panelCapacity } from './deform-connection.ts';
import { DEFORMS } from './deforms.ts';
import { generate, type Result } from './generate.ts';
import { hingeSize } from './rig.ts';
import { toSpecimen, type HubRecord } from './hub.ts';
import { loadCatalog } from './sections.ts';
import type { Specimen } from './specimen.ts';
import { findHubData, HUB_TABLES, readTables } from './tables.ts';
import { add, dot, mul, norm, sub, type V } from './vec.ts';
import { parseCsv } from './sections.ts';

const cat = loadCatalog('aisc', ...readTables('aisc'));
const T: DeformTable = DEFORMS.connections;
const IDS = ['Chi_and_Uang_2002_DC2', 'Ricles_et_al_2004_SPEC-1', 'Lee_et_al_2002_CR1'];

const record = (id: string): HubRecord => JSON.parse(readFileSync(new URL(`./specimens/${id}.json`, import.meta.url), 'utf8'));
function curves(id: string) {
  const out: Record<string, Curve> = {};
  for (const { folder } of T.responses) {
    const f = new URL(`./specimens/responses/connections/${folder}/${id}.csv`, import.meta.url);
    if (existsSync(f)) out[folder] = readResponse(readFileSync(f, 'utf8'));
  }
  return out;
}
function load(id: string) {
  const rec = record(id);
  const spec = toSpecimen(rec) as Specimen;
  return { rec, spec, r: generate({ specimen: spec }, cat) as Result, p: protocol(curves(id)) };
}
// the step with the largest drift
const peak = (c: Curve) => c.x.reduce((b, x, i) => (Math.abs(x) > Math.abs(c.x[b]) ? i : b), 0);
const sample = (x: number, y = 100) => ({ x, y, along: x });
const near = (a: V, b: V, tol: number, what: string) => assert.ok(Math.hypot(...sub(a, b)) < tol, `${what}: ${a} is not ${b}`);

test('readResponse: a BOM, a quoted header, a trailing comma, E notation, NA rows', () => {
  const c = readResponse('﻿"Chord Rotation [rads]",Moment [kN-mm],\n-3.190786e-05,1.249291e+04,\nNA,NA,\n2.55E-06,11.6,\n\n');
  assert.deepEqual(c, { x: [-3.190786e-5, 2.55e-6], y: [12492.91, 11.6] });
});

test('readResponse: the three styles of the copied files', () => {
  assert.equal(curves(IDS[0]).Global.x.length, 382);
  assert.equal(curves(IDS[1]).Beam_moment_rotation.x.length, 3982);
  assert.equal(curves(IDS[2]).Global_west.x.length, 704);
});

test('thin: the first, the last and every peak of x, at most max points', () => {
  const x = Array.from({ length: 5000 }, (_, i) => (i / 5000) * Math.sin(i / 40));
  const c = thin({ x, y: x.map((v) => 2 * v) }, 300);
  assert.ok(c.x.length <= 300);
  assert.equal(c.x[0], x[0]);
  assert.equal(c.x.at(-1), x.at(-1));
  assert.ok(c.y.every((y, i) => y === 2 * c.x[i]));
  for (const v of [Math.max(...x), Math.min(...x)]) assert.ok(c.x.includes(v));
  assert.equal(thin({ x: [1, 2], y: [3, 4] }).x.length, 2);
});

test('protocol: same row counts line up by row', () => {
  const p = protocol({ Global: { x: [0, 1, 2], y: [0, 5, 6] }, Panel_zone: { x: [0, 0.1, 0.3], y: [1, 2, 3] } });
  assert.equal(p.n, 3);
  assert.deepEqual(p.at(1).Panel_zone, { x: 0.1, y: 2, along: 0.1 });
});

test('protocol: different row counts line up by pseudo time, step 0 is the start', () => {
  const tri = (n: number, a: number) => Array.from({ length: n }, (_, i) => a * (1 - Math.abs((2 * i) / (n - 1) - 1)));
  const [g, z] = [tri(11, 1), tri(101, 0.1)];
  const p = protocol({ Global: { x: g, y: g }, Panel_zone: { x: z, y: z } });
  assert.equal(p.n, 11);
  assert.equal(p.driver, 'Global');
  assert.equal(p.at(0).Panel_zone.x, 0);
  assert.ok(Math.abs(p.at(5).Panel_zone.x - 0.1) < 1e-9, 'the peaks line up');
  assert.ok(Math.abs(p.at(10).Panel_zone.x) < 1e-9);
});

test('protocol: `along` has the sign of the driver', () => {
  const p = protocol({ Global: { x: [0, 1, -1], y: [0, 0, 0] }, Global_west: { x: [0, -1, 1], y: [0, 0, 0] } });
  assert.equal(p.at(1).Global_west.along, 1);
});

test('movePoint: a Hermite bend, then the blend of A and B', () => {
  const m: Move = { o: [0, 0, 0], u: [1, 0, 0], n: [0, 0, 1], A: I4(), knots: [{ s: 0, w: 0, t: 0, r: 0 }, { s: 100, w: 10, t: 0.1, r: 0.1 }] };
  near(movePoint([100, 0, 0], m), [100, 0, 10], 1e-9, 'the end knot');
  near(movePoint([200, 0, 0], m), [200, 0, 20], 1e-9, 'straight on past the end');
  near(movePoint([100, 0, 5], m), [99.5, 0, 15], 1e-9, 'the section turns by r');
  const pivot: V = [10, 0, 0];
  const b: Move = { o: pivot, u: [1, 0, 0], n: [0, 0, 1], knots: [], A: I4(), B: tilt(pivot, [0, 0, 1], [1, 0, 0], 0.1), split: [-10, 10] };
  near(movePoint(pivot, b), pivot, 1e-9, 'the pivot stays');
  near(movePoint([0, 0, 0], b), [0, 0, 0], 1e-9, 'A alone');
  near(movePoint([30, 0, 0], b), [30, 0, 2], 1e-9, 'B alone');
});

test('follow: a part takes the move of what it stands on', () => {
  const part = (id: string, supports: string[]) => ({ id, supports }) as any;
  const m = { o: [0, 0, 0], u: [1, 0, 0], n: [0, 0, 1], knots: [], A: I4() } as Move;
  const out = follow([part('block', []), part('a', ['block', 'b']), part('b', []), part('c', ['a']), part('d', ['block'])], { b: m });
  assert.equal(out.a, m);
  assert.equal(out.c, m);
  assert.equal(out.d, undefined);
  assert.equal(out.block, undefined);
});

test('strut: both ends stay on their pins, the piece in the split stretches', () => {
  const [p0, p1, q1]: V[] = [[0, 0, 0], [1000, 0, 0], [1100, 100, 0]];
  const m = strut(p0, p1, p0, q1, [200, 800]);
  near(movePoint(p0, m), p0, 1e-9, 'the fixed pin');
  near(movePoint(p1, m), q1, 1e-9, 'the moving pin');
  const end = movePoint([200, 0, 0], m);
  assert.ok(Math.abs(Math.hypot(...end) - 200) < 1e-9, 'the fixed end keeps its length');
});

for (const id of IDS) {
  test(`${id}: at zero every point stays`, () => {
    const { r, spec, rec, p } = load(id);
    const zero: Samples = Object.fromEntries(Object.keys(p.series).map((k) => [k, sample(0, 0)]));
    const d = T.shape(r, spec, rec, zero, 5);
    for (const q of deformParts(r.parts, d)) {
      const o = r.parts.find((x) => x.id === q.id)!;
      q.faces.forEach((f, i) => f.pts.forEach((pt, j) => near(pt, o.faces[i].pts[j], 1e-6, q.id)));
    }
  });

  test(`${id}: every move is for a part that exists`, () => {
    const { r, spec, rec, p } = load(id);
    const ids = new Set(r.parts.map((q) => q.id));
    const d = T.shape(r, spec, rec, p.at(1), 1);
    for (const k of Object.keys(d.moves)) assert.ok(ids.has(k), k);
    // the struts have their own move, not the one of the part they stand on
    for (const q of r.parts.filter((q) => /-(link|actuator)$/.test(q.id))) assert.notEqual(d.moves[q.id], d.moves[q.supports[0]], q.id);
  });

  test(`${id}: at the peak drift the parts stay glued and the rig stays on its pins`, () => {
    const { r, spec, rec, p } = load(id);
    const scale = T.autoScale(p);
    const at = p.at(peak(p.series[p.driver]));
    const d = T.shape(r, spec, rec, at, scale);
    const rig = r.rig!;
    const col = d.moves.column;
    const theta = (at.Global.along + (at.Global_west?.along ?? at.Global.along)) / 2;
    for (const a of r.st.arms) {
      // the beam end and the column flange at the same place, top and bottom flange
      const beam = d.moves[a.id];
      const face = r.parts.find((q) => q.id === a.id)!.faces.flatMap((f) => f.pts).reduce((m, pt) => Math.min(m, dot(pt, beam.u)), 1e9);
      for (const z of [a.z - a.sec.tf, a.z - a.sec.d + a.sec.tf]) {
        const pt: V = add(mul(beam.u, face), [0, 0, z]);
        near(movePoint(pt, beam), movePoint(pt, col), 0.5, `${a.id} on the column`);
      }
    }
    // the mount of each strut stays on the pin of what it stands on
    const ends = (k: string, s: typeof rig.top, on: Move) => {
      const u = norm(sub(s.to, s.from));
      const { pin } = hingeSize(s.D);
      const [p0, p1] = [add(s.from, mul(u, pin)), sub(s.to, mul(u, pin))];
      near(movePoint(p0, d.moves[k]), p0, 1e-6, `${k}: the fixed pin`);
      near(movePoint(p1, d.moves[k]), movePoint(p1, on), 1e-6, `${k}: the moving pin`);
      return p1;
    };
    const top = ends(rig.top.kind === 'link' ? 'top-link' : 'top-actuator', rig.top, col);
    const moved = sub(movePoint([0, 0, top[2]], col), [0, 0, top[2]]);
    const sway = dot(moved, rig.dir);
    if (spec.test === undefined || spec.test === 'connection') {
      const arm = top[2] - rig.foot[2];
      if ((spec as any).load === 'column') assert.ok(Math.abs(sway - theta * scale * arm) < 0.01, `the top moves θ H, not ${sway}`);
      else assert.ok(Math.abs(sway) < 0.01, `the top pin stays, not ${sway}`);
    }
    for (const t of rig.tips) {
      ends(`${t.arm}-${t.kind}`, t, d.moves[t.arm]);
      const pt = sub(t.to, [0, 0, 0]);
      const dz = movePoint(pt, d.moves[t.arm])[2] - pt[2];
      if ((spec as any).load === 'column') assert.ok(Math.abs(dz) < 2, `the tip of ${t.arm} stays, not ${dz}`);
      else assert.ok(Math.abs(dz) > 1, `the tip of ${t.arm} moves`);
    }
  });
}

test('Lee CR1: each beam tip follows its own drift file', () => {
  const { r, spec, rec, p } = load(IDS[2]);
  const at: Samples = { Global: sample(0.03), Global_west: sample(0.01) };
  const d = T.shape(r, spec, rec, at, 1);
  const tips = r.rig!.tips.map((t) => {
    const u = d.moves[t.arm].u;
    return (movePoint(t.to, d.moves[t.arm])[2] - t.to[2]) / dot(t.to, u) * Math.sign(dot(u, r.rig!.dir));
  });
  assert.ok(Math.abs(tips[0] - 0.03) < 1e-3, `east ${tips[0]}`);
  assert.ok(Math.abs(tips[1] - 0.01) < 1e-3, `west ${tips[1]}`);
  assert.ok(p.n > 0);
});

test('zones: DC2 by hand', () => {
  const { r, spec, rec } = load(IDS[0]);
  const Mp = 9520884.184 * 379.8241715;
  assert.ok(Math.abs(plasticMoment(rec)! - Mp) < 1);
  assert.equal(panelCapacity(rec), 3891.221266);
  // V and P given: M = P (tip - face), in kN mm
  const d = T.shape(r, spec, rec, { Global: sample(0.02, 1000), Panel_zone: sample(0.004, 1945.6) }, 1);
  const [hinge, panel] = d.zones;
  assert.equal(hinge.label, 'Beam hinge');
  assert.ok(Math.abs(panel.level - 0.5) < 1e-3, `V / Rn ${panel.level}`);
  const arm = r.st.arms[0];
  const free = d.moves.beam1.knots.at(-1)!.s - d.moves.beam1.knots[0].s;
  assert.ok(free > 0.8 * arm.L && free < arm.L);
  assert.ok(Math.abs(hinge.level - (1000 * free * 1000) / Mp) < 1e-6, `M / Mp ${hinge.level}`);
});

test('zones: no capacity in the record gives no zone, and the legend says why', () => {
  const { r, spec, rec } = load(IDS[0]);
  const d = T.shape(r, spec, { ...rec, z_xb: 'NA', r_n_pl_m_aisc: 'NA', r_n_pl_n_aisc: 'NA', r_n_el_n_aisc: 'NR' }, { Global: sample(0.02) }, 1);
  assert.deepEqual(d.zones, []);
  assert.ok(d.notes!.some((n) => n.includes('no beam hinge zone')));
  assert.ok(d.notes!.some((n) => n.includes('no panel zone color')));
});

test('zones: no force file gives no beam hinge zone, and the legend says why', () => {
  const { r, spec, rec } = load(IDS[2]);
  const d = T.shape(r, spec, rec, { Panel_zone: sample(0.004, 1000) }, 1);
  assert.deepEqual(d.zones.map((z) => z.label), ['Panel zone']);
  assert.ok(d.notes!.includes('No force or moment file: no beam hinge zone.'));
  assert.ok(!d.notes!.some((n) => n.includes('actuator force')));
});

test('a table lists its folders once, and the viewer has room for its moves', () => {
  for (const t of Object.values(DEFORMS)) assert.equal(new Set(t.responses.map((r) => r.folder)).size, t.responses.length);
  const { r, spec, rec, p } = load(IDS[1]);
  const d = T.shape(r, spec, rec, p.at(10), 5);
  for (const m of Object.values(d.moves)) assert.ok(m.knots.length <= 8);
  assert.ok(d.zones.length <= 4);
});

// ---- with the hub data
const dir = findHubData();
test('hub connections: every test with response files gives finite moves', { skip: dir ? false : 'no resslab-hub-data folder next to the repo' }, (t) => {
  const table = join(dir!, 'connections');
  const rows = parseCsv(readFileSync(join(dir!, HUB_TABLES.connections), 'utf8'));
  const files = new Map(T.responses.map(({ folder }) => [folder, new Set(readdirSync(join(table, folder)))]));
  let [done, noForce] = [0, 0];
  for (const rec of rows) {
    const id = String(rec.id);
    const c: Record<string, Curve> = {};
    for (const [folder, names] of files) if (names.has(`${id}.csv`)) c[folder] = readResponse(readFileSync(join(table, folder, `${id}.csv`), 'utf8'));
    if (!Object.values(c).some((k) => k.x.length)) continue;
    let spec: Specimen;
    try {
      spec = toSpecimen(rec);
    } catch {
      continue; // hub.test.ts looks at these
    }
    const r = generate({ specimen: spec }, cat);
    const p = protocol(c);
    const scale = T.autoScale(p);
    assert.ok([1, 2, 5, 10, 20].includes(scale), `${id}: scale ${scale}`);
    const force = Object.keys(p.series).some((k) => k !== 'Panel_zone');
    if (!force) noForce++;
    for (const k of [0, 0.25, 0.5, 0.75, 1]) {
      const d = T.shape(r, spec, rec, p.at(Math.round(k * (p.n - 1))), scale);
      for (const [name, m] of Object.entries(d.moves)) {
        assert.ok(m.knots.length <= 8, `${id} ${name}: knots`);
        const q = movePoint(add(m.o, mul(m.u, 500)), m);
        assert.ok(q.every(Number.isFinite), `${id} ${name}: not finite at step ${k}`);
      }
      assert.ok(d.zones.every((z) => Number.isFinite(z.level)), `${id}: zone level`);
      if (!force) assert.ok(d.zones.every((z) => z.slot !== 0), `${id}: a beam hinge with no force`);
    }
    done++;
  }
  t.diagnostic(`${done} tests`);
  assert.ok(done > 50);
  assert.equal(noForce, 6);
});
