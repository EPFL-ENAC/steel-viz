// node --test
// The shear check (AISC 360-22 chapter G), with numbers worked by hand.
// Fy 345 MPa, E 210000 MPa, sqrt(E / Fy) = 24.67. The limits of Cv1 and Cv2:
//   kv 5.34 (a web, G2.1): 1.10 sqrt(kv E / Fy) = 62.71
//   kv 1.2 (a stem, a leg, a flange, G3 and G6): 1.10 x 27.03 = 29.73, 1.37 x 27.03 = 37.03
//   kv 5 (a square tube wall, G4): 1.10 x 55.17 = 60.69
// `strong` is the shear along the depth (w, with My), `weak` across (v, with Mz).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cv1, cv2, memberRatio, shear } from './checks.ts';
import { channelSection, chsSection, doubleAngle, iSection, loadCatalog, rhsSection, rodSection, teeSection } from './sections.ts';
import { generate } from './generate.ts';
import { readTables } from './tables.ts';

const near = (a: number, b: number, tol = 0.001) =>
  assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${a} is not within ${tol * 100}% of ${b}`);
const fy = 345;
const none = { N: 0, Nc: 0, My: 0, Mz: 0, Vy: 0, Vz: 0 };

// G2-3, G2-4: Cv1 = 1 up to 62.71, then 62.71 / (h / tw): 62.71 / 122.5 = 0.5119
test('G2.1: Cv1 of a web', () => {
  near(cv1(40, 5.34, fy), 1);
  near(cv1(122.5, 5.34, fy), 0.5119);
});

// G2-9 to G2-11, kv 1.2: 1 up to 29.73, then 29.73 / 33 = 0.9009, past 37.03
// 1.51 x 1.2 x 210000 / (50² x 345) = 380 520 / 862 500 = 0.4412
test('G2.2: the three cases of Cv2', () => {
  near(cv2(20, 1.2, fy), 1);
  near(cv2(33, 1.2, fy), 0.9009);
  near(cv2(50, 1.2, fy), 0.4412);
});

// I 300 x 150 x 10 x 7: h / tw = 280 / 7 = 40, Cv1 = 1.
// strong: 0.6 x 345 x 300 x 7 = 434.7 kN. weak (G6): two flanges,
// b / t = 75 / 10 = 7.5, Cv2 = 1: 2 x 0.6 x 345 x 150 x 10 = 621.0 kN.
// A thin web, I 1000 x 200 x 10 x 8: h / tw = 980 / 8 = 122.5, Cv1 = 0.5119,
// 0.6 x 345 x 1000 x 8 x 0.5119 = 847.8 kN.
test('G2.1 and G6: an I section', () => {
  const v = shear(iSection('I', 300, 150, 10, 7), 3000, fy);
  near(v.strong, 434.7e3);
  near(v.weak, 621.0e3);
  near(shear(iSection('I', 1000, 200, 10, 8), 3000, fy).strong, 847.8e3);
});

// C 250 x 80, tf 12, tw 8: h / tw = 226 / 8 = 28.3, Cv1 = 1:
// 0.6 x 345 x 250 x 8 = 414.0 kN. weak (G6, b = bf for a channel):
// 80 / 12 = 6.7, 2 x 0.6 x 345 x 80 x 12 = 397.4 kN.
test('G2.1 and G6: a channel', () => {
  const v = shear(channelSection('C', 250, 80, 12, 8), 3000, fy);
  near(v.strong, 414.0e3);
  near(v.weak, 397.44e3);
});

// T 150 deep, flange 150 x 10, stem 7. G3, the stem: b / t = 150 / 7 = 21.4,
// Cv2 = 1: 0.6 x 345 x 150 x 7 = 217.4 kN. G6, the flange: 75 / 10 = 7.5,
// 0.6 x 345 x 150 x 10 = 310.5 kN. A deep stem, 300 / 7 = 42.9: Cv2 =
// 380 520 / (42.86² x 345) = 0.6005, 0.6 x 345 x 300 x 7 x 0.6005 = 261.0 kN.
test('G3 and G6: a tee', () => {
  const v = shear(teeSection('T', 150, 150, 10, 7), 3000, fy);
  near(v.strong, 217.35e3);
  near(v.weak, 310.5e3);
  near(shear(teeSection('T', 300, 150, 10, 7), 3000, fy).strong, 261.04e3);
});

// 2L 100 x 100 x 10: four legs of b / t = 10, Cv2 = 1. Along each axis two
// legs: 2 x 0.6 x 345 x 100 x 10 = 414.0 kN.
test('G3: a double angle', () => {
  const v = shear(doubleAngle('L100x100x10', 100, 10), 3000, fy);
  near(v.strong, 414.0e3);
  near(v.weak, 414.0e3);
});

// square tube 200 x 8: h = 200 - 3 x 8 = 176, h / t = 22, Cv2 = 1.
// Aw = 2 x 176 x 8 = 2816, 0.6 x 345 x 2816 = 582.9 kN, both ways.
test('G4: a square tube', () => {
  const v = shear(rhsSection('RHS', 200, 200, 8), 3000, fy);
  near(v.strong, 582.9e3);
  near(v.weak, 582.9e3);
});

// G5. D 200, t 10, L 3000: G5-2a 336 000 / (sqrt(15) x 20^1.25) = 2051, G5-2b
// 163 800 / 20^1.5 = 1831, so 0.6 Fy = 207 governs: 207 x 5969.0 / 2 = 617.8 kN.
// D 500, t 2, L 10000 (D / t 250): G5-2a 336 000 / (sqrt(20) x 994.0) = 75.58,
// G5-2b 163 800 / 3953 = 41.4: Fcr = 75.58, A = pi (500² - 496²) / 4 = 3129.0,
// 75.58 x 3129.0 / 2 = 118.2 kN.
test('G5: a round tube', () => {
  near(shear(chsSection('CHS', 200, 10), 3000, fy).strong, 617.8e3);
  near(shear(chsSection('CHS', 500, 2), 10000, fy).weak, 118.24e3);
});

// a rod of 30: A = 706.9, 0.6 x 345 x 0.75 x 706.9 = 109.7 kN
test('a solid rod: 0.6 Fy on 3/4 of the area', () => {
  near(shear(rodSection('ROD', 30), 3000, fy).strong, 109.74e3);
});

// memberRatio takes the shear ratio when it is the largest one
test('memberRatio: the shear along both axes', () => {
  const s = iSection('I', 300, 150, 10, 7);
  near(memberRatio(s, { ...none, Vz: 0.5 * 434.7e3 }, 3000, fy), 0.5);
  near(memberRatio(s, { ...none, Vy: 0.7 * 621.0e3 }, 3000, fy), 0.7);
});

// size() reads it: aisc seed 63, arm6 takes 216 kN of shear. W10X26 has Vn =
// 358 kN (ratio 0.60, at the limit), so it gets a W16X26: the same weight,
// a deeper web (524 kN).
test('size(): a short heavy beam gets a deeper web', () => {
  const cat = loadCatalog('aisc', ...readTables('aisc'));
  const r = generate({ seed: 63, fy }, cat, 'members');
  assert.equal(r.st.arms.find((a) => a.id === 'arm6')?.sec.id, 'W16X26');
  const m = r.members.arm6;
  const v = shear(cat.all.find((s) => s.id === 'W10X26')!, m.L, fy);
  assert.ok(m.Vz / v.strong >= 0.6, `W10X26 shear ratio ${m.Vz / v.strong}`);
});
