// The deformed shape of a brace test. The last test reads every response file
// of the hub, so it needs a copy of resslab-hub-data next to the repo (skipped
// in CI).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { deformParts, movePoint, protocol, readResponse, type Move, type Samples } from './deform.ts';
import { bendDirection, BRACE_DEFORM as T, capacities, geometry, readStep } from './deform-braces.ts';
import { generate, type Detail } from './generate.ts';
import { toSpecimen, type HubRecord } from './hub.ts';
import { loadCatalog, parseCsv, type Section } from './sections.ts';
import { findHubData, HUB_TABLES, readTables } from './tables.ts';
import { add, dot, mul, sub, type V } from './vec.ts';

const cat = loadCatalog('aisc', ...readTables('aisc'));
const FILE = 'force_displacement';
const SB = 'Shaback_3A';
const SBF = 'Takeuchi_Matsui_528';
const DBF = 'Wakabayashi_DPC1-1';

const record = (id: string): HubRecord => JSON.parse(readFileSync(new URL(`./specimens/${id}.json`, import.meta.url), 'utf8'));
function made(id: string, change: HubRecord = {}, detail?: Detail) {
  const rec = { ...record(id), ...change };
  const spec = toSpecimen(rec);
  const r = generate({ specimen: spec }, cat, detail);
  const g = geometry(r, rec);
  const shape = (s: Samples, scale = 1) => T.shape(r, spec, rec, s, scale);
  return { rec, spec, r, g, shape };
}
const step = (x: number, y: number, lo = Math.min(0, x), hi = Math.max(0, x)): Samples => ({ [FILE]: { x, y, along: x, lo, hi } });
const at = (o: V, u: V, s: number) => add(o, mul(u, s));
const near = (a: number, b: number, msg: string, tol = 0.01) => assert.ok(Math.abs(a - b) < tol, `${msg}: ${a} is not ${b}`);
const moved = (p: V, m: Move) => sub(movePoint(p, m), p);
const nearV = (a: V, b: V, msg: string, tol = 0.01) => a.forEach((x, k) => near(x, b[k], `${msg} [${k}]`, tol));
// the mm per kN of a test, as in readStep()
const give = (b: ReturnType<typeof made>) => (1.5 * b.g.spec.L * 1000) / (Number(b.rec.e) * Number(b.rec.area));
const middle = (l: { o: V; u: V; bend: [number, number] }) => at(l.o, l.u, (l.bend[0] + l.bend[1]) / 2);

for (const id of [SB, SBF, DBF])
  test(`${id}: at zero, nothing moves`, () => {
    const { r, shape } = made(id);
    const d = shape(step(0, 0), 5);
    deformParts(r.parts, d).forEach((p, i) => p.faces.forEach((f, j) => f.pts.forEach((q, k) => nearV(q, r.parts[i].faces[j].pts[k], p.id))));
  });

test('tension: the top end goes along the brace, the beam and the top gusset go with it', () => {
  const { g, r, shape } = made(SB);
  const [l] = g.lines;
  const { L } = g.spec;
  const d = shape(step(10, 500), 2);
  const want = mul(l.u, 20);
  nearV(moved(at(l.o, l.u, L), d.moves.brace), want, 'top end');
  nearV(moved([0, 0, 0], d.moves['rig-beam']), want, 'beam');
  nearV(moved(at(l.o, l.u, L), d.moves['brace-to-conn']), want, 'top gusset');
  nearV(moved(l.o, d.moves['brace-from-conn']), [0, 0, 0], 'bottom gusset');
  near(dot(moved(middle(l), d.moves.brace), l.n), 0, 'no bow');
  near(dot(moved(middle(l), d.moves.brace), l.u), 10, 'the middle takes half of the stretch', 0.5);
  assert.ok(r.parts.every((p) => !p.id.startsWith('rig-') || p.id === 'rig-beam' || p.id === 'rig-actuator' || p.id === 'rig-actuator-mount-to' || !d.moves[p.id]), 'floor and wall stay');
});

test('compression: the middle moves by the formula, past the elastic part only', () => {
  const b = made(SB);
  const [l] = b.g.lines;
  const Pc = Number(b.rec.p_c);
  const shortening = 50 - Pc * give(b);
  const a = (2 / Math.PI) * Math.sqrt(l.Lb * shortening);
  const d = b.shape(step(-50, -300));
  near(dot(moved(middle(l), d.moves.brace), l.n), a, 'bow', 0.5);
  assert.deepEqual(l.n, [1, 0, 0], 'a gusset bends out of plane');
  near(readStep(b.g, b.rec, step(-Pc * give(b) + 1, -Pc)[FILE])[0].a, 0, 'still straight at the peak');
});

test('which way: gusset, fixed and pin', () => {
  const u: V = [0, Math.SQRT1_2, Math.SQRT1_2];
  const sec = (Is: number, Iw: number) => ({ Is, Iw }) as Section;
  const inPlane = (n: V) => near(Math.abs(n[0]), 0, 'in plane');
  const across = (n: V) => near(Math.abs(n[0]), 1, 'out of plane');
  for (const s of [sec(2, 1), sec(1, 2), sec(1, 1)]) across(bendDirection('gusset', s, u));
  across(bendDirection('fixed', sec(2, 1), u));
  inPlane(bendDirection('fixed', sec(1, 2), u));
  across(bendDirection('fixed', sec(1, 1), u));
  across(bendDirection('pin', sec(2, 1), u));
  inPlane(bendDirection('pin', sec(1, 2), u));
  inPlane(bendDirection('pin', sec(1, 1), u));

  // a square tube on pins: the whole length bends, in the plane of the pins
  const pin = made(SB, { boundary_condition: 'Pin-Pin end' });
  assert.deepEqual(pin.g.lines[0].bend, [0, pin.g.spec.L]);
  inPlane(pin.g.lines[0].n);
});

test('fixed ends stay square, a gusset folds', () => {
  const fixed = made(SB, { boundary_condition: 'Fixed-fixed end' });
  const gusset = made(SB);
  const slope = (b: typeof gusset) => {
    const [l] = b.g.lines;
    const m = b.shape(step(-50, -300)).moves.brace;
    const q = (s: number) => dot(moved(at(l.o, l.u, s), m), l.n);
    return (q(l.bend[0] + 10) - q(l.bend[0])) / 10;
  };
  assert.ok(Math.abs(slope(fixed)) < 0.005, `fixed: ${slope(fixed)}`);
  assert.ok(slope(gusset) > 0.05, `gusset: ${slope(gusset)}`);
});

test('history: at the same displacement, buckled after a big tension cycle only', () => {
  const b = made(SB);
  const long = readStep(b.g, b.rec, step(5, -200, -5, 60)[FILE])[0];
  const short = readStep(b.g, b.rec, step(5, -200, -5, 5)[FILE])[0];
  assert.ok(long.a > 100, `after 60 mm: ${long.a}`);
  near(short.a, 0, 'after 5 mm');
});

test('protocol(): lo and hi on a thinned file', () => {
  const c = readResponse(readFileSync(new URL(`./specimens/responses/braces/${FILE}/${SBF}.csv`, import.meta.url), 'utf8'));
  const p = protocol({ [FILE]: c }, 60);
  let [lo, hi] = [0, 0];
  for (let i = 0; i < p.n; i++) {
    const s = p.at(i)[FILE];
    [lo, hi] = [Math.min(lo, s.along), Math.max(hi, s.along)];
    assert.deepEqual([s.lo, s.hi], [lo, hi], `step ${i}`);
  }
  near(hi - lo, Math.max(...c.x) - Math.min(...c.x), 'the turning points stay');
});

test('DBF: the second brace goes the other way, with its own history', () => {
  const b = made(DBF);
  const [one, two] = readStep(b.g, b.rec, step(20, 300, -30, 20)[FILE]);
  assert.equal(one.x, 20);
  assert.equal(two.x, -20);
  assert.equal(one.force, 150);
  assert.equal(two.force, -150);
  near(one.a, 0, 'the brace in tension is straight here');
  assert.ok(two.a > 0, 'the other one bows');
  assert.deepEqual(b.g.lines[1].n, mul(b.g.lines[0].n, -1), 'they bow apart');
  // it has its own longest length: 30 mm, when the first one was pushed
  const k = give(b);
  const { Pc, Pt } = capacities(b.rec, 'DBF');
  near(two.delta, Math.max(0, 30 - Pt! * k) - Pc! * k + 20, 'its shortening');
});

for (const id of [SBF, DBF])
  test(`${id}: the frame, the actuator and the braces stay joined`, () => {
    const { g, shape, r } = made(id);
    const { feet, top } = g.rig.frame!;
    const d = shape(step(4, 100), 5);
    const [l] = g.lines;
    const sway = moved(at(l.o, l.u, g.spec.L), d.moves[l.id]);
    near(dot(sway, l.u) / l.u[1] / l.u[1], sway[1] / l.u[1], 'it moves along y only', 1);
    near(sway[2], 0, 'it moves along y only');
    near(sway[1] * l.u[1], 20, 'the brace gets longer by x * scale');
    feet.forEach((foot, i) => {
      const col = d.moves[i ? 'rig-colB' : 'rig-colA'];
      nearV(moved(foot, col), [0, 0, 0], 'the column turns about its foot pin');
      nearV(moved([foot[0], foot[1], top], col), moved([foot[0], foot[1], top], d.moves['rig-beam']), 'column top and beam');
      nearV(moved(foot, d.moves[i ? 'rig-footB' : 'rig-footA']), [0, 0, 0], 'the foot pin');
      assert.ok(!d.moves[i ? 'rig-footB-mount' : 'rig-footA-mount'], 'the foot stays');
    });
    for (const line of g.lines) {
      const end = at(line.o, line.u, g.spec.L);
      nearV(moved(end, d.moves[line.id]), moved(end, d.moves['rig-colA']), 'the top end goes with the frame');
      nearV(moved(line.o, d.moves[line.id]), [0, 0, 0], 'the bottom end stays');
    }
    const { to } = g.rig.actuator;
    nearV(moved(to, d.moves['rig-actuator']), moved(to, d.moves['rig-beam']), 'the actuator stays on the beam', 0.5);
    assert.ok(!d.moves['rig-wall'] && !d.moves['rig-base'], 'wall and base stay');
    assert.equal(r.parts.filter((p) => p.id === 'rig-beam').length, 1);
  });

test('DBF: the second brace gets shorter by the same amount', () => {
  const { g, shape } = made(DBF);
  const d = shape(step(4, 100), 5);
  const [one, two] = g.lines;
  const change = (l: typeof one) => dot(moved(at(l.o, l.u, g.spec.L), d.moves[l.id]), l.u);
  near(change(one), 20, 'first');
  near(change(two), -20, 'second');
});

test('the scale changes the axial move, not the bow', () => {
  const { g, shape } = made(SB);
  const [l] = g.lines;
  const s = step(-50, -300);
  const [d1, d10] = [shape(s, 1), shape(s, 10)];
  near(dot(moved(middle(l), d10.moves.brace), l.n), dot(moved(middle(l), d1.moves.brace), l.n), 'bow');
  const top = at(l.o, l.u, g.spec.L);
  near(dot(moved(top, d10.moves.brace), l.u), -500, 'top');
  near(dot(moved(top, d1.moves.brace), l.u), -50, 'top');
  assert.ok(d10.notes?.some((n) => /×10.*real size/.test(n)), d10.notes?.join('\n'));
});

test('a monotonic SBF file reads as compression', () => {
  const b = made(SBF, { loading_protocol: 'Monotonic' });
  const [s] = readStep(b.g, b.rec, step(30, 100, 0, 30)[FILE]);
  assert.equal(s.x, -30);
  assert.equal(s.force, -100);
  assert.ok(s.a > 0);
  assert.ok(b.shape(step(30, 100, 0, 30)).notes?.some((n) => /compression as positive/.test(n)));
  assert.ok(readStep(made(SBF).g, made(SBF).rec, step(30, 100, 0, 30)[FILE])[0].x === 30, 'not a cyclic file');
});

test('the capacities: p_c, p_t, else p_t_theory, a DBF has sums', () => {
  assert.deepEqual(capacities({ p_c: 100, p_t: 200, p_t_theory: 300 }, 'SB'), { Pc: 100, Pt: 200 });
  assert.deepEqual(capacities({ p_c: 'nr', p_t: 'na', p_t_theory: 300 }, 'SB'), { Pc: 300, Pt: 300 });
  assert.deepEqual(capacities({ p_c: 100, p_t: 200, p_t_theory: 300 }, 'DBF'), { Pc: 50, Pt: 100 });
  assert.deepEqual(capacities({ p_c: 'nr', p_t: 'nr', p_t_theory: 300 }, 'DBF'), { Pc: 300, Pt: 300 });
});

test('the hinge stays up when the force falls', () => {
  const b = made(SB);
  const Pc = Number(b.rec.p_c);
  const peak = readStep(b.g, b.rec, step(-15, -Pc)[FILE])[0];
  const late = readStep(b.g, b.rec, step(-100, -0.3 * Pc)[FILE])[0];
  near(peak.axial!, 1, 'axial at the peak');
  near(late.axial!, 0.3, 'axial after buckling');
  assert.ok(late.hinge! > 0.7, `hinge after buckling: ${late.hinge}`);
  assert.ok(late.hinge! > peak.hinge!, 'more than at the peak');
  const zones = b.shape(step(-100, -0.3 * Pc)).zones;
  assert.deepEqual(zones.map((z) => z.slot), [1, 0]);
  assert.deepEqual(zones.map((z) => z.level), [late.axial, late.hinge]);
});

test('no Z in the record: the section gives it. No fy: no hinge zone, and a note', () => {
  const noZ = made(SB, { z_x: 'nr', z_y: 'nr' });
  const ref = made(SB);
  // the section has sharp corners and the nominal thickness, so it is a bit more
  assert.ok(Math.abs(noZ.g.lines[0].Mp! / ref.g.lines[0].Mp! - 1) < 0.3, 'near the Z of the record');
  const noFy = made(SB, { fy_m: 'nr', f_yn: 'nr' });
  const d = noFy.shape(step(-50, -300));
  assert.deepEqual(d.zones.map((z) => z.slot), [1]);
  assert.ok(d.notes?.some((n) => /no hinge zone/.test(n)));
});

test('in each detail: few knots and zones, every move is for a part', () => {
  for (const id of [SB, SBF, DBF])
    for (const detail of ['members', 'plates', 'bolts'] as Detail[])
      for (const ends of ['Gusset plate', 'Fixed-fixed end', 'Pin-Pin end']) {
        const { r, shape } = made(id, { boundary_condition: ends }, detail);
        const d = shape(step(-30, -100, -30, 20), 5);
        assert.ok(d.zones.length <= 4, `${id}: zones`);
        const ids = new Set(r.parts.map((p) => p.id));
        for (const [name, m] of Object.entries(d.moves)) {
          assert.ok(ids.has(name), `${id} ${detail}: no part ${name}`);
          assert.ok(m.knots.length <= 8, `${id} ${name}: knots`);
        }
      }
});

// ---- with the hub data
// Each test outside the bands, and why. The PR that added this file says more.
// No data is fixed here: these lists go down when the hub data gets fixed.
const AXIAL_OUTSIDE = [
  // the file is the one of another test: HSS2-1, HSS2-2, P2-1
  'Fell_et_al_HSS1-4', 'Fell_et_al_HSS1-5', 'Fell_et_al_HSS1-6',
  // the file goes past p_c, p_t and p_t_theory
  'Zayas_Strut1',
  // p_c is a copy of p_t
  'Zayas_Strut6',
  // p_c and p_t are 2.85 times too small, the file agrees with p_t_theory
  'Tremblay_W6',
  // p_t 11.5 and p_c 5.8, the file says 93 and 60
  'Broderick_CyIS5-50H', 'Broderick_CyLS1-40H',
  // the file stays at 0.53 of the record both ways
  'Wakabayashi_SPC1',
  // not an error: in a DBF p_c and p_t are the two directions of the sum
  'Wakabayashi_DIC3-D1', 'Wakabayashi_DIC3-D2', 'Wakabayashi_DAC3-1', 'Wakabayashi_DAC3-2',
];
const HINGE_OUTSIDE = [
  // tension only
  'Fell_et_al_P1-4', 'Fell_et_al_P2-4',
  // a short protocol, the brace hardly goes past buckling
  'Han_S90-8A', 'Han_S90-8B', 'Han_S90-8C', 'Zayas_Strut3',
  // stocky tubes: the force falls faster than the bow grows, likely local buckling
  'Tremblay_RHS12', 'Tremblay_RHS13',
  // z_x and z_y are 1e6 too big
  'Nip_40x40x3x2050-CS-HR', 'Nip_40x40x3x1250-CS-HR', 'Nip_40x40x3x1250-CS-CF', 'Nip_50x50x3x2850-SS-CF',
  'Nip_50x50x3x2050-SS-CF', 'Nip_60x40x3x2050-SS-CF', 'Nip_50x50x3x1250-SS-CF', 'Nip_60x40x3x1250-SS-CF',
  // z_x and z_y are 1000 too big
  'Wakabayashi_RB4C',
  // z_x and z_y are wrong, and the file goes to 2.4 times p_t_theory
  'Wakabayashi_FTBC',
  // the middle moves before the peak, so the bow is too big at the peak
  'Lehman_Roeder_HSS8',
  // a long DBF: the sum falls below p_t_theory, so |F| - p_t_theory leaves nothing
  // for the brace in compression
  'Wakabayashi_DAM3',
  // the file has the sum of two braces, and |F| - p_t_theory leaves out the
  // hardening of the one in tension: the force of the other one is too high
  'Wakabayashi_DIM1', 'Wakabayashi_DIM2', 'Wakabayashi_DIM3', 'Wakabayashi_DIC1-D1', 'Wakabayashi_DIC1-D2',
  'Wakabayashi_DIC3-D1', 'Wakabayashi_DIC3-D2', 'Wakabayashi_DOM1', 'Wakabayashi_DOM2', 'Wakabayashi_DOM3',
  'Wakabayashi_DOC3-D1', 'Wakabayashi_DOC3-D2', 'Wakabayashi_BFDI-D1', 'Wakabayashi_BFDI-D2',
];
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];

const dir = findHubData();
test('hub braces: the levels of every test with a response file', { skip: dir ? false : 'no resslab-hub-data folder next to the repo' }, (t) => {
  const rows = parseCsv(readFileSync(join(dir!, HUB_TABLES.braces), 'utf8'));
  const folder = join(dir!, 'braces', FILE);
  const files = new Set(readdirSync(folder));
  const seen: { id: string; axial: number; hinge: number; peak: boolean; early: boolean }[] = [];
  let shown = 0; // the biggest axial move on screen, over the length of the brace
  for (const rec of rows) {
    const id = String(rec.id);
    if (!files.has(`${id}.csv`)) continue;
    let spec;
    try {
      spec = toSpecimen(rec);
    } catch {
      continue; // hub.test.ts looks at these
    }
    const c = readResponse(readFileSync(join(folder, `${id}.csv`), 'utf8'));
    if (!c.x.length) continue;
    const r = generate({ specimen: spec }, cat);
    const g = geometry(r, rec);
    const p = protocol({ [FILE]: c });
    const scale = T.autoScale(p);
    shown = Math.max(shown, (Math.max(...c.x.map(Math.abs)) * scale) / g.spec.L);
    let [axial, hinge] = [0, 0];
    const steps = Array.from({ length: p.n }, (_, i) => readStep(g, rec, p.at(i)[FILE]));
    for (const s of steps.flat()) {
      for (const v of [s.a, s.axial, s.hinge]) assert.ok(v === undefined || Number.isFinite(v), `${id}: not finite`);
      axial = Math.max(axial, s.axial ?? 0);
      hinge = Math.max(hinge, s.hinge ?? 0);
    }
    // the compression peak: the force turns back after it
    const Pc = capacities(rec, g.spec.frame).Pc ?? 0;
    let [at0, best] = [-1, 0];
    for (let i = 0; i < steps.length; i++) {
      const f = steps[i][0].force;
      if (f < best) [at0, best] = [i, f];
      else if (best < -0.3 * Pc && f > best + 0.08 * Math.abs(best)) break;
    }
    const first = steps.findIndex((s) => s[0].a > g.lines[0].Lb / 200);
    seen.push({ id, axial, hinge, peak: at0 >= 0, early: at0 >= 0 && first >= 0 && first < at0 });
    for (const k of [0, 0.25, 0.5, 0.75, 1]) {
      const d = T.shape(r, spec, rec, p.at(Math.round(k * (p.n - 1))), scale);
      assert.ok(d.zones.length <= 4 && d.zones.every((z) => Number.isFinite(z.level)), `${id}: zones`);
      for (const [name, m] of Object.entries(d.moves)) {
        assert.ok(m.knots.length <= 8, `${id} ${name}: knots`);
        assert.ok(movePoint(add(m.o, mul(m.u, 500)), m).every(Number.isFinite), `${id} ${name}: not finite`);
      }
    }
  }
  const [axials, hinges] = [seen.map((s) => s.axial), seen.map((s) => s.hinge).filter((h) => h > 0)];
  const peaks = seen.filter((s) => s.peak);
  const early = peaks.filter((s) => s.early).length / peaks.length;
  t.diagnostic(`${seen.length} tests, axial median ${median(axials).toFixed(2)}, hinge median ${median(hinges).toFixed(2)}, early ${(100 * early).toFixed(0)} %`);
  assert.ok(seen.length > 200, `${seen.length} tests`);
  assert.ok(median(axials) > 0.9 && median(axials) < 1.1, `axial median ${median(axials)}`);
  assert.ok(median(hinges) > 0.8 && median(hinges) < 1.4, `hinge median ${median(hinges)}`);
  assert.ok(early < 0.2, `the middle moves before the peak on ${early} of the tests`);
  assert.ok(shown < 0.25, `a brace looks ${shown} shorter on screen`);
  assert.deepEqual(seen.filter((s) => s.axial < 0.7 || s.axial > 1.3).map((s) => s.id).sort(), [...AXIAL_OUTSIDE].sort());
  assert.deepEqual(seen.filter((s) => s.hinge < 0.4 || s.hinge > 3).map((s) => s.id).sort(), [...HINGE_OUTSIDE].sort());
});
