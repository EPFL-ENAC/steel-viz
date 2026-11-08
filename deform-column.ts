// The deformed shape of a column test (the tables `columns` and `hss_columns`).
// buildColumn() draws both, so they share this model. Only the way to read a
// step changes: columnStep() and hssStep().
//
// The files give, at each step: the chord rotation θ and the moment M at the
// base, and for some `columns` tests the axial shortening.
//
// The lever is the whole distance between the ends. So the top moves δ = θ L.
// In a 3pb test, θ is the turn of each half span, so mid span moves δ = θ L/2.
//
// A standing column has a linear curvature, zero at the height a L (a is
// l_sc / l_c). This gives its bend:
//
//   w(s) = k0 (s²/2 - s³ / (6 a L)),  k0 = δ / (L² (1/2 - 1/(6a)))
//
// a = 1 is a cantilever (fixed-free), a = 0.5 is double curvature (fixed-fixed,
// the top stays level), fixed-flexible is between the two. A 3pb column bends
// like a simple beam under a load at mid span, and goes straight on past the
// rollers.
//
// θ moves the column along the push, also for a test at an angle. A bi-axial
// test with two files moves along the sum of the two rotations, so Move.n
// changes at each step. Always use Sample.x here: Sample.along flips the sign
// of a file to match the driver, and in a bi-axial test the signs are real.
//
// Mp is not reduced by the axial load. The reductions we tried (EC3, AISC)
// spread the peak levels more than no reduction, so the level stays |M| / Mp.
import { add, dot, mul, sub, type V } from './vec.ts';
import type { ColumnRig, Result, RigStrut } from './generate.ts';
import type { HubRecord } from './hub.ts';
import { hingeSize } from './rig.ts';
import { biggest, clevisMove, follow, I4, movePoint, scaleFor, shift, strut, type DeformState, type DeformTable, type Knot, type Move, type Protocol, type Samples, type Zone } from './deform.ts';
import { strutMove } from './deform-connection.ts';
import type { ColumnSpecimen, Specimen } from './specimen.ts';

const MOMENT = 0;
const STRONG = 'moment_rotation_strong';
const WEAK = 'moment_rotation_weak';
const SHORTENING = 'axial_shortening_rotation';
const HSS = 'Moment_Rotation';

const value = (rec: HubRecord, f: string) => {
  const x = typeof rec[f] === 'string' ? Number((rec[f] as string).trim() || NaN) : rec[f];
  return typeof x === 'number' && Number.isFinite(x) ? x : undefined;
};

// the height of zero moment over the length, when the table doesn't give it
const ZERO_MOMENT: Record<ColumnSpecimen['ends'], number> = { 'fixed-free': 1, 'fixed-fixed': 0.5, 'fixed-flexible': 0.75, '3pb': 1 };

// One step of a test. theta: the rotation along n. level: |M| / Mp, undefined
// with no Mp or no moment. down: the file value of the shortening (mm).
type Step = { n: V; theta: number; level?: number; down?: number; notes: string[] };

// ------------------------------------------------------------- the tables
const isWeak = (rec: HubRecord) => String(rec.axis_of_bending ?? '').trim() === 'Weak';
const isBiaxial = (rec: HubRecord) => String(rec.axis_of_bending ?? '').trim() === 'Bi-axial';

// |M| / Mp of a `columns` test. M: kN mm. Z: mm3, f_ymf: MPa, so Mp is in N mm.
// Z comes from axis_of_bending, not from the folder: the weak axis tests of
// Ozkula, Harris and Uang have their file in moment_rotation_strong.
export function columnLevel(rec: HubRecord, at: Samples): number | undefined {
  const fy = value(rec, 'f_ymf');
  const [zs, zw] = [value(rec, isWeak(rec) ? 'z_yc' : 'z_xc'), value(rec, 'z_yc')];
  const ratio = (M: number | undefined, z: number | undefined) => (M !== undefined && z && fy ? Math.abs(M * 1000) / (z * fy) : undefined);
  const [s, w] = [ratio(at[STRONG]?.y, zs), ratio(at[WEAK]?.y, zw)];
  return s !== undefined && w !== undefined ? Math.hypot(s, w) : (s ?? w);
}

// |M| / Mp of an `hss_columns` test. M: kN m, mp_measured__knmm: kN mm.
export function hssLevel(rec: HubRecord, at: Samples): number | undefined {
  const [M, Mp] = [at[HSS]?.y, value(rec, 'mp_measured__knmm')];
  return M !== undefined && Mp ? Math.abs(M * 1000) / Mp : undefined;
}

const reduced = (n: number | undefined) => (n ? [`Mp is not reduced by the axial load (P / Py = ${n.toFixed(2)}): a hinge can form below level 1.`] : []);

function columnStep(rig: ColumnRig, rec: HubRecord, at: Samples): Step {
  const [s, w] = [at[STRONG], at[WEAK]];
  const notes: string[] = [];
  let [n, theta] = [rig.push, s?.x ?? w?.x ?? 0];
  if (isBiaxial(rec)) {
    const v = add(mul(rig.web, s?.x ?? 0), mul(rig.minor, w?.x ?? 0));
    theta = Math.hypot(...v);
    if (theta > 0) n = mul(v, 1 / theta);
    if (!w) notes.push('No weak axis file on this bi-axial test: it moves along the web only.');
  }
  const [p, py] = [value(rec, 'p'), value(rec, 'p_ym')];
  const level = columnLevel(rec, at);
  if (level === undefined && (s || w)) notes.push('No Z and fy in the record: no hinge zone.');
  return { n, theta, level, down: at[SHORTENING]?.y, notes: [...notes, ...reduced(p && py ? Math.abs(p) / py : undefined)] };
}

function hssStep(rig: ColumnRig, rec: HubRecord, at: Samples): Step {
  const notes: string[] = [];
  const level = hssLevel(rec, at);
  if (level === undefined && at[HSS]) notes.push('No Mp in the record: no hinge zone.');
  if (value(rec, 'loading_angle')) notes.push('Pushed at an angle: Mp is about the face of the tube.');
  return { n: rig.push, theta: at[HSS]?.x ?? 0, level, notes: [...notes, ...reduced(value(rec, 'axial_load_ratio'))] };
}

// ------------------------------------------------------------- the bend
// 5 knots with r = t. With 2 knots the cubic is the same, but r is linear
// between knots: at a = 0.5 it would stay zero and the sections would not turn.
const SPOTS = [0, 0.25, 0.5, 0.75, 1];

function standingKnots(L: number, a: number, top: number): Knot[] {
  const k0 = top / (L * L * (1 / 2 - 1 / (6 * a)));
  return SPOTS.map((f) => {
    const s = f * L;
    const t = k0 * (s - (s * s) / (2 * a * L));
    return { s, w: k0 * ((s * s) / 2 - (s * s * s) / (6 * a * L)), t, r: t };
  });
}

function spanKnots(L: number, mid: number): Knot[] {
  return SPOTS.map((f) => {
    const x = f <= 0.5 ? 2 * f : 2 - 2 * f; // 0 on a roller, 1 at mid span
    const t = ((f <= 0.5 ? 1 : -1) * 1.5 * mid * (1 - x * x)) / (L / 2);
    return { s: f * L, w: (mid * (3 * x - x * x * x)) / 2, t, r: t };
  });
}

// ------------------------------------------------------------- the shape
const along = (p: V, u: V, s: number): V => add(p, mul(u, s));

// An actuator on the column. A rig is drawn for the real test, but the scale
// can push the head past the pin on the reaction, and the actuator would turn
// over. So the two pins stay at least two tongues apart, and the foot leaves
// its reaction: the mount goes back along the bar, with the bar's end on its pin.
function actuatorMove(id: string, s: RigStrut, col: Move, moves: Record<string, Move>, notes: string[]) {
  const m = strutMove(s, col);
  moves[id] = m;
  const { pin, reach } = hingeSize(s.D);
  const p1 = along(s.to, m.u, -pin);
  const q1 = movePoint(p1, col);
  const over = 2 * (reach - pin) - dot(sub(q1, m.o), m.u);
  if (over <= 0) return;
  const note = 'At this scale the column goes past the actuator: its foot leaves its support.';
  if (!notes.includes(note)) notes.push(note);
  moves[id] = strut(m.o, p1, along(m.o, m.u, -over), q1, m.split!);
  moves[`${id}-mount-from`] = { o: m.o, u: m.u, n: [0, 0, 0], knots: [], A: shift(mul(m.u, -over)) };
}

function shape(r: Result, spec: Specimen, rec: HubRecord, at: Samples, scale: number, read: typeof columnStep): DeformState {
  if (spec.test !== 'column') throw new Error(`${spec.id}: not a column test`);
  const rig = r.st.columnRig;
  if (!rig) return { moves: {}, zones: [], scale, notes: ['No rig: no deformed shape.'] };
  const step = read(rig, rec, at);
  const { o, u, web, minor } = rig;
  const { n, level, notes } = step;
  const L = spec.length;
  const lying = spec.ends === '3pb';

  // a from the record, when it gives a shape the formula can draw
  const given = (value(rec, 'l_sc') ?? NaN) / (value(rec, 'l_c') ?? NaN);
  const a = given >= 0.5 && given <= 1 ? given : ZERO_MOMENT[spec.ends];
  const theta = step.theta * scale;
  const col: Move = { o, u, n, A: I4(), knots: lying ? spanKnots(L, (theta * L) / 2) : standingKnots(L, a, theta * L) };
  if (step.down !== undefined) {
    // some files reach 8 % of the length: at scale 20 the column would turn inside out
    const down = Math.max(step.down * scale, -L / 2);
    if (down > step.down * scale) notes.push('At this scale the shortening is cut at half the length.');
    col.B = shift(mul(u, down));
    col.split = [0, L];
  } else notes.push('No axial shortening file: no shortening drawn.');

  const moves: Record<string, Move> = { column: col };
  for (const s of rig.struts) actuatorMove(s.id, s, col, moves, notes);
  if (r.parts.some((p) => p.id === 'rig-pin')) moves['rig-pin'] = clevisMove(r.parts, 'rig-pin', col);

  // the hinges: a box just around the section, so the plates stay out of it
  const zones: Zone[] = [];
  const { d, bf } = r.st.col;
  const h = Math.min(d, L / 4);
  const zone = (s: number, label: string) => {
    if (level === undefined) return;
    zones.push({ c: along(o, u, s), axes: [web, minor, u], half: [d / 2 + 1, bf / 2 + 1, h / 2 - 1], level, slot: MOMENT, label, ratio: '|M| / Mp' });
  };
  if (lying) zone(L / 2, 'Mid span hinge');
  else zone(h / 2, 'Base hinge');
  if (spec.ends === 'fixed-fixed') {
    zone(L - h / 2, 'Top hinge');
    notes.push('The top hinge uses the moment of the file.');
  }
  return { moves: follow(r.parts, moves), zones, scale, notes };
}

// the rotation files only: the shortening is in mm
function autoScale(p: Protocol, folders: string[]) {
  const all = folders.map((k) => p.series[k]).filter(Boolean);
  return scaleFor(Math.max(0, ...all.map((c) => biggest(c.x))));
}

export const COLUMN_DEFORM: DeformTable = {
  responses: [
    { folder: STRONG, x: 'Chord rotation', y: 'Moment', label: 'Strong axis', xUnit: 'rad', yUnit: 'kN mm', slot: MOMENT },
    { folder: WEAK, x: 'Chord rotation', y: 'Moment', label: 'Weak axis', xUnit: 'rad', yUnit: 'kN mm', slot: MOMENT },
    { folder: SHORTENING, x: 'Chord rotation', y: 'Axial shortening', label: 'Shortening', xUnit: 'rad', yUnit: 'mm' },
  ],
  shape: (r, spec, rec, at, scale) => shape(r, spec, rec, at, scale, columnStep),
  autoScale: (p) => autoScale(p, [STRONG, WEAK]),
};

export const HSS_COLUMN_DEFORM: DeformTable = {
  responses: [{ folder: HSS, x: 'Chord rotation', y: 'Moment', label: 'Column', xUnit: 'rad', yUnit: 'kN m', slot: MOMENT }],
  shape: (r, spec, rec, at, scale) => shape(r, spec, rec, at, scale, hssStep),
  autoScale: (p) => autoScale(p, [HSS]),
};
