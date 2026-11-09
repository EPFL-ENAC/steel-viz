// node --test haunch.test.ts
// The two kinds only a hub test gets: welded_plates (WFP) and welded_haunch
// (KBB, see haunch.ts). What hub.ts reads, the parts, the deformed view, the
// hinge at the haunch tip. No random draw ever picks them. The last test reads
// the force files of the hub, so it needs a copy of resslab-hub-data next to
// the repo (skipped in CI).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { clashes } from './clash.ts';
import { follow, movePoint, protocol, readResponse, type Curve, type DeformTable, type Move } from './deform.ts';
import { DEFORMS } from './deforms.ts';
import { floating, generate, hdir, type Result } from './generate.ts';
import { HAUNCH_NOTE, hubHaunch } from './haunch.ts';
import { fromHubConnection, toSpecimen, type HubRecord } from './hub.ts';
import { loadCatalog, parseCsv } from './sections.ts';
import type { ConnSpecimen } from './specimen.ts';
import { BEAM_CONN_KINDS, CONNS, SPECIMEN_CONN_KINDS, type Part } from './steel.ts';
import { findHubData, HUB_TABLES, readTables } from './tables.ts';
import { dot, sub, type V } from './vec.ts';

const cat = loadCatalog('aisc', ...readTables('aisc'));
const T: DeformTable = DEFORMS.connections;
const record = (id: string): HubRecord => JSON.parse(readFileSync(new URL(`./specimens/${id}.json`, import.meta.url), 'utf8'));
const DC2 = record('Chi_and_Uang_2002_DC2'); // no slab
const SPEC1 = record('Ricles_et_al_2004_SPEC-1'); // a slab
const [D, L] = [300, 700];
const KBB = { connection_type: 'KBB', d_h: D, s_h: L, comments: 'Retrofit - triangular hanch' };
const WFP = { connection_type: 'WFP', t_pl: 25 };
const STRAIGHT = { ...KBB, comments: 'Retrofit - straight hanch' };
const HAUNCH = 'beam1-from-haunch';

const draw = (over: HubRecord, base = DC2): Result => generate({ specimen: fromHubConnection({ ...base, ...over }) }, cat);
const byId = (r: Result, id: string) => r.parts.find((p) => p.id === id);
const ids = (r: Result) => r.parts.map((p) => p.id).sort();
const points = (p: Part) => p.faces.flatMap((f) => f.pts);
const span = (x: number[]) => Math.max(...x) - Math.min(...x);
const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) < tol;
// the bounding box of a part, from its faces
const bbox = (p: Part) =>
  [0, 1, 2].flatMap((k) => {
    const xs = points(p).map((q) => q[k]);
    return [Math.min(...xs), Math.max(...xs)].map((x) => Math.round(x * 1000) / 1000);
  });
// along the beam from the column face, and depth under the beam bottom
function inBeam(r: Result, p: V) {
  const a = r.st.arms[0];
  const u = hdir(a.bearing);
  const face = Math.min(...points(byId(r, 'beam1')!).map((q) => dot(q, u)));
  return { s: dot(p, u) - face, h: a.z - a.sec.d - p[2] };
}
// the heights of the continuity plates
const plateLevels = (r: Result) => [...new Set(r.parts.filter((p) => /stiffener\d+e$/.test(p.id)).map((p) => {
  const z = points(p).map((q) => q[2]);
  return Math.round((Math.min(...z) + Math.max(...z)) / 2);
}))].sort((a, b) => a - b);

// ---- what hub.ts reads
test('a WFP record: welded_plates, t_pl, no note', () => {
  const s = fromHubConnection({ ...DC2, ...WFP });
  assert.equal(s.beams[0].connection, 'welded_plates');
  assert.equal(s.beams[0].tPlate, 25);
  assert.deepEqual(s.notes, []);
});

test('a WFP record with no t_pl: the usual error', () => {
  assert.throws(() => fromHubConnection({ ...DC2, connection_type: 'WFP' }), /: t_pl is missing$/);
});

test('a KBB record: welded_haunch, d_h and s_h, the note says KBB and no Kaiser', () => {
  const s = fromHubConnection({ ...DC2, ...KBB });
  assert.equal(s.beams[0].connection, 'welded_haunch');
  assert.deepEqual(s.beams[0].haunch, { depth: D, length: L, straight: false });
  assert.deepEqual(s.notes, [HAUNCH_NOTE]);
  assert.match(HAUNCH_NOTE, /KBB/);
  assert.doesNotMatch(HAUNCH_NOTE, /Kaiser/);
});

test('a KBB record with no d_h or s_h: the usual error', () => {
  assert.throws(() => fromHubConnection({ ...DC2, ...KBB, d_h: 'NA' }), /: d_h is missing$/);
  assert.throws(() => fromHubConnection({ ...DC2, ...KBB, s_h: 'NA' }), /: s_h is missing$/);
});

test('hubHaunch: straight only when the comments say it', () => {
  assert.equal(hubHaunch(1, 2, 'Retrofit - straight hanch').straight, true);
  assert.equal(hubHaunch(1, 2, 'Retrofit - triangular hanch').straight, false);
  assert.equal(hubHaunch(1, 2, 'Hanch - Retrofit').straight, false);
  assert.equal(hubHaunch(1, 2, '').straight, false);
});

// ---- WFP
test('WFP: the flange_plates parts with no bolts, thick as t_pl', () => {
  const [w, b] = [draw(WFP), draw({ connection_type: 'BFP' })];
  assert.ok(w.ok, w.log.join('\n'));
  assert.deepEqual(ids(w), ids(b).filter((id) => id !== 'beam1-bolts'));
  assert.ok(w.parts.filter((p) => p.kind !== 'rig').every((p) => p.dots.length === 0), 'a bolt on a welded plate');
  // the plates stand out of the beam by their thickness, up and down
  const conn = byId(w, 'beam1-from-conn')!;
  assert.ok(near(span(points(conn).map((q) => q[2])), w.st.arms[0].sec.d + 2 * 25), 'plate thickness');
  assert.deepEqual(conn.info?.conn, ['welded_plates']);
  // with the thickness of flange_plates (16), the same outline and the same beam
  const same = draw({ ...WFP, t_pl: 16 });
  assert.deepEqual(bbox(byId(same, 'beam1-from-conn')!), bbox(byId(b, 'beam1-from-conn')!));
  assert.deepEqual(bbox(byId(same, 'beam1')!), bbox(byId(b, 'beam1')!));
  assert.deepEqual(clashes(w.parts), []);
  assert.deepEqual(floating(w.parts), []);
});

test('WFP keeps its hinge at the column face', () => {
  const at = { Global: { x: 0.02, y: 1000, along: 0.02 } };
  const hinge = (over: HubRecord) => {
    const rec = { ...DC2, ...over };
    return T.shape(generate({ specimen: fromHubConnection(rec) }, cat), fromHubConnection(rec), rec, at, 1).zones.find((z) => z.label === 'Beam hinge')!;
  };
  const [w, b] = [hinge(WFP), hinge({ connection_type: 'BFP' })];
  assert.equal(w.ratio, '|M| / Mp');
  assert.equal(w.level, b.level);
  assert.deepEqual(w.c, b.c);
});

// ---- the haunch
test('the haunch: under the bottom flange, d_h deep and s_h long, as wide as the flange', () => {
  for (const over of [KBB, STRAIGHT]) {
    const r = draw(over);
    assert.ok(r.ok, r.log.join('\n'));
    const h = byId(r, HAUNCH)!;
    assert.equal(h.kind, 'plate');
    assert.deepEqual(h.supports, ['beam1', 'column']);
    assert.deepEqual(h.info?.conn, ['welded_haunch']);
    assert.deepEqual(h.dots, []);
    const at = points(h).map((p) => inBeam(r, p));
    assert.ok(near(Math.min(...at.map((q) => q.s)), 0) && near(Math.max(...at.map((q) => q.s)), L), 'length');
    assert.ok(near(Math.min(...at.map((q) => q.h)), 0) && near(Math.max(...at.map((q) => q.h)), D), 'depth');
    const across = r.st.arms[0].bearing % 180 === 0 ? 0 : 1;
    assert.ok(near(span(points(h).map((p) => p[across])), r.st.arms[0].sec.bf), 'width');
    // it replaces the plates: no plate part, no bolts
    assert.equal(byId(r, 'beam1-from-conn'), undefined);
    assert.equal(byId(r, 'beam1-bolts'), undefined);
    assert.deepEqual(clashes(r.parts), []);
    assert.deepEqual(floating(r.parts), []);
  }
});

test('the outline: a triangle goes up to the beam at the tip, a straight one stays deep', () => {
  const deepAtTip = (over: HubRecord) => {
    const r = draw(over);
    return Math.max(...points(byId(r, HAUNCH)!).map((p) => inBeam(r, p)).filter((q) => near(q.s, L)).map((q) => q.h));
  };
  assert.ok(near(deepAtTip(KBB), 0), `triangle ${deepAtTip(KBB)}`);
  assert.ok(near(deepAtTip(STRAIGHT), D), `straight ${deepAtTip(STRAIGHT)}`);
});

test('the beam is where it is with welded, only with one more cut at the tip', () => {
  for (const base of [DC2, SPEC1]) {
    const [h, w] = [draw(KBB, base), draw({ connection_type: 'WUF-W' }, base)];
    assert.deepEqual(bbox(byId(h, 'beam1')!), bbox(byId(w, 'beam1')!));
    const cut = points(byId(h, 'beam1')!).map((p) => inBeam(h, p)).filter((q) => near(q.s, L));
    assert.ok(cut.length > 0, 'no vertex at the tip');
  }
});

test('the slab has the outline of a welded beam, on top of the same beam', () => {
  const [h, w] = [draw(KBB, SPEC1), draw({ connection_type: 'WUF-W' }, SPEC1)];
  const slabs = (r: Result) => r.parts.filter((p) => p.kind === 'slab');
  assert.ok(slabs(h).length > 0, 'no slab');
  assert.deepEqual(slabs(h).map((p) => p.id), slabs(w).map((p) => p.id));
  assert.deepEqual(slabs(h).map(bbox), slabs(w).map(bbox));
  assert.deepEqual(slabs(h).map((p) => p.boxes), slabs(w).map((p) => p.boxes));
  assert.deepEqual(clashes(h.parts), []);
});

test('continuity plates: one more level at the bottom of the haunch, none with t_cp 0', () => {
  const [h, w] = [draw(KBB), draw({ connection_type: 'WUF-W' })];
  const a = h.st.arms[0];
  const extra = plateLevels(h).filter((z) => !plateLevels(w).includes(z));
  assert.deepEqual(extra, [Math.round(a.z - a.sec.d - D + a.sec.tf / 2)]);
  assert.equal(plateLevels(h).length, plateLevels(w).length + 1);
  assert.deepEqual(plateLevels(draw({ ...KBB, t_cp: 0 })), []);
});

test('the doubler stops at the plates of the beam flanges, not at the haunch', () => {
  const dp = { n_dp: 1, t_dp: 12 };
  const [h, w] = [draw({ ...KBB, ...dp }), draw({ connection_type: 'WUF-W', ...dp })];
  assert.deepEqual(bbox(byId(h, 'column-doublerw')!), bbox(byId(w, 'column-doublerw')!));
});

test('a haunch that does not fit is refused', () => {
  const beam = (haunch: { depth: number; length: number; straight: boolean } | undefined, connection: 'welded_haunch' | 'welded' = 'welded_haunch'): ConnSpecimen => ({
    id: 'x', column: { section: 'W14X257', height: 3000 }, beams: [{ section: 'W14X22', bearing: 0, length: 2000, connection, ...(haunch ? { haunch } : {}) }],
  });
  assert.throws(() => generate({ specimen: beam(undefined) }, cat), /needs a haunch/);
  assert.throws(() => generate({ specimen: beam({ depth: 5, length: 300, straight: false }) }, cat), /does not fit/);
  assert.throws(() => generate({ specimen: beam({ depth: 200, length: 5, straight: false }) }, cat), /does not fit/);
  assert.throws(() => generate({ specimen: beam({ depth: 200, length: 5000, straight: false }) }, cat), /does not fit/);
  assert.throws(() => generate({ specimen: beam({ depth: 200, length: 300, straight: false }, 'welded') }, cat), /does not fit/);
});

// ---- the deformed view
test('deformed view: the haunch has the move of the beam', () => {
  const r = draw(KBB);
  const [col, beam] = [{ name: 'column' }, { name: 'beam' }] as unknown as Move[];
  assert.equal(follow(r.parts, { column: col, beam1: beam })[HAUNCH], beam);
});

test('deformed view: at 4 % drift the bottom corner stays near the column, the top edge on the beam', () => {
  const rec = { ...DC2, ...KBB };
  const spec = fromHubConnection(rec);
  const r = generate({ specimen: spec }, cat);
  const d = T.shape(r, spec, rec, { Global: { x: 0.04, y: 1000, along: 0.04 } }, 1);
  const [m, c] = [d.moves.beam1, d.moves.column];
  const a = r.st.arms[0];
  const u = hdir(a.bearing);
  // the corner on the column face: as the haunch moves it, and as the column moves it
  const beamAt = points(byId(r, 'beam1')!).find((p) => near(inBeam(r, p).s, 0))!;
  const corner: V = [beamAt[0], beamAt[1], a.z - a.sec.d - D];
  const gap = Math.hypot(...sub(movePoint(corner, m), movePoint(corner, c)));
  assert.ok(gap < 8, `the corner leaves the column by ${gap.toFixed(1)} mm`);
  // the top edge is a chord of the bent beam: the gap at its middle is small
  const o: V = [corner[0], corner[1], a.z - a.sec.d];
  const tip: V = [o[0] + u[0] * L, o[1] + u[1] * L, o[2]];
  const mid: V = [o[0] + (u[0] * L) / 2, o[1] + (u[1] * L) / 2, o[2]];
  const [po, pt, pm] = [movePoint(o, m), movePoint(tip, m), movePoint(mid, m)];
  const off = Math.hypot(...sub(pm, po.map((x, k) => (x + pt[k]) / 2) as V));
  assert.ok(off < 2, `the top edge leaves the beam by ${off.toFixed(2)} mm`);
});

// ---- the hinge
test('the hinge: past the tip, M at s_h over Mp of the plain beam', () => {
  const rec = { ...DC2, ...KBB };
  const spec = fromHubConnection(rec);
  const r = generate({ specimen: spec }, cat);
  const d = T.shape(r, spec, rec, { Global: { x: 0.02, y: 1000, along: 0.02 } }, 1);
  const hinge = d.zones.find((z) => z.label === 'Beam hinge')!;
  const m = d.moves.beam1;
  const [face, tip] = [m.knots[0].s, m.knots.at(-1)!.s];
  const sec = r.st.arms[0].sec;
  // it starts just past the tip of the haunch, and is one beam depth long
  assert.ok(near(dot(sub(hinge.c, m.o), m.u), face + L + sec.d / 2 + 0.5), 'center');
  assert.ok(near(hinge.half[0], sec.d / 2));
  // no beam file: M at the face is P times the free length
  const Mp = Number(DC2.z_xb) * Number(DC2.f_yb_avg);
  assert.ok(near(hinge.level, (1000 * (tip - face - L) * 1000) / Mp, 1e-9), `level ${hinge.level}`);
  assert.equal(hinge.ratio, '|M| / Mp at the haunch tip');
  assert.ok(d.notes!.some((n) => n.startsWith('Haunch: the hinge starts at the haunch tip')));
});

// ---- the seeds
test('no random draw picks the two kinds', () => {
  const kinds = ['welded_plates', 'welded_haunch'] as const;
  for (const k of kinds) {
    assert.equal(CONNS[k].replaces, undefined);
    assert.equal(CONNS[k].specimenOnly, true);
    assert.ok(!(BEAM_CONN_KINDS as string[]).includes(k), k);
    assert.ok(SPECIMEN_CONN_KINDS.includes(k), k);
  }
  for (const form of ['tree', 'portal', 'box', 'mix'] as const)
    for (let seed = 1; seed <= 5; seed++) {
      const r = generate({ seed, form, connKindsP: 1, secondaryP: 1 }, cat);
      for (const k of kinds) assert.ok(!r.parts.some((p) => p.info?.conn?.includes(k)), `${form} seed ${seed}`);
    }
});

// ---- with the hub data
const dir = findHubData();
test('hub: the 11 tests have their kind, no clash, no floating part, and finite levels on the 7 haunches', { skip: dir ? false : 'no resslab-hub-data folder next to the repo' }, (t) => {
  const table = join(dir!, 'connections');
  const rows = parseCsv(readFileSync(join(dir!, HUB_TABLES.connections), 'utf8'));
  const wfp = rows.filter((r) => r.connection_type === 'WFP');
  const kbb = rows.filter((r) => r.connection_type === 'KBB');
  assert.equal(wfp.length, 4);
  assert.equal(kbb.length, 7);
  for (const rec of wfp) {
    const spec = toSpecimen(rec) as ConnSpecimen;
    const r = generate({ specimen: spec }, cat);
    assert.equal(spec.beams[0].connection, 'welded_plates', String(rec.id));
    assert.equal(byId(r, 'beam1-bolts'), undefined, String(rec.id));
    assert.deepEqual(spec.notes?.filter((n) => n.includes('WFP')), [], String(rec.id));
    assert.deepEqual(clashes(r.parts), [], String(rec.id));
    assert.deepEqual(floating(r.parts), [], String(rec.id));
  }
  const forces = T.responses.filter((f) => f.slot === undefined || f.slot === 0).map((f) => f.folder);
  const files = new Map(T.responses.map(({ folder }) => [folder, new Set(readdirSync(join(table, folder)))]));
  for (const rec of kbb) {
    const id = String(rec.id);
    const spec = toSpecimen(rec) as ConnSpecimen;
    const r = generate({ specimen: spec }, cat);
    assert.deepEqual(clashes(r.parts), [], id);
    assert.deepEqual(floating(r.parts), [], id);
    assert.ok(spec.notes?.includes(HAUNCH_NOTE), id);
    spec.beams.forEach((b, i) => {
      assert.equal(b.connection, 'welded_haunch', id);
      assert.equal(b.haunch!.straight, id === 'Kim_and_Lee_2017_PN500C-SH', id);
      assert.ok(byId(r, `beam${i + 1}-from-haunch`), `${id}: beam ${i + 1} has no haunch`);
    });
    const c: Record<string, Curve> = {};
    for (const [folder, names] of files) if (names.has(`${id}.csv`)) c[folder] = readResponse(readFileSync(join(table, folder, `${id}.csv`), 'utf8'));
    assert.ok(forces.some((f) => c[f]?.x.length), `${id}: no force file`);
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
      assert.equal(hinges.length, spec.beams.length, id);
      for (const z of hinges) {
        assert.ok(Number.isFinite(z.level), `${id}: level ${z.level} at step ${i}`);
        peak = Math.max(peak, z.level);
      }
    }
    // the zone stays on the beam
    const d = T.shape(r, spec, rec, p.at(0), 1);
    d.zones.filter((z) => z.slot === 0).forEach((z, i) => {
      const m = d.moves[`beam${i + 1}`];
      const end = dot(sub(z.c, m.o), m.u) + z.half[0];
      assert.ok(end < m.knots.at(-1)!.s, `${id}: the zone passes the beam end`);
    });
    t.diagnostic(`${peak.toFixed(2)} ${id}${peak < 0.8 || peak > 1.4 ? '  <- look' : ''}`);
  }
});
