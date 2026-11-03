// node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alphaCr, E, solve, type Elem, type FNode } from './solver.ts';
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

// ---------------------------------------------------------- buckling
// Euler loads (Timoshenko and Gere, Theory of Elastic Stability, ch. 2):
// pinned at both ends Pcr = pi^2 EI / L^2, fixed base and free top
// Pcr = pi^2 EI / (4 L^2). I is the weak inertia, the column buckles that way.

const PIN: boolean[] = [true, true, true, false, false, true]; // translations and torsion (rz on a vertical member) held
const SLIDE: boolean[] = [true, true, false, false, false, false]; // the top moves along the column only

// a vertical column of n elements, load P down at the top
function upright(n: number, H: number, P: number, base: FNode['fixed'], top: FNode['fixed']) {
  const nodes: FNode[] = Array.from({ length: n + 1 }, (_, k) => ({ x: [0, 0, (H * k) / n] }));
  nodes[0].fixed = base;
  nodes[n].fixed = top;
  nodes[n].f = [0, 0, -P];
  const elems: Elem[] = Array.from({ length: n }, (_, k) => ({ i: k, j: k + 1, p: ipe }));
  return { nodes, elems };
}

function alpha(nodes: FNode[], elems: Elem[]) {
  const r = solve(nodes, elems);
  assert.ok(r.ok);
  return alphaCr(nodes, elems, r);
}

for (const n of [2, 4])
  test(`a pinned column of ${n} elements buckles at pi^2 EI / L^2`, () => {
    const H = 4000;
    const P = 1e5;
    const { nodes, elems } = upright(n, H, P, PIN, SLIDE);
    near(alpha(nodes, elems) * P, (Math.PI ** 2 * E * ipe.Iw) / H ** 2);
  });

for (const n of [1, 3])
  test(`a cantilever column of ${n} element${n > 1 ? 's' : ''} buckles at pi^2 EI / 4L^2`, () => {
    const H = 3000;
    const P = 1e5;
    const { nodes, elems } = upright(n, H, P, true, false);
    near(alpha(nodes, elems) * P, (Math.PI ** 2 * E * ipe.Iw) / (4 * H ** 2));
  });

test('a hanger in strong tension does not hide the column', () => {
  // the hanger would "buckle" first if its tension was a compression
  const H = 3000;
  const P = 1e5;
  const { nodes, elems } = upright(3, H, P, true, false);
  const top = nodes.push({ x: [2000, 0, H], fixed: true }) - 1;
  const end = nodes.push({ x: [2000, 0, 0], f: [0, 0, -20 * P] }) - 1;
  elems.push({ i: top, j: end, p: hss });
  near(alpha(nodes, elems) * P, (Math.PI ** 2 * E * ipe.Iw) / (4 * H ** 2));
});

test('nothing in compression: no buckling', () => {
  const nodes: FNode[] = [{ x: [0, 0, 3000], fixed: true }, { x: [0, 0, 0], f: [0, 0, -1e5] }];
  assert.equal(alpha(nodes, [{ i: 0, j: 1, p: hss }]), Infinity);
});
