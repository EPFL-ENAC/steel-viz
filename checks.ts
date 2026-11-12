// Member checks, from the public formulas of AISC 360-22 (no phi factors:
// generate.ts keeps its own margin, LIMIT):
// - E3: flexural buckling of a member in compression, about both axes.
// - E7: a round tube with a thin wall (D / t past 0.11 E / Fy) in compression
//   takes Fcr Ae, with an effective area Ae under A.
// - E4: flexural-torsional buckling of a tee and a double angle (singly
//   symmetric), with Cw = 0 (the user note of E4).
// - F2: lateral torsional buckling of an I section or a channel bent about its
//   strong axis (compact). Tubes and rods: no LTB, Mn = Fy Z (F7, F11).
// - F9: a tee or a double angle bent in its plane of symmetry, always with the
//   stem (or the legs along the depth) in compression: the solver gives |M|
//   only, and a continuous chord has both signs. It is the safe side.
// - F10: one equal angle bent about a leg (a geometric axis), with no
//   restraint: yielding and LTB, the toe in compression.
// - F8: a round tube, no LTB, but local buckling of its wall: Fy Z up to
//   D / t = 0.07 E / Fy (compact), less past it (noncompact, slender).
//   A round tube with D / t of 0.45 E / Fy or more is refused (tooThin).
// - F6: weak axis bending of an I section, Mn = Fy Z. A channel, a tee and a
//   double angle: Fy Z but at most 1.6 Fy S (F6-1).
// - H1-1: axial force and bending together.
// - G: shear, along both axes of every kind (see shear()). No interaction with
//   the moment: AISC has none for these shapes.
//
// The buckling length is the member length (K = 1). That is right when the
// global analysis already has the sway effects (EC3 5.2.2(3)b, the same idea
// as the AISC direct analysis method): generate.ts amplifies the moments with
// alphaCr from solver.ts for that, and adds the notional loads for the frame
// imperfections (EC3 5.3.2, AISC 360-22 C2.2b).
//
// The tables have no Cw, no shear center and no elastic modulus for the open
// shapes: they come from the dimensions (rects() of sections.ts), see
// elastic() and ltb(). J is the thin wall J of rectProps().
//
// Not checked: local buckling of slender plates of the other sections
// (E7, F3, F9.3, F9.4, F10.3), E4 for a channel, E5 and E6 (one angle, the
// connectors of a double angle), F11 for a flat bar, the open shapes of the
// specimens (2C keeps Fy Z), Cb > 1 (Cb = 1 is the safe side for cantilevers
// and unbraced spans).
import { E, G } from './solver.ts';
import { ANGLE_GAP, rects, type Section } from './sections.ts';

// The centroid (cv, cw) and the smaller elastic modulus about each axis, from
// the plates of the section: Ss = Is / (the farthest fiber along w), Sw the
// same along v. size() calls it a lot, so it keeps the result.
const elasticOf = new WeakMap<Section, { cv: number; cw: number; Ss: number; Sw: number }>();
export function elastic(s: Section) {
  let e = elasticOf.get(s);
  if (e) return e;
  const rs = rects(s);
  const area = (r: number[]) => (r[1] - r[0]) * (r[3] - r[2]);
  const A = rs.reduce((a, r) => a + area(r), 0);
  const cv = rs.reduce((a, r) => a + area(r) * (r[0] + r[1]), 0) / (2 * A);
  const cw = rs.reduce((a, r) => a + area(r) * (r[2] + r[3]), 0) / (2 * A);
  const far = (lo: number, hi: number, c: number) => Math.max(c - lo, hi - c);
  const v = far(Math.min(...rs.map((r) => r[0])), Math.max(...rs.map((r) => r[1])), cv);
  const w = far(Math.min(...rs.map((r) => r[2])), Math.max(...rs.map((r) => r[3])), cw);
  e = { cv, cw, Ss: s.Is / w, Sw: s.Iw / v };
  elasticOf.set(s, e);
  return e;
}

// Vz: the shear along w (with My, the strong axis), Vy: along v (with Mz)
export type MemberForces = { N: number; Nc: number; My: number; Mz: number; Vy: number; Vz: number };

// F8: a round tube with D / t of 0.45 E / Fy or more is out of the scope of
// AISC. size() never picks it, and memberRatio() gives Infinity.
export const tooThin = (s: Section, fy: number) => s.kind === 'CHS' && s.d / s.tf >= (0.45 * E) / fy;

// E7.2: the effective area of a round tube in compression. A up to
// D / t = 0.11 E / Fy (E7-6), then (0.038 E / (Fy D / t) + 2/3) A (E7-7). Just
// past the limit E7-7 gives 1.01 A: never more than A. Other sections: A.
function effectiveArea(s: Section, fy: number): number {
  if (s.kind !== 'CHS') return s.A;
  const Dt = s.d / s.tf;
  if (Dt <= (0.11 * E) / fy) return s.A;
  return Math.min(s.A, ((0.038 * E) / (fy * Dt) + 2 / 3) * s.A);
}

// E3: nominal compression strength Pn = Fcr A, for a buckling length L. A
// thin round tube: Fcr Ae (E7-1), Fcr is the same.
export function compression(s: Section, L: number, fy: number): number {
  const r = Math.min(Math.sqrt(s.Is / s.A), Math.sqrt(s.Iw / s.A));
  const Fe = s.kind === 'T' || s.kind === '2L' ? torsional(s, L).Fe : (Math.PI ** 2 * E) / (L / r) ** 2;
  const Fcr = fy / Fe <= 2.25 ? 0.658 ** (fy / Fe) * fy : 0.877 * Fe;
  return Fcr * effectiveArea(s, fy);
}

// E4 for a tee or a double angle: symmetric about v = 0 (y, the axis of
// symmetry, is our w axis, so Iy is our Iw). The shear center is where the
// flange (or the outstanding legs) meets the stem: w = -d / 2 + tf / 2, y0
// from the centroid. Cw = 0 (E4 user note). Fex: flexural buckling about the
// other axis (Is). Fe = the lower of Fex and the flexural-torsional E4-3.
export function torsional(s: Section, L: number) {
  const fe = (I: number) => (Math.PI ** 2 * E) / (L / Math.sqrt(I / s.A)) ** 2;
  const y0 = elastic(s).cw - (-s.d / 2 + s.tf / 2);
  const r02 = y0 * y0 + (s.Is + s.Iw) / s.A;
  const H = 1 - (y0 * y0) / r02;
  const [Fex, Fey, Fez] = [fe(s.Is), fe(s.Iw), (G * s.J) / (s.A * r02)];
  const Fft = ((Fey + Fez) / (2 * H)) * (1 - Math.sqrt(1 - (4 * Fey * Fez * H) / (Fey + Fez) ** 2));
  return { y0, r02, H, Fex, Fey, Fez, Fft, Fe: Math.min(Fex, Fft) };
}

// F8: nominal moment of a round tube, about any axis. Mp = Fy Z (F8-1) for a
// compact wall, D / t up to 0.07 E / Fy. Noncompact, up to 0.31 E / Fy:
// (0.021 E / (D / t) + Fy) S (F8-2). Slender: Fcr S, Fcr = 0.33 E / (D / t)
// (F8-3, F8-4). Mn is the lower of yielding and local buckling.
export function roundMoment(s: Section, fy: number): number {
  const Mp = fy * s.Ws;
  const Dt = s.d / s.tf;
  const S = (2 * s.Is) / s.d;
  if (Dt <= (0.07 * E) / fy) return Mp;
  if (Dt <= (0.31 * E) / fy) return Math.min(Mp, ((0.021 * E) / Dt + fy) * S);
  return Math.min(Mp, ((0.33 * E) / Dt) * S);
}

// F2 values of an I section or a channel: Lp, Lr and the elastic LTB stress
// past Lr. The I: Cw = Iy h0² / 4 and c = 1. The channel: Cw of a channel
// with parallel flanges (b' = bf - tw / 2, h0 = d - tf, AISC Design Guide 9)
// and c = (h0 / 2) sqrt(Iy / Cw) (F2-8b).
export function ltb(s: Section, fy: number) {
  const ry = Math.sqrt(s.Iw / s.A);
  const Sx = (2 * s.Is) / s.d;
  const h0 = s.d - s.tf; // distance between the flange centroids
  const b = s.bf - s.tw / 2;
  const Cw = s.kind === 'C' ? ((s.tf * b ** 3 * h0 * h0) / 12) * ((3 * b * s.tf + 2 * h0 * s.tw) / (6 * b * s.tf + h0 * s.tw)) : (s.Iw * h0 * h0) / 4;
  const c = s.kind === 'C' ? (h0 / 2) * Math.sqrt(s.Iw / Cw) : 1;
  const rts = Math.sqrt(Math.sqrt(s.Iw * Cw) / Sx);
  const jc = (s.J * c) / (Sx * h0);
  const Lp = 1.76 * ry * Math.sqrt(E / fy);
  const Lr = 1.95 * rts * (E / (0.7 * fy)) * Math.sqrt(jc + Math.sqrt(jc * jc + 6.76 * ((0.7 * fy) / E) ** 2));
  const Fcr = (Lb: number) => ((Math.PI ** 2 * E) / (Lb / rts) ** 2) * Math.sqrt(1 + 0.078 * jc * (Lb / rts) ** 2);
  return { Lp, Lr, Sx, rts, Fcr, Cw, c };
}

// F9-10, F9-11: the elastic LTB moment of a tee or a double angle, stem (or
// legs along the depth) in compression: B = -2.3 (d / Lb) sqrt(Iy / J)
export function teeMcr(s: Section, Lb: number): number {
  const B = -2.3 * (s.d / Lb) * Math.sqrt(s.Iw / s.J);
  return ((1.95 * E) / Lb) * Math.sqrt(s.Iw * s.J) * (B + Math.sqrt(1 + B * B));
}

// F10-2, F10-3: Mn of an angle from My and Mcr, at most 1.5 My
function angleMn(My: number, Mcr: number): number {
  const r = My / Mcr;
  return r <= 1 ? Math.min((1.92 - 1.17 * Math.sqrt(r)) * My, 1.5 * My) : (0.92 - 0.17 / r) * Mcr;
}

// F10, one equal angle bent about a leg, no restraint, toe in compression:
// Mcr = (0.58 E b⁴ t / Lb²)(sqrt(1 + 0.88 (Lb t / b²)²) - 1), and My at 0.8
// of the yield moment for the LTB part (F10.2(b)(ii)). Yielding: 1.5 My
// (F10-1). The legs are equal, so the same Mcr about both axes.
export function angleMoment(s: Section, S: number, Lb: number, fy: number): number {
  const [b, t] = [s.d, s.tf];
  const Mcr = ((0.58 * E * b ** 4 * t) / (Lb * Lb)) * (Math.sqrt(1 + 0.88 * ((Lb * t) / (b * b)) ** 2) - 1);
  return Math.min(1.5 * fy * S, angleMn(0.8 * fy * S, Mcr));
}

// nominal strong axis moment Mn, for an unbraced length Lb, Cb = 1
export function strongMoment(s: Section, Lb: number, fy: number): number {
  if (s.kind === 'CHS') return roundMoment(s, fy);
  // F9: My = Fy S to the tip of the stem (the smaller S). A tee: the lower of
  // My (F9-4) and Mcr (F9-13). A double angle: F10-2, F10-3 with that Mcr,
  // at most 1.5 My (F9-5)
  if (s.kind === 'T') return Math.min(fy * elastic(s).Ss, teeMcr(s, Lb));
  if (s.kind === '2L') return angleMn(fy * elastic(s).Ss, teeMcr(s, Lb));
  if (s.kind === 'L') return angleMoment(s, elastic(s).Ss, Lb, fy);
  const Mp = fy * s.Ws;
  if (s.kind !== 'I' && s.kind !== 'C') return Mp;
  const { Lp, Lr, Sx, Fcr } = ltb(s, fy);
  if (Lb <= Lp) return Mp;
  if (Lb <= Lr) return Math.min(Mp, Mp - (Mp - 0.7 * fy * Sx) * ((Lb - Lp) / (Lr - Lp)));
  return Math.min(Mp, Fcr(Lb) * Sx);
}

// G2-3, G2-4: the web shear buckling factor Cv1, for a web of h / tw = lam
// and the plate buckling factor kv (5.34, a web with no stiffener). G2.1(a)
// (Cv1 = 1 for a rolled I up to 2.24 sqrt(E / Fy)) only changes the phi
// factor, and we have none: (b) gives Cv1 = 1 up to 2.54 sqrt(E / Fy).
export function cv1(lam: number, kv: number, fy: number): number {
  const lim = 1.1 * Math.sqrt((kv * E) / fy);
  return lam <= lim ? 1 : lim / lam;
}

// G2-9 to G2-11: the factor Cv2, for the tubes (G4), the tee stems and the
// angle legs (G3) and the flanges in weak axis shear (G6)
export function cv2(lam: number, kv: number, fy: number): number {
  const r = Math.sqrt((kv * E) / fy);
  if (lam <= 1.1 * r) return 1;
  if (lam <= 1.37 * r) return (1.1 * r) / lam;
  return (1.51 * kv * E) / (lam * lam * fy);
}

// G3 and G6: a plate b wide and t thick, sheared along b: 0.6 Fy b t Cv2 with
// h / tw = b / t and kv = 1.2 (an outstanding leg, a stem, a flange)
const plate = (b: number, t: number, fy: number) => 0.6 * fy * b * t * cv2(b / t, 1.2, fy);

// Chapter G: the nominal shear strength Vn of a section, `strong` along w
// (the depth, with My), `weak` along v (with Mz). L: the member length, for
// the round tube (G5, Lv = L, the longest it can be: the safe side).
export function shear(s: Section, L: number, fy: number): { strong: number; weak: number } {
  const both = (v: number) => ({ strong: v, weak: v });
  // G2.1: the web of an I or a channel, Aw = d tw, h the clear web
  const web = (n: number) => n * 0.6 * fy * s.d * s.tw * cv1((s.d - 2 * s.tf) / s.tw, 5.34, fy);
  switch (s.kind) {
    case 'I': // G6: two flanges, each b = bf / 2 on both sides of the web
      return { strong: web(1), weak: 2 * 0.6 * fy * s.bf * s.tf * cv2(s.bf / 2 / s.tf, 1.2, fy) };
    case 'C': // G6: two flanges, b = bf for a channel
      return { strong: web(1), weak: 2 * plate(s.bf, s.tf, fy) };
    case '2C': // two channels, bf = both flanges and the gap
      return { strong: web(2), weak: 4 * plate((s.bf - ANGLE_GAP) / 2, s.tf, fy) };
    case 'T': // G3: the stem, b = d. G6: one flange, b = bf / 2 on both sides
      return { strong: plate(s.d, s.tw, fy), weak: 0.6 * fy * s.bf * s.tf * cv2(s.bf / 2 / s.tf, 1.2, fy) };
    case '2L': // G3: the legs along w (d) and the outstanding legs
      return { strong: 2 * plate(s.d, s.tw, fy), weak: 2 * plate((s.bf - ANGLE_GAP) / 2, s.tf, fy) };
    case 'L':
      return { strong: plate(s.d, s.tw, fy), weak: plate(s.bf, s.tf, fy) };
    case 'FB': // d the width, bf the thickness. Across the thickness b / t < 1, Cv2 = 1
      return { strong: plate(s.d, s.bf, fy), weak: 0.6 * fy * s.d * s.bf };
    case 'RHS': {
      // G4: Aw = 2 h t, h = the side less 3 t (the corner radius is not kept)
      const side = (H: number) => 0.6 * fy * 2 * (H - 3 * s.tf) * s.tf * cv2((H - 3 * s.tf) / s.tf, 5, fy);
      return { strong: side(s.d), weak: side(s.bf) };
    }
    case 'CHS': {
      // G5: Fcr Ag / 2, Fcr the larger of G5-2a and G5-2b, at most 0.6 Fy
      const Dt = s.d / s.tf;
      const Fcr = Math.min(0.6 * fy, Math.max((1.6 * E) / (Math.sqrt(L / s.d) * Dt ** 1.25), (0.78 * E) / Dt ** 1.5));
      return both((Fcr * s.A) / 2);
    }
    default:
      // ROD: a solid round bar is not in chapter G. Its peak shear stress is
      // 4/3 of the mean: 0.6 Fy at the peak gives 0.6 Fy x 0.75 A.
      return both(0.6 * fy * 0.75 * s.A);
  }
}

// nominal weak axis moment: a round tube as about the strong axis, one angle
// F10 about its other leg, a channel, a tee and a double angle Fy Z at most
// 1.6 Fy S (F6-1), the others Fy Z (F6, F7, F11)
export function weakMoment(s: Section, L: number, fy: number): number {
  if (s.kind === 'CHS') return roundMoment(s, fy);
  if (s.kind === 'L') return angleMoment(s, elastic(s).Sw, L, fy);
  if (s.kind === 'C' || s.kind === 'T' || s.kind === '2L') return Math.min(fy * s.Ww, 1.6 * fy * elastic(s).Sw);
  return fy * s.Ww;
}

// H1-1: Pr / Pc with the bending part
const h1 = (p: number, m: number) => (p >= 0.2 ? p + (8 / 9) * m : p / 2 + m);

// the use ratio of a member (1 = at its nominal strength): the compression
// case with Pn, the tension case with Fy A, and the shear along both axes
// (chapter G), the largest one. Infinity for a round tube that is too thin
// (tooThin).
export function memberRatio(s: Section, f: MemberForces, L: number, fy: number): number {
  if (tooThin(s, fy)) return Infinity;
  const weak = weakMoment(s, L, fy);
  const m = f.My / strongMoment(s, L, fy) + f.Mz / weak;
  const c = f.Nc > 0 ? h1(f.Nc / compression(s, L, fy), m) : 0;
  const t = h1(f.N / (fy * s.A), m);
  const v = shear(s, L, fy);
  return Math.max(c, t, f.Vz / v.strong, f.Vy / v.weak);
}

