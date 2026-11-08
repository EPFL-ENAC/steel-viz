// The deformed shape of an EBF link test (the table `eccentric_braced_frames`).
//
// The file gives, at each step: gamma_t, the total link rotation, and V, the
// link shear. The link is the only part that deforms. It shears: one end moves
// gamma e from the other, and its sections stay parallel to its end faces.
//
// The rest is two rigid sides, A and B, one at each link end:
// - TF1 (no frame): side A is the block, it stays. Side B is the loading beam.
//   It goes up with no turn (a side arm holds it parallel in these tests).
// - In a frame: each side turns by theta about its own foot pin. Link in the
//   middle: side A is colA, beamA, side B is colB, beamB. Link at the edge: side
//   A is colA alone, the link stands on its flange.
//
// Two sides that turn by theta about two pins at the same height differ by a
// lift of theta L, L from pin to pin, wherever the link is. So theta = gamma e /
// L for the middle and for the edge. L is the drawn span, so that the parts stay
// glued when the record has no frame size. The composite tests move the same way.
import type { V } from './vec.ts';
import type { Result } from './generate.ts';
import type { HubRecord } from './hub.ts';
import { biggest, clevisMove, follow, I4, movePoint, mulM, scaleFor, shift, strut, tilt, type DeformState, type DeformTable, type M4, type Move, type Samples } from './deform.ts';
import { firstOf, strutMove } from './deform-connection.ts';
import type { Specimen } from './specimen.ts';

const SHEAR = 1;
const [X, Y, Z]: V[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

// The capacity of a link, kN, the AISC 341 rule: Vn = min(Vp, 2 Mp / e). Vp =
// 0.6 fy Aw. A long link yields in bending first, so e picks the capacity.
// The hub gives Aw and Zp of one channel, and a link from channels has two.
// Its Zp also leaves out the flange plates (tf_add_n), so these links take Vp.
export function linkCapacity(rec: HubRecord, e: number) {
  const [aw, fw] = [firstOf(rec, ['aw_m', 'aw_n']), firstOf(rec, ['f_y_m_web', 'f_y_n_web'])];
  if (!aw || !fw) return undefined;
  const channels = /^C\s/i.test(String(rec.profile ?? '').trim());
  const webs = channels ? 2 : 1;
  const Vp = (webs * 0.6 * fw * aw) / 1000;
  const [zp, ff] = [firstOf(rec, ['zp_m', 'zp_n']), firstOf(rec, ['f_y_m_flg', 'f_y_n_flg'])];
  const plates = (firstOf(rec, ['tf_add_m', 'tf_add_n']) ?? 0) > 0;
  const Vb = zp && ff && !plates ? (webs * 2 * zp * ff) / e / 1000 : Infinity;
  return Vb < Vp ? { V: Vb, Vp, ratio: '|V| / (2 Mp / e)', channels, plates } : { V: Vp, Vp, ratio: '|V| / Vp', channels, plates };
}

const rigid = (A: M4): Move => ({ o: [0, 0, 0], u: Z, n: Y, knots: [], A });

function shape(r: Result, spec: Specimen, rec: HubRecord, at: Samples, scale: number): DeformState {
  if (spec.test !== 'link') throw new Error(`${spec.id}: not a link test`);
  const { link, linkRig: rig, col: sec } = r.st;
  if (!link || !rig) throw new Error(`${spec.id}: no link in this structure`);
  const { e } = link;
  const { y0, zl, frame } = rig;
  const s = at.processed_data;
  const g = (s?.along ?? 0) * scale;
  const lift = g * e;

  // the two rigid sides
  let [MA, MB] = [I4(), shift([0, 0, lift])];
  const moves: Record<string, Move> = {};
  if (frame) {
    const theta = lift / (frame.feet[1][1] - frame.feet[0][1]);
    [MA, MB] = frame.feet.map((f) => tilt(f, Y, Z, theta));
    moves['rig-footA'] = clevisMove(r.parts, 'rig-footA', rigid(MA));
    moves['rig-footB'] = clevisMove(r.parts, 'rig-footB', rigid(MB));
    moves['rig-colA'] = rigid(MA);
    moves['rig-colB'] = rigid(MB);
    moves['rig-beamB'] = rigid(MB);
    // pinned at the foot, the top on the link end. The bar stretches a few mm.
    for (const b of frame.braces) {
      const len = Math.hypot(...b.to.map((c, i) => c - b.from[i]));
      moves[b.id] = strut(b.from, b.to, b.from, movePoint(b.to, rigid(b.side ? MB : MA)), [0, len]);
    }
  } else moves['rig-load'] = rigid(MB);
  moves['rig-actuator'] = strutMove(rig.actuator, rigid(frame && !frame.side ? MA : MB));
  moves['link-endB'] = rigid(MB);
  // r = 0, t = gamma: the shear. B is side B with the lift taken off, so the
  // second link end lands exactly on side B.
  moves.link = {
    o: [0, y0, zl], u: Y, n: Z, A: MA, B: mulM(MB, shift([0, 0, -lift])), split: [0, e],
    knots: [{ s: 0, w: 0, t: g, r: 0 }, { s: e, w: lift, t: g, r: 0 }],
  };

  // the working zone
  const notes: string[] = [];
  const cap = linkCapacity(rec, e);
  const zones = cap
    ? [{
      c: [0, y0 + e / 2, zl] as V, axes: [Y, X, Z] as [V, V, V], half: [e / 2 - 1, sec.bf / 2, sec.d / 2 - sec.tf - 1] as V, slot: SHEAR,
      level: Math.abs(s?.y ?? 0) / cap.V, label: 'Link web', ratio: cap.ratio,
    }]
    : [];
  if (!cap) notes.push('No web area or yield stress in the record: no link web color.');
  else {
    if (cap.V < cap.Vp) notes.push('Long link: it yields in bending first. The shape is drawn in shear all the same.');
    if (cap.channels) notes.push('Built up from two channels: the capacity counts both.');
    if (cap.plates) notes.push('Flange plates: Zp of the record leaves them out, so the capacity is Vp alone.');
  }
  if (frame && (spec.frame?.span !== link.span || spec.frame?.height !== link.height)) notes.push(`Frame turn from the drawn frame, ${link.span} x ${link.height} mm, not from the test.`);
  return { moves: follow(r.parts, moves), zones, scale, notes };
}

export const LINK_DEFORM: DeformTable = {
  responses: [{
    folder: 'processed_data', x: 'Link rotation', y: 'Link shear', label: 'Link', xUnit: 'rad', yUnit: 'kN', slot: SHEAR,
    cols: ['gamma_t', 'V'], file: (id) => `id${id}.csv`,
  }],
  shape,
  autoScale: (p) => scaleFor(biggest(p.series.processed_data.x)),
};
