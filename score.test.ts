// node --test score.test.ts
// The variety: it counts what the structure has, and the drawing shows it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, X_KINDS, X_LABEL, type Params } from './generate.ts';
import { cat } from './params-check.ts';
import { better, mixScore, variety, VARIETY_FULL, VARIETY_KINDS } from './score.ts';
import { BEAM_CONN_KINDS, CONNS } from './steel.ts';

const seeds = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const kindsOf = (seed: number, over: Partial<Params> = {}) => variety(generate({ seed, ...over }, cat, 'members').st).kinds;

test('the list has no kind twice', () => {
  assert.equal(new Set(VARIETY_KINDS).size, VARIETY_KINDS.length);
});

test('each kind of a default seed is in the list, once, and the parts show it', () => {
  // `plates` has the base gussets and the splice plates
  const types = (parts: ReturnType<typeof generate>['parts']) => parts.map((q) => q.info?.type ?? '');
  for (const seed of seeds(30)) {
    const r = generate({ seed }, cat, 'plates');
    const { variety: n, kinds } = variety(r.st);
    assert.equal(n, kinds.length, `seed ${seed}`);
    assert.equal(new Set(kinds).size, n, `seed ${seed}`);
    for (const k of kinds) assert.ok(VARIETY_KINDS.includes(k), `seed ${seed}: ${k}`);
    const t = types(r.parts);
    const shows = (kind: string, s: string) => assert.equal(kinds.includes(kind), t.some((x) => x.startsWith(s)), `seed ${seed}: ${kind}`);
    shows('foot gussets', 'Base gussets');
    shows('beam splice', 'Beam splice');
    shows('post', 'Post');
    shows('tension rod', 'Tension rod');
    shows('truss', 'Truss bottom chord');
    shows('column splice, bearing', 'Column splice, bearing');
    shows('column splice, flange plates', 'Column splice, flange');
    const conns = r.parts.flatMap((q) => q.info?.conn ?? []);
    for (const c of BEAM_CONN_KINDS) assert.equal(kinds.includes(CONNS[c].label), conns.includes(c), `seed ${seed}: ${c}`);
  }
});

const asked: [string, Partial<Params>, number?][] = [
  ['gable roof', { gableP: 1, form: 'portal', storeys: 1 }],
  ['skewed arm', { skewP: 1, form: 'tree' }],
  ...X_KINDS.map((k): [string, Partial<Params>] => [`X brace, ${X_LABEL[k]}`, { bracing: 'x', xKind: k, form: 'box', storeys: 2 }]),
  // not a tree: at the default height no arm of a tree gets a brace
  ['round tube brace', { roundP: 1, braceP: 1, form: 'box' }],
  // rare: most tubes are smaller than CAP_MIN_D and keep the slot. The first one is seed 35.
  ['round tube brace, end caps', { roundP: 1, braceP: 1, form: 'box' }, 48],
];
for (const [kind, over, n = 12] of asked)
  test(`${kind}: a structure that has it counts it`, () => {
    assert.ok(seeds(n).some((seed) => kindsOf(seed, over).includes(kind)));
  });

test('with no detail at all, the variety is lower', () => {
  const none: Partial<Params> = {
    braceP: 0, secondaryP: 0, postP: 0, beamSpliceP: 0, connKindsP: 0, shapeP: 0, skewP: 0, gableP: 0, roundP: 0, xP: 0, trussK: 0, rodP: 0, colSpliceP: 0,
  };
  const mean = (over: Partial<Params>) => seeds(20).reduce((s, seed) => s + kindsOf(seed, over).length, 0) / 20;
  assert.ok(mean(none) < mean({}));
});

test('the sort: most kinds first, the same variety goes to the better logo', () => {
  const scan = (score: number, v: number) => ({ score, fill: 0, aspect: 0, balance: 0, members: 0, crossings: 0, variety: v, kinds: [] });
  const [a, b, c] = [scan(0.5, 10), scan(0.9, 8), scan(0.7, 10)];
  assert.deepEqual([a, b, c].sort(better('variety')), [c, a, b]);
  assert.deepEqual([a, b, c].sort(better('logo')), [b, c, a]);
  assert.deepEqual([a, b, c].sort(better('mix')), [b, c, a].sort((x, y) => mixScore(y.score, y.variety) - mixScore(x.score, x.variety)));
});

test('the mix stops at a full variety', () => {
  assert.equal(mixScore(1, VARIETY_FULL), 1);
  assert.equal(mixScore(1, VARIETY_FULL + 5), 1);
  assert.equal(mixScore(0, 0), 0);
});
