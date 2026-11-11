// node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compression, ltb, memberRatio, strongMoment } from './checks.ts';
import { E } from './solver.ts';
import { iSection, loadCatalog } from './sections.ts';
import { readTables } from './tables.ts';

const near = (a: number, b: number, tol = 0.001) =>
  assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${a} is not within ${tol * 100}% of ${b}`);
const fy = 345;
const ipe = iSection('IPE 300', 300, 150, 10.7, 7.1);
const aisc = loadCatalog('aisc', ...readTables('aisc'));
const W = (id: string) => aisc.all.find((s) => s.id === id)!;

// a round tube of the table: E3 with r = sqrt(I / A), and Fy Z (F8, no LTB)
test('E3 and F8 on a round tube', () => {
  const s = aisc.pipes.find((x) => x.id === 'Pipe4STD')!;
  const r = Math.sqrt(s.Is / s.A);
  const L = 3000;
  const Fe = (Math.PI ** 2 * E) / (L / r) ** 2;
  near(compression(s, L, fy), 0.658 ** (fy / Fe) * fy * s.A);
  near(strongMoment(s, 10000, fy), fy * s.Ws);
});

test('E3: a very short member reaches Fy A', () => {
  near(compression(ipe, 10, fy), fy * ipe.A);
});

test('E3: the two Fcr formulas meet at Fy / Fe = 2.25', () => {
  const r = Math.sqrt(ipe.Iw / ipe.A);
  // Fe = pi^2 E / (L/r)^2 = Fy / 2.25
  const L = r * Math.sqrt((2.25 * Math.PI ** 2 * E) / fy);
  near(compression(ipe, L * (1 - 1e-9), fy), compression(ipe, L * (1 + 1e-9), fy), 0.002);
  // past it, the elastic formula: 0.877 Fe A
  const L2 = 2 * L;
  near(compression(ipe, L2, fy), 0.877 * ((Math.PI ** 2 * E) / (L2 / r) ** 2) * ipe.A);
});

test('F2: Mp up to Lp, 0.7 Fy Sx at Lr from both sides', () => {
  const { Lp, Lr, Sx, Fcr } = ltb(ipe, fy);
  near(strongMoment(ipe, Lp, fy), fy * ipe.Ws);
  near(strongMoment(ipe, Lr, fy), 0.7 * fy * Sx);
  // the elastic formula gives the same at Lr: this checks the Lr formula
  // (0.5 %: the code constants 1.95, 6.76 and 0.078 are rounded)
  near(Fcr(Lr) * Sx, 0.7 * fy * Sx, 0.005);
  assert.ok(strongMoment(ipe, 2 * Lr, fy) < 0.7 * fy * Sx);
});

// AISC Steel Construction Manual, 15th ed., Table 3-2 (Fy = 50 ksi). Ours is
// about 3 % higher: E = 210000 MPa here (200000 in AISC), and the table
// sections have fillets, ours don't.
for (const [id, LpFt, LrFt] of [['W14X22', 3.67, 10.4], ['W12X79', 10.8, 39.9]] as const)
  test(`F2: Lp and Lr of ${id} match the AISC table`, () => {
    const { Lp, Lr } = ltb(W(id), fy);
    near(Lp, LpFt * 304.8, 0.05);
    near(Lr, LrFt * 304.8, 0.05);
  });

test('H1-1: both branches, and tension uses Fy A', () => {
  const Py = fy * ipe.A;
  const Mp = fy * ipe.Ws;
  // short member, no buckling: Pn = Py, Mn = Mp
  near(memberRatio(ipe, { N: 0.1 * Py, Nc: 0.1 * Py, My: 0.5 * Mp, Mz: 0, Vy: 0, Vz: 0 }, 10, fy), 0.05 + 0.5);
  near(memberRatio(ipe, { N: 0.4 * Py, Nc: 0.4 * Py, My: 0.45 * Mp, Mz: 0, Vy: 0, Vz: 0 }, 10, fy), 0.4 + (8 / 9) * 0.45);
  // a long member in tension does not buckle
  near(memberRatio(ipe, { N: 0.5 * Py, Nc: 0, My: 0, Mz: 0, Vy: 0, Vz: 0 }, 6000, fy), 0.5);
  assert.ok(memberRatio(ipe, { N: 0.5 * Py, Nc: 0.5 * Py, My: 0, Mz: 0, Vy: 0, Vz: 0 }, 6000, fy) > 1);
});
