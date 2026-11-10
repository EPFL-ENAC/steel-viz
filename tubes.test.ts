// node --test
// Local buckling of round tubes (AISC 360-22 F8 and E7), with numbers worked
// by hand. Fy 345 MPa, E 210000 MPa, so the D / t limits are:
//   0.07 E / Fy = 42.6 (F8 compact), 0.11 E / Fy = 67.0 (E7 slender),
//   0.31 E / Fy = 188.7 (F8 slender), 0.45 E / Fy = 273.9 (refused).
// A tube of D and t: A = pi (D² - Di²) / 4, I = pi (D⁴ - Di⁴) / 64,
// S = 2 I / D, Z = (D³ - Di³) / 6, with Di = D - 2 t.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compression, memberRatio, roundMoment, strongMoment, tooThin } from './checks.ts';
import { chsSection, loadCatalog } from './sections.ts';
import { generate } from './generate.ts';
import { readTables } from './tables.ts';

const near = (a: number, b: number, tol = 0.001) =>
  assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${a} is not within ${tol * 100}% of ${b}`);
const fy = 345;
const none = { N: 0, Nc: 0, My: 0, Mz: 0 };

// D 200, t 10: D / t 20, compact. Z = (200³ - 180³) / 6 = 361 333 mm³,
// Mn = Fy Z = 345 x 361 333 = 124.66 kN·m. A = 5969.0 mm², a short member
// takes Fy A = 2059.3 kN.
test('F8 and E7: a compact round tube takes Fy Z and Fy A', () => {
  const s = chsSection('CHS 200x10', 200, 10);
  near(roundMoment(s, fy), 124.66e6);
  near(strongMoment(s, 5000, fy), 124.66e6);
  near(compression(s, 10, fy), 2059.3e3);
});

// D 200, t 4: D / t 50, noncompact in bending (42.6 to 188.7), not slender in
// compression (under 67). S = 118 323 mm³, Z = 153 685 mm³.
// F8-2: Mn = (0.021 x 210000 / 50 + 345) S = (88.2 + 345) x 118 323 = 51.26 kN·m,
// under Fy Z = 53.02 kN·m. A = 2463.0 mm², Fy A = 849.7 kN.
test('F8: a noncompact round tube takes less than Fy Z', () => {
  const s = chsSection('CHS 200x4', 200, 4);
  near(roundMoment(s, fy), 51.26e6);
  assert.ok(roundMoment(s, fy) < fy * s.Ws);
  near(compression(s, 10, fy), 849.7e3);
  // a round tube has no weak axis: Mz takes the same Mn
  near(memberRatio(s, { ...none, Mz: 0.5 * 51.26e6 }, 10, fy), 0.5);
  near(memberRatio(s, { ...none, My: 0.5 * 51.26e6 }, 10, fy), 0.5);
});

// D 300, t 1.25: D / t 240, slender (188.7 to 273.9). S = 87 259 mm³.
// F8-3, F8-4: Fcr = 0.33 x 210000 / 240 = 288.75 MPa, Mn = 288.75 x 87 259 =
// 25.20 kN·m (Fy Z is 38.49 kN·m). E7-7: Ae = (0.038 x 210000 / (345 x 240)
// + 2/3) A = (0.0964 + 0.6667) A = 0.7630 A, A = 1173.2 mm²: a short member
// takes Fy Ae = 345 x 0.7630 x 1173.2 = 308.8 kN, not Fy A = 404.8 kN.
test('F8 and E7: a slender round tube', () => {
  const s = chsSection('CHS 300x1.25', 300, 1.25);
  near(roundMoment(s, fy), 25.2e6);
  near(compression(s, 10, fy), 308.8e3);
  assert.ok(!tooThin(s, fy));
});

// D 300, t 1: D / t 300, past 0.45 E / Fy = 273.9. AISC doesn't cover it.
test('F8: a round tube past D / t = 0.45 E / Fy is refused', () => {
  const s = chsSection('CHS 300x1', 300, 1);
  assert.ok(tooThin(s, fy));
  assert.equal(memberRatio(s, none, 10, fy), Infinity);
  // only round tubes: a thin square tube is not refused here
  assert.ok(!tooThin({ ...s, kind: 'RHS' }, fy));
});

// size() never picks a refused tube. At a small load, the lightest round
// tube that is stiff enough wins. The pipes table gets one more tube, lighter
// than all of it (the lightest is 525 mm²): THIN, past the limit, is never
// picked. CONTROL, the same weight with a wall under the limit, shows that
// such a light tube would be picked. No short brace: it takes D 150 at most.
test('size() never picks a round tube past the D / t limit', () => {
  const [i, hss, c, l, pipes] = readTables('aisc');
  const thin = chsSection('THIN', 290, 0.55); // D / t 527, A = 500 mm²
  const ctl = chsSection('CONTROL', 100, 1.62); // D / t 62, A = 500 mm²
  assert.ok(tooThin(thin, fy) && !tooThin(ctl, fy));
  const cat = (row: string) => loadCatalog('aisc', i, hss, c, l, `${pipes.trimEnd()}\n${row}\n`);
  const withThin = cat('THIN,290,0.55');
  const withCtl = cat('CONTROL,100,1.62');
  assert.equal(withThin.pipes[0].id, 'THIN');
  let control = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const p = { seed, form: 'box', roundP: 1, load: 10, shortBraceP: 0 } as const;
    assert.ok(!generate(p, withThin).parts.some((x) => x.info?.sec?.id === 'THIN'), `seed ${seed}`);
    if (generate(p, withCtl).parts.some((x) => x.info?.sec?.id === 'CONTROL')) control++;
  }
  assert.ok(control > 0, 'no brace took the control tube: the test proves nothing');
});
