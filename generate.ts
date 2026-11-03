// A steel structure from a seed, in one of three forms:
// - tree: one column on a base plate, arms at random levels and bearings,
//   sometimes a brace under an arm or a secondary beam off it.
// - portal: two columns with beams between them, one or two storeys, braced
//   or not, and a few arms out of the columns.
// - box: four columns in a rectangle, beams and braces only in its four
//   walls, nothing sticks out.
// The solver checks it stands up, fixes it if not, and sizes the members.
// A real test specimen (specimen.ts) skips all the random draws: its column
// and beams are given, the solver only checks it.
import { add, cross, len, mul, norm, sub, type V } from './vec.ts';
import { solve, type Elem, type FNode } from './solver.ts';
import type { Catalog, Section } from './sections.ts';
import {
  box3, boxOf, flat, geo, hardware, memberBoxes, memberFaces, resolve, splicePlates, stiffener, supportFace, BEARING_T, EDGE, PINNED, SETBACK, SPLICE_HALF,
  type ConnType, type Geo, type P2, type Part, type Plate,
} from './steel.ts';
import { overlap } from './clash.ts';
import { BEAM_CONNS, findSection, type Specimen } from './specimen.ts';

export type Detail = 'members' | 'plates' | 'bolts';
export type Params = {
  seed: number;
  arms: number;
  height: number; // mm
  load: number; // line load on the arms, N/mm (= kN/m)
  fy: number; // MPa
  braceP: number;
  secondaryP: number;
  postP: number; // the chance of a post, on each beam that can take one
  beamSpliceP: number; // the chance of a splice, on each long bay beam (less on a box)
  seg: number;
  form: Form | 'mix'; // mix: the seed picks the form
  specimen?: Specimen; // a real test: seed, form, arms, height, braceP and secondaryP are not used
};
export const DEFAULTS: Params = { seed: 1, arms: 8, height: 2500, load: 100, fy: 345, braceP: 0.3, secondaryP: 0.35, postP: 0.3, beamSpliceP: 0.3, seg: 400, form: 'mix' };

export function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// a: where the brace meets the arm, measured from the column it starts on
// (the column at the `end` of the arm: 0 its start, 1 its far end). zb:
// where it meets that column, a height that stays put when sizing changes
// the depth of the arm.
type Brace = { a: number; zb: number; sec: Section; end: 0 | 1 };
// An arm starts on column `col`. A bay beam also ends on column `to`.
// splice: a bolted splice in a bay beam, that far along it (geometry only).
type Arm = {
  id: string; col: number; to?: number; z: number; bearing: number; L: number; conn: ConnType; conn2?: ConnType; sec: Section; braces: Brace[];
  truss?: Truss; rod?: Rod; post?: Post; splice?: number;
};
// A post on the top flange of a beam, `a` along it, `h` high from the top of
// the beam to the top of its cap plate. Free at the top, where it brings a
// point load into the beam.
type Post = { a: number; h: number; sec: Section };
// A Warren truss under an arm. The arm is its top chord. D: from the top of
// the arm down to the top of the bottom chord. The bottom chord starts on
// the column (a bay: runs to the other column) and ends at `end`, measured
// along the arm. Each web diagonal goes from `b` on the bottom chord to `t`
// on the top chord, both measured along the arm. `low`: a low truss (see
// LOW). `hMin`: the clear height the top chord must keep when it is sized.
type Web = { b: number; t: number; sec: Section };
type Truss = { D: number; end: number; chord: Section; conn: ConnType; conn2?: ConnType; webs: Web[]; low: boolean; hMin: number };
// A tension rod: from the column at height zr down to the top of the arm, `a` along it.
type Rod = { a: number; zr: number; sec: Section };
const chordId = (a: Arm) => `${a.id}-chord`;
const webId = (a: Arm, k: number) => `${a.id}-web${k + 1}`;
const rodId = (a: Arm) => `${a.id}-rod`;
const postId = (a: Arm) => `${a.id}-post`;
const farId = (a: Arm) => `${a.id}-far`;
const drop = (a: Arm, b: Brace) => a.z - a.sec.d - b.zb;
const braceId = (a: Arm, i: number) => `${a.id}-brace${i ? i + 1 : ''}`;
type Secondary = { id: string; arm: number; a: number; side: 1 | -1; L: number; conn: ConnType; sec: Section };
type Col = { x: V };
export type Form = 'tree' | 'portal' | 'box';
// A column splice: above z every column is the lighter section `sec`.
type Splice = { z: number; sec: Section; kind: 'bearing' | 'flange' };
// base: the gussets on the base plates, none, on the flange faces, or on all four faces
type Base = 'none' | 'flange' | 'all';
// id: the specimen id. continuity: false leaves out the continuity plates.
export type Structure = {
  form: Form | 'specimen'; id?: string; H: number; col: Section; cols: Col[]; arms: Arm[]; secs: Secondary[]; splice?: Splice; base?: Base; continuity?: boolean;
};
const colId = (i: number) => (i ? `column${i + 1}` : 'column');
const baseId = (i: number) => (i ? `base${i + 1}` : 'base');

const hdir = (bearing: number): V => [Math.sin((bearing * Math.PI) / 180), Math.cos((bearing * Math.PI) / 180), 0];
const mid = <T>(xs: T[]) => xs[Math.floor(xs.length / 2)];
const r50 = (x: number) => Math.round(x / 50) * 50;
const r150 = (x: number) => Math.round(x / 150) * 150;
// where the arm starts: on the axis of its column
const start = (st: Structure, a: Arm): V => add(st.cols[a.col].x, [0, 0, a.z]);

function pick<T extends string>(rng: () => number, w: Record<T, number>): T {
  const total = Object.values<number>(w).reduce((s, x) => s + x, 0);
  let x = rng() * total;
  for (const [k, v] of Object.entries<number>(w)) if ((x -= v) < 0) return k as T;
  return Object.keys(w)[0] as T;
}
const BEAM_CONN = { shear_tab: 0.4, end_plate: 0.2, flange_plates: 0.2, welded: 0.2 };

// every face of a column an arm lands on: its column, bearing and height
function faces(arms: Arm[]) {
  return arms.flatMap((a) => [
    { a, col: a.col, bearing: a.bearing, z: a.z },
    ...(a.to === undefined ? [] : [{ a, col: a.to, bearing: (a.bearing + 180) % 360, z: a.z }]),
  ]);
}

// ------------------------------------------------------------- topology
// tree: one column with arms (the first form, keep its random draws as they
// are so old seeds give the same structure)
function tree(p: Params, cat: Catalog, rng: () => number): Structure {
  const H = p.height;
  const arms: Arm[] = [];
  for (let k = 0, tries = 0; k < p.arms && tries < 200; tries++) {
    const z = Math.round((0.35 + 0.6 * rng()) * H / 150) * 150;
    const bearing = 90 * Math.floor(rng() * 4);
    // arms on the same side need room between them
    if (arms.some((a) => a.bearing === bearing && Math.abs(a.z - z) < 900)) continue;
    const L = r50((0.3 + 0.4 * rng()) * H);
    const conn = pick(rng, BEAM_CONN);
    arms.push({ id: `arm${k + 1}`, col: 0, z, bearing, L, conn, sec: mid(cat.beams), braces: [] });
    k++;
  }
  arms.sort((a, b) => a.z - b.z);
  arms.forEach((a, i) => (a.id = `arm${i + 1}`));
  for (const a of arms) if (rng() < p.braceP) addBrace(a, arms, cat);
  return { form: 'tree', H, col: mid(cat.columns), cols: [{ x: [0, 0, 0] }], arms, secs: secondaries(p, cat, rng, arms) };
}

function secondaries(p: Params, cat: Catalog, rng: () => number, arms: Arm[]): Secondary[] {
  const secs: Secondary[] = [];
  arms.forEach((a, i) => {
    if (rng() >= p.secondaryP) return;
    // on a bay beam, away from the columns and the knee braces
    const at = a.to === undefined ? 0.6 + 0.35 * rng() : 0.4 + 0.2 * rng();
    secs.push({
      id: `sec${secs.length + 1}`, arm: i, a: r50(at * a.L),
      side: rng() < 0.5 ? 1 : -1, L: r50((0.25 + 0.25 * rng()) * (a.to === undefined ? a.L : Math.min(a.L, p.height))),
      conn: pick(rng, { shear_tab: 0.6, end_plate: 0.25, welded: 0.15 }), sec: mid(cat.beams),
    });
  });
  return secs;
}

// portal: two columns and the beams between them, one or two storeys.
// box: four columns in a rectangle, so four walls. Nothing sticks out of
// them: no arms out of the columns, no secondary beams.
// Each bay storey gets its bracing: none (the connections take the
// moments), knee braces at both ends, a chevron (two braces up to the
// middle of the beam) or one diagonal. A portal also gets a few arms out of
// its columns.
function frame(form: 'portal' | 'box', p: Params, cat: Catalog, rng: () => number): Structure {
  const storeys = rng() < 0.4 ? 2 : 1;
  const H = r150(p.height * (storeys === 2 ? 1.5 : 1));
  const b0 = 90 * Math.floor(rng() * 4);
  const cols: Col[] = [{ x: [0, 0, 0] }];
  const bays: [number, number, number][] = []; // from column, to column, bearing
  const span = () => r50((0.8 + 0.5 * rng()) * p.height);
  if (form === 'portal') {
    cols.push({ x: mul(hdir(b0), span()) });
    bays.push([0, 1, b0]);
  } else {
    const b1 = (b0 + 90) % 360;
    const [u, v] = [mul(hdir(b0), span()), mul(hdir(b1), span())];
    cols.push({ x: u }, { x: v }, { x: add(u, v) });
    bays.push([0, 1, b0], [0, 2, b1], [1, 3, b1], [2, 3, b0]);
  }
  const levels = storeys === 2 ? [r150(0.5 * H), H - 150] : [H - 150];
  const arms: Arm[] = [];
  const bracing: string[] = [];
  for (const [i, j, bearing] of bays)
    for (const z of levels) {
      const L = Math.round(len(sub(cols[j].x, cols[i].x)));
      arms.push({ id: '', col: i, to: j, z, bearing, L, conn: pick(rng, BEAM_CONN), conn2: pick(rng, BEAM_CONN), sec: mid(cat.beams), braces: [] });
      bracing.push(pick(rng, { none: 0.2, knee: 0.3, chevron: 0.3, diagonal: 0.2 }));
    }
  // a few arms out of the columns, never on the side of a bay
  const nArms = form === 'box' ? 0 : Math.max(0, Math.min(3, Math.round((p.arms - arms.length) / 3)));
  for (let k = 0, tries = 0; k < nArms && tries < 100; tries++) {
    const col = Math.floor(rng() * cols.length);
    const bearing = 90 * Math.floor(rng() * 4);
    const z = r150((0.35 + 0.6 * rng()) * H);
    const L = r50((0.3 + 0.3 * rng()) * p.height);
    if (faces(arms).some((f) => f.col === col && f.bearing === bearing && (f.a.to !== undefined || Math.abs(f.z - z) < 900))) continue;
    arms.push({ id: '', col, z, bearing, L, conn: pick(rng, BEAM_CONN), sec: mid(cat.beams), braces: [] });
    k++;
  }
  arms.forEach((a, i) => (a.id = `arm${i + 1}`));
  // bracing, from the bottom storey up, so a brace knows the beams under it
  arms.forEach((a, i) => {
    const kind = bracing[i];
    if (kind === 'knee') addBrace(a, arms, cat, 0, 0.4) && addBrace(a, arms, cat, 1, 0.4);
    if (kind === 'chevron') addBrace(a, arms, cat, 0, 0, a.L / 2 - 250) && addBrace(a, arms, cat, 1, 0, a.L / 2 - 250);
    if (kind === 'diagonal') addBrace(a, arms, cat, rng() < 0.5 ? 0 : 1, 0, a.L - 500);
    if (kind === undefined && rng() < p.braceP) addBrace(a, arms, cat);
  });
  return { form, H, col: mid(cat.columns), cols, arms, secs: form === 'box' ? [] : secondaries(p, cat, rng, arms) };
}

// A brace under the arm, down to the column at its `end`. It must stay
// above the arms below it on the same face of that column (or it goes
// through them), and be long enough that its two gussets don't run into
// each other. A knee brace goes as far along the arm as down the column
// (at most `reach` of the arm). A brace with `along` set lands at that
// point of the arm, from as low as it can.
const BRACE_MIN = 1000; // mm, along the arm and down the column
function addBrace(a: Arm, arms: Arm[], cat: Catalog, end: 0 | 1 = 0, reach = 0.55, along = 0): boolean {
  const col = end ? a.to! : a.col;
  const bearing = end ? (a.bearing + 180) % 360 : a.bearing;
  const below = faces(arms).filter((f) => f.a !== a && f.col === col && f.bearing === bearing && f.z < a.z).map((f) => f.z + 600);
  const zb = Math.max(600, ...below);
  if (along) {
    // a steep brace: its gussets are far apart along it, the rule is on its length
    const dz = a.z - a.sec.d - zb;
    if (along < 500 || dz < 800 || Math.hypot(along, dz) < 1.4 * BRACE_MIN) return false;
    a.braces.push({ a: r50(along), zb, sec: mid(cat.tubes), end });
    return true;
  }
  const d = Math.min(reach * a.L, a.z - a.sec.d - zb);
  if (d < BRACE_MIN) return false;
  a.braces.push({ a: r50(d), zb: a.z - a.sec.d - d, sec: mid(cat.tubes), end });
  return true;
}

// ------------------------------------------------------------- trusses and rods
// They come after the fix loop, from a draw of their own, so a seed keeps
// its structure. A truss takes the place of the braces of its arm.
const H_MIN = 700; // mm, the clear height between the two chords
const NODE_GAP = 50; // two diagonals that meet at a node land this far on each side of it
const TUBE_MIN = 400; // mm, a diagonal between its two gussets: room for both knife plates
// the chance of a truss: a bay beam of a portal, a bay beam of a box (a box
// has 4 to 8 of them), an arm that sticks out
const TRUSS_P = { bay: 0.35, box: 0.1, arm: 0.3 };
// A low truss, for the arms of a tree: they are short, and close to the arm
// below on the same face. It takes the room under the arm, down to the floor
// or to the arm below, and its diagonals use the small gusset.
const LOW = { min: 450, max: 650, floor: 500, gap: 450, chord: 250, tube: 250 };
const ROD_P = 0.4;
// how far the face of the column is from its axis, for a beam on that bearing
const colFace = (st: Structure, bearing: number) => (bearing % 180 === 0 ? st.col.d / 2 : st.col.tw / 2);

// The faces of the columns a member at `a` lands on: its own, and the far one in a bay.
const endFaces = (a: Arm): [number, number][] => [[a.col, a.bearing], ...(a.to === undefined ? [] : [[a.to, (a.bearing + 180) % 360] as [number, number]])];

function trussFor(st: Structure, a: Arm, cat: Catalog, rng: () => number): Truss | undefined {
  const low = st.form === 'tree';
  // always the first draw, so a seed where no truss fits keeps its rods
  let h = low ? r50(LOW.min + (LOW.max - LOW.min) * rng()) : r50(H_MIN + 200 * rng());
  const ends = endFaces(a);
  const onFaces = faces(st.arms).filter((f) => f.a !== a && ends.some(([c, b]) => f.col === c && f.bearing === b) && f.z < a.z);
  if (low) {
    // the room under the arm: above the floor, and above the arms below it on its face
    const below = onFaces.map((f) => f.z + LOW.gap);
    h = Math.min(h, Math.floor((a.z - a.sec.d - Math.max(LOW.floor, ...below)) / 50) * 50);
    if (h < LOW.min) return undefined;
  }
  const D = a.sec.d + h;
  const zc = a.z - D;
  if (!low) {
    if (zc < 700) return undefined;
    // nothing else on the column faces it lands on, from the arm down to under the chord
    if (onFaces.some((f) => f.z > zc - 900)) return undefined;
  }
  // the nodes of the zigzag, along the arm, and which ones are on the top chord
  let xs: number[];
  let top: (k: number) => boolean;
  if (a.to !== undefined) {
    // a bay: from a bottom node near one column to a bottom node near the other
    const s0 = r50(colFace(st, a.bearing) + 400);
    const m = Math.max(1, Math.round((a.L - 2 * s0) / (2 * h)));
    const q = (a.L - 2 * s0) / (2 * m);
    if (q < 0.8 * h) return undefined;
    xs = [...Array(2 * m + 1).keys()].map((k) => s0 + k * q);
    top = (k) => k % 2 === 1;
  } else {
    // an arm: at least two diagonals, the last one up to the tip
    const s0 = r50(colFace(st, a.bearing) + 400);
    const span = a.L - 150 - s0;
    const n = Math.max(2, Math.round(span / h));
    const q = span / n;
    if (q < 0.6 * h) return undefined;
    xs = [...Array(n + 1).keys()].map((k) => s0 + k * q);
    top = (k) => (n - k) % 2 === 0;
  }
  const n = xs.length - 1;
  const web: ConnType = low ? 'gusset_small' : 'gusset';
  const webs: Web[] = [];
  for (let k = 0; k < n; k++) {
    const x0 = xs[k] + (k > 0 ? NODE_GAP : 0);
    const x1 = xs[k + 1] - (k + 1 < n ? NODE_GAP : 0);
    const [b, t] = top(k) ? [x1, x0] : [x0, x1];
    if ((Math.hypot(t - b, h) * (h - 2 * SETBACK[web])) / h < (low ? LOW.tube : TUBE_MIN)) return undefined;
    webs.push({ b: r50(b), t: r50(t), sec: mid(cat.tubes) });
  }
  const end = a.to !== undefined ? a.L : Math.max(...webs.map((w) => w.b)) + 300;
  const conn = () => pick(rng, { shear_tab: 0.6, end_plate: 0.4 }) as ConnType;
  return { D, end, chord: mid(cat.beams), conn: conn(), conn2: a.to !== undefined ? conn() : undefined, webs, low, hMin: low ? h : H_MIN };
}

// how high the room above an arm goes, on its face of the column: under the
// next arm on that face, under its truss and its braces
function roomAbove(st: Structure, a: Arm): number {
  let top = st.H - 250;
  for (const f of faces(st.arms)) {
    if (f.a === a || f.col !== a.col || f.bearing !== a.bearing || f.z <= a.z) continue;
    top = Math.min(top, f.z - f.a.sec.d - 300);
    if (f.a.truss) top = Math.min(top, f.z - f.a.truss.D - f.a.truss.chord.d - 300);
    const e = f.col === f.a.col && f.bearing === f.a.bearing ? 0 : 1;
    for (const b of f.a.braces) if (b.end === e) top = Math.min(top, b.zb - 300);
  }
  return top;
}

// a rod from the column down to an arm that sticks out, if the column above
// has room for it
function rodFor(st: Structure, a: Arm, cat: Catalog, rng: () => number): Rod | undefined {
  if (a.to !== undefined || a.braces.length || a.truss || a.L < 900) return undefined;
  const at = Math.min(r50(a.L * (0.65 + 0.2 * rng())), a.L - 150);
  const top = roomAbove(st, a);
  const zr = Math.min(a.z + r50(at * (0.7 + 0.5 * rng())), Math.floor(top / 50) * 50);
  if (zr - a.z < Math.max(400, 0.5 * at)) return undefined;
  return { a: at, zr, sec: cat.rods[Math.floor(cat.rods.length / 2)] };
}

// trusses first, so a rod knows the chords above it
function addTrussesAndRods(st: Structure, cat: Catalog, rng: () => number, log: string[]): boolean {
  let added = false;
  for (const a of st.arms) {
    const r = rng();
    const P = a.to === undefined ? TRUSS_P.arm : st.form === 'box' ? TRUSS_P.box : TRUSS_P.bay;
    if (r >= P || (a.to === undefined && a.L < 1400)) continue;
    const tr = trussFor(st, a, cat, rng);
    if (!tr) continue;
    a.truss = tr;
    a.braces = [];
    added = true;
    log.push(`${a.id}: truss, ${tr.webs.length} diagonals, ${tr.D} mm deep`);
  }
  for (const a of st.arms) {
    if (rng() >= ROD_P) continue;
    const rod = rodFor(st, a, cat, rng);
    if (!rod) continue;
    a.rod = rod;
    added = true;
    log.push(`${a.id}: tension rod, up to ${rod.zr} mm`);
  }
  return added;
}

// ------------------------------------------------------------- posts
// A short column on the top flange of a beam, free at the top, where it
// brings a point load into the beam. On an arm that sticks out (with room
// above it on its face, and no rod or truss), or on a bay beam of the top
// storey. At most POST_MAX in a structure.
const POST_MAX = 2;
const POST_LOAD = 800; // mm: the post carries the load of this much beam
const POST_PLATES = 20 + 16; // base plate and cap plate, mm
// the post fits on the beam: its flanges are not wider than the beam flange
const postFits = (s: Section, beam: Section) => s.bf <= beam.bf;
function addPosts(st: Structure, p: Params, cat: Catalog, rng: () => number, log: string[]): boolean {
  if (st.form === 'specimen' || p.postP <= 0) return false;
  const topZ = Math.max(...st.arms.filter((a) => a.to !== undefined).map((a) => a.z));
  let n = 0;
  for (const a of st.arms) {
    if (n >= POST_MAX) break;
    if (rng() >= p.postP) continue;
    const h0 = r50(400 + 500 * rng());
    const at = rng();
    if (a.truss || a.rod) continue;
    const bay = a.to !== undefined;
    if (bay && a.z !== topZ) continue;
    const h = bay ? h0 : Math.min(h0, Math.floor((roomAbove(st, a) - a.z) / 50) * 50);
    if (h < 400 + POST_PLATES) continue;
    const sec = cat.columns.find((s) => postFits(s, a.sec));
    if (!sec) continue;
    // a free spot along it, away from the end plates at the column, the
    // secondaries and the braces
    const end = colFace(st, a.bearing) + 350 + sec.d / 2 + 2 * EDGE;
    const t0 = Math.max(end, bay ? 0.3 * a.L : 0.5 * a.L);
    const t1 = Math.min(bay ? a.L - end : a.L - 150, bay ? 0.7 * a.L : a.L);
    const busy = [
      ...st.secs.filter((s) => st.arms[s.arm] === a).map((s) => s.a),
      ...a.braces.map((b) => (b.end ? a.L - b.a : b.a)),
    ];
    const ok: number[] = [];
    for (let t = Math.ceil(t0 / 50) * 50; t <= t1; t += 50) if (busy.every((x) => Math.abs(x - t) >= 300)) ok.push(t);
    if (!ok.length) continue;
    a.post = { a: ok[Math.floor(at * ok.length)], h, sec };
    n++;
    log.push(`${a.id}: post at ${a.post.a} mm, ${h} mm high`);
  }
  return n > 0;
}

// The sections of a structure, to go back to them: the references, not a
// copy (sizeTop compares sections with ===).
function snapshot(st: Structure) {
  return {
    col: st.col,
    arms: st.arms.map((a) => ({
      sec: a.sec, braces: a.braces.map((b) => b.sec), rod: a.rod?.sec, chord: a.truss?.chord, webs: a.truss?.webs.map((w) => w.sec),
    })),
    secs: st.secs.map((s) => s.sec),
  };
}
function restore(st: Structure, k: ReturnType<typeof snapshot>) {
  st.col = k.col;
  st.arms.forEach((a, i) => {
    const r = k.arms[i];
    a.sec = r.sec;
    a.braces.forEach((b, j) => (b.sec = r.braces[j]));
    if (a.rod) a.rod.sec = r.rod!;
    if (a.truss) {
      a.truss.chord = r.chord!;
      a.truss.webs.forEach((w, j) => (w.sec = r.webs![j]));
    }
  });
  st.secs.forEach((s, i) => (s.sec = k.secs[i]));
}

// ------------------------------------------------------------- beam splice
// A bolted splice in a long bay beam: plates on both flanges and on the web,
// like the flange splice of a column. It is a full strength splice, so the
// solver keeps the beam in one piece. Between 20 and 40 % of the span from
// one end, where the moment is small in a beam fixed at both ends, and clear
// of the end connections, the braces, the secondary beams and a post.
const SPLICE_BEAM_MIN = 2000; // mm
function addBeamSplices(st: Structure, p: Params, rng: () => number, log: string[]) {
  if (st.form === 'specimen' || p.beamSpliceP <= 0) return;
  const P = p.beamSpliceP * (st.form === 'box' ? 0.4 : 1);
  st.arms.forEach((a, i) => {
    const r = rng();
    const pick = rng();
    if (r >= P || a.to === undefined || a.truss || a.L < SPLICE_BEAM_MIN) return;
    const end = colFace(st, a.bearing) + 350 + SPLICE_HALF;
    const busy: [number, number][] = [
      ...a.braces.map((b): [number, number] => {
        // its gusset reaches up to about 340 mm along the beam
        const x = b.end ? a.L - b.a : b.a;
        return [x - 350, x + 350];
      }),
      ...st.secs.filter((s) => s.arm === i).map((s): [number, number] => [s.a - s.sec.bf / 2 - 150, s.a + s.sec.bf / 2 + 150]),
    ];
    if (a.post) {
      const half = a.post.sec.d / 2 + 2 * EDGE + 50;
      busy.push([a.post.a - half, a.post.a + half]);
    }
    const ok: number[] = [];
    for (let t = Math.ceil(0.2 * a.L / 25) * 25; t <= a.L - 0.2 * a.L; t += 25) {
      if (t > 0.4 * a.L && t < 0.6 * a.L) continue;
      if (t < end || t > a.L - end) continue;
      if (busy.some(([lo, hi]) => t + SPLICE_HALF > lo && t - SPLICE_HALF < hi)) continue;
      ok.push(t);
    }
    if (!ok.length) return;
    a.splice = ok[Math.floor(pick * ok.length)];
    log.push(`${a.id}: beam splice at ${a.splice} mm`);
  });
}

// a real test specimen: one column and its beams, all given (specimen.ts)
function specimen(spec: Specimen, cat: Catalog): Structure {
  const H = spec.column.height;
  const bad = (msg: string) => new Error(`${spec.id}: ${msg}`);
  if (!(H > 0)) throw bad(`the column height must be above 0, not ${JSON.stringify(H)}`);
  const col = findSection(spec.column.section, cat);
  const arms: Arm[] = (spec.beams ?? []).map((b, i) => {
    const id = `beam${i + 1}`;
    const sec = findSection(b.section, cat);
    if (![0, 90, 180, 270].includes(b.bearing)) throw bad(`${id}: bearing must be 0, 90, 180 or 270, not ${JSON.stringify(b.bearing)}`);
    if (!BEAM_CONNS.includes(b.connection)) throw bad(`${id}: connection must be one of ${BEAM_CONNS.join(', ')}, not ${JSON.stringify(b.connection)}`);
    const onWeb = b.bearing % 180 === 90;
    // the column face the beam lands on, from the column axis
    const face = onWeb ? (col.kind === 'I' ? col.tw / 2 : col.bf / 2) : col.d / 2;
    if (!(b.length > face + 100)) throw bad(`${id}: length ${b.length} mm is too short, the column face is at ${face} mm from its axis`);
    if (onWeb && col.kind === 'I' && sec.bf + 20 > col.d - 2 * col.tf) throw bad(`${id}: the beam (bf ${sec.bf} mm) does not fit between the column flanges`);
    const z = (b.at ?? H / 2) + sec.d / 2; // top of steel
    if (z > H || z - sec.d < 0) throw bad(`${id}: the beam is not inside the column height (0 to ${H} mm)`);
    return { id, col: 0, z, bearing: b.bearing, L: b.length, conn: b.connection, sec, braces: [] };
  });
  for (const a of arms)
    for (const o of arms)
      if (a !== o && a.bearing === o.bearing && a.z - a.sec.d < o.z && o.z - o.sec.d < a.z) throw bad(`${a.id} and ${o.id} are on the same face at the same height`);
  return { form: 'specimen', id: spec.id, H, col, cols: [{ x: [0, 0, 0] }], arms, secs: [], base: 'none', continuity: spec.continuity };
}

// ------------------------------------------------------------- analysis
type Model = { nodes: FNode[]; elems: Elem[]; owner: string[]; nodeOwner: string[][] };

function model(st: Structure, p: Params): Model {
  const nodes: FNode[] = [];
  const elems: Elem[] = [];
  const owner: string[] = [];
  const nodeOwner: string[][] = [];
  const node = (x: V, who: string, fixed = false) => {
    let i = nodes.findIndex((n) => Math.hypot(...sub(n.x, x)) < 1);
    if (i < 0) {
      i = nodes.push({ x, fixed }) - 1;
      nodeOwner.push([]);
    }
    if (!nodeOwner[i].includes(who)) nodeOwner[i].push(who);
    return i;
  };
  const w = (s: Section) => s.A * 7.7e-5; // self weight, N/mm
  const chain = (who: string, pts: V[], s: Section, pinFirst: boolean, q: number, pinLast = false) => {
    const ids = pts.map((x) => node(x, who));
    for (let k = 0; k + 1 < ids.length; k++) {
      elems.push({ i: ids[k], j: ids[k + 1], p: s, pinI: k === 0 && pinFirst, pinJ: k === ids.length - 2 && pinLast, q: [0, 0, -q] });
      owner.push(who);
    }
  };
  // each column, cut at every level something lands on, and at the splice
  const sp = st.splice;
  st.cols.forEach((c, ci) => {
    const zs = new Set([0, st.H]);
    if (sp) zs.add(sp.z);
    for (const a of st.arms) {
      if (a.col === ci || a.to === ci) {
        zs.add(a.z);
        if (a.truss) zs.add(a.z - a.truss.D);
      }
      if (a.rod && a.col === ci) zs.add(a.rod.zr);
      for (const b of a.braces) if ((b.end ? a.to : a.col) === ci) zs.add(b.zb);
    }
    node(c.x, 'column', true);
    const z = [...zs].sort((x, y) => x - y);
    for (let k = 0; k + 1 < z.length; k++) {
      const top = sp !== undefined && z[k] >= sp.z;
      const [who, s] = top ? ['column-top', sp.sec] : ['column', st.col];
      elems.push({ i: node(add(c.x, [0, 0, z[k]]), who), j: node(add(c.x, [0, 0, z[k + 1]]), who), p: s, pinI: false, pinJ: false, q: [0, 0, -w(s)] });
      owner.push(who);
    }
  });
  st.arms.forEach((a, i) => {
    const h = hdir(a.bearing);
    const o = start(st, a);
    const at = new Set([0, a.L]);
    for (const b of a.braces) at.add(b.end ? a.L - b.a : b.a);
    for (const s of st.secs) if (s.arm === i) at.add(s.a);
    for (const wb of a.truss?.webs ?? []) at.add(wb.t);
    if (a.rod) at.add(a.rod.a);
    if (a.post) at.add(a.post.a);
    const pts = [...at].sort((x, y) => x - y).map((t) => add(o, mul(h, t)));
    chain(a.id, pts, a.sec, PINNED.includes(a.conn), w(a.sec) + p.load, a.conn2 !== undefined && PINNED.includes(a.conn2));
    const tr = a.truss;
    if (tr) {
      // the bottom chord carries only its own weight
      const oc = add(o, [0, 0, -tr.D]);
      const cs = [...new Set([0, tr.end, ...tr.webs.map((wb) => wb.b)])].sort((x, y) => x - y).map((t) => add(oc, mul(h, t)));
      chain(chordId(a), cs, tr.chord, PINNED.includes(tr.conn), w(tr.chord), tr.conn2 !== undefined && PINNED.includes(tr.conn2));
      tr.webs.forEach((wb, k) => {
        const id = webId(a, k);
        elems.push({ i: node(add(oc, mul(h, wb.b)), id), j: node(add(o, mul(h, wb.t)), id), p: wb.sec, pinI: true, pinJ: true, q: [0, 0, -w(wb.sec)] });
        owner.push(id);
      });
    }
    if (a.rod) {
      const id = rodId(a);
      elems.push({ i: node(add(st.cols[a.col].x, [0, 0, a.rod.zr]), id), j: node(add(o, mul(h, a.rod.a)), id), p: a.rod.sec, pinI: true, pinJ: true, q: [0, 0, -w(a.rod.sec)] });
      owner.push(id);
    }
    if (a.post) {
      // fixed on the beam, free at the top, with a point load there
      const id = postId(a);
      const b0 = add(o, mul(h, a.post.a));
      const top = node(add(b0, [0, 0, a.post.h]), id);
      nodes[top].f = [0, 0, -p.load * POST_LOAD];
      elems.push({ i: node(b0, id), j: top, p: a.post.sec, pinI: false, pinJ: false, q: [0, 0, -w(a.post.sec)] });
      owner.push(id);
    }
    a.braces.forEach((b, k) => {
      const b0 = add(st.cols[b.end ? a.to! : a.col].x, [0, 0, b.zb]);
      const b1 = add(o, mul(h, b.end ? a.L - b.a : b.a));
      const id = braceId(a, k);
      elems.push({ i: node(b0, id), j: node(b1, id), p: b.sec, pinI: true, pinJ: true, q: [0, 0, -w(b.sec)] });
      owner.push(id);
    });
  });
  for (const s of st.secs) {
    const a = st.arms[s.arm];
    const h = hdir(a.bearing);
    const side: V = mul([h[1], -h[0], 0], s.side);
    const p0 = add(start(st, a), mul(h, s.a));
    chain(s.id, [p0, add(p0, mul(side, s.L))], s.sec, PINNED.includes(s.conn), w(s.sec) + p.load / 2);
  }
  return { nodes, elems, owner, nodeOwner };
}

// a mechanism at a node: fix the pinned connection highest up the support
// chain of the members that meet there (arm before its secondary)
function fix(st: Structure, m: Model, nodeIdx: number, cat: Catalog, rng: () => number, log: string[]): boolean {
  const who = m.nodeOwner[nodeIdx];
  const arms = st.arms.filter((a) => who.includes(a.id) || st.secs.some((s) => who.includes(s.id) && st.arms[s.arm] === a));
  for (const a of arms) {
    if (PINNED.includes(a.conn)) {
      if (!a.braces.length && rng() < 0.5 && addBrace(a, st.arms, cat, 0, a.to === undefined ? 0.55 : 0.4)) {
        log.push(`${a.id}: mechanism, added a brace`);
        return true;
      }
      a.conn = pick(rng, { end_plate: 1, flange_plates: 1, welded: 1 });
      log.push(`${a.id}: mechanism, shear tab -> ${a.conn}`);
      return true;
    }
    if (a.conn2 && PINNED.includes(a.conn2)) {
      a.conn2 = pick(rng, { end_plate: 1, flange_plates: 1, welded: 1 });
      log.push(`${a.id}: mechanism, far end shear tab -> ${a.conn2}`);
      return true;
    }
  }
  for (const s of st.secs.filter((s) => who.includes(s.id))) {
    if (!PINNED.includes(s.conn)) continue;
    s.conn = rng() < 0.6 ? 'end_plate' : 'welded';
    log.push(`${s.id}: mechanism, shear tab -> ${s.conn}`);
    return true;
  }
  return false;
}

// ------------------------------------------------------------- sizing
const LIMIT = 0.6;
type Forces = { N: number; My: number; Mz: number };
const ratioOf = (s: Section, f: Forces, fy: number) => f.N / (s.A * fy) + f.My / (s.Ws * fy) + f.Mz / (s.Ww * fy);
function worstOf(m: Model, res: Forces[]) {
  const worst = new Map<string, Forces>();
  m.owner.forEach((who, i) => {
    const w = worst.get(who) ?? { N: 0, My: 0, Mz: 0 };
    worst.set(who, { N: Math.max(w.N, res[i].N), My: Math.max(w.My, res[i].My), Mz: Math.max(w.Mz, res[i].Mz) });
  });
  return worst;
}
// beams that frame into the column web (above `z`) must fit between its flanges
const webClear = (arms: Arm[], z = -Infinity) => Math.max(0, ...arms.filter((a) => a.bearing % 180 === 90).flatMap((a) => [
  ...(a.z - a.sec.d > z ? [a.sec.bf + 40] : []),
  ...(a.truss && a.z - a.truss.D - a.truss.chord.d > z ? [a.truss.chord.bf + 40] : []),
]));

function size(st: Structure, m: Model, res: { N: number; My: number; Mz: number }[], cat: Catalog, fy: number, check = false): number {
  const worst = worstOf(m, res);
  const ratio = (s: Section, f: Forces) => ratioOf(s, f, fy);
  let maxRatio = 0;
  // the lightest section that works; in check mode, the current one is kept
  const choose = (list: Section[], who: string, cur: Section, ok: (s: Section) => boolean = () => true) => {
    const f = worst.get(who)!;
    // none works: the heaviest one that keeps the rule
    const s = check ? cur : (list.find((s) => ok(s) && ratio(s, f) < LIMIT) ?? list.findLast(ok) ?? list[list.length - 1]);
    maxRatio = Math.max(maxRatio, ratio(s, f));
    return s;
  };
  for (const a of st.arms) {
    // a top chord keeps the clear height of its truss
    a.sec = choose(cat.beams, a.id, a.sec, (s) => s.d >= 200 && (!a.truss || a.truss.D - s.d >= a.truss.hMin));
    const tr = a.truss;
    if (tr) {
      tr.chord = choose(cat.beams, chordId(a), tr.chord, (s) => s.d >= 150 && s.d <= (tr.low ? LOW.chord : Math.max(a.sec.d, 360)));
      tr.webs.forEach((wb, k) => {
        const L = Math.hypot(wb.t - wb.b, tr.D - a.sec.d);
        wb.sec = choose(cat.tubes, webId(a, k), wb.sec, (s) => L / s.rmin < 200);
      });
    }
    if (a.rod) a.rod.sec = choose(cat.rods, rodId(a), a.rod.sec);
    const post = a.post;
    if (post) {
      // if no post fits on the beam any more, not a heavier one than now
      const sec = a.sec;
      const fits = cat.columns.some((s) => postFits(s, sec));
      post.sec = choose(cat.columns, postId(a), post.sec, (s) => (fits ? postFits(s, sec) : s.A <= post.sec.A));
    }
    a.braces.forEach((b, k) => {
      const L = Math.hypot(b.a, drop(a, b));
      b.sec = choose(cat.tubes, braceId(a, k), b.sec, (s) => L / s.rmin < 200);
    });
  }
  for (const s of st.secs) {
    const arm = st.arms[s.arm];
    s.sec = choose(cat.beams, s.id, s.sec, (x) => x.d <= arm.sec.d - 2 * arm.sec.tf);
  }
  const needClear = webClear(st.arms);
  st.col = choose(cat.columns, 'column', st.col, (c) => c.d - 2 * c.tf >= needClear && c.d >= 250);
  // the upper shaft is sized by sizeTop, here it is only checked
  const top = worst.get('column-top');
  if (st.splice && top) maxRatio = Math.max(maxRatio, ratio(st.splice.sec, top));
  return maxRatio;
}

// ------------------------------------------------------------- details
// Details that don't change the topology. They come from their own random
// draws, so a seed keeps its structure and only gets the details on top.

// A column splice, on about 6 structures in 10: one level for all the
// columns, between 30 and 70 % of the height, well clear of anything that
// lands on a column there.
const SPLICE_P = 0.6;
const SPLICE_GAP = 50; // mm, free height kept above and below the splice plates
function pickSplice(st: Structure, rng: () => number): Splice | undefined {
  if (rng() >= SPLICE_P || st.H < 2000) return undefined;
  const kind = rng() < 0.5 ? 'bearing' : 'flange';
  // the height the plates take, around the cut
  const [below, above] = kind === 'bearing' ? [0, BEARING_T] : [SPLICE_HALF, SPLICE_HALF];
  const busy: [number, number][] = [[0, 400]];
  for (const a of st.arms) {
    // an extended end plate reaches 90 mm past the flanges, flange plates 16
    const ext = [a.conn, a.conn2].includes('end_plate') ? 90 : 16;
    busy.push([a.z - a.sec.d - ext, a.z + ext]);
    for (const b of a.braces) busy.push([b.zb - 300, b.zb + 300]);
    if (a.truss) {
      const zc = a.z - a.truss.D;
      const e = [a.truss.conn, a.truss.conn2].includes('end_plate') ? 90 : 16;
      busy.push([zc - a.truss.chord.d - e, zc + e]);
    }
    if (a.rod) busy.push([a.rod.zr - 400, a.rod.zr + 100]);
  }
  const ok: number[] = [];
  for (let z = r50(0.3 * st.H); z <= 0.7 * st.H; z += 50)
    if (busy.every(([lo, hi]) => z + above + SPLICE_GAP <= lo || z - below - SPLICE_GAP >= hi)) ok.push(z);
  if (!ok.length) return undefined;
  return { z: ok[Math.floor(rng() * ok.length)], sec: st.col, kind };
}

// the upper shaft: the lightest section, not heavier than the lower one,
// that takes the forces above the splice and leaves room for the beams that
// frame into its web
function sizeTop(st: Structure, m: Model, res: Forces[], cat: Catalog, fy: number) {
  const sp = st.splice!;
  const f = worstOf(m, res).get('column-top')!;
  const need = webClear(st.arms, sp.z);
  sp.sec = cat.columns.find((s) => s.A <= st.col.A && s.d >= 200 && s.d - 2 * s.tf >= need && ratioOf(s, f, fy) < LIMIT) ?? st.col;
  // the same section above and below: no reason to splice
  if (sp.sec === st.col) st.splice = undefined;
  // a flange splice between two very different depths needs thick fills: bear instead
  else if (Math.abs(st.col.d - sp.sec.d) / 2 > 25) sp.kind = 'bearing';
}

// ------------------------------------------------------------- geometry
function parts(st: Structure, detail: Detail, seg: number): Part[] {
  const out: Part[] = [];
  let step = 0;
  const plates = detail !== 'members';
  const bolts = detail === 'bolts';
  const tb = 40;
  const sp = st.splice;
  // the details added at the end: each goes right after the part it stands on
  const extras: { after: string; part: Part }[] = [];
  const extra = (id: string, on: string, ps: Plate[], from: V) => {
    if (plates && ps.length) extras.push({ after: on, part: { id, step: 0, supports: [on], kind: 'plate', from, faces: ps.flatMap((q) => q.faces), boxes: ps.map((q) => q.box), dots: [] } });
  };
  // each column: its lower shaft and, above a splice, its upper shaft
  const cols = st.cols.map((c, ci) => {
    const at = (z: number) => add(c.x, [0, 0, z]);
    const lo = geo(colId(ci), st.col, c.x, at(sp ? sp.z : st.H), false);
    const centre = add(c.x, [0, 0, -tb / 2]);
    out.push({
      id: baseId(ci), step: step++, supports: [], kind: 'base', from: [0, 0, -1],
      faces: box3(centre, [0, 1, 0], [0, 0, 1], st.col.bf + 150, st.col.d + 150, tb),
      boxes: [boxOf(centre, [0, 1, 0], [0, 0, 1], st.col.bf + 150, st.col.d + 150, tb)],
      dots: bolts ? [-1, 1].flatMap((sx) => [-1, 1].map((sy) => ({ p: add(c.x, [sx * (st.col.bf / 2 + 40), sy * (st.col.d / 2 + 40), 1]), n: [0, 0, 1] as V }))) : [],
    });
    out.push({ id: lo.id, step: step++, supports: [baseId(ci)], kind: 'column', from: [0, 0, 1], faces: memberFaces(lo, seg), boxes: memberBoxes(lo), dots: [] });
    if (!sp) return { lo, hi: lo };
    const hi = geo(`${colId(ci)}-top`, sp.sec, at(sp.z + (sp.kind === 'bearing' ? BEARING_T : 0)), at(st.H), false);
    const sid = `${colId(ci)}-splice`;
    const k = splicePlates(lo, hi, sp.kind);
    // without the plates, the upper shaft stands on the lower one
    if (plates) out.push({ id: sid, step: step++, supports: [lo.id], kind: 'plate', from: [0, 0, 1], faces: k.faces, boxes: k.boxes, dots: [] });
    out.push({ id: hi.id, step: step++, supports: [plates ? sid : lo.id], kind: 'column', from: [0, 0, 1], faces: memberFaces(hi, seg), boxes: memberBoxes(hi), dots: [] });
    if (bolts) out.push({ id: `${sid}-bolts`, step: step++, supports: [hi.id, sid], kind: 'bolts', faces: [], dots: k.dots });
    return { lo, hi };
  });
  // the shaft of column ci at height z
  const colAt = (ci: number, z: number) => (sp && z > sp.z ? cols[ci].hi : cols[ci].lo);

  // one member and its end connections, in build order: plates, member, bolts
  type End = { S: Geo; sId: string; conn: ConnType; at: 'from' | 'to' };
  // from: the direction the member (and its plates) come from
  const member = (g: Geo, ends: End[], from: V) => {
    const rs = ends.map((e) => resolve(g, e.S, e.at));
    g.copes = rs.flatMap((r) => (r.cope ? [r.cope] : []));
    const hws = ends.map((e, i) => ({ e, hw: hardware(g, e.conn, rs[i]) }));
    const supports: string[] = [];
    for (const { e, hw } of hws) {
      if (plates && hw.faces.length) {
        out.push({ id: `${g.id}-${e.at}-conn`, step: step++, supports: [e.sId], kind: 'plate', from, faces: hw.faces, boxes: hw.boxes, dots: [] });
        supports.push(`${g.id}-${e.at}-conn`);
      } else supports.push(e.sId);
    }
    const Lg = len(sub(g.p1, g.p0));
    const cuts = hws.flatMap(({ e, hw }) => hw.reach.map((x) => (e.at === 'from' ? x : Lg - x)));
    out.push({ id: g.id, step: step++, supports, kind: 'member', from, faces: memberFaces(g, seg, cuts), boxes: memberBoxes(g), dots: [] });
    const dots = hws.flatMap(({ hw }) => hw.dots);
    if (bolts && dots.length) out.push({ id: `${g.id}-bolts`, step: step++, supports: [g.id, ...supports], kind: 'bolts', faces: [], dots });
  };

  const armGeo = new Map<string, Geo>();
  // a post on the top flange at T, on the beam piece P: base plate, post, cap, bolts
  const post = (a: Arm, T: V, P: Geo) => {
    const { h, sec } = a.post!;
    const up: V = [0, 0, 1];
    const u = P.u;
    const across = Math.max(P.sec.bf, sec.bf);
    const along = sec.d + 4 * EDGE;
    const bid = `${postId(a)}-base`;
    const bc = add(T, [0, 0, 10]);
    if (plates) out.push({ id: bid, step: step++, supports: [P.id], kind: 'plate', from: up, faces: box3(bc, up, u, across, 20, along), boxes: [boxOf(bc, up, u, across, 20, along)], dots: [] });
    // the web along the beam, so the flanges sit across it
    const pg = geo(postId(a), sec, add(T, [0, 0, 20]), add(T, [0, 0, h - 16]), false);
    pg.w = u;
    pg.v = cross(u, pg.u);
    out.push({ id: pg.id, step: step++, supports: [plates ? bid : P.id], kind: 'member', from: up, faces: memberFaces(pg, seg), boxes: memberBoxes(pg), dots: [] });
    const cc = add(T, [0, 0, h - 8]);
    if (plates) out.push({ id: `${postId(a)}-cap`, step: step++, supports: [pg.id], kind: 'plate', from: up, faces: box3(cc, up, u, sec.bf + 20, 16, sec.d + 20), boxes: [boxOf(cc, up, u, sec.bf + 20, 16, sec.d + 20)], dots: [] });
    const gauge = Math.max(50, P.sec.bf - 2 * EDGE);
    const v = cross(up, u);
    const dots = [-1, 1].flatMap((su) => [-1, 1].map((sv) => ({ p: add(add(add(T, mul(u, su * (sec.d / 2 + EDGE))), mul(v, (sv * gauge) / 2)), [0, 0, 21]), n: up })));
    if (bolts) out.push({ id: `${postId(a)}-bolts`, step: step++, supports: [pg.id, bid], kind: 'bolts', faces: [], dots });
  };
  for (const a of st.arms) {
    const h = hdir(a.bearing);
    const o = start(st, a);
    const zm = a.z - a.sec.d / 2;
    const S = colAt(a.col, zm);
    const p0 = add(o, mul(h, supportFace(S, h) + SETBACK[a.conn]));
    const ends: End[] = [{ S, sId: S.id, conn: a.conn, at: 'from' }];
    let p1 = add(o, mul(h, a.L));
    if (a.to !== undefined) {
      const Sj = colAt(a.to, zm);
      p1 = add(p1, mul(h, -(supportFace(Sj, mul(h, -1)) + SETBACK[a.conn2!])));
      ends.push({ S: Sj, sId: Sj.id, conn: a.conn2!, at: 'to' });
    }
    const g = geo(a.id, a.sec, p0, p1, true);
    // an arm slides in along its axis, a bay beam is lowered between its columns
    if (a.splice === undefined) {
      armGeo.set(a.id, g);
      member(g, ends, a.to === undefined ? h : [0, 0, 1]);
    } else {
      // two pieces, each on its column, then the splice plates on both
      const cut = add(o, mul(h, a.splice));
      const g1 = geo(a.id, a.sec, p0, cut, true);
      const g2 = geo(farId(a), a.sec, cut, p1, true);
      armGeo.set(g1.id, g1);
      armGeo.set(g2.id, g2);
      member(g1, [ends[0]], [0, 0, 1]);
      member(g2, [ends[1]], [0, 0, 1]);
      const sid = `${a.id}-splice`;
      const k = splicePlates(g1, g2, 'flange');
      if (plates) out.push({ id: sid, step: step++, supports: [g1.id, g2.id], kind: 'plate', from: [0, 0, 1], faces: k.faces, boxes: k.boxes, dots: [] });
      if (bolts) out.push({ id: `${sid}-bolts`, step: step++, supports: [g2.id, sid], kind: 'bolts', faces: [], dots: k.dots });
    }
    if (a.post) post(a, add(o, mul(h, a.post.a)), pieceAt(armGeo, a, a.post.a));
    a.braces.forEach((b, k) => {
      const hb = b.end ? mul(h, -1) : h; // from its column, toward the arm
      const B = add(st.cols[b.end ? a.to! : a.col].x, [0, 0, b.zb]);
      const C = add(add(o, mul(h, b.end ? a.L - b.a : b.a)), [0, 0, -a.sec.d]);
      const u = sub(C, B);
      const L = Math.hypot(...u);
      const un = mul(u, 1 / L);
      const Sb = colAt(b.end ? a.to! : a.col, b.zb);
      const t0 = (supportFace(Sb, hb) + SETBACK.gusset) / (un[0] * hb[0] + un[1] * hb[1]);
      const t1 = SETBACK.gusset / un[2];
      const bg = geo(braceId(a, k), b.sec, add(B, mul(un, t0)), sub(C, mul(un, t1)), false);
      const P = pieceAt(armGeo, a, b.end ? a.L - b.a : b.a);
      member(bg, [
        { S: Sb, sId: Sb.id, conn: 'gusset', at: 'from' },
        { S: P, sId: P.id, conn: 'gusset', at: 'to' },
      ], a.to === undefined ? hb : [h[1], -h[0], 0]); // from outside, level; in a bay, from the side
    });
    const tr = a.truss;
    if (tr) {
      // the bottom chord, on the column like the arm, then the diagonals between the two chords
      const oc = add(o, [0, 0, -tr.D]);
      const zcm = a.z - tr.D - tr.chord.d / 2;
      const Sc = colAt(a.col, zcm);
      const cEnds: End[] = [{ S: Sc, sId: Sc.id, conn: tr.conn, at: 'from' }];
      let c1 = add(oc, mul(h, tr.end));
      if (a.to !== undefined) {
        const Sj = colAt(a.to, zcm);
        c1 = add(c1, mul(h, -(supportFace(Sj, mul(h, -1)) + SETBACK[tr.conn2!])));
        cEnds.push({ S: Sj, sId: Sj.id, conn: tr.conn2!, at: 'to' });
      }
      const cg = geo(chordId(a), tr.chord, add(oc, mul(h, supportFace(Sc, h) + SETBACK[tr.conn])), c1, true);
      armGeo.set(cg.id, cg);
      member(cg, cEnds, a.to === undefined ? h : [0, 0, 1]);
      const web: ConnType = tr.low ? 'gusset_small' : 'gusset';
      tr.webs.forEach((wb, k) => {
        const B = add(oc, mul(h, wb.b));
        const C = add(add(o, mul(h, wb.t)), [0, 0, -a.sec.d]);
        const un = norm(sub(C, B));
        const t = SETBACK[web] / un[2];
        const wg = geo(webId(a, k), wb.sec, add(B, mul(un, t)), sub(C, mul(un, t)), false);
        member(wg, [
          { S: cg, sId: cg.id, conn: web, at: 'from' },
          { S: g, sId: a.id, conn: web, at: 'to' },
        ], [h[1], -h[0], 0]);
      });
    }
    if (a.rod) {
      // from the column down to the top flange, a clevis at both ends
      const Sr = colAt(a.col, a.rod.zr);
      const R = add(st.cols[a.col].x, [0, 0, a.rod.zr]);
      const A = add(o, mul(h, a.rod.a));
      const un = norm(sub(A, R));
      const t0 = (supportFace(Sr, h) + SETBACK.clevis) / (un[0] * h[0] + un[1] * h[1]);
      const t1 = SETBACK.clevis / -un[2];
      const rg = geo(rodId(a), a.rod.sec, add(R, mul(un, t0)), sub(A, mul(un, t1)), false);
      member(rg, [
        { S: Sr, sId: Sr.id, conn: 'clevis', at: 'from' },
        { S: g, sId: a.id, conn: 'clevis', at: 'to' },
      ], h);
    }
  }
  for (const s of st.secs) {
    const a = st.arms[s.arm];
    const ag = pieceAt(armGeo, a, s.a);
    const side = mul(ag.v, s.side);
    const at = add(start(st, a), mul(hdir(a.bearing), s.a));
    const g = geo(s.id, s.sec, add(at, mul(side, supportFace(ag, side) + SETBACK[s.conn])), add(at, mul(side, s.L)), true);
    member(g, [{ S: ag, sId: ag.id, conn: s.conn, at: 'from' }], side);
  }
  details(st, cols, armGeo, colAt, extra);

  // keep the details that fit: one that goes through a part already there is left out
  const kept: Part[] = [];
  const boxes = out.flatMap((q) => q.boxes ?? []);
  for (const { part } of extras) {
    if (part.boxes!.some((a) => boxes.some((b) => overlap(a, b)))) continue;
    boxes.push(...part.boxes!);
    kept.push(part);
  }
  const res: Part[] = [];
  for (const q of out) {
    res.push(q);
    res.push(...kept.filter((k) => extras.find((e) => e.part === k)!.after === q.id));
  }
  res.forEach((q, i) => (q.step = i));
  return res;
}

// the piece of a beam at t mm along it: the far piece after a beam splice
const pieceAt = (armGeo: Map<string, Geo>, a: Arm, t: number): Geo =>
  armGeo.get(a.splice !== undefined && t > a.splice ? farId(a) : a.id)!;

// The small plates that make a frame look built: a cap on each column, plates
// across the column where a moment beam pulls on its flanges, stiffeners in a
// beam where a brace pushes up, gussets at the column feet.
const MOMENT: ConnType[] = ['end_plate', 'flange_plates', 'welded'];
function details(
  st: Structure, cols: { lo: Geo; hi: Geo }[], armGeo: Map<string, Geo>, colAt: (ci: number, z: number) => Geo,
  extra: (id: string, on: string, ps: Plate[], from: V) => void,
) {
  const [X, Y, Z]: V[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const down: V = [0, 0, -1];
  st.cols.forEach((c, ci) => {
    const { lo, hi } = cols[ci];
    const id = colId(ci);
    // cap plate
    const cap = add(hi.p1, [0, 0, 10]);
    extra(`${id}-cap`, hi.id, [flat(cap, X, Y, 20, rect(hi.sec.bf + 30, hi.sec.d + 30))], down);
    // continuity plates, at the flange levels of each moment beam on a flange face
    const levels: number[] = [];
    // each beam end on a column: column, connection, bearing, top of steel, section
    const beamEnds = st.arms.flatMap((a) => [
      [a.col, a.conn, a.bearing, a.z, a.sec], [a.to, a.conn2, a.bearing + 180, a.z, a.sec],
      ...(a.truss ? [[a.col, a.truss.conn, a.bearing, a.z - a.truss.D, a.truss.chord], [a.to, a.truss.conn2, a.bearing + 180, a.z - a.truss.D, a.truss.chord]] : []),
    ] as [number | undefined, ConnType | undefined, number, number, Section][]);
    for (const [ci2, conn, bearing, zt, sec] of st.continuity === false ? [] : beamEnds) {
      if (ci2 !== ci || !conn || !MOMENT.includes(conn) || bearing % 180 !== 0) continue;
      for (const z of [zt - sec.tf / 2, zt - sec.d + sec.tf / 2])
        if (levels.every((l) => Math.abs(l - z) > 30)) levels.push(z);
    }
    levels.sort((p, q) => p - q).forEach((z, k) => {
      const S = colAt(ci, z);
      const o = add(c.x, [0, 0, z]);
      const t = Math.max(10, Math.round(S.sec.tf));
      // one part per side of the web: a beam that frames into the web there leaves no room
      for (const s of [-1, 1]) extra(`${id}-stiffener${k + 1}${s < 0 ? 'w' : 'e'}`, S.id, [stiffener(S.sec, o, mul(X, s), Y, t)], mul(X, s));
    });
    // gussets at the foot: on the two flange faces, or on all four faces
    if (st.base && st.base !== 'none') {
      const { d, bf, tw } = lo.sec;
      const ps: Plate[] = [-1, 1].map((s) => flat(add(c.x, [0, s * d / 2, 0]), mul(Y, s), Z, 12, [[0, 0], [70, 0], [70, 30], [0, 180]]));
      if (st.base === 'all') {
        const L = bf / 2 - tw / 2 + 70;
        for (const s of [-1, 1])
          ps.push(flat(add(c.x, [s * tw / 2, 0, 0]), mul(X, s), Z, 12, [[0, 0], [L, 0], [L, 30], [L - 70, 180], [0, 180]]));
      }
      extra(`${id}-gussets`, lo.id, ps, down);
    }
  });
  // bearing stiffeners in a beam, over the point where a brace pushes on it
  for (const a of st.arms) {
    const g = armGeo.get(a.id)!;
    const h = hdir(a.bearing);
    a.braces.forEach((b, k) => {
      const t = b.end ? a.L - b.a : b.a;
      const P = pieceAt(armGeo, a, t);
      const o = add(add(start(st, a), mul(h, t)), [0, 0, -a.sec.d / 2]);
      for (const s of [-1, 1]) extra(`${a.id}-stiffener${k ? k + 1 : ''}${s < 0 ? 'a' : 'b'}`, P.id, [stiffener(a.sec, o, mul(P.v, s), Z, 10)], mul(P.v, s));
    });
    // and at each node of a truss, in both chords
    const tr = a.truss;
    if (tr) {
      const cg = armGeo.get(chordId(a))!;
      tr.webs.forEach((wb, k) => {
        const ot = add(add(start(st, a), mul(h, wb.t)), [0, 0, -a.sec.d / 2]);
        const ob = add(add(start(st, a), mul(h, wb.b)), [0, 0, -tr.D - tr.chord.d / 2]);
        for (const s of [-1, 1]) {
          const sd = s < 0 ? 'a' : 'b';
          extra(`${webId(a, k)}-stiffener-t${sd}`, a.id, [stiffener(a.sec, ot, mul(g.v, s), Z, 10)], mul(g.v, s));
          extra(`${webId(a, k)}-stiffener-b${sd}`, cg.id, [stiffener(tr.chord, ob, mul(cg.v, s), Z, 10)], mul(cg.v, s));
        }
      });
    }
  }
}
const rect = (w: number, h: number): P2[] => [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];

// every part comes after the parts it stands on
export function floating(ps: Part[]): string[] {
  const step = new Map(ps.map((p) => [p.id, p.step]));
  return ps.flatMap((p) => p.supports.filter((s) => !((step.get(s) ?? Infinity) < p.step)).map((s) => `${p.id} before ${s}`));
}

export type Result = {
  st: Structure;
  parts: Part[];
  ok: boolean;
  log: string[];
  ratio: number;
  solves: number;
  ms: { topology: number; solve: number; geometry: number };
  nodes: number;
};

export function generate(p0: Partial<Params>, cat: Catalog, detail: Detail = 'bolts'): Result {
  const p = { ...DEFAULTS, ...p0 };
  if (p.specimen) return buildSpecimen(p, p.specimen, cat, detail);
  const rng = mulberry32(p.seed * 7919 + 13);
  const t0 = performance.now();
  // a draw of its own, so a tree seed gives the same tree in mix and in tree
  const roll = mulberry32(p.seed * 104729 + 7)();
  const form: Form = p.form !== 'mix' ? p.form : roll < 0.45 ? 'tree' : roll < 0.75 ? 'portal' : 'box';
  const st = form === 'tree' ? tree(p, cat, rng) : frame(form, p, cat, rng);
  const t1 = performance.now();
  const log: string[] = [];
  let solves = 0;
  let ok = false;
  let ratio = 0;
  let m = model(st, p);
  let sized = 0;
  for (let k = 0; k < 40; k++) {
    m = model(st, p);
    const r = solve(m.nodes, m.elems);
    solves++;
    if (!r.ok) {
      ok = false;
      if (!fix(st, m, r.node, cat, rng, log)) {
        log.push(`mechanism at node ${r.node} (${m.nodeOwner[r.node].join(', ')}) ${r.dofName}, no fix found`);
        break;
      }
      continue;
    }
    ok = true;
    // three sizing passes, then one more solve to check the final sections
    ratio = size(st, m, r.forces, cat, p.fy, sized === 3);
    if (sized === 3) break;
    sized++;
  }
  const again = () => (solves++, solve((m = model(st, p)).nodes, m.elems));
  // trusses and rods, from a draw of their own: size them, then check. If
  // the structure does not stand up with them, go back to it without them.
  if (ok) {
    const keep = { ratio, col: st.col, arms: st.arms.map((a) => ({ sec: a.sec, braces: a.braces })), secs: st.secs.map((s) => s.sec) };
    const n = log.length;
    if (addTrussesAndRods(st, cat, mulberry32(p.seed * 2654435 + 5), log)) {
      let good = true;
      for (let k = 0; k < 4 && good; k++) {
        const r = again();
        if (r.ok) ratio = size(st, m, r.forces, cat, p.fy, k === 3);
        else good = false;
      }
      if (!good) {
        st.col = keep.col;
        ratio = keep.ratio;
        st.arms.forEach((a, i) => Object.assign(a, keep.arms[i], { truss: undefined, rod: undefined }));
        st.secs.forEach((s, i) => (s.sec = keep.secs[i]));
        log.splice(n, log.length - n, 'trusses and rods: mechanism, left out');
        m = model(st, p);
      }
    }
  }
  // posts, from a draw of their own: they bring loads, so size again and
  // check. If the structure does not stand up with them, leave them out.
  if (ok) {
    const keep = { ratio, secs: snapshot(st) };
    const n = log.length;
    if (addPosts(st, p, cat, mulberry32(p.seed * 49979687 + 17), log)) {
      let good = true;
      for (let k = 0; k < 4 && good; k++) {
        const r = again();
        if (r.ok) ratio = size(st, m, r.forces, cat, p.fy, k === 3);
        else good = false;
      }
      if (!good) {
        restore(st, keep.secs);
        ratio = keep.ratio;
        st.arms.forEach((a) => (a.post = undefined));
        log.splice(n, log.length - n, 'posts: mechanism, left out');
        m = model(st, p);
      }
    }
  }
  // the details, from a draw of their own
  const det = mulberry32(p.seed * 15485863 + 3);
  const b = det();
  st.base = b < 0.5 ? 'none' : b < 0.8 ? 'flange' : 'all';
  st.splice = ok ? pickSplice(st, det) : undefined;
  // solve with the cut, size the upper shaft, then check it (sizeTop can drop the splice)
  if (st.splice) {
    const r = again();
    if (r.ok) sizeTop(st, m, r.forces, cat, p.fy);
    else st.splice = undefined;
  }
  if (st.splice) {
    const r = again();
    if (r.ok) {
      ratio = size(st, m, r.forces, cat, p.fy, true);
      log.push(`splice at ${st.splice.z} mm (${st.splice.kind}), ${st.col.id} below, ${st.splice.sec.id} above`);
    } else st.splice = undefined;
  }
  // splices in the bay beams: geometry only, from a draw of their own
  if (ok) addBeamSplices(st, p, mulberry32(p.seed * 32452843 + 11), log);
  log.push(`${sized} sizing passes, final max ratio ${ratio.toFixed(2)} (limit ${LIMIT})`);
  const t2 = performance.now();
  const ps = parts(st, detail, p.seg);
  const t3 = performance.now();
  return { st, parts: ps, ok, log, ratio, solves, ms: { topology: t1 - t0, solve: t2 - t1, geometry: t3 - t2 }, nodes: m.nodes.length };
}

// A real specimen: no random draw, no fix and no sizing. The solver checks
// that it stands up as built, and gives the max ratio under p.load (only for
// the log, the test loads are not known here). No trusses, rods, splice or
// base gussets.
function buildSpecimen(p: Params, spec: Specimen, cat: Catalog, detail: Detail): Result {
  const t0 = performance.now();
  const st = specimen(spec, cat);
  const t1 = performance.now();
  const log = [...(spec.notes ?? [])];
  const m = model(st, p);
  const r = solve(m.nodes, m.elems);
  let ratio = 0;
  if (r.ok) {
    ratio = size(st, m, r.forces, cat, p.fy, true);
    log.push(`sections as given, max ratio ${ratio.toFixed(2)} under ${p.load} N/mm on the beams`);
  } else log.push(`mechanism at node ${r.node} (${m.nodeOwner[r.node].join(', ')}) ${r.dofName}: it does not stand up as given`);
  const t2 = performance.now();
  const ps = parts(st, detail, p.seg);
  const t3 = performance.now();
  return { st, parts: ps, ok: r.ok, log, ratio, solves: 1, ms: { topology: t1 - t0, solve: t2 - t1, geometry: t3 - t2 }, nodes: m.nodes.length };
}
