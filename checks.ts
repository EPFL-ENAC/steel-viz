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
//
// The buckling length is the member length (K = 1). That is right when the
// global analysis already has the sway effects (EC3 5.2.2(3)b, the same idea
// as the AISC direct analysis method): generate.ts amplifies the moments with
// alphaCr from solver.ts for that.
//
// Not checked: shear, local buckling of slender plates of the other sections
// (E7, F3), torsional and flexural-torsional buckling (E4), Cb > 1 (Cb = 1 is
// the safe side for cantilevers and unbraced spans).
import { E } from './solver.ts';
import type { Section } from './sections.ts';

export type MemberForces = { N: number; Nc: number; My: number; Mz: number };

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

// H1-1: Pr / Pc with the bending part
const h1 = (p: number, m: number) => (p >= 0.2 ? p + (8 / 9) * m : p / 2 + m);

// the use ratio of a member (1 = at its nominal strength): the compression
// case with Pn, and the tension case with Fy A, the larger one. Infinity for
// a round tube that is too thin (tooThin).
export function memberRatio(s: Section, f: MemberForces, L: number, fy: number): number {
  if (tooThin(s, fy)) return Infinity;
  const weak = s.kind === 'CHS' ? roundMoment(s, fy) : fy * s.Ww;
  const m = f.My / strongMoment(s, L, fy) + f.Mz / weak;
  const c = f.Nc > 0 ? h1(f.Nc / compression(s, L, fy), m) : 0;
  const t = h1(f.N / (fy * s.A), m);
  return Math.max(c, t);
}

