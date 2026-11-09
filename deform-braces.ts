// The deformed shape of a brace test (the table `braces`).
//
// One file gives, at each step, the axial displacement x (mm) and the force
// (kN), tension positive. The brace gets longer by x. In compression, past
// buckling, the middle moves sideways: a half sine that takes up the shortening
// Δ has an amplitude of (2 / π) sqrt(Lb Δ), Lb the length that bends.
//
// A step alone can't give Δ. A brace that was pulled far stays longer, so it
// buckles at a positive displacement. So Δ counts from the longest length so
// far (Sample.hi), less the elastic part of the stretch and of the shortening.
//
// `scale` is not the same for the two moves. The axial displacement is small
// next to the brace, so it takes the scale (the top end, the frame, the
// actuator). The bow is already 5 to 15 % of the length at real size, and it
// is not linear in the displacement. So it stays at real size, and Δ always
// uses the real displacement. This is the one table where the scale of
// deform.ts doesn't multiply everything.
//
// Two colors. The axial zone is the force over the capacity: it drops after
// buckling, because the brace carries less. The hinge in the middle is the
// moment there over Mp: the force drops but the bow grows, so it stays near 1
// while the middle works hardest.
import { add, dot, mul, sub, type V } from './vec.ts';
import type { BraceRig, Result, RigStrut } from './generate.ts';
import type { HubRecord } from './hub.ts';
import { hingeSize } from './rig.ts';
import { biggest, clevisMove, follow, I4, movePoint, scaleFor, shift, strut, type DeformState, type DeformTable, type Knot, type M4, type Move, type Sample, type Samples, type Zone } from './deform.ts';
import type { Section } from './sections.ts';
import type { BraceSpecimen, Specimen } from './specimen.ts';
import { frame } from './steel.ts';

const FILE = 'force_displacement';
const MOMENT = 0;
const AXIAL = 1;
const E_STEEL = 200000; // MPa
// How much more the test gives than the bare brace, L / EA: the ends and the
// rig give too. Read on the tests: at 1, the middle moves before the force
// peak on 64 of 207 tests, at 1.5 on 29.
const GIVE = 1.5;
const FOLD = 20; // mm: a gusset or a pin folds over this length

const value = (rec: HubRecord, f: string) => {
  const x = typeof rec[f] === 'string' ? Number((rec[f] as string).trim() || NaN) : rec[f];
  return typeof x === 'number' && Number.isFinite(x) ? x : undefined;
};
const firstOf = (rec: HubRecord, fs: string[]) => fs.map((f) => value(rec, f)).find((x) => x !== undefined);
const at = (o: V, u: V, s: number): V => [0, 1, 2].map((k) => o[k] + u[k] * s) as V;

// Which way a brace bends. A gusset is weak out of plane, whatever the
// section. The others turn about the weak axis. A round or square section has
// none: a fixed one goes out of plane, a pin the way the drawn pin turns.
export function bendDirection(ends: BraceSpecimen['ends'], sec: Section, u: V): V {
  const { v, w } = frame([0, 0, 0], u);
  const same = Math.abs(sec.Is - sec.Iw) < 1e-6 * sec.Is;
  if (ends === 'gusset' || (same && ends === 'fixed')) return [1, 0, 0];
  if (same) return w;
  return sec.Iw <= sec.Is ? mul(v, Math.sign(v[0])) : w;
}

// the plastic moment for that bend, N mm. No Z in the record: the one of the section.
function plasticMoment(rec: HubRecord, sec: Section, n: V, u: V) {
  const { v } = frame([0, 0, 0], u);
  const acrossDepth = Math.abs(dot(n, v)) > 0.5; // bending about the axis of Iw
  const weak = sec.Iw <= sec.Is === acrossDepth;
  const zs = [value(rec, 'z_x'), value(rec, 'z_y')].filter((z): z is number => !!z && z > 0);
  const z = zs.length ? (weak ? Math.min(...zs) : Math.max(...zs)) : acrossDepth ? sec.Ww : sec.Ws;
  const fy = firstOf(rec, ['fy_m', 'f_yn']);
  return z && fy ? z * fy : undefined;
}

// The capacities of one brace, kN. p_c and p_t of a DBF are peaks of the file,
// so of the two braces together. p_t_theory is one brace.
export function capacities(rec: HubRecord, frameKind: BraceSpecimen['frame']) {
  const share = frameKind === 'DBF' ? 0.5 : 1;
  const read = (f: string) => {
    const p = Math.abs(value(rec, f) ?? 0) * share;
    return p || Math.abs(value(rec, 'p_t_theory') ?? 0) || undefined;
  };
  return { Pc: read('p_c'), Pt: read('p_t') };
}

// The monotonic SBF tests give compression as positive: the force goes up to
// p_c, then drops, and there is no p_t.
const signFlipped = (rec: HubRecord, frameKind: BraceSpecimen['frame']) => frameKind === 'SBF' && String(rec.loading_protocol ?? '').trim() === 'Monotonic';

// One brace. n: the way it bends. bend: the length that bends, free: the
// length that stretches, both in mm from o. Lb: bend[1] - bend[0].
type Line = { id: string; o: V; u: V; n: V; bend: [number, number]; free: [number, number]; Lb: number; Mp?: number };
type Geometry = { spec: NonNullable<Result['st']['brace']>; rig: BraceRig; sec: Section; lines: Line[] };

// An angle lies on one face of its gusset, and a gusset is one flat plate with
// no cut along the brace. A bow that starts under the plate pushes the end of
// the angle through it, so the bow of an angle starts where the gussets end.
function pastGussets(r: Result, l: BraceRig['lines'][number]): [number, number] {
  const along = (end: string) => r.parts.find((p) => p.id === `${l.id}-${end}-conn`)?.faces.flatMap((f) => f.pts.map((q) => dot(sub(q, l.o), l.u))) ?? [];
  return [Math.max(l.s[0], ...along('from')), Math.min(l.s[1], ...along('to'))];
}

const geometries = new WeakMap<Result, Map<HubRecord, Geometry>>();
export function geometry(r: Result, rec: HubRecord): Geometry {
  const known = geometries.get(r)?.get(rec);
  if (known) return known;
  const [spec, rig] = [r.st.brace, r.st.braceRig];
  if (!spec || !rig) throw new Error('not a brace test');
  const sec = r.st.col;
  const lines = rig.lines.map((l, i): Line => {
    const n = mul(bendDirection(spec.ends, sec, l.u), i ? -1 : 1); // the two braces of a DBF bow apart
    const bend: [number, number] = spec.ends === 'pin' ? [0, spec.L] : spec.ends === 'gusset' && sec.kind === 'L' ? pastGussets(r, l) : l.s;
    return { ...l, n, bend, free: l.s, Lb: bend[1] - bend[0], Mp: plasticMoment(rec, sec, n, l.u) };
  });
  const g = { spec, rig, sec, lines };
  if (!geometries.has(r)) geometries.set(r, new Map());
  geometries.get(r)!.set(rec, g);
  return g;
}

// One brace at one step, after the sign of the file. x: its length change (mm).
// a: the bow, always at real size. axial, hinge: the levels of the zones.
export type BraceStep = { x: number; force: number; delta: number; a: number; axial?: number; hinge?: number };

export function readStep(g: Geometry, rec: HubRecord, s: Sample): BraceStep[] {
  const { spec, sec, lines } = g;
  const { Pc, Pt } = capacities(rec, spec.frame);
  const flip = signFlipped(rec, spec.frame);
  const k = (GIVE * spec.L * 1000) / ((value(rec, 'e') || E_STEEL) * (value(rec, 'area') || sec.A));
  const [x, y] = flip ? [-s.along, -s.y] : [s.along, s.y];
  const [lo0, hi0] = [s.lo ?? Math.min(0, s.along), s.hi ?? Math.max(0, s.along)];
  const [lo, hi] = flip ? [-hi0, -lo0] : [lo0, hi0];
  const two = lines.length > 1;
  const theory = Math.abs(value(rec, 'p_t_theory') ?? 0);
  return lines.map((l, i) => {
    // The second brace of a DBF goes the other way, with its own history.
    const [xi, longest] = i ? [-x, -lo] : [x, hi];
    const force = (i ? -y : y) * (two ? 0.5 : 1);
    const kept = Math.max(0, longest - (Pt ?? 0) * k);
    const delta = Math.max(0, kept - (Pc ?? 0) * k - xi);
    const a = (2 / Math.PI) * Math.sqrt(l.Lb * delta);
    // A DBF: the file has the sum, the brace in tension takes up to its yield force
    const pushed = force >= 0 ? 0 : two && theory ? Math.max(0, Math.abs(y) - theory) : -force;
    const ends = spec.ends === 'fixed' ? 0.5 : 1; // fixed ends take half of the moment
    return {
      x: xi, force, delta, a,
      axial: force >= 0 ? (Pt ? force / Pt : undefined) : Pc ? -force / Pc : undefined,
      hinge: l.Mp ? (pushed * 1000 * a * ends) / l.Mp : undefined,
    };
  });
}

// The bow, in mm along n. A pin and a gusset turn at their end: a half sine,
// with a flat knot past each end so what is behind stays. A fixed end stays
// square: (1 - cos 2πξ) / 2, with the same shortening for the same amplitude.
function bowKnots(l: Line, fixed: boolean, a: number): Knot[] {
  const [s0, s1] = l.bend;
  const knot = (f: number): Knot => {
    const [w, t] = fixed
      ? [(a * (1 - Math.cos(2 * Math.PI * f))) / 2, ((a * Math.PI) / l.Lb) * Math.sin(2 * Math.PI * f)]
      : [a * Math.sin(Math.PI * f), ((a * Math.PI) / l.Lb) * Math.cos(Math.PI * f)];
    return { s: s0 + f * l.Lb, w, t, r: t };
  };
  const body = [0, 0.25, 0.5, 0.75, 1].map(knot);
  if (fixed) return body;
  const flat = (s: number): Knot => ({ s, w: 0, t: 0, r: 0 });
  return [flat(s0 - FOLD), ...body, flat(s1 + FOLD)];
}

// A link or an actuator, from its fixed pin to its pin on `on` (as in
// deform-connection.ts)
function strutMove(s: RigStrut, on: Move): Move {
  const L = Math.hypot(...sub(s.to, s.from));
  const u = mul(sub(s.to, s.from), 1 / L);
  const { pin, reach } = hingeSize(s.D);
  const [p0, p1]: V[] = [s.from, s.to].map((p, i) => at(p, u, (i ? -1 : 1) * pin));
  return strut(p0, p1, p0, movePoint(p1, on), [reach + 0.6 * (L - 2 * reach) - pin, L - reach - pin]);
}

function shape(r: Result, spec: Specimen, rec: HubRecord, samples: Samples, scale: number): DeformState {
  if (spec.test !== 'brace') throw new Error(`${spec.id}: not a brace test`);
  const g = geometry(r, rec);
  const { lines, sec } = g;
  const { rig } = g;
  const { ends, L } = g.spec;
  const steps = readStep(g, rec, samples[FILE]);
  const moved = steps[0].x * scale;
  const moves: Record<string, Move> = {};

  // The rig. SB: the loading beam goes along the brace. A frame: its top goes
  // sideways, so that the brace gets longer by x. The pinned columns turn
  // about their feet. The y move only, so the top ends stay on the column and
  // under the beam at the same time.
  let beam: M4;
  let topEnd: M4;
  if (rig.frame) {
    const { feet, top } = rig.frame;
    const u = lines[0].u;
    const z0 = feet[0][2];
    const turn = moved / u[1] / (at(lines[0].o, u, L)[2] - z0);
    topEnd = I4();
    topEnd[9] = turn;
    topEnd[13] = -turn * z0;
    beam = shift([0, turn * (top - z0), 0]);
    const up: V = [0, 0, 1];
    feet.forEach((foot, i) => {
      const name = i ? 'B' : 'A';
      moves[`rig-col${name}`] = { o: foot, u: up, n: [0, 0, 0], knots: [], A: topEnd };
      moves[`rig-foot${name}`] = clevisMove(r.parts, `rig-foot${name}`, moves[`rig-col${name}`]);
    });
  } else {
    topEnd = shift(mul(lines[0].u, moved));
    beam = topEnd;
  }
  const loaded: Move = { o: [0, 0, 0], u: [0, 0, 1], n: [0, 0, 0], knots: [], A: beam };
  moves['rig-beam'] = loaded;
  moves['rig-actuator'] = strutMove(rig.actuator, loaded);

  // Each brace and its ends take one move. The bottom end stays, the top end
  // goes with the rig, the steel between them takes the change of length.
  lines.forEach((l, i) => {
    const m: Move = { o: l.o, u: l.u, n: l.n, knots: bowKnots(l, ends === 'fixed', steps[i].a), A: I4(), B: topEnd, split: l.free };
    for (const p of r.parts) if (!p.joint && (p.id === l.id || p.id.startsWith(`${l.id}-`))) moves[p.id] = m;
    // A pin end: the mount doesn't bend, it stays at the bottom and goes with
    // the rig at the top. Only the tongue turns, with the end of the bow.
    for (const p of r.parts) {
      if (!p.joint?.of.startsWith(`${l.id}-`)) continue;
      const top = dot(sub(p.joint.pin, l.o), l.u) > L / 2;
      const A = top ? topEnd : I4();
      moves[p.id] = { o: l.o, u: l.u, n: l.n, knots: [], A };
      moves[p.joint.of] = clevisMove(r.parts, p.joint.of, m, A);
    }
  });

  // the working zones
  const notes = [`The axial displacement is ×${scale}, the sideways bow is at real size.`];
  const zones: Zone[] = [];
  lines.forEach((l, i) => {
    const { v, w } = frame([0, 0, 0], l.u);
    const axes: [V, V, V] = [l.u, v, w];
    const name = lines.length > 1 ? `Brace ${i + 1}` : 'Brace';
    // Across the brace, from its drawn part: an angle isn't centered on the axis.
    // 2 mm more and no more: the other brace of a DBF is 10 mm away.
    const drawn = r.parts.find((p) => p.id === l.id)?.faces.flatMap((f) => f.pts.map((pt) => dot(sub(pt, l.o), v))) ?? [-sec.bf / 2, sec.bf / 2];
    const [lo, hi] = [Math.min(...drawn), Math.max(...drawn)];
    const across = (hi - lo) / 2 + 2;
    const onto = (c: V): V => add(c, mul(v, (lo + hi) / 2));
    const { axial, hinge, force } = steps[i];
    const [s0, s1] = l.free;
    if (axial !== undefined) zones.push({ c: onto(at(l.o, l.u, (s0 + s1) / 2)), axes, half: [(s1 - s0) / 2 - 1, across, sec.d], level: axial, slot: AXIAL, label: name, ratio: force >= 0 ? 'N / Pt' : '|N| / Pc' });
    if (hinge !== undefined) zones.push({ c: onto(at(l.o, l.u, (l.bend[0] + l.bend[1]) / 2)), axes, half: [Math.max(sec.d, l.Lb / 10), across, sec.d], level: hinge, slot: MOMENT, label: `${name} hinge`, ratio: '|N| a / Mp' });
  });
  if (!lines.every((l) => l.Mp)) notes.push('No Z and fy: no hinge zone.');
  if (steps[0].axial === undefined) notes.push('No capacity in the record: no axial zone.');
  if (signFlipped(rec, g.spec.frame)) notes.push('This file gives compression as positive.');
  if (lines.length > 1) notes.push('The file gives the force of the two braces together: half on each.');
  if (ends === 'pin' && Math.abs(lines[0].n[0]) > 0.5) notes.push('The weak axis is across the drawn pin: the pin is drawn the wrong way for this bend.');
  return { moves: follow(r.parts, moves), zones, scale, notes };
}

export const BRACE_DEFORM: DeformTable = {
  responses: [{ folder: FILE, x: 'Axial displacement', y: 'Force', label: 'Force', xUnit: 'mm', yUnit: 'kN', slot: AXIAL }],
  shape,
  // no length here: 1 m stands for a brace
  // it sees no length, so 1 m stands for it. Auto stops at 10: only short braces
  // move this little, and at 20 they lose a third of their length.
  autoScale: (p) => Math.min(10, scaleFor(biggest(p.series[FILE].x) / 1000)),
};
