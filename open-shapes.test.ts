// node --test
// The checks of the open shapes (AISC 360-22 F2 for a channel, F9 for a tee
// and a double angle, F10 for one angle, E4 for a tee and a double angle),
// with numbers worked by hand. Fy 345 MPa, E 210000, G 81000 MPa,
// sqrt(E / Fy) = 24.672, pi² E = 2 072 617. The tables have no Cw, no shear
// center and no elastic modulus for these shapes: checks.ts computes them from
// the plates, so the tests check those too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { angleMoment, compression, elastic, ltb, memberRatio, strongMoment, teeMcr, torsional, weakMoment } from './checks.ts';
import { channelSection, doubleAngle, singleAngle, teeSection } from './sections.ts';

const near = (a: number, b: number, tol = 0.001) =>
  assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${a} is not within ${tol * 100}% of ${b}`);
const fy = 345;

// C 250 x 80, tf 12, tw 8. b' = 80 - 4 = 76, h0 = 250 - 12 = 238.
// Cw = (12 x 76³ x 238² / 12)(3 x 76 x 12 + 2 x 238 x 8) / (6 x 76 x 12 + 238 x 8)
//    = 2.4865e10 x 6544 / 7376 = 2.2061e10 mm6
// Iy (our Iw) = 2.2404e6, c = 119 sqrt(2.2404e6 / 2.2061e10) = 1.1992 (F2-8b)
// Sx = 34.908e6 / 125 = 279 261, rts² = sqrt(Iy Cw) / Sx = 796.1, rts = 28.215
const channel = channelSection('C', 250, 80, 12, 8);

test('F2: Cw, c and rts of a channel', () => {
  const l = ltb(channel, fy);
  near(l.Cw, 2.2061e10);
  near(l.c, 1.1992);
  near(l.Sx, 279261);
  near(l.rts, 28.215);
});

// ry = sqrt(2.2404e6 / 3728) = 24.515, Lp = 1.76 x 24.515 x 24.672 = 1064.5
// J c / (Sx h0) = 130 731 x 1.1992 / (279 261 x 238) = 0.0023588
// Lr = 1.95 x 28.215 x 869.57 x sqrt(0.0023588 + sqrt(0.0023588² + 6.76 x 0.00115²)) = 3757.2
test('F2: Lp and Lr of a channel', () => {
  const l = ltb(channel, fy);
  near(l.Lp, 1064.5);
  near(l.Lr, 3757.2);
});

// Mp = 345 x 330 632 = 114.07 kNm (Lb 1000 < Lp).
// Lb 3000: Mp - (Mp - 0.7 x 345 x 279 261)(3000 - 1064.5) / (3757.2 - 1064.5)
//        = 114.07 - 46.63 x 0.7188 = 80.55 kNm (F2-2)
// Lb 8000: Lb / rts = 283.54, Fcr = 2 072 617 / 283.54² x sqrt(1 + 0.078 x
//          0.0023588 x 283.54²) = 25.78 x 3.974 = 102.45, x Sx = 28.61 kNm (F2-3, F2-4)
test('F2: the three zones of a channel', () => {
  near(strongMoment(channel, 1000, fy), 114.07e6);
  near(strongMoment(channel, 3000, fy), 80.55e6);
  near(strongMoment(channel, 8000, fy), 28.61e6);
});

// weak axis: Fy Zy = 345 x 70 134 = 24.20 kNm. The centroid is 18.54 from the
// back of the web, the toes are 76 - 18.54 = 57.46 away: Sy = 2.2404e6 / 57.46
// = 38 992, 1.6 Fy Sy = 21.52 kNm, the lower one (F6-1)
test('F6: the 1.6 Fy S cap of a channel', () => {
  near(elastic(channel).Sw, 38992);
  near(weakMoment(channel, 3000, fy), 21.52e6);
});

// T 150 deep, flange 150 x 10, stem 7. A = 1500 + 980 = 2480.
// centroid: (1500 x -70 + 980 x 5) / 2480 = -40.363 (w down from the middle)
// Ix = 12 500 + 1500 x 29.637² + 7 x 140³ / 12 + 980 x 45.363² = 4.9473e6
// stem tip at 75: Sx = 4.9473e6 / 115.363 = 42 885, My = 345 x 42 885 = 14.80 kNm
// Iy = 2.8165e6, J = 150 x 10³ / 3 + 140 x 7³ / 3 = 66 007
const tee = teeSection('T', 150, 150, 10, 7);

test('F9: My of a tee, stem in compression', () => {
  near(elastic(tee).cw, -40.363);
  near(elastic(tee).Ss, 42885);
  near(strongMoment(tee, 1000, fy), 14.80e6); // Mcr is larger: My (F9-4)
});

// Lb 1000: B = -2.3 x 0.15 x sqrt(2.8165e6 / 66 007) = -2.2536 (F9-12)
// Mcr = 409.5 x sqrt(2.8165e6 x 66 007) x (-2.2536 + sqrt(1 + 2.2536²))
//     = 409.5 x 431 170 x 0.21194 = 37.42 kNm (F9-10)
// Lb 6000: B = -0.3756, Mcr = 68.25 x 431 170 x 0.69261 = 20.38 kNm
test('F9: Mcr of a tee, B and the two lengths', () => {
  near(teeMcr(tee, 1000), 37.42e6);
  near(teeMcr(tee, 6000), 20.38e6);
});

// a deep tee, T 300, flange 120 x 10, stem 7: A = 3230, centroid -50.728,
// Ix = 31.206e6, Sx = 31.206e6 / 200.728 = 155 464, My = 53.64 kNm.
// Iy = 1.4483e6, J = 73 157. Lb 4000: B = -2.3 x 0.075 x 4.4494 = -0.76752,
// Mcr = 102.375 x 325 503 x 0.49307 = 16.43 kNm < My: Mn = Mcr (F9-13)
test('F9: LTB governs a deep tee', () => {
  const t = teeSection('T', 300, 120, 10, 7);
  near(fy * elastic(t).Ss, 53.64e6);
  near(strongMoment(t, 4000, fy), 16.43e6);
});

// weak axis of the tee: Fy Zy = 345 x 57 965 = 20.00 kNm, 1.6 Fy Sy =
// 1.6 x 345 x 2.8165e6 / 75 = 20.73: Fy Zy governs
test('F6 cap on a tee: Fy Z when it is the lower one', () => {
  near(weakMoment(tee, 1000, fy), 20.00e6);
});

// 2L 100 x 100 x 10, gap 12: A = 3800, centroid -21.316, Ix = 3.6001e6,
// Sx = 3.6001e6 / 71.316 = 50 481, My = 17.416 kNm. Iy = 8.1715e6, J = 126 667.
// Lb 1000: B = -0.23 x 8.0319 = -1.8473, Mcr = 409.5 x 1 017 372 x 0.25330 =
// 105.53 kNm. My / Mcr = 0.16504: (1.92 - 1.17 x 0.40625) My = 25.16 kNm (F10-2)
// Lb 40 000: B = -0.046183, Mcr = 10.2375 x 1 017 372 x 0.95488 = 9.945 kNm.
// My / Mcr = 1.7512: (0.92 - 0.17 / 1.7512) Mcr = 8.184 kNm (F10-3)
const twoL = doubleAngle('L100x100x10', 100, 10);

test('F9 with F10-2 and F10-3: a double angle, legs in compression', () => {
  near(elastic(twoL).Ss, 50481);
  near(teeMcr(twoL, 1000), 105.53e6);
  near(strongMoment(twoL, 1000, fy), 25.16e6);
  near(teeMcr(twoL, 40000), 9.945e6);
  near(strongMoment(twoL, 40000, fy), 8.184e6);
});

// 2L 50 x 50 x 10: Ix = 392 778, centroid -8.889, Sx = 11 590, My = 3.9986 kNm.
// Iy = 1.2728e6, J = 60 000. Lb 500: B = -0.23 x 4.6058 = -1.0593,
// Mcr = 819 x 276 348 x 0.39744 = 89.95 kNm. My / Mcr = 0.04445: F10-2 gives
// 1.673 My, so the 1.5 My cap: 5.998 kNm (F9-5)
test('F9-5: the 1.5 My cap of a double angle', () => {
  const s = doubleAngle('L50x50x10', 50, 10);
  near(teeMcr(s, 500), 89.95e6);
  near(strongMoment(s, 500, fy), 5.998e6);
});

// one angle L 100 x 100 x 10: Sx = 1.8000e6 / 71.316 = 25 240, My = 8.708 kNm,
// for the LTB part 0.8 My = 6.966 kNm.
// Lb 1000: Mcr = 0.58 x 210 000 x 100⁴ x 10 / 1000² x (sqrt(1 + 0.88) - 1)
//        = 121.8e6 x 0.37113 = 45.20 kNm, (1.92 - 1.17 sqrt(0.15411)) 6.966 = 10.18 kNm
// Lb 4000: Mcr = 7.6125e6 x (sqrt(1 + 0.88 x 16) - 1) = 21.95 kNm, 8.784 kNm
// Lb 20 000: Mcr = 304 500 x 17.788 = 5.416 kNm < 0.8 My: (0.92 - 0.17 x 5.416
//            / 6.966) x 5.416 = 4.267 kNm (F10-3)
test('F10: one angle about a leg', () => {
  const a = singleAngle('L100x100x10', 100, 10);
  const S = elastic(a).Ss;
  near(S, 25240);
  near(angleMoment(a, S, 1000, fy), 10.18e6);
  near(angleMoment(a, S, 4000, fy), 8.784e6);
  near(angleMoment(a, S, 20000, fy), 4.267e6);
  near(strongMoment(a, 4000, fy), 8.784e6);
  near(weakMoment(a, 4000, fy), 8.784e6); // equal legs: the same about both axes
});

// E4 of the tee, L 3000: the shear center is at the middle of the flange,
// w = -70, y0 = 70 - 40.363 = 29.637.
// r0² = 29.637² + (4.9473e6 + 2.8165e6) / 2480 = 878.35 + 3130.58 = 4008.94
// H = 1 - 878.35 / 4008.94 = 0.78090
// Fez = 81 000 x 66 007 / (2480 x 4008.94) = 537.76
// Fey = 2 072 617 / (3000² / 1135.69) = 261.54, Fex = 2 072 617 / (3000² / 1994.9) = 459.41
// Fe = (799.30 / 1.5618)(1 - sqrt(1 - 4 x 261.54 x 537.76 x 0.7809 / 799.30²)) = 225.75
// Fcr = 0.658^(345 / 225.75) x 345 = 181.97, Pn = 181.97 x 2480 = 451.3 kN
test('E4: flexural-torsional buckling of a tee', () => {
  const e = torsional(tee, 3000);
  near(e.y0, 29.637);
  near(e.r02, 4008.94);
  near(e.H, 0.7809);
  near(e.Fez, 537.76);
  near(e.Fey, 261.54);
  near(e.Fex, 459.41);
  near(e.Fe, 225.75); // under the flexural Fe of 261.54
  near(compression(tee, 3000, fy), 451.3e3);
});

// E4 of the 2L, L 3000: shear center at the heel, w = -45, y0 = 23.684.
// r0² = 560.94 + (3.6001e6 + 8.1715e6) / 3800 = 3658.72, H = 0.84668
// Fez = 81 000 x 126 667 / (3800 x 3658.72) = 737.96, Fey = 495.21
// FTB: (1233.17 / 1.69336)(1 - sqrt(1 - 0.81387)) = 414.06
// Fex = 2 072 617 / (3000² / 947.39) = 218.18: flexural buckling about x is
// lower, Fe = 218.18. Fcr = 0.658^1.5813 x 345 = 177.98, Pn = 676.3 kN
test('E4: a double angle, where flexural buckling is lower', () => {
  const e = torsional(twoL, 3000);
  near(e.H, 0.84668);
  near(e.Fez, 737.96);
  near(e.Fft, 414.06);
  near(e.Fe, 218.18);
  near(compression(twoL, 3000, fy), 676.3e3);
});

// memberRatio reads it: the tee with My = 7.40 kNm (half of 14.80) and no
// other force gives 0.5, where Fy Zx (26.10 kNm) would give 0.28
test('memberRatio: a tee uses F9', () => {
  const none = { N: 0, Nc: 0, My: 0, Mz: 0, Vy: 0, Vz: 0 };
  near(memberRatio(tee, { ...none, My: 7.40e6 }, 1000, fy), 0.5, 0.002);
});
