// The deformed shape of the EBF link tests: the two traps of their files, how
// each rig moves, the capacity, and the levels of all the real tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { biggest, movePoint, protocol, readResponse, responseFile, type DeformState, type Samples } from './deform.ts';
import { LINK_DEFORM as T, linkCapacity } from './deform-links.ts';
import { DEFORMS } from './deforms.ts';
import { generate, type Result } from './generate.ts';
import { hingeSize } from './rig.ts';
import { toSpecimen, type HubRecord } from './hub.ts';
import { loadCatalog, parseCsv } from './sections.ts';
import type { LinkSpecimen } from './specimen.ts';
import { HUB_TABLES, findHubData, readTables } from './tables.ts';
import type { V } from './vec.ts';

const cat = loadCatalog('aisc', ...readTables('aisc'));
const spec0 = T.responses[0];
const record = (name: string): HubRecord => JSON.parse(readFileSync(new URL(`./specimens/${name}.json`, import.meta.url), 'utf8'));
const TF1 = 'Malley_and_Popov_1983_24';
const TF2 = 'Stratan_and_Dubina_2003_LL5-m';
const TF4 = 'Roeder_and_Popov_1977_TF1-F1';
const TF4_PLATES = 'Volynkin_and_Clifton_2016_AL-4C';

const step = (g: number, V = 100): Samples => ({ processed_data: { x: g, y: V, along: g } });
function play(name: string, g: number, scale = 1) {
  const rec = record(name);
  const spec = toSpecimen(rec) as LinkSpecimen;
  const r = generate({ specimen: spec }, cat);
  return { r, rec, spec, d: T.shape(r, spec, rec, step(g), scale), link: r.st.link!, rig: r.st.linkRig! };
}
const near = (a: V, b: V, msg: string, tol = 1e-6) => assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < tol, `${msg}: ${a} is not ${b}`);
const at = (d: DeformState, id: string, p: V) => {
  assert.ok(d.moves[id], `no move for ${id}`);
  return movePoint(p, d.moves[id]);
};
const first = (r: Result, ...ids: string[]) => ids.find((id) => r.parts.some((p) => p.id === id))!;

// ---- the two traps of the files
test('the file of a row is id<N>.csv, the other tables stay <id>.csv', () => {
  assert.equal(responseFile(spec0, '74'), 'id74.csv');
  assert.equal(responseFile(DEFORMS.connections.responses[0], '74'), '74.csv');
});

test('readResponse takes the named columns, and throws on a missing one', () => {
  const csv = '﻿"data_ind","gamma_t","V",\r\n0,0.01,5,\r\n1,NA,6,\r\n2,2E-2,-7,\r\n';
  assert.deepEqual(readResponse(csv, ['gamma_t', 'V']), { x: [0.01, 0.02], y: [5, -7] });
  assert.deepEqual(readResponse(csv), { x: [0, 2], y: [0.01, 0.02] }); // no cols: the first two, as before
  assert.throws(() => readResponse(csv, ['gamma_t', 'M']), /no column/);
});

// ---- how each rig moves
test('TF1: end A stays, end B and the loading beam go up by gamma e with no turn', () => {
  const g = 0.05;
  const { d, link, rig, r } = play(TF1, g);
  const { e } = link;
  const { y0, zl } = rig;
  assert.equal(link.config, 'TF1');
  const lift: V = [0, 0, g * e];
  near(at(d, 'link', [0, y0, zl + 100]), [0, y0, zl + 100], 'link end A');
  near(at(d, 'link', [0, y0 + e, zl + 100]), [0, y0 + e, zl + 100 + g * e], 'link end B');
  for (const p of [[0, y0 + e, zl], [50, y0 + e + 300, zl + 900]] as V[]) near(at(d, 'rig-load', p), [p[0] + lift[0], p[1] + lift[1], p[2] + lift[2]], 'loading beam');
  near(at(d, 'link-endB', [0, y0 + e, zl - 100]), at(d, 'link', [0, y0 + e, zl - 100]), 'end plate on the link');
  assert.equal(d.moves['link-endA'], undefined, 'end A stands on the block');
  assert.ok(r.parts.some((p) => p.id === 'rig-block') && !d.moves['rig-block']);
  // the actuator: the head stays on its pin at the crosshead, the foot follows the beam
  const a = d.moves['rig-actuator'];
  near(movePoint(a.o, a), a.o, 'actuator top pin');
  const { from, to, D } = rig.actuator;
  const pin: V = [to[0], to[1], to[2] + hingeSize(D).pin * Math.sign(from[2] - to[2])];
  near(movePoint(pin, a), at(d, 'rig-load', pin), 'actuator foot pin');
});

test('the link shears: r differs from t, and sections stay parallel to the end faces', () => {
  const g = 0.05;
  const { d, link, rig } = play(TF1, g);
  const { e } = link;
  const { y0, zl } = rig;
  const k = d.moves.link.knots;
  assert.ok(k.every((x) => x.r === 0 && x.t === g));
  const [lo, hi] = [at(d, 'link', [0, y0 + e / 2, zl - 100]), at(d, 'link', [0, y0 + e / 2, zl + 100])];
  near([lo[0], lo[1], hi[2] - 200], [hi[0], hi[1], lo[2]], 'a section stays upright');
  near(at(d, 'link', [0, y0 + e / 2, zl]), [0, y0 + e / 2, zl + (g * e) / 2], 'half way');
});

for (const [name, config] of [[TF2, 'TF2'], [TF4, 'TF4'], [TF4_PLATES, 'TF4']] as const)
  for (const scale of [1, 20])
    test(`${name} at scale ${scale}: the frame turns by gamma e / span, and nothing comes apart`, () => {
      const g = 0.02;
      const { d, link, rig, r } = play(name, g, scale);
      assert.equal(link.config, config);
      const { e, span } = link;
      const { y0, zl, frame, actuator } = rig;
      assert.ok(frame && span);
      const [fA, fB] = frame.feet;
      assert.equal(fB[1] - fA[1], span, 'foot to foot is the drawn span');
      const theta = (g * scale * e) / span;

      // the columns turn about their feet, by theta
      for (const [id, f] of [['rig-colA', fA], ['rig-colB', fB]] as const) {
        near(at(d, id, f), f, `${id} on its pin`);
        const top: V = [0, f[1], f[2] + 1000];
        near(at(d, id, top), [0, f[1] + 1000 * theta, f[2] + 1000], `${id} turns by theta`);
      }
      // one link end moves gamma e from the other
      const [a, b] = [at(d, 'link', [0, y0, zl]), at(d, 'link', [0, y0 + e, zl])];
      const beam = theta * (y0 + e - y0); // the rigid turn of side A over e
      near([0, 0, b[2] - a[2] + beam], [0, 0, g * scale * e], 'gamma e between the link ends');
      // the ends are glued to their sides, on all the height of the section
      const sideA = first(r, 'rig-beamA', 'rig-colA');
      for (const z of [-100, 0, 100]) {
        near(at(d, 'link', [0, y0, zl + z]), at(d, sideA, [0, y0, zl + z]), `end A at ${z}`);
        near(at(d, 'link', [0, y0 + e, zl + z]), at(d, 'rig-beamB', [0, y0 + e, zl + z]), `end B at ${z}`);
      }
      // beamB and colB are one rigid side
      near(at(d, 'rig-beamB', [0, fB[1], zl]), at(d, 'rig-colB', [0, fB[1], zl]), 'beam on colB');
      // the struts: the fixed end stays, the other follows its side
      for (const s of frame.braces) {
        near(at(d, s.id, s.from), s.from, `${s.id} foot`);
        near(at(d, s.id, s.to), at(d, s.side ? 'rig-colB' : 'rig-colA', s.to), `${s.id} top`, 1e-3);
      }
      const m = d.moves['rig-actuator'];
      near(movePoint(m.o, m), m.o, 'actuator on the wall');
      const end = actuator.to;
      const col = frame.side ? 'rig-colB' : 'rig-colA';
      const lever = at(d, col, end);
      assert.ok(Math.abs(lever[1] - end[1] - (zl - fA[2]) * theta) < 1e-6, 'the column moves the actuator end');
      // the mount of the foot stays, the tongue turns
      assert.ok(!d.moves['rig-footA-mount'] && !d.moves['rig-footB-mount']);
    });

test('the middle link and the edge link follow the same rule', () => {
  const [mid, edge] = [play(TF2, 0.02), play(TF4, 0.02)];
  assert.equal(mid.link.at, 'middle');
  assert.equal(edge.link.at, 'edge');
  for (const { d, link, rig } of [mid, edge]) {
    const [fA, fB] = rig.frame!.feet;
    const top = (id: string, f: V) => at(d, id, [0, f[1], f[2] + 1000])[1] - f[1];
    const theta = (0.02 * link.e) / link.span!;
    assert.ok(Math.abs(top('rig-colA', fA) - 1000 * theta) < 1e-9);
    assert.ok(Math.abs(top('rig-colB', fB) - 1000 * theta) < 1e-9);
  }
});

test('the stiffeners take the move of the link, by follow()', () => {
  for (const name of [TF1, TF2, TF4]) {
    const { d, r } = play(name, 0.03);
    const st = r.parts.filter((p) => p.info?.type === 'Stiffener');
    assert.ok(st.length >= 2, name);
    for (const p of st) assert.equal(d.moves[p.id], d.moves.link, `${name} ${p.id}`);
  }
});

// ---- the capacity
const rec = (over: HubRecord): HubRecord => ({ profile: 'W18x40', aw_m: 3000, f_y_m_web: 300, zp_m: 1e6, f_y_m_flg: 250, ...over });
test('linkCapacity: e picks Vp or 2 Mp / e', () => {
  const short = linkCapacity(rec({}), 500)!;
  assert.equal(short.V, 540); // 0.6 x 300 x 3000
  assert.equal(short.ratio, '|V| / Vp');
  const long = linkCapacity(rec({}), 2000)!;
  assert.equal(long.V, 250); // 2 x 1e6 x 250 / 2000
  assert.equal(long.Vp, 540);
  assert.equal(long.ratio, '|V| / (2 Mp / e)');
});
test('linkCapacity: measured first, else nominal, and nothing with no web', () => {
  const nominal = { profile: 'W18x40', aw_n: 3000, f_y_n_web: 300, zp_n: 1e6, f_y_n_flg: 250 };
  assert.equal(linkCapacity(nominal, 500)!.V, 540);
  assert.equal(linkCapacity({ ...nominal, aw_m: 'NA', f_y_m_web: 'NR' }, 500)!.V, 540);
  assert.equal(linkCapacity(rec({ aw_m: 'NA' }), 500), undefined);
  assert.equal(linkCapacity(rec({ zp_m: 'NA' }), 2000)!.V, 540); // no Zp: Vp
});
test('linkCapacity: a link from channels counts two, with flange plates it takes Vp', () => {
  const two = linkCapacity(rec({ profile: 'C 320x85x5x12' }), 500)!;
  assert.equal(two.V, 1080);
  assert.equal(linkCapacity(rec({ profile: 'C 320x85x5x12' }), 2000)!.V, 500);
  assert.equal(linkCapacity(rec({ profile: 'C 305x75x7x13', tf_add_n: 12 }), 2000)!.V, 1080);
});

test('the zone sits on the web and follows |V|', () => {
  const { d, r, rec: row, spec, link, rig } = play(TF2, 0.02);
  const cap = linkCapacity(row, link.e)!;
  assert.equal(d.zones.length, 1);
  const z = d.zones[0];
  assert.equal(z.slot, spec0.slot);
  assert.equal(z.label, 'Link web');
  near(z.c, [0, rig.y0 + link.e / 2, rig.zl], 'zone centre');
  assert.ok(Math.abs(z.half[2] - (r.st.col.d / 2 - r.st.col.tf - 1)) < 1e-9, 'between the flanges, 1 mm off them');
  assert.ok(Math.abs(z.level - 100 / cap.V) < 1e-12);
  assert.equal(T.shape(r, spec, row, step(0.02, -250), 1).zones[0].level, 250 / cap.V);
});

// ---- the examples
const examples: [string, number][] = [[TF1, 51], [TF2, 87], [TF4, 65]];
for (const [name, id] of examples)
  test(`${name} plays its protocol`, () => {
    const csv = readFileSync(new URL(`./specimens/responses/eccentric_braced_frames/processed_data/id${id}.csv`, import.meta.url), 'utf8');
    const c = readResponse(csv, spec0.cols);
    assert.ok(c.x.length > 50 && biggest(c.x) < 1, `${id}: x is gamma_t`);
    assert.ok(biggest(c.y) > 10, `${id}: y is V`);
    const row = record(name);
    assert.equal(row.id, id);
    const spec = toSpecimen(row) as LinkSpecimen;
    const r = generate({ specimen: spec }, cat);
    const p = protocol({ processed_data: c });
    const scale = T.autoScale(p);
    for (let i = 0; i < p.n; i += 10) {
      const d = T.shape(r, spec, row, p.at(i), scale);
      for (const q of r.parts) assert.ok(q.faces.every((f) => f.pts.every((v) => !d.moves[q.id] || movePoint(v, d.moves[q.id]).every(Number.isFinite))), `${q.id} at ${i}`);
      assert.ok(Number.isFinite(d.zones[0].level));
    }
  });

// ---- with the hub data
const median = (x: number[]) => [...x].sort((a, b) => a - b)[x.length >> 1];
const dir = findHubData();
test('hub EBF links: every test gives finite moves and levels, the medians are right', { skip: dir ? false : 'no resslab-hub-data folder next to the repo' }, (t) => {
  const table = join(dir!, 'eccentric_braced_frames');
  const rows = parseCsv(readFileSync(join(dir!, HUB_TABLES.eccentric_braced_frames), 'utf8'));
  const names = new Set(readdirSync(join(table, spec0.folder)));
  const peaks: number[] = [];
  const vsHub: number[] = [];
  const odd: string[] = [];
  for (const row of rows) {
    const id = String(row.id);
    const file = responseFile(spec0, id);
    if (!names.has(file)) continue;
    const c = readResponse(readFileSync(join(table, spec0.folder, file), 'utf8'), spec0.cols);
    assert.ok(c.x.length, `${id}: no rows`);
    const spec = toSpecimen(row) as LinkSpecimen;
    const r = generate({ specimen: spec }, cat);
    const p = protocol({ processed_data: c });
    const scale = T.autoScale(p);
    assert.ok([1, 2, 5, 10, 20].includes(scale), `${id}: scale ${scale}`);
    for (const k of [0, 0.5, 1]) {
      const d = T.shape(r, spec, row, p.at(Math.round(k * (p.n - 1))), scale);
      for (const [name, m] of Object.entries(d.moves)) {
        assert.ok(m.knots.length <= 8, `${id} ${name}: knots`);
        assert.ok(movePoint(m.o, m).every(Number.isFinite), `${id} ${name}: not finite`);
      }
      assert.equal(d.zones.length, 1, `${id}: zone`);
      assert.ok(Number.isFinite(d.zones[0].level), `${id}: level`);
    }
    const level = biggest(c.y) / linkCapacity(row, spec.e)!.V;
    assert.ok(Number.isFinite(level) && level > 0, `${id}: peak level ${level}`);
    peaks.push(level);
    const ov = Number(row.ov_aisc);
    if (ov > 0) vsHub.push(level / ov);
    if (level > 2.5 || level < 0.9 || (ov > 0 && Math.abs(level / ov - 1) > 0.2)) odd.push(`${id} ${row.investigator} ${row.spec_id}: ${level.toFixed(2)} (ov_aisc ${row.ov_aisc})`);
  }
  t.diagnostic(`${peaks.length} tests, median peak level ${median(peaks).toFixed(3)}, median level / ov_aisc ${median(vsHub).toFixed(3)} on ${vsHub.length}`);
  for (const line of odd) t.diagnostic(line);
  assert.equal(peaks.length, 236);
  // the peak has strain hardening in it: it reads level / ov_aisc near 1, not level
  assert.ok(median(vsHub) > 0.95 && median(vsHub) < 1.05, `median level / ov_aisc ${median(vsHub)}`);
  assert.ok(median(peaks) > 1.3 && median(peaks) < 1.6, `median peak level ${median(peaks)}`);
});
