// Test rig parts: what holds and loads a specimen in the lab. Reaction blocks,
// pins, rollers, actuators, frame members. They are not steel of the
// specimen: their kind is 'rig', and the renderers draw them lighter.
//
// Each builder returns one Part. The caller gives its step and the parts it
// stands on (supports), so floating() can check the build order. The parts
// only touch each other and the specimen, so clashes() passes with no
// special rule. Sizes are in mm, like everywhere.
//
// No three.js here.
import { add, cross, len, mul, norm, sub, type V } from './vec.ts';
import { rodSection, type Catalog, type Section } from './sections.ts';
import { box3, boxOf, flat, geo, memberBoxes, memberFaces, type Box, type Face, type P2, type Part } from './steel.ts';

// step, supports: as for any part. type: the name in the tooltip. from: the
// direction it comes from in the build animation (default: from above).
export type RigOpts = { step: number; supports?: string[]; type?: string; from?: V };

type Solid = { faces: Face[]; boxes: Box[] };
const join = (...ss: Solid[]): Solid => ({ faces: ss.flatMap((s) => s.faces), boxes: ss.flatMap((s) => s.boxes) });

function rigPart(id: string, s: Solid, o: RigOpts, type: string): Part {
  return { id, step: o.step, faces: s.faces, dots: [], supports: o.supports ?? [], boxes: s.boxes, kind: 'rig', from: o.from ?? [0, 0, 1], info: { type: o.type ?? type } };
}

const rect = (a: number, b: number): P2[] => [[-a / 2, -b / 2], [a / 2, -b / 2], [a / 2, b / 2], [-a / 2, b / 2]];
// points on a circle of radius r around (0, y), from angle a0 to a1 (rad), ends left out
const arc = (y: number, r: number, a0: number, a1: number, n = 8): P2[] =>
  [...Array(n - 1).keys()].map((i) => {
    const a = a0 + ((a1 - a0) * (i + 1)) / n;
    return [r * Math.cos(a), y + r * Math.sin(a)];
  });

// a straight bar: an I or a round bar from p0 to p1. w: the depth direction
// of an I (default: the one geo() picks).
function bar(sec: Section, p0: V, p1: V, w?: V): Solid {
  const g = geo('rig', sec, p0, p1, false);
  if (w) [g.w, g.v] = [w, cross(w, g.u)];
  return { faces: memberFaces(g, 1e9), boxes: memberBoxes(g) };
}

// ------------------------------------------------------------- pin joint
// The sizes of a pin joint, from its pin diameter D. R: half the width of an
// ear and of the tongue. te, tt, tb: ear, tongue and base plate thickness.
// pin: the pin centre, from the mount face. reach: the shortest tongue end.
// width: the base plate across the pin, side: the base plate along the ears.
export function hingeSize(D: number) {
  const [R, te, tt, tb] = [D, 0.4 * D, 0.6 * D, 0.5 * D];
  const gap = tt + 2; // 1 mm between the tongue and each ear
  const pin = tb + 2.2 * R;
  return { R, te, tt, tb, gap, pin, reach: pin + 1.6 * R, width: gap + 2 * te + 0.6 * D, side: 2 * R + 0.6 * D };
}

// A pin joint: a base plate on the mount face, two ears, the pin, and the
// tongue between the ears, on to the next part. at: on the mount face. along:
// away from it. axis: the pin axis, at right angles to along (the free
// rotation). reach: from the mount face to the tongue end.
function hinge(at: V, along: V, axis: V, D: number, reach: number): Solid & { pin: V } {
  const z = hingeSize(D);
  const { R, te, tt, tb, gap, pin } = z;
  if (reach < z.reach - 1e-6) throw new Error(`a pin joint of ${D} mm needs ${Math.ceil(z.reach)} mm, not ${Math.round(reach)}`);
  const n = cross(axis, along); // across the ears
  const base = flat(add(at, mul(along, tb / 2)), axis, n, tb, rect(z.width, z.side));
  const ear: P2[] = [[-R, tb], [R, tb], [R, pin], ...arc(pin, R, 0, Math.PI), [-R, pin]];
  const ears = [1, -1].map((s) => flat(add(at, mul(axis, s * (gap / 2 + te / 2))), n, along, te, ear));
  const tongue = flat(at, n, along, tt, [[R, reach], [-R, reach], [-R, pin], ...arc(pin, R, Math.PI, 2 * Math.PI), [R, pin]]);
  const pc = add(at, mul(along, pin));
  const half = gap / 2 + te + 0.3 * D;
  const rod = bar(rodSection('pin', D), sub(pc, mul(axis, half)), add(pc, mul(axis, half)));
  const plates = [base, ...ears, tongue];
  return { ...join({ faces: plates.flatMap((p) => p.faces), boxes: plates.map((p) => p.box) }, rod), pin: pc };
}

// ------------------------------------------------------------- the parts
// A reaction block, or a reaction wall: a box, its sizes along x, y, z.
export function block(id: string, centre: V, size: V, o: RigOpts): Part {
  const [sx, sy, sz] = size;
  const s = { faces: box3(centre, [0, 1, 0], [0, 0, 1], sx, sy, sz), boxes: [boxOf(centre, [0, 1, 0], [0, 0, 1], sx, sy, sz)] };
  return rigPart(id, s, o, 'Reaction block');
}

// A clevis: a pin joint on a mount face (see hinge). The tongue ends at
// at + along * reach, where the specimen (or a link) starts.
export function clevis(id: string, at: V, along: V, axis: V, D: number, reach: number, o: RigOpts): Part {
  return rigPart(id, hinge(at, norm(along), norm(axis), D, reach), o, 'Pin');
}

// A roller under a specimen: a round bar along axis, on a seat. top: where
// the specimen sits on it.
export function roller(id: string, top: V, axis: V, D: number, length: number, o: RigOpts): Part {
  const c = sub(top, [0, 0, D / 2]);
  const ax = norm(axis);
  const rod = bar(rodSection('roller', D), sub(c, mul(ax, length / 2)), add(c, mul(ax, length / 2)));
  const across = cross([0, 0, 1], ax);
  const sc = sub(c, [0, 0, D]);
  const seat = flat(sc, ax, across, D, rect(length, 1.5 * D));
  return rigPart(id, join(rod, { faces: seat.faces, boxes: [seat.box] }), o, 'Roller');
}

// A hydraulic actuator from a reaction (from) to the specimen (to): a pin
// joint on each mount face, the cylinder, then the thinner piston rod. axis:
// the pin axis of both joints. D: the pin diameter.
export function actuator(id: string, from: V, to: V, axis: V, D: number, o: RigOpts): Part {
  const L = len(sub(to, from));
  const u = norm(sub(to, from));
  const ax = norm(axis);
  const r = hingeSize(D).reach;
  if (L < 2 * r + 4 * D) throw new Error(`actuator ${id}: ${Math.round(L)} mm is too short for its pins`);
  const [a, b] = [add(from, mul(u, r)), sub(to, mul(u, r))];
  const m = add(a, mul(u, 0.6 * (L - 2 * r)));
  const s = join(
    hinge(from, u, ax, D, r),
    hinge(to, mul(u, -1), ax, D, r),
    bar(rodSection('cylinder', 2.4 * D), a, m),
    bar(rodSection('rod', 1.2 * D), m, b),
  );
  return rigPart(id, s, { from: u, ...o }, 'Actuator');
}

// A frame member of the rig: an I section from p0 to p1. w: its depth
// direction (default: vertical for a beam, y for a column).
export function rigMember(id: string, sec: Section, p0: V, p1: V, o: RigOpts, w?: V): Part {
  return { ...rigPart(id, bar(sec, p0, p1, w && norm(w)), o, 'Rig frame member'), info: { type: o.type ?? 'Rig frame member', sec, L: len(sub(p1, p0)) } };
}

// A crosshead to hang a vertical actuator from: two posts from the floor
// (z = floor) and a beam on them. at: the middle of the beam bottom, where
// the actuator hangs. across: the beam direction. span: between the posts.
export function crosshead(id: string, at: V, across: V, span: number, floor: number, sec: Section, o: RigOpts): Part {
  const x = norm([across[0], across[1], 0]);
  const top = at[2];
  const posts = [1, -1].map((s) => {
    const p = add(at, mul(x, (s * span) / 2));
    return bar(sec, [p[0], p[1], floor], [p[0], p[1], top], x);
  });
  const h = span / 2 + sec.d / 2;
  const beam = bar(sec, add(sub(at, mul(x, h)), [0, 0, sec.d / 2]), add(add(at, mul(x, h)), [0, 0, sec.d / 2]));
  return rigPart(id, join(...posts, beam), o, 'Crosshead');
}

// The lightest I of the catalog at least minDepth deep, for the members of
// a rig frame (the deepest one when none is deep enough).
export function rigSection(cat: Catalog, minDepth: number): Section {
  const all = [...cat.columns, ...cat.beams].sort((a, b) => a.A - b.A);
  return all.find((s) => s.d >= minDepth) ?? all.reduce((a, b) => (b.d > a.d ? b : a));
}
