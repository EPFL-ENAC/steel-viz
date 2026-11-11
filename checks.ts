// Member checks, from the public formulas of AISC 360-22 (no phi factors:
// generate.ts keeps its own margin, LIMIT):
// - E3: flexural buckling of a member in compression, about both axes.
// - E7: a round tube with a thin wall (D / t past 0.11 E / Fy) in compression
//   takes Fcr Ae, with an effective area Ae under A.
// - F2: lateral torsional buckling of an I section bent about its strong axis
//   (doubly symmetric, compact). Tubes and rods: no LTB, Mn = Fy Z (F7, F11).
// - F8: a round tube, no LTB, but local buckling of its wall: Fy Z up to
//   D / t = 0.07 E / Fy (compact), less past it (noncompact, slender).
//   A round tube with D / t of 0.45 E / Fy or more is refused (tooThin).
// - F6: weak axis bending of an I section, Mn = Fy Z.
// - H1-1: axial force and bending together.
// - G: shear, along both axes of every kind (see shear()). No interaction with
//   the moment: AISC has none for these shapes.
//
// The buckling length is the member length (K = 1). That is right when the
// global analysis already has the sway effects (EC3 5.2.2(3)b, the same idea
// as the AISC direct analysis method): generate.ts amplifies the moments with
// alphaCr from solver.ts for that.
//
// Not checked: local buckling of slender plates of the other sections
// (E7, F3), torsional and flexural-torsional buckling (E4), Cb > 1 (Cb = 1 is
// the safe side for cantilevers and unbraced spans).
import { E } from './solver.ts';
import { ANGLE_GAP, type Section } from './sections.ts';

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
  const Fe = (Math.PI ** 2 * E) / (L / r) ** 2;
  const Fcr = fy / Fe <= 2.25 ? 0.658 ** (fy / Fe) * fy : 0.877 * Fe;
  return Fcr * effectiveArea(s, fy);
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

// F2 values of an I section: Lp, Lr and the elastic LTB stress past Lr
export function ltb(s: Section, fy: number) {
  const ry = Math.sqrt(s.Iw / s.A);
  const Sx = (2 * s.Is) / s.d;
  const h0 = s.d - s.tf; // distance between the flange centroids
  const Cw = (s.Iw * h0 * h0) / 4;
  const rts = Math.sqrt(Math.sqrt(s.Iw * Cw) / Sx);
  const jc = s.J / (Sx * h0); // c = 1 for a doubly symmetric I
  const Lp = 1.76 * ry * Math.sqrt(E / fy);
  const Lr = 1.95 * rts * (E / (0.7 * fy)) * Math.sqrt(jc + Math.sqrt(jc * jc + 6.76 * ((0.7 * fy) / E) ** 2));
  const Fcr = (Lb: number) => ((Math.PI ** 2 * E) / (Lb / rts) ** 2) * Math.sqrt(1 + 0.078 * jc * (Lb / rts) ** 2);
  return { Lp, Lr, Sx, rts, Fcr };
}

// nominal strong axis moment Mn, for an unbraced length Lb, Cb = 1
export function strongMoment(s: Section, Lb: number, fy: number): number {
  if (s.kind === 'CHS') return roundMoment(s, fy);
  const Mp = fy * s.Ws;
  if (s.kind !== 'I') return Mp;
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

// H1-1: Pr / Pc with the bending part
const h1 = (p: number, m: number) => (p >= 0.2 ? p + (8 / 9) * m : p / 2 + m);

// the use ratio of a member (1 = at its nominal strength): the compression
// case with Pn, the tension case with Fy A, and the shear along both axes
// (chapter G), the largest one. Infinity for a round tube that is too thin
// (tooThin).
export function memberRatio(s: Section, f: MemberForces, L: number, fy: number): number {
  if (tooThin(s, fy)) return Infinity;
  const weak = s.kind === 'CHS' ? roundMoment(s, fy) : fy * s.Ww;
  const m = f.My / strongMoment(s, L, fy) + f.Mz / weak;
  const c = f.Nc > 0 ? h1(f.Nc / compression(s, L, fy), m) : 0;
  const t = h1(f.N / (fy * s.A), m);
  const v = shear(s, L, fy);
  return Math.max(c, t, f.Vz / v.strong, f.Vy / v.weak);
}

