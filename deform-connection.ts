// The deformed shape of a beam-to-column test (the table `connections`).
//
// The files give, at each step: the drift θ and the actuator force P (Global,
// Global_west), the panel zone distortion γ and shear V (Panel_zone), and the
// chord rotation θb and moment M of each beam (Beam_moment_rotation, _west).
// What is left of θ is the bending of the column.
//
// The model is in the plane of the beams. An angle is positive when the column
// top goes along the first beam. φc is the turn of the column at the joint, φb
// the turn of the beam axis at the joint, φc - φb = γ (the panel zone is a
// parallelogram). The column ends are pins with no moment. The joint stays on
// the line between them. Each beam is a cantilever under a tip load, and its
// root section stays glued to the column flange.
//
// Column loaded: the top pin moves θ H, the beam tips stay. Beam loaded: the
// top pin stays, the beam tips move θ L. So beam loaded, all the angles are
// measured from θ (rho below), and no angle turns the whole specimen.
import { dot, mul, sub, type V } from './vec.ts';
import type { Result, RigStrut } from './generate.ts';
import { hdir, panelZone } from './generate.ts';
import type { HubRecord } from './hub.ts';
import { hingeSize } from './rig.ts';
import { cutMoment, hingeAt } from './rbs.ts';
import { biggest, clevisMove, follow, hermite, I4, movePoint, scaleFor, shift, strut, type DeformState, type DeformTable, type Knot, type Move, type Sample, type Samples, type Zone } from './deform.ts';
import type { Specimen } from './specimen.ts';

const G = 77000; // shear modulus of steel, MPa
const MOMENT = 0;
const SHEAR = 1;

export const value = (rec: HubRecord, f: string) => {
  const x = typeof rec[f] === 'string' ? Number((rec[f] as string).trim() || NaN) : rec[f];
  return typeof x === 'number' && Number.isFinite(x) ? x : undefined;
};
export const firstOf = (rec: HubRecord, fs: string[]) => fs.map((f) => value(rec, f)).find((x) => x !== undefined);

// the plastic moment of a beam, N mm. z_xb: mm3, fy: MPa
export function plasticMoment(rec: HubRecord) {
  const [z, fy] = [value(rec, 'z_xb'), firstOf(rec, ['f_yb_avg', 'f_yb_mill', 'f_yb'])];
  return z && fy ? z * fy : undefined;
}
// the panel zone capacity, kN
export const panelCapacity = (rec: HubRecord) => firstOf(rec, ['r_n_pl_m_aisc', 'r_n_pl_n_aisc', 'r_n_el_n_aisc']) || undefined;

// A beam of the test. o: on the column axis, at the beam axis. u: along it.
// sign: 1 on the side of the first beam. face: the column face, from o.
// tip: where the load goes in, from o. free: tip - face.
type Beam = { id: string; o: V; u: V; sign: number; face: number; tip: number; free: number; d: number; bf: number; strut?: RigStrut };
type Geometry = { beams: Beam[]; pz: ReturnType<typeof panelZone>; zTop: number };

const geometries = new WeakMap<Result, Geometry>();
function geometry(r: Result): Geometry {
  const known = geometries.get(r);
  if (known) return known;
  const { st, parts, rig } = r;
  const beams = st.arms.map((a): Beam => {
    const u = hdir(a.bearing);
    const o: V = [0, 0, a.z - a.sec.d / 2];
    const faces = parts.find((p) => p.id === a.id)?.faces ?? [];
    const face = faces.reduce((m, f) => Math.min(m, ...f.pts.map((p) => dot(p, u))), a.L);
    const s = rig?.tips.find((t) => t.arm === a.id);
    const tip = s ? dot(s.to, u) : a.L;
    return { id: a.id, o, u, sign: Math.sign(dot(u, rig!.dir)) || 1, face, tip, free: tip - face, d: a.sec.d, bf: a.sec.bf, strut: s };
  });
  const g = { beams, pz: panelZone(st), zTop: rig!.top.to[2] };
  geometries.set(r, g);
  return g;
}

// The numbers of one step, with the fallbacks of the README.
type Step = {
  theta: number; drifts: number[]; gamma: number; phiB: number; phiC: number;
  moments: number[]; // |M| at the column face of each beam, kN mm
  shear: number; // |V|, kN
};
function readStep(at: Samples, g: Geometry, r: Result, rec: HubRecord, spec: Extract<Specimen, { beams: unknown }>): Step {
  const { st } = r;
  const { beams } = g;
  const column = spec.load === 'column';
  const pick = <T>(i: number, east: T, west: T) => (i === 0 ? east ?? west : west ?? east);
  const global = beams.map((_, i): Sample | undefined => pick(i, at.Global, at.Global_west));
  const chord = beams.map((_, i): Sample | undefined => pick(i, at.Beam_moment_rotation, at.Beam_moment_rotation_west));
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

  // the forces
  const hc = value(rec, 'h_c') ?? st.H;
  const moments = beams.map((b, i) => {
    if (chord[i]) return Math.abs(chord[i]!.y);
    const P = Math.abs(global[i]?.y ?? 0);
    return column ? ((P * hc) / beams.length) * (b.free / b.tip) : P * b.free;
  });
  const lever = Math.max(1, beams[0].d - st.arms[0].sec.tf);
  const atAxis = beams.reduce((sum, b, i) => sum + (moments[i] * b.tip) / b.free, 0);
  const inColumn = column ? Math.abs(global[0]?.y ?? 0) : atAxis / hc;
  const shear = at.Panel_zone ? Math.abs(at.Panel_zone.y) : Math.max(0, moments.reduce((a, b) => a + b, 0) / lever - inColumn);

  // the angles
  const fromChord = chord.some(Boolean) ? mean(chord.map((c, i) => (c ? (c.along * beams[i].free) / beams[i].tip : 0))) : undefined;
  const drifts0 = global.map((s) => s?.along);
  const known = drifts0.filter((x) => x !== undefined) as number[];
  // the web and its doubler plates
  const elastic = (shear * 1000) / (G * st.col.d * (st.col.tw + (st.doubler ? st.doubler.n * st.doubler.t : 0)));
  const theta0 = known.length ? mean(known) : (at.Panel_zone?.along ?? 0) + (fromChord ?? 0);
  const gamma = at.Panel_zone ? at.Panel_zone.along : Math.sign(theta0) * Math.min(elastic, Math.abs(theta0) / 2);
  const phiB = fromChord ?? (theta0 - gamma) / 2;
  return { theta: theta0, drifts: drifts0.map((x) => x ?? theta0), gamma, phiB, phiC: phiB + gamma, moments, shear };
}

// The column, from the foot pin. Between a pin and the joint it is a cubic with
// no curvature at the pin. The pin is a little past the end of the steel, on a
// straight line (the end plate, the head). So at the end of the steel: slope t
// from the slope of the chord, and the deflection that reaches the pin.
function columnKnots(sA: number, sB: number, s0: number, s1: number, ramp: number, sTop: number, theta: number, phiC: number, phiB: number, rho: number): Knot[] {
  const sj = (s0 + s1) / 2;
  const [w0, w1] = [theta * sj - phiC * (sj - s0), theta * sj + phiC * (s1 - sj)];
  // sA: the column foot, sB: the column top, sTop: the top pin. The foot pin is at 0.
  const D0 = Math.max(1, s0 - sA);
  const D1 = Math.max(1, sB - s1);
  const e1 = sTop - sB;
  const t0 = ((3 * w0) / D0 - phiC) / (2 + (3 * sA) / D0);
  const t1 = ((3 * (theta * sTop - w1)) / D1 - phiC) / (2 + (3 * e1) / D1);
  const foot: Knot = { s: sA, w: t0 * sA, t: t0, r: t0 };
  const top: Knot = { s: sB, w: theta * sTop - t1 * e1, t: t1, r: t1 };
  const pz0: Knot = { s: s0, w: w0, t: phiC, r: phiB };
  const pz1: Knot = { s: s1, w: w1, t: phiC, r: phiB };
  const below = hermite(foot, pz0, s0 - ramp);
  const above = hermite(pz1, top, s1 + ramp);
  return [
    foot,
    { s: s0 - ramp, ...below, r: below.t },
    pz0, pz1,
    { s: s1 + ramp, ...above, r: above.t },
    top,
  ].map((k) => ({ s: k.s, w: k.w - rho * k.s, t: k.t - rho, r: k.r - rho }));
}

// a beam: a tip load cantilever on the root turn. K: its tip deflection.
function beamKnots(b: Beam, rootT: number, rootR: number, K: number): Knot[] {
  const at = (s: number, r?: number): Knot => {
    const x = (s - b.face) / b.free;
    const t = rootT + (K * (6 * x - 3 * x * x)) / 2 / b.free;
    return { s, w: rootT * b.free * x + (K * (3 * x * x - x * x * x)) / 2, t, r: r ?? t };
  };
  return [at(b.face, rootR), at(b.face + Math.min(b.d, b.free / 2)), at(b.tip)];
}

// A link or an actuator, from its fixed pin to its pin on `on`
export function strutMove(s: RigStrut, on: Move): Move {
  const L = Math.hypot(...sub(s.to, s.from));
  const u = mul(sub(s.to, s.from), 1 / L);
  const { pin, reach } = hingeSize(s.D);
  const [p0, p1]: V[] = [s.from, s.to].map((p, i) => [0, 1, 2].map((k) => p[k] + (i ? -1 : 1) * u[k] * pin) as V);
  // an actuator stretches its rod, a link its bar. Both ends stay as they are.
  const start = s.kind === 'actuator' ? reach + 0.6 * (L - 2 * reach) : reach;
  return strut(p0, p1, p0, movePoint(p1, on), [start - pin, L - reach - pin]);
}

function shape(r: Result, spec: Specimen, rec: HubRecord, at: Samples, scale: number): DeformState {
  if (spec.test !== undefined && spec.test !== 'connection') throw new Error(`${spec.id}: not a beam-to-column test`);
  if ('frame' in spec && spec.frame) throw new Error(`${spec.id}: no deformed shape for a frame test yet`);
  const rig = r.rig;
  if (!rig || !r.st.arms.length) return { moves: {}, zones: [], scale, notes: ['No beam: no deformed shape.'] };
  const g = geometry(r);
  const v = readStep(at, g, r, rec, spec as Extract<Specimen, { beams: unknown }>);
  const { st } = r;
  const { pz, beams } = g;
  const [zF, h] = [rig.foot[2], rig.dir];
  const up: V = [0, 0, 1];

  const [theta, phiC, phiB] = [v.theta * scale, v.phiC * scale, v.phiB * scale];
  const rho = spec.load === 'column' ? 0 : theta;
  const col: Move = {
    o: rig.foot, u: up, n: h, A: I4(),
    knots: columnKnots(-zF, st.H - zF, pz.z0 - zF, pz.z1 - zF, pz.ramp, g.zTop - zF, theta, phiC, phiB, rho),
  };
  const moves: Record<string, Move> = {
    column: col,
    'column-foot': col,
    'foot-pin': clevisMove(r.parts, 'foot-pin', col),
  };
  const top = strutMove(rig.top, col);
  moves[rig.top.kind === 'link' ? 'top-link' : 'top-actuator'] = top;

  beams.forEach((b, i) => {
    const root: V = [0, 1, 2].map((k) => b.o[k] + b.u[k] * b.face) as V;
    const m: Move = {
      o: b.o, u: b.u, n: up, A: shift(sub(movePoint(root, col), root)),
      // the tip ends at (drift of this beam - θ + rho) * tip
      knots: beamKnots(b, -b.sign * (phiB - rho), -b.sign * (phiC - rho), b.sign * b.tip * (v.drifts[i] * scale - theta + phiB)),
    };
    moves[b.id] = m;
    if (b.strut) moves[`${b.id}-${b.strut.kind}`] = strutMove(b.strut, m);
  });

  // the working zones
  const notes: string[] = [];
  const zones: Zone[] = [];
  const Mp = plasticMoment(rec);
  const Rn = panelCapacity(rec);
  const across = rig.axis;
  // one of these files is enough: readStep() gives it to every beam
  const force = at.Global ?? at.Global_west ?? at.Beam_moment_rotation ?? at.Beam_moment_rotation_west;
  if (!force) notes.push('No force or moment file: no beam hinge zone.');
  else if (!Mp) notes.push('No Z and fy in the record: no beam hinge zone.');
  else
    beams.forEach((b, i) => {
      // RBS: the hinge is at the center of the cut. A haunch: it starts at the
      // haunch tip. M at the face goes down in a line to 0 at the load, l_o
      // from the face. The beam file gives M at the face (l_o of the record),
      // Global gives P times b.free.
      const { rbs: cut, haunch } = st.arms[i];
      const s = cut ? hingeAt(cut) : haunch ? haunch.length : 0;
      const beamFile = i === 0 ? at.Beam_moment_rotation ?? at.Beam_moment_rotation_west : at.Beam_moment_rotation_west ?? at.Beam_moment_rotation;
      const M = cut || haunch ? cutMoment(v.moments[i], s, (beamFile && value(rec, 'l_o')) || b.free) : v.moments[i];
      const [zb, zr] = [value(rec, 'z_xb'), value(rec, 'z_xb_rbs')];
      const Mpi = cut && zb && zr ? (Mp * zr) / zb : Mp;
      const c: V = [0, 1, 2].map((k) => b.o[k] + b.u[k] * (b.face + (cut ? s : s + b.d / 2 + 0.5))) as V;
      zones.push({
        c, axes: [b.u, across, up], half: [cut ? cut.b / 2 : b.d / 2, b.bf, b.d], slot: MOMENT,
        level: Math.abs(M * 1000) / Mpi, label: beams.length > 1 ? `Beam hinge ${i ? 'west' : 'east'}` : 'Beam hinge', ratio: cut ? '|M| / Mp at the cut' : haunch ? '|M| / Mp at the haunch tip' : '|M| / Mp',
      });
    });
  if (Rn) {
    zones.push({
      c: [0, 0, (pz.z0 + pz.z1) / 2], axes: [h, across, up], half: [st.col.d / 2 + 1, st.col.bf, (pz.z1 - pz.z0) / 2], slot: SHEAR,
      level: Math.abs(v.shear) / Rn, label: 'Panel zone', ratio: '|V| / Rn',
    });
  } else notes.push('No panel zone capacity in the record: no panel zone color.');
  if (st.arms.some((a) => a.rbs))
    notes.push(value(rec, 'z_xb_rbs')
      ? 'RBS: the hinge is at the center of the cut, with M at the cut (from M at the column face) and Z of the cut section (z_xb_rbs).'
      : 'RBS: the hinge is at the center of the cut, with M at the cut. No z_xb_rbs in the record: Z of the full beam.');
  if (st.arms.some((a) => a.haunch)) notes.push('Haunch: the hinge starts at the haunch tip (s_h from the column face), with M there (from M at the column face) and Z of the plain beam.');
  if (st.slab) notes.push('The slab is not counted: the hinge level is |M| / Mp of the steel beam alone, so it can go above 1.');
  if (!at.Panel_zone) notes.push('No panel zone file: elastic estimate of the distortion.');
  if (force && !at.Beam_moment_rotation) notes.push('No beam file: moment from the actuator force, what is left of the drift is half beam, half column.');
  return { moves: follow(r.parts, moves), zones, scale, notes };
}

export const CONNECTION_DEFORM: DeformTable = {
  responses: [
    { folder: 'Global', x: 'Story drift', y: 'Actuator force', label: 'Global', xUnit: 'rad', yUnit: 'kN' },
    { folder: 'Global_west', x: 'Story drift', y: 'Actuator force', label: 'Global west', xUnit: 'rad', yUnit: 'kN' },
    { folder: 'Panel_zone', x: 'Distortion', y: 'Shear force', label: 'Panel zone', xUnit: 'rad', yUnit: 'kN', slot: SHEAR },
    { folder: 'Beam_moment_rotation', x: 'Chord rotation', y: 'Moment', label: 'Beam', xUnit: 'rad', yUnit: 'kN mm', slot: MOMENT },
    { folder: 'Beam_moment_rotation_west', x: 'Chord rotation', y: 'Moment', label: 'Beam west', xUnit: 'rad', yUnit: 'kN mm', slot: MOMENT },
  ],
  shape,
  autoScale(p) {
    const drift = ['Global', 'Global_west'].map((k) => p.series[k]).filter(Boolean);
    const all = drift.length ? drift : Object.values(p.series);
    return scaleFor(Math.max(...all.map((c) => biggest(c.x))));
  },
};
