// node --test tools/steel-generator/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { E, solve, type Elem, type FNode } from './solver.ts';
import { iSection, rhsSection } from './sections.ts';

const ipe = iSection('IPE 300', 300, 150, 10.7, 7.1);
const hss = rhsSection('SHS 100', 100, 100, 6);
const near = (a: number, b: number, tol = 0.01) =>
  assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${a} is not within ${tol * 100}% of ${b}`);

test('cantilever tip deflection is PL^3/3EI', () => {
  const P = 10000;
  const L = 3000;
  const nodes: FNode[] = [{ x: [0, 0, 0], fixed: true }, { x: [L, 0, 0], f: [0, 0, -P] }];
  const r = solve(nodes, [{ i: 0, j: 1, p: ipe }]);
  assert.ok(r.ok);
  near(-r.d[6 + 2], (P * L ** 3) / (3 * E * ipe.Is));
  near(r.forces[0].My, P * L);
});

test('simply supported beam midspan moment is qL^2/8', () => {
  const q = 20;
  const L = 6000;
  const nodes: FNode[] = [
    { x: [0, 0, 0], fixed: [true, true, true, true, false, false] },
    { x: [L / 2, 0, 0] },
    { x: [L, 0, 0], fixed: [false, true, true, false, false, false] },
  ];
  const el = (i: number, j: number): Elem => ({ i, j, p: ipe, q: [0, 0, -q] });
  const r = solve(nodes, [el(0, 1), el(1, 2)]);
  assert.ok(r.ok);
  near(Math.max(...r.forces.map((f) => f.My)), (q * L * L) / 8);
  near(-r.d[6 + 2], (5 * q * L ** 4) / (384 * E * ipe.Is));
});

// a column with an arm on a shear tab: nothing holds the arm up
const column: FNode[] = [{ x: [0, 0, 0], fixed: true }, { x: [0, 0, 1500] }, { x: [0, 0, 3000] }];

test('a cantilever on a shear tab is a mechanism at its tip', () => {
  const nodes: FNode[] = [...column, { x: [2500, 0, 3000] }];
  const r = solve(nodes, [
    { i: 0, j: 1, p: ipe },
    { i: 1, j: 2, p: ipe },
    { i: 2, j: 3, p: ipe, pinI: true, q: [0, 0, -5] },
  ]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.node, 3);
});

test('the same cantilever with a pinned brace under it is stable', () => {
  const nodes: FNode[] = [...column, { x: [1500, 0, 3000] }, { x: [2500, 0, 3000] }];
  const r = solve(nodes, [
    { i: 0, j: 1, p: ipe },
    { i: 1, j: 2, p: ipe },
    { i: 2, j: 3, p: ipe, pinI: true, q: [0, 0, -5] },
    { i: 3, j: 4, p: ipe, q: [0, 0, -5] },
    { i: 1, j: 3, p: hss, pinI: true, pinJ: true },
  ]);
  assert.ok(r.ok, JSON.stringify(r.ok ? '' : r));
  // the brace carries the arm: it is in compression, the shear tab has no moment
  assert.ok(r.forces[4].N > 10000);
});
