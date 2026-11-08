// The reduced beam section (RBS) of a beam-to-column test: a circular cut in
// both edges of both flanges, near the column, so the beam hinge forms there
// and not at the weld. steel.ts draws it (rbsFaces), deform-connection.ts
// puts the beam hinge zone at its center.
//
// The hub data gives how deep the cut is (b_bf_rbs, the flange width at the
// center of the cut, or rbs_cut = 1 - b_bf_rbs / b_bf) and Z of the cut
// section (z_xb_rbs). It gives no position and no length. We take the middle
// of the AISC 358 ranges for a prequalified RBS: the cut starts at a = 0.5 to
// 0.75 bf from the column face, and is b = 0.65 to 0.85 d long.
//
// No Node API here: hub.ts uses it, and index.ts exports hub.ts.
import type { Rbs } from './steel.ts';

export const RBS_A = 0.625; // a / bf
export const RBS_B = 0.75; // b / d

export const RBS_NOTE = `RBS: the data has no position and length for the cut, drawn at a = ${RBS_A} bf from the column face, b = ${RBS_B} d long (the middle of the AISC 358 ranges)`;

const r3 = (x: number) => Math.round(x * 1000) / 1000;

// The cut of a hub record. bf, d: the beam. bfRbs: b_bf_rbs, cut: rbs_cut
// (NaN when missing). c comes from b_bf_rbs, else from rbs_cut.
export function hubRbs(bf: number, d: number, bfRbs: number, cut: number): { rbs?: Rbs; note: string } {
  const c = bfRbs > 0 && bfRbs < bf ? (bf - bfRbs) / 2 : cut > 0 && cut < 1 ? (bf * cut) / 2 : NaN;
  if (!(c > 0)) return { note: 'RBS: no b_bf_rbs or rbs_cut in the record, the cut is not drawn' };
  return { rbs: { a: r3(RBS_A * bf), b: r3(RBS_B * d), c: r3(c) }, note: RBS_NOTE };
}

// s: the center of the cut, from the column face. The beam hinge is there.
export const hingeAt = (r: Rbs) => r.a + r.b / 2;

// The moment at s from the column face, from M at the face. lo: the shear
// span, from the column face to the load. The moment goes down in a straight
// line to 0 at the load.
export const cutMoment = (M: number, s: number, lo: number) => (M * Math.max(0, lo - s)) / lo;
