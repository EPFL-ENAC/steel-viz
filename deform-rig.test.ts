// The pin joints in the deformed view (Part.joint): the mount stays with what
// it stands on, and only the tongue turns about its pin. Peak step, auto scale.
// One test of each table runs on the files of specimens/responses/, and all
// the real tests run when the hub data is there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { movePoint, protocol, readResponse, responseFile, type Curve, type DeformState, type Move, type Protocol } from './deform.ts';
import { DEFORMS } from './deforms.ts';
import { generate } from './generate.ts';
import { toSpecimen, type HubRecord } from './hub.ts';
import { loadCatalog, parseCsv } from './sections.ts';
import type { ColumnSpecimen, Specimen } from './specimen.ts';
import type { Part } from './steel.ts';
import { findHubData, HUB_TABLES, readTables } from './tables.ts';
import { dot, len, norm, sub, type V } from './vec.ts';

const cat = loadCatalog('aisc', ...readTables('aisc'));
const FAR = 1e-6; // mm
const LEAVES = /its foot leaves its support/;

// The part a clevis tongue points at. A new clevis must come here.
function nextPart(id: string): string {
  if (id === 'foot-pin') return 'column-foot';
  if (id === 'rig-footA') return 'rig-colA';
  if (id === 'rig-footB') return 'rig-colB';
  if (id === 'rig-pin') return 'column';
  if (id.endsWith('-pin')) return `${id.slice(0, -'-pin'.length)}-plate`;
  throw new Error(`${id}: which part does this clevis hold?`);
}

const at = (p: V, m?: Move) => (m ? movePoint(p, m) : p);
const dist = (a: V, b: V) => len(sub(a, b));

// All that is wrong with the joints of one test, one line per problem.
function problems(parts: Part[], d: DeformState): string[] {
  const out: string[] = [];
  const bad = (id: string, what: string) => out.push(`${id}: ${what}`);
  const leaves = !!d.notes?.some((n) => LEAVES.test(n));
  for (const q of parts) {
    if (!q.joint) continue;
    const { of, pin, end } = q.joint;
    const [own, tongue] = [d.moves[q.id], d.moves[of]];
    const points = [...q.faces.flatMap((f) => f.pts), pin];

    // the mount. The pin end of a brace stands on its seat. At the top, its
    // supports say the plate, because the seat is built after it.
    const seat = of.endsWith('-pin') ? parts.find((p) => p.id === `${of.slice(0, -'-pin'.length)}-seat`) : undefined;
    const under = seat ? [seat] : q.supports.map((s) => parts.find((p) => p.id === s)!);
    const base = under.find((p) => d.moves[p.id]);
    if (!base) {
      // only the far mount of an actuator past its limit, and the note says so
      if (own && !(leaves && q.id.endsWith('-mount-from'))) {
        const far = Math.max(...points.map((p) => dist(at(p, own), p)));
        if (far > FAR) bad(q.id, `on a static part, it moves by ${far.toFixed(3)} mm`);
      }
    } else {
      // over the points of that part: a seat takes the move of the bow, flat where it is
      const far = Math.max(...base.faces.flatMap((f) => f.pts).map((p) => dist(at(p, own), at(p, d.moves[base.id]))));
      if (far > FAR) bad(q.id, `${far.toFixed(3)} mm away from ${base.id}`);
    }

    // the pin goes to the same place with the tongue and with the mount
    if (!tongue) {
      bad(of, 'no move');
      continue;
    }
    const q0 = at(pin, own);
    const gap = dist(at(pin, tongue), q0);
    if (gap > FAR) bad(q.id, `the pin is ${gap.toFixed(3)} mm off its tongue`);

    // the tongue keeps its length
    const e = at(end, tongue);
    const stretch = Math.abs(dist(e, at(pin, tongue)) - dist(end, pin));
    if (stretch > FAR) bad(of, `its tongue gets longer by ${stretch.toFixed(3)} mm`);

    // and it turns like the bar, or points at the next part
    const mates = parts.filter((p) => p.joint?.of === of && p !== q);
    const target = mates.length ? at(mates[0].joint!.pin, d.moves[mates[0].id]) : at(end, d.moves[nextPart(of)]);
    const off = 1 - dot(norm(sub(e, q0)), norm(sub(target, q0)));
    if (off > 1e-9) bad(of, `its tongue is off the bar by ${Math.acos(1 - off).toFixed(4)} rad`);
  }
  return out;
}

// the peak step at the auto scale
function atPeak(table: string, r: { parts: Part[] }, spec: unknown, rec: HubRecord, p: Protocol): DeformState {
  const T = DEFORMS[table];
  const x = p.series[p.driver].x;
  const pk = x.reduce((b, v, i) => (Math.abs(v) > Math.abs(x[b]) ? i : b), 0);
  return T.shape(r as never, spec as never, rec, p.at(pk), T.autoScale(p));
}

// One of each layout. change: what the files don't have, on a test that does.
// has: the joint that this change is there for.
const FIXTURES: [string, string, object?, string?][] = [
  ['connections', 'Chi_and_Uang_2002_DC2'],
  ['connections', 'Ricles_et_al_2004_SPEC-1'],
  ['connections', 'Lee_et_al_2002_CR1'],
  ['braces', 'Shaback_3A'],
  ['braces', 'Takeuchi_Matsui_528'],
  ['braces', 'Wakabayashi_DPC1-1'],
  ['braces', 'Shaback_3A', { ends: 'pin' }, 'brace-from-pin'],
  ['braces', 'Takeuchi_Matsui_528', { ends: 'pin' }, 'brace-from-pin'],
  ['columns', 'Cheng_Chen_Niu_Nethercot_B-H4-0.2-15'],
  ['columns', 'MacRae_C3'],
  ['columns', 'Nakashima_et_al_S105604'],
  ['hss_columns', 'Nakajima_et_al_2009__L-T16-45'],
  ['hss_columns', 'Sugiyama_Igarashi_1986__Igarashi-14'],
  ['hss_columns', 'Tsuda_Matsui_1998__Matsui-943'],
  ['hss_columns', 'Nakajima_et_al_2009__L-T16-45', { axial: true }, 'rig-pin'],
  ['eccentric_braced_frames', 'Malley_and_Popov_1983_24'],
  ['eccentric_braced_frames', 'Roeder_and_Popov_1977_TF1-F1'],
  ['eccentric_braced_frames', 'Stratan_and_Dubina_2003_LL5-m'],
];

const here = (path: string) => new URL(`./specimens/${path}`, import.meta.url);
for (const [table, name, change, has] of FIXTURES)
  test(`${table}/${name}${change ? ' ' + JSON.stringify(change) : ''}: the mounts stay, the tongues turn about their pins`, () => {
    const rec: HubRecord = JSON.parse(readFileSync(here(`${name}.json`), 'utf8'));
    const curves: Record<string, Curve> = {};
    for (const s of DEFORMS[table].responses) {
      const f = here(`responses/${table}/${s.folder}/${responseFile(s, String(rec.id || rec.test_id))}`);
      if (existsSync(f)) curves[s.folder] = readResponse(readFileSync(f, 'utf8'), s.cols);
    }
    const spec = { ...toSpecimen(rec), ...change } as Specimen;
    const r = generate({ specimen: spec }, cat);
    assert.ok(r.parts.some((p) => p.joint?.of === (has ?? p.joint?.of)), `no pin joint ${has ?? ''}`);
    assert.deepEqual(problems(r.parts, atPeak(table, r, spec, rec, protocol(curves))), []);
  });

test('an actuator past its limit: the whole foot leaves its support, and the rail says so', () => {
  const name = 'MacRae_C3';
  const rec: HubRecord = JSON.parse(readFileSync(here(`${name}.json`), 'utf8'));
  const spec = toSpecimen(rec) as ColumnSpecimen;
  const r = generate({ specimen: spec }, cat);
  const folder = DEFORMS.columns.responses[0].folder;
  const push = (x: number) => DEFORMS.columns.shape(r, spec, rec, { [folder]: { x, y: 0, along: Math.abs(x) } }, 1);
  const id = 'rig-actuator-mount-from';
  const small = push(0.001);
  assert.ok(!small.moves[id] && !small.notes?.some((n) => LEAVES.test(n)), 'it stays while it can');
  const big = push(-2);
  assert.ok(big.moves[id] && big.notes?.some((n) => LEAVES.test(n)), 'it leaves');
  assert.deepEqual(problems(r.parts, big), []);
});

const hub = findHubData();

// every real test of these tables that has a response file, in its rig
function* realTests(tables: string[]) {
  for (const table of tables) {
    for (const rec of parseCsv(readFileSync(join(hub!, HUB_TABLES[table]), 'utf8')) as HubRecord[]) {
      let spec;
      try {
        spec = toSpecimen(rec);
      } catch {
        continue; // hub-count.ts lists these
      }
      const curves: Record<string, Curve> = {};
      for (const s of DEFORMS[table].responses) {
        const f = join(hub!, table, s.folder, responseFile(s, String(rec.id || rec.test_id)));
        if (existsSync(f)) curves[s.folder] = readResponse(readFileSync(f, 'utf8'), s.cols);
      }
      if (!Object.keys(curves).length) continue;
      yield { table, rec, spec, r: generate({ specimen: spec }, cat), p: protocol(curves) };
    }
  }
}

test('all the real tests: the mounts stay, the tongues turn about their pins', { skip: hub ? false : 'no hub data' }, () => {
  const wrong: string[] = [];
  let seen = 0;
  for (const { table, rec, spec, r, p } of realTests(Object.keys(DEFORMS))) {
    for (const line of problems(r.parts, atPeak(table, r, spec, rec, p))) wrong.push(`${table}/${spec.id} ${line}`);
    seen++;
  }
  assert.ok(seen > 500, `only ${seen} tests`);
  assert.deepEqual(wrong.slice(0, 60), [], `${wrong.length} problems`);
});

test('at the auto scale, no column test goes past its actuator', { skip: hub ? false : 'no hub data' }, () => {
  const past: string[] = [];
  let seen = 0;
  for (const { table, rec, spec, r, p } of realTests(['columns', 'hss_columns'])) {
    seen++;
    const T = DEFORMS[table];
    const scale = T.autoScale(p);
    // every step: the foot can leave at a step that is not the peak
    for (let i = 0; i < p.n; i++) {
      if (T.shape(r, spec, rec, p.at(i), scale).notes?.some((n) => LEAVES.test(n))) {
        past.push(`${table}/${spec.id} at step ${i}`);
        break;
      }
    }
  }
  assert.ok(seen > 300, `only ${seen} tests`);
  assert.deepEqual(past, []);
});
