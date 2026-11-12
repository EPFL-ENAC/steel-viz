// node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alphaCr, E, sideCase, solve, type Elem, type FNode } from './solver.ts';
import { iSection, rhsSection } from './sections.ts';
import type { V } from './vec.ts';

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

// ---------------------------------------------------------- side cases
// A two storey portal: two columns fixed at the base, 6000 mm high, levels
// at 3000 and 6000, beams 6000 mm pinned at both ends, no self weight.
// q1 = 20 N/mm at level 1, q2 = 10 N/mm at level 2: each column gets
// 60 kN at level 1 and 30 kN at level 2. The side load of generate.ts goes
// on the column nodes, phi times that.
function twoStoreys() {
  const nodes: FNode[] = [];
  for (const x of [0, 6000]) nodes.push({ x: [x, 0, 0], fixed: true }, { x: [x, 0, 3000] }, { x: [x, 0, 6000] });
  const col = (i: number, j: number): Elem => ({ i, j, p: ipe });
  const beam = (i: number, j: number, q: number): Elem => ({ i, j, p: ipe, pinI: true, pinJ: true, q: [0, 0, -q] });
  const elems = [col(0, 1), col(1, 2), col(3, 4), col(4, 5), beam(1, 4, 20), beam(2, 5, 10)];
  const r = solve(nodes, elems);
  assert.ok(r.ok);
  return { nodes, elems, r };
}
const bend = (f: { My: number; Mz: number }) => Math.max(f.My, f.Mz);
const shear = (f: { Vy: number; Vz: number }) => Math.max(f.Vy, f.Vz);

test('side case: no extra force gives the gravity forces', () => {
  const { nodes, elems, r } = twoStoreys();
  assert.deepEqual(sideCase(nodes, elems, r, []), r.forces);
});

for (const [phi, rule] of [[1 / 200, 'EC3, m = 1'], [0.002, 'AISC']] as const)
  test(`side case, phi ${phi} (${rule}): each storey of a column takes the side load above it`, () => {
    const { nodes, elems, r } = twoStoreys();
    // gravity alone: the columns stand straight, no shear, no moment
    for (const k of [0, 1, 2, 3]) assert.ok(bend(r.forces[k]) < 1 && shear(r.forces[k]) < 1e-3, `column element ${k}`);
    for (const sign of [1, -1]) {
      // per column: phi 60 kN at level 1, phi 30 kN at level 2
      const H1 = phi * 60000;
      const H2 = phi * 30000;
      const at = (H: number) => (node: number) => ({ node, f: [sign * H, 0, 0] as V });
      const f = sideCase(nodes, elems, r, [...[1, 4].map(at(H1)), ...[2, 5].map(at(H2))]);
      for (const [bottom, top] of [[0, 1], [2, 3]]) {
        near(shear(f[top]), H2); // 150 N for phi 1/200
        near(shear(f[bottom]), H1 + H2); // 450 N
        near(bend(f[top]), H2 * 3000);
        near(bend(f[bottom]), H2 * 6000 + H1 * 3000); // 1.8 kN·m for phi 1/200
        near(f[bottom].N, 90000); // the weight is still there
      }
    }
  });
