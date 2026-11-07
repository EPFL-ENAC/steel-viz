// The RBS cut (rbs.ts): what hub.ts reads, the beam faces of steel.ts, and
// the beam hinge of deform-connection.ts at the cut. The last test reads the
// force files of the hub, so it needs a copy of resslab-hub-data next to the
// repo (skipped in CI).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { clashes } from './clash.ts';
import { protocol, readResponse, type Curve, type DeformTable } from './deform.ts';
import { DEFORMS } from './deforms.ts';
import { floating, generate } from './generate.ts';
import { toSpecimen, type HubRecord } from './hub.ts';
import { hubRbs, RBS_NOTE } from './rbs.ts';
import { loadCatalog, parseCsv } from './sections.ts';
import { geo, memberFaces, rbsDepth } from './steel.ts';
import { findHubData, HUB_TABLES, readTables } from './tables.ts';
import { cross, dot, sub, type V } from './vec.ts';

const cat = loadCatalog('aisc', ...readTables('aisc'));
const T: DeformTable = DEFORMS.connections;
const DC2: HubRecord = JSON.parse(readFileSync(new URL('./specimens/Chi_and_Uang_2002_DC2.json', import.meta.url), 'utf8'));
const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) < tol;

test('hubRbs: the cut of DC2, from b_bf_rbs, else rbs_cut, else no cut', () => {
  const r = hubRbs(304.8, 911.86, 228.6, 0.25);
  assert.deepEqual(r.rbs, { a: 190.5, b: 683.895, c: 38.1 });
  assert.equal(r.note, RBS_NOTE);
  assert.match(r.note, /0\.625.*0\.75/);
  assert.ok(near(hubRbs(304.8, 911.86, NaN, 0.25).rbs!.c, 38.1));
  const none = hubRbs(304.8, 911.86, NaN, NaN);
  assert.equal(none.rbs, undefined);
  assert.match(none.note, /not drawn/);
  // the record reads the same
  const spec = toSpecimen(DC2);
  assert.ok(spec.test === undefined || spec.test === 'connection');
  if (spec.test === undefined || spec.test === 'connection') assert.deepEqual(spec.beams[0].rbs, r.rbs);
});

// a W36x150 beam, 3000 mm along x, with the cut of DC2
const rbs = { a: 190.5, b: 683.895, c: 38.1 };
function beamFaces() {
  const sec = cat.all.find((s) => s.id === 'W36X150')!;
  const g = geo('beam', sec, [0, 0, 0], [3000, 0, 0], true);
  g.rbs = rbs;
  return { sec, g, faces: memberFaces(g, 1000, [1500]) };
}

test('the faces: the flanges are narrower in the cut, full outside', () => {
  const { sec, g, faces } = beamFaces();
  const pts = faces.flatMap((f) => f.pts);
  // the half width of the flanges at x along the beam
  const half = (x: number) => Math.max(...pts.filter((p) => near(dot(sub(p, g.p0), g.u), x, 1e-3)).map((p) => Math.abs(dot(sub(p, g.p0), g.v))));
  assert.ok(near(rbsDepth(rbs, rbs.a + rbs.b / 2), rbs.c, 1e-9));
  assert.ok(near(half(rbs.a + rbs.b / 2), sec.bf / 2 - rbs.c), `center ${half(rbs.a + rbs.b / 2)}`);
  assert.ok(near(half(rbs.a), sec.bf / 2));
  assert.ok(near(half(rbs.a + rbs.b), sec.bf / 2));
  assert.ok(near(half(0), sec.bf / 2) && near(half(3000), sec.bf / 2));
  // every face is flat
  for (const f of faces) {
    if (f.pts.length !== 4) continue;
    const [a, b, c, d] = f.pts;
    const k = cross(sub(b, a), sub(c, a));
    assert.ok(Math.abs(dot(k, sub(d, a))) / Math.max(1e-9, Math.hypot(...k)) < 1e-6, 'a side face is not flat');
  }
});

test('the faces: no edge across the beam inside the cut', () => {
  const { g, faces } = beamFaces();
  const at = (p: V) => dot(sub(p, g.p0), g.u);
  let along = 0;
  for (const f of faces)
    for (const [i, j] of f.edges) {
      const [x, y] = [at(f.pts[i]), at(f.pts[j])];
      if (Math.min(x, y) < rbs.a - 1e-6 || Math.max(x, y) > rbs.a + rbs.b + 1e-6) continue;
      assert.ok(Math.abs(x - y) > 1e-6, `an edge across the beam at ${x.toFixed(1)}`);
      along++;
    }
  assert.ok(along > 0);
});

test('an interior test: both beams are cut, no clash, no floating part', () => {
  const rec = { ...DC2, specimen_type: String(DC2.specimen_type).replace('Exterior', 'Interior'), l_b: 2 * Number(DC2.l_b) };
  const spec = toSpecimen(rec);
  const r = generate({ specimen: spec }, cat);
  assert.deepEqual(r.st.arms.map((a) => a.rbs), [rbs, rbs]);
  const cut = r.parts.filter((p) => p.info?.type?.endsWith(', RBS'));
  assert.equal(cut.length, 2);
  assert.deepEqual(clashes(r.parts), []);
  assert.deepEqual(floating(r.parts), []);
});

test('the hinge: at the center of the cut, M at the cut over Mp of the cut', () => {
  const spec = toSpecimen(DC2);
  const r = generate({ specimen: spec }, cat);
  const d = T.shape(r, spec, DC2, { Global: { x: 0.02, y: 1000, along: 0.02 } }, 1);
  const hinge = d.zones.find((z) => z.label === 'Beam hinge')!;
  const knots = d.moves.beam1.knots;
  const [face, tip] = [knots[0].s, knots.at(-1)!.s];
  const s = rbs.a + rbs.b / 2;
  const o = d.moves.beam1.o;
  assert.ok(near(dot(sub(hinge.c, o), d.moves.beam1.u), face + s), `center ${dot(sub(hinge.c, o), d.moves.beam1.u)}`);
  assert.ok(near(hinge.half[0], rbs.b / 2));
  const Mp = 7905329.428 * 379.8241715;
  assert.ok(near(hinge.level, (1000 * (tip - face - s) * 1000) / Mp, 1e-9), `level ${hinge.level}`);
  assert.equal(hinge.ratio, '|M| / Mp at the cut');
  assert.ok(d.notes!.some((n) => n.startsWith('RBS: the hinge is at the center of the cut')));
});

// ---- with the hub data
const median = (x: number[]) => [...x].sort((a, b) => a - b)[x.length >> 1];
const dir = findHubData();
test('hub RBS tests: the hinge level at the cut is finite, the median is a bit over 1', { skip: dir ? false : 'no resslab-hub-data folder next to the repo' }, (t) => {
  const table = join(dir!, 'connections');
  const rows = parseCsv(readFileSync(join(dir!, HUB_TABLES.connections), 'utf8')).filter((r) => r.connection_type === 'RBS');
  const forces = T.responses.filter((f) => f.slot === undefined || f.slot === 0).map((f) => f.folder);
  const files = new Map(T.responses.map(({ folder }) => [folder, new Set(readdirSync(join(table, folder)))]));
  const peaks: [string, number][] = [];
  for (const rec of rows) {
    const id = String(rec.id);
    let spec;
    try {
      spec = toSpecimen(rec);
    } catch {
      continue; // Del_Caprio_et_al_2014_RBS-A, hub.test.ts looks at it
    }
    const c: Record<string, Curve> = {};
    for (const [folder, names] of files) if (names.has(`${id}.csv`)) c[folder] = readResponse(readFileSync(join(table, folder, `${id}.csv`), 'utf8'));
    if (!forces.some((f) => c[f]?.x.length)) continue;
    const r = generate({ specimen: spec }, cat);
    assert.ok(r.st.arms.every((a) => a.rbs), `${id}: a beam with no cut`);
    const p = protocol(c);
    // about 50 even steps, and the step with the largest force of each file
    const steps = new Set([...Array(50).keys()].map((k) => Math.round((k * (p.n - 1)) / 49)));
    for (const f of forces) {
      let [best, big] = [0, -1];
      for (let i = 0; i < p.n; i++) {
        const y = Math.abs(p.at(i)[f]?.y ?? -1);
        if (y > big) [best, big] = [i, y];
      }
      if (big >= 0) steps.add(best);
    }
    let peak = 0;
    for (const i of steps) {
      const d = T.shape(r, spec, rec, p.at(i), 1);
      const hinges = d.zones.filter((z) => z.slot === 0);
      assert.ok(hinges.length === r.st.arms.length, `${id}: ${hinges.length} hinge zones`);
      for (const z of hinges) {
        assert.ok(Number.isFinite(z.level), `${id}: level ${z.level} at step ${i}`);
        peak = Math.max(peak, z.level);
      }
    }
    peaks.push([id, peak]);
  }
  const m = median(peaks.map(([, x]) => x));
  t.diagnostic(`${peaks.length} tests, median peak level ${m.toFixed(2)}`);
  for (const [id, x] of peaks) t.diagnostic(`${x.toFixed(2)} ${id}${x < 0.8 || x > 1.4 ? '  <- look' : ''}`);
  assert.equal(peaks.length, 19);
  assert.ok(m > 0.9 && m < 1.6, `median ${m}`);
});
