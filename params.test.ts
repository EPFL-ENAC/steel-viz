// node --test
// The look settings of Params (storeys, span, bracing, arm bands, connections,
// detail chances): at their default nothing changes, set they still give
// structures with no clash and no floating part.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from './sections.ts';
import { BEAM_CONN_KINDS, BRACING_KINDS, DEFAULTS, floating, generate, type Params } from './generate.ts';
import { clashes } from './clash.ts';
import { CONNS, type ConnType } from './steel.ts';
import { readTables } from './tables.ts';

const cat = loadCatalog('aisc', ...readTables('aisc'));
const SEEDS = 25;

test('the look settings at their default change nothing', () => {
  const { storeys, spanK, bracing, armL, armZ, conn, trussK, rodP, colSpliceP, connKindsP } = DEFAULTS;
  const set = { storeys, spanK, bracing, armL, armZ, conn, trussK, rodP, colSpliceP, connKindsP };
  for (let seed = 1; seed <= 30; seed++) assert.deepEqual(generate({ seed, ...set }, cat).parts, generate({ seed }, cat).parts, `seed ${seed}`);
});

// the kinds of before the connKindsP stream, and the newer ones
const OLD: ConnType[] = ['shear_tab', 'end_plate', 'flange_plates', 'welded', 'gusset', 'gusset_small', 'gusset_lap', 'clevis'];
const NEW = BEAM_CONN_KINDS.filter((k) => !OLD.includes(k));
const kinds = (r: ReturnType<typeof generate>) => r.parts.flatMap((q) => q.info?.conn ?? []) as ConnType[];

// With connKindsP 0, a seed gives the parts of before the newer kinds (the
// branch was checked against main once, part by part). Here: no new kind,
// and the members stand where the default run has them (a new kind never
// moves a member, it only changes where its lines are cut at the end).
test('more connection kinds at 0 change nothing', () => {
  for (const form of ['tree', 'portal', 'box', 'mix'] as const)
    for (let seed = 1; seed <= 20; seed++) {
      const off = generate({ seed, form, connKindsP: 0 }, cat);
      const on = generate({ seed, form }, cat);
      assert.deepEqual(kinds(off).filter((k) => !OLD.includes(k)), [], `${form} seed ${seed}`);
      const members = (r: typeof on) => r.parts.filter((q) => q.kind === 'member').map((q) => [q.id, q.boxes, q.info?.sec?.id, q.info?.L]);
      assert.deepEqual(members(off), members(on), `${form} seed ${seed}`);
    }
});

test('each newer connection kind shows on some seeds', () => {
  const seen = new Set<ConnType>();
  for (const form of ['tree', 'portal', 'box', 'mix'] as const)
    for (let seed = 1; seed <= 40; seed++) for (const k of kinds(generate({ seed, form, connKindsP: 1 }, cat))) seen.add(k);
  for (const k of NEW) assert.ok(seen.has(k), `${CONNS[k].label} never shows`);
});

const CASES: [string, Partial<Params>][] = [
  ['one storey', { storeys: 1, form: 'portal' }],
  ['two storeys', { storeys: 2, form: 'box' }],
  ['short spans', { spanK: 0.6, form: 'portal' }],
  ['long spans', { spanK: 1.6, form: 'box' }],
  ...BRACING_KINDS.map((b): [string, Partial<Params>] => [`bracing ${b}`, { bracing: b, form: 'portal', storeys: 2 }]),
  ...BEAM_CONN_KINDS.map((c): [string, Partial<Params>] => [`connections ${c}`, { conn: c }]),
  ['short low arms', { armL: [0.2, 0.3], armZ: [0.3, 0.5], form: 'tree' }],
  ['long high arms', { armL: [0.6, 0.9], armZ: [0.8, 1], form: 'tree' }],
  ['no truss, no rod, no splice', { trussK: 0, rodP: 0, colSpliceP: 0 }],
  ['many trusses and rods', { trussK: 2.5, rodP: 1, colSpliceP: 1 }],
  ['all braces, secondaries, posts, splices', { braceP: 1, secondaryP: 1, postP: 1, beamSpliceP: 1 }],
  ...(['tree', 'portal', 'box'] as const).map((form): [string, Partial<Params>] => [`more connection kinds, ${form}`, { connKindsP: 1, form, secondaryP: 1 }]),
];

for (const [name, over] of CASES)
  test(`${name}: no clash, no floating part`, () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = generate({ seed, ...over }, cat);
      assert.deepEqual(clashes(r.parts), [], `seed ${seed}`);
      assert.deepEqual(floating(r.parts), [], `seed ${seed}`);
    }
  });

test('the settings do what they say', () => {
  for (let seed = 1; seed <= 10; seed++) {
    assert.equal(generate({ seed, form: 'portal', storeys: 2 }, cat).st.H, Math.round((DEFAULTS.height * 1.5) / 150) * 150);
    const welded = generate({ seed, conn: 'welded' }, cat).st;
    assert.ok(welded.arms.every((a) => a.conn === 'welded' || a.conn === 'gusset' || a.truss), `seed ${seed}`);
  }
});
