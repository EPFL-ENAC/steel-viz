// The concrete slab of a beam-to-column test (slab.ts): what hub.ts reads, where
// the slab goes, how it follows its beam, and what it must not change (the steel,
// the seeds). The last test reads the hub table, so it needs a copy of
// resslab-hub-data next to the repo (skipped in CI).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { clashes } from './clash.ts';
import { movePoint, type DeformTable } from './deform.ts';
import { DEFORMS } from './deforms.ts';
import { floating, generate, hdir, type Result } from './generate.ts';
import { renderHLR } from './hlr.ts';
import { fromHubConnection, toSpecimen, type HubRecord } from './hub.ts';
import { loadCatalog, parseCsv } from './sections.ts';
import { RIB_PITCH, SLAB_NOTE, TIP_GAP } from './slab.ts';
import type { ConnSpecimen } from './specimen.ts';
import { render, type Box, type Part } from './steel.ts';
import { findHubData, HUB_TABLES, readTables } from './tables.ts';
import { add, cross, dot, mul, sub, type V } from './vec.ts';

const cat = loadCatalog('aisc', ...readTables('aisc'));
const T: DeformTable = DEFORMS.connections;
const record = (id: string): HubRecord => JSON.parse(readFileSync(new URL(`./specimens/${id}.json`, import.meta.url), 'utf8'));
const SPEC1 = record('Ricles_et_al_2004_SPEC-1');
const DC2 = record('Chi_and_Uang_2002_DC2');
const ISO = { az: 225, el: 35.264, size: 800 };

const INTERIOR = 'Interior - Column Loaded - Subassembly';
const EXTERIOR = 'Exterior - Beam Loaded - Subassembly';
const INTERIOR_BEAM = 'Interior - Beam Loaded - Subassembly';
const RBS = { connection_type: 'RBS', b_bf_rbs: 228.6 };
const BFP = { connection_type: 'BFP' };

const spec = (over: HubRecord = {}) => fromHubConnection({ ...SPEC1, ...over });
const draw = (over: HubRecord = {}): Result => generate({ specimen: spec(over) }, cat);
const slabsOf = (parts: Part[]) => parts.filter((p) => p.kind === 'slab');
const points = (p: Part) => p.faces.flatMap((f) => f.pts);
const inside = (q: V, b: Box) => b.ax.every((ax, k) => Math.abs(dot(sub(q, b.c), ax)) < b.h[k]);
const middle = (x: number[]) => (Math.min(...x) + Math.max(...x)) / 2;
// a beam and the column axis: along() is mm along the beam, from this axis
function axis(r: Result, armId: string) {
  const a = r.st.arms.find((x) => x.id === armId)!;
  const col = points(r.parts.find((p) => p.id === 'column')!);
  const c: V = [middle(col.map((q) => q[0])), middle(col.map((q) => q[1])), 0];
  const h = hdir(a.bearing);
  return { z: a.z, c, h, along: (q: V) => dot(sub(q, c), h) };
}

test('the reader: the sizes of the record, both spellings of perpendicular', () => {
  assert.deepEqual(spec().slab, { left: 1219.2, right: 304.8, concrete: 82.55, rib: 50.8, ribWidth: 127, ribs: 'parallel' });
  assert.equal(spec({ deck_ribs_orientation: 'perpenticular' }).slab!.ribs, 'perpendicular');
  assert.equal(spec({ deck_ribs_orientation: 'perpendicular' }).slab!.ribs, 'perpendicular');
  assert.equal(spec({ deck_ribs_orientation: 'Parallel' }).slab!.ribs, 'parallel');
});

test('the reader: the note says what we take, the old note is gone', () => {
  const { notes } = spec();
  assert.ok(notes!.includes(SLAB_NOTE));
  assert.ok(!notes!.some((n) => /slab.*not drawn/.test(n)));
  assert.match(SLAB_NOTE, new RegExp(`${TIP_GAP} mm.*${RIB_PITCH} mm`));
});

test('the reader: no slab, missing sizes, unknown orientation', () => {
  const bare = spec({ slab: 'NO' });
  assert.equal(bare.slab, undefined);
  assert.ok(!bare.notes!.some((n) => /slab/.test(n)));
  for (const over of [{ w_l: 'NA' }, { h_co: 0 }, { b_o: null }, { deck_ribs_orientation: 'NA' }]) {
    const s = spec(over);
    assert.equal(s.slab, undefined, JSON.stringify(over));
    assert.ok(s.notes!.includes('the slab sizes are missing, the slab is not drawn'), JSON.stringify(over));
  }
  // the form that hub-count.ts groups
  assert.throws(() => spec({ deck_ribs_orientation: 'diagonal' }), { message: 'Ricles_et_al_2004_SPEC-1: deck_ribs_orientation "diagonal" is not supported yet' });
});

test('no clash and no floating part: interior, exterior, both rib directions, RBS and flange plates', () => {
  for (const specimen_type of [INTERIOR, EXTERIOR, INTERIOR_BEAM])
    for (const deck_ribs_orientation of ['parallel', 'perpenticular'])
      for (const conn of [RBS, BFP]) {
        const at = `${specimen_type} ${deck_ribs_orientation} ${conn.connection_type}`;
        const r = draw({ specimen_type, deck_ribs_orientation, ...conn });
        assert.equal(slabsOf(r.parts).length, r.st.arms.length, at);
        assert.deepEqual(clashes(r.parts), [], at);
        assert.deepEqual(floating(r.parts), [], at);
      }
});

test('one slab part per beam, on its beam', () => {
  const r = draw();
  assert.equal(r.st.arms.length, 2);
  assert.deepEqual(slabsOf(r.parts).map((p) => [p.id, p.supports]), r.st.arms.map((a) => [`${a.id}-slab`, [a.id]]));
  assert.deepEqual(slabsOf(draw({ specimen_type: EXTERIOR }).parts).map((p) => p.id), ['beam1-slab']);
});

test('the column goes through an opening, closed on an exterior test', () => {
  for (const specimen_type of [INTERIOR, EXTERIOR]) {
    const r = draw({ specimen_type });
    const { d, bf } = r.st.col;
    const { z, c, h } = axis(r, r.st.arms[0].id);
    const boxes = slabsOf(r.parts).flatMap((p) => p.boxes ?? []);
    const across = cross(h, [0, 0, 1]);
    // a point in the concrete layer, at s along the beam and x across it
    const at = (s: number, x: number): V => [...add(add(c, mul(h, s)), mul(across, x)).slice(0, 2), z + 50.8 + 82.55 / 2] as V;
    for (const s of [0, d / 2, -d / 2])
      for (const x of [0, bf / 2, -bf / 2]) assert.ok(!boxes.some((b) => inside(at(s, x), b)), `${specimen_type}: ${s}, ${x} is in the slab`);
    // the concrete all around: in front, on both sides
    for (const [s, x] of [[d / 2 + 100, 0], [10, bf / 2 + 60], [10, -bf / 2 - 60]]) assert.ok(boxes.some((b) => inside(at(s, x), b)), `${specimen_type}: no slab at ${s}, ${x}`);
  }
  // the two parts of an interior test meet at the column axis, an exterior one
  // goes past the back flange
  const reach = (r: Result) => Math.min(...points(slabsOf(r.parts)[0]).map(axis(r, r.st.arms[0].id).along));
  assert.ok(Math.abs(reach(draw())) < 0.01);
  const ext = draw({ specimen_type: EXTERIOR });
  assert.ok(reach(ext) < -ext.st.col.d / 2);
});

test('the slab stops before the rig at the beam tip', () => {
  for (const specimen_type of [INTERIOR, EXTERIOR, INTERIOR_BEAM]) {
    const r = draw({ specimen_type });
    for (const a of r.st.arms) {
      const { along } = axis(r, a.id);
      const end = Math.max(...points(r.parts.find((p) => p.id === `${a.id}-slab`)!).map(along));
      const rig = r.parts.filter((p) => p.kind === 'rig' && p.supports.includes(a.id));
      assert.ok(rig.length > 0, `${specimen_type} ${a.id}: no tip rig`);
      const start = Math.min(...rig.flatMap(points).map(along));
      assert.ok(end <= start, `${specimen_type} ${a.id}: the slab ends at ${end}, the rig starts at ${start}`);
      assert.ok(end < Math.max(...points(r.parts.find((p) => p.id === a.id)!).map(along)));
    }
  }
});

test('the ribs: under the concrete, inside the edges, at the rib spacing', () => {
  const zs = (over: HubRecord) => {
    const r = draw(over);
    const p = r.parts.find((x) => x.id === 'beam1-slab')!;
    const { z: top, along } = axis(r, 'beam1');
    const low = p.faces.filter((f) => f.pts.every((q) => Math.abs(q[2] - top) < 0.01));
    return { top, p, low, along };
  };
  const par = zs({});
  const zAll = points(par.p).map((q) => q[2]);
  assert.ok(Math.abs(Math.min(...zAll) - par.top) < 0.01, 'the ribs stand on the top flange');
  assert.ok(Math.abs(Math.max(...zAll) - (par.top + 50.8 + 82.55)) < 0.01, 'the total depth');
  // a rib every RIB_PITCH: walls across the beam repeat at that spacing
  const per = zs({ deck_ribs_orientation: 'perpenticular' });
  const starts = [...new Set(per.low.flatMap((f) => f.pts.map((q) => Math.round(per.along(q)))))].sort((a, b) => a - b);
  assert.ok(starts.length >= 4, 'perpendicular ribs');
  assert.ok(starts.some((s, i) => starts.some((k, j) => j > i && Math.abs(k - s - RIB_PITCH) <= 1)));
});

test('a bad slab throws a clear error', () => {
  const base = spec() as ConnSpecimen;
  const go = (slab: Partial<NonNullable<ConnSpecimen['slab']>>, more: Partial<ConnSpecimen> = {}) => () => generate({ specimen: { ...base, ...more, slab: { ...base.slab!, ...slab } } }, cat);
  assert.throws(go({ right: 100 }), /must be more than the column opening/);
  assert.throws(go({ rib: -1 }), /rib must be a number above 0/);
  assert.throws(go({ ribWidth: RIB_PITCH }), /more than the rib spacing/);
  assert.throws(go({ ribs: 'x' as 'parallel' }), /ribs must be parallel or perpendicular/);
  assert.throws(go({}, { beams: [{ ...base.beams[0], bearing: 90 }] }), /on the column web/);
});

test('the slab follows its beam: same stations, same offset, a chord close to the curve', () => {
  const rec = { ...SPEC1, ...RBS };
  const s = toSpecimen(rec);
  const r = generate({ specimen: s }, cat);
  const d = T.shape(r, s, rec, { Global: { x: 0.04, y: 1000, along: 0.04 }, Beam_moment_rotation: { x: 0.03, y: 1e6, along: 0.03 } }, 5);
  let moved = 0;
  for (const a of r.st.arms) {
    const m = d.moves[`${a.id}-slab`];
    assert.equal(m, d.moves[a.id], `${a.id}: the slab has the move of its beam`);
    const beam = r.parts.find((p) => p.id === a.id)!;
    const slab = r.parts.find((p) => p.id === `${a.id}-slab`)!;
    const along = (q: V) => dot(sub(q, m.o), m.u);
    const lo = Math.min(...points(slab).map(along));
    const hi = Math.max(...points(slab).map(along));

    // every station of the beam under the slab is a station of the slab too
    const have = points(slab).map(along);
    for (const st of new Set(points(beam).map(along)))
      if (st > lo && st < hi) assert.ok(have.some((k) => Math.abs(k - st) <= 0.5), `${a.id}: no slab station at ${st}`);

    // a rib bottom point and the point at the same station and height on the
    // beam axis stay at the same distance
    const flat = points(slab).filter((q) => Math.abs(q[2] - a.z) < 0.01);
    assert.ok(flat.length > 0);
    const lat = cross(m.u, m.n);
    for (const q of flat) {
      const under = sub(q, mul(lat, dot(sub(q, m.o), lat)));
      const gap = Math.hypot(...sub(q, under));
      const after = Math.hypot(...sub(movePoint(q, m), movePoint(under, m)));
      assert.ok(Math.abs(after - gap) < 0.5, `${a.id}: the gap goes from ${gap} to ${after} mm`);
      moved += Math.hypot(...sub(movePoint(q, m), q)) > 1 ? 1 : 0;
    }

    // between two stations the faces are straight, and they stay close to the curve
    const top = Math.max(...points(slab).map((q) => q[2]));
    for (const f of slab.faces) {
      if (!f.pts.every((q) => Math.abs(q[2] - top) < 0.01)) continue;
      for (let i = 0; i < 4; i++) {
        const [p, q] = [f.pts[i], f.pts[(i + 1) % 4]];
        const mid: V = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, p[2]];
        const [mp, mq] = [movePoint(p, m), movePoint(q, m)];
        const chord: V = [(mp[0] + mq[0]) / 2, (mp[1] + mq[1]) / 2, (mp[2] + mq[2]) / 2];
        const off = Math.hypot(...sub(chord, movePoint(mid, m)));
        assert.ok(off < 5, `${a.id}: a chord is ${off} mm from the curve`);
      }
    }
  }
  assert.ok(moved > 0, 'nothing moved');
});

test('the rail says the slab is not counted, only on a test with a slab', () => {
  const noted = (rec: HubRecord) => {
    const s = toSpecimen(rec);
    const d = T.shape(generate({ specimen: s }, cat), s, rec, { Global: { x: 0.02, y: 1000, along: 0.02 } }, 1);
    return d.notes!.some((n) => n.startsWith('The slab is not counted'));
  };
  assert.ok(noted(SPEC1));
  assert.ok(!noted({ ...SPEC1, slab: 'NO' }));
  assert.ok(!noted(DC2));
});

test('the steel parts are the same with and without the slab', () => {
  for (const over of [RBS, BFP, { specimen_type: EXTERIOR }]) {
    // the rig parts built after the slab come later: same order, other step numbers
    const steel = (parts: Part[]) => parts.filter((p) => p.kind !== 'slab').map((p) => ({ ...p, step: 0 }));
    const order = (parts: Part[]) => parts.filter((p) => p.kind !== 'slab').sort((p, q) => p.step - q.step).map((p) => p.id);
    const [a, b] = [draw(over).parts, draw({ ...over, slab: 'NO' }).parts];
    assert.deepEqual(steel(a), steel(b));
    assert.deepEqual(order(a), order(b));
  }
});

test('seeds have no slab', () => {
  for (const seed of [1, 2, 3, 4, 5]) assert.deepEqual(slabsOf(generate({ seed }, cat).parts), []);
  assert.deepEqual(slabsOf(generate({ specimen: toSpecimen(DC2) }, cat).parts), []);
});

// the steel lines of a drawing: every segment outside the groups of the rig and
// the slab (class g), as a share of the steel box, so a change of scale is out
function steelLines(svg: string) {
  const segs: number[][] = [];
  for (const g of svg.split('<g').slice(1)) {
    if (g.startsWith(' class="g')) continue;
    for (const [, d] of g.matchAll(/<path[^>]* d="([^"]*)"/g)) {
      if (/[^-MLH\d. e]/.test(d)) continue;
      for (const sub of d.split('M').slice(1)) {
        const n = sub.split('L').map((t) => t.trim().split(' ').map(Number));
        for (let i = 0; i + 1 < n.length; i++) segs.push([...n[i], ...n[i + 1]]);
      }
    }
  }
  const [xs, ys] = [segs.flatMap((s) => [s[0], s[2]]), segs.flatMap((s) => [s[1], s[3]])];
  const [x0, y0, w] = [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs)];
  return segs.map((s) => [(s[0] + s[2]) / 2, (s[1] + s[3]) / 2].map((v, i) => (v - (i ? y0 : x0)) / w));
}

test('SVG: the slab hides no steel line, and its own lines are in the light group', () => {
  for (const over of [RBS, BFP]) {
    const [a, b] = [steelLines(renderHLR(draw(over).parts, ISO).svg), steelLines(renderHLR(draw({ ...over, slab: 'NO' }).parts, ISO).svg)];
    assert.ok(b.length > 100);
    assert.ok(Math.abs(a.length - b.length) <= b.length * 0.01, `${b.length} steel lines with no slab, ${a.length} with it`);
    // each line with no slab is still there with it (1% of the steel box: the rounding of the two scales)
    const lost = b.filter((p) => !a.some((q) => Math.abs(q[0] - p[0]) < 0.01 && Math.abs(q[1] - p[1]) < 0.01));
    assert.ok(lost.length <= b.length * 0.01, `${lost.length} of ${b.length} steel lines are lost under the slab`);
  }
  // a part of the drawing is in the slab: more light lines with it
  const light = (svg: string) => svg.split('<g class="g').length;
  assert.ok(light(renderHLR(draw().parts, ISO).svg) > light(renderHLR(draw({ slab: 'NO' }).parts, ISO).svg));
});

test('the painter draws the slab with no fill', () => {
  const svg = render(draw().parts, ISO).svg;
  assert.match(svg, /\.steel \.n path\{fill:none\}/);
  assert.match(svg, /class="g n"/);
  assert.doesNotMatch(render(draw({ slab: 'NO' }).parts, ISO).svg, /class="g n"/);
});

const dir = findHubData();
test('hub connections: the 13 tests with a slab draw it, on every beam', { skip: dir ? false : 'no resslab-hub-data folder next to the repo' }, () => {
  const rows = parseCsv(readFileSync(join(dir!, HUB_TABLES.connections), 'utf8'));
  const withSlab = rows.filter((row) => /^YES$/i.test(String(row.slab).trim()));
  assert.equal(withSlab.length, 14);
  const ids: string[] = [];
  for (const row of withSlab) {
    let s: ConnSpecimen;
    try {
      s = fromHubConnection(row);
    } catch {
      continue; // Del_Caprio_et_al_2014_RBS-A, an "Exterior - Frame"
    }
    assert.ok(s.slab, `${s.id}: no slab`);
    assert.ok(!s.notes!.some((n) => /slab.*not drawn/.test(n)), `${s.id}: the note is still there`);
    const r = generate({ specimen: s }, cat);
    assert.equal(slabsOf(r.parts).length, r.st.arms.length, s.id);
    ids.push(s.id);
  }
  assert.equal(ids.length, 13);
});
