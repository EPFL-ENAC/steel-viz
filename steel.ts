// Geometry and line drawing renderer, ported from sculpture_render.py
// (branch feat/logo-aisc), in mm.
//
// Every member is its real cross section extruded along its axis. The
// `render` here is the fast one: the painter's trick (faces filled with the
// background, drawn back to front, back faces culled, long members cut in
// segments so the depth sort stays honest). It is wrong in some places.
// hlr.ts draws the exact hidden lines, and is the default.
import { add, cross, dot, len, mul, norm, sub, type V } from './vec.ts';
import type { Section } from './sections.ts';

export const PITCH = 75; // bolt pitch
export const EDGE = 38; // bolt edge distance

type P2 = [number, number];
export type Face = { pts: V[]; edges: [number, number][] };
// a bolt: on the side of `axis` that looks at the camera, or on a face with normal `n`
export type Dot = { p: V; axis?: V; half?: number; n?: V };
// a solid box, for the clash check (clash.ts): centre, 3 unit axes, half sizes
export type Box = { c: V; ax: [V, V, V]; h: [number, number, number] };
export type Part = { id: string; step: number; faces: Face[]; dots: Dot[]; supports: string[]; boxes?: Box[]; accent?: boolean };

// ------------------------------------------------------------- profiles
function ccw(p: P2[]): P2[] {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [a, b] = [p[i], p[(i + 1) % p.length]];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s > 0 ? p : [...p].reverse();
}

export function profI(d: number, bf: number, tw: number, tf: number): P2[][] {
  const [h, w, x, t] = [d / 2, bf / 2, tw / 2, tf];
  return [
    ccw([
      [-w, -h], [w, -h], [w, -h + t], [x, -h + t], [x, h - t], [w, h - t],
      [w, h], [-w, h], [-w, h - t], [-x, h - t], [-x, -h + t], [-w, -h + t],
    ]),
  ];
}

export const profRect = (h: number, b: number): P2[][] => [
  ccw([[-b / 2, -h / 2], [b / 2, -h / 2], [b / 2, h / 2], [-b / 2, h / 2]]),
];

// ---------------------------------------------------------------- frames
// u along the member, w along its depth, v = w x u
export function frame(p0: V, p1: V): { u: V; v: V; w: V } {
  const u = norm(sub(p1, p0));
  let w: V;
  if (Math.abs(u[2]) > 0.99) w = [0, 1, 0];
  else {
    const down: V = [0, 0, -1];
    w = norm(sub(down, mul(u, dot(down, u))));
  }
  return { u, v: cross(w, u), w };
}

// ---------------------------------------------------------------- solids
// `cuts` are extra cut points, in mm from p0. A connection plate gives one,
// so the piece of member under the plate ends where the plate ends: with the
// same extent, the plate (on top) sorts in front of it.
export function prism(p0: V, p1: V, polys: P2[][], u: V, v: V, w: V, seg: number, shift = 0, cuts: number[] = []): Face[] {
  const L = len(sub(p1, p0));
  const marks = [0, ...cuts.filter((x) => x > 1 && x < L - 1).sort((a, b) => a - b), L];
  const ts: number[] = [0];
  for (let i = 1; i < marks.length; i++) {
    const [a, b] = [marks[i - 1], marks[i]];
    const k = Math.max(1, Math.ceil((b - a) / seg));
    for (let j = 1; j <= k; j++) ts.push(a + ((b - a) * j) / k);
  }
  const n = ts.length - 1;
  const faces: Face[] = [];
  for (const poly of polys) {
    const base = poly.map(([a, b]) => add(p0, add(mul(v, a), mul(w, b + shift))));
    const m = base.length;
    for (let k = 0; k < n; k++) {
      const A = base.map((pt) => add(pt, mul(u, ts[k])));
      const B = base.map((pt) => add(pt, mul(u, ts[k + 1])));
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % m;
        const edges: [number, number][] = [[1, 2], [3, 0]];
        if (k === 0) edges.push([0, 1]);
        if (k === n - 1) edges.push([2, 3]);
        faces.push({ pts: [A[i], A[j], B[j], B[i]], edges });
      }
      const ring = (): [number, number][] => [...Array(m).keys()].map((i) => [i, (i + 1) % m]);
      if (k === 0) faces.push({ pts: [...A].reverse(), edges: ring() });
      if (k === n - 1) faces.push({ pts: B, edges: ring() });
    }
  }
  return faces;
}

// a box: sizes sx, sy, sz along (ay x az), ay, az
export function box3(centre: V, ay: V, az: V, sx: number, sy: number, sz: number): Face[] {
  const v = cross(ay, az);
  return prism(sub(centre, mul(az, sz / 2)), add(centre, mul(az, sz / 2)), profRect(sy, sx), az, v, ay, 1e9);
}

// the same box as box3, as a solid
export const boxOf = (centre: V, ay: V, az: V, sx: number, sy: number, sz: number): Box =>
  ({ c: centre, ax: [cross(ay, az), ay, az], h: [sx / 2, sy / 2, sz / 2] });

// ------------------------------------------------------------- members
export type Geo = {
  id: string;
  sec: Section;
  p0: V;
  p1: V;
  u: V;
  v: V;
  w: V;
  sh: number; // d/2 for a top-of-steel line, 0 for a centre line
  polys: P2[][];
  d: number;
  tw: number;
  copes: Cope[]; // set from the connections, before the faces are made
};

// A cope: the end of a beam cut back where it meets the flanges of the beam
// it frames into. `top` and `bot` are the depths cut away (0 = none), over
// `len` mm from the end.
export type Cope = { at: 'from' | 'to'; len: number; top: number; bot: number };

export function geo(id: string, sec: Section, p0: V, p1: V, tos: boolean): Geo {
  const { u, v, w } = frame(p0, p1);
  const polys = sec.kind === 'I' ? profI(sec.d, sec.bf, sec.tw, sec.tf) : profRect(sec.d, sec.bf);
  return { id, sec, p0, p1, u, v, w, sh: tos ? sec.d / 2 : 0, polys, d: sec.d, tw: sec.kind === 'I' ? sec.tw : sec.bf, copes: [] };
}

// The outline of an I cut to the depths [top, d - bot] (0 = no cut), with
// extra corners on the web sides at `splits` (depths from the top). With the
// same corners, the coped end and the full section share their edges, so the
// faces of the two parts join without a seam. `piece` gives instead what a
// cope takes away: the top (or bottom) `depth` mm.
function outlineI(s: Section, top: number, bot: number, splits: number[]): P2[] {
  const [h, w, x, t] = [s.d / 2, s.bf / 2, s.tw / 2, s.tf];
  const [b0, b1] = [top ? -h + top : -h + t, bot ? h - bot : h - t];
  const mids = splits.map((dd) => dd - h).filter((b) => b > b0 + 0.01 && b < b1 - 0.01).sort((a, b) => a - b);
  const pts: P2[] = top ? [[-x, b0], [x, b0]] : [[-w, -h], [w, -h], [w, -h + t], [x, -h + t]];
  for (const b of mids) pts.push([x, b]);
  pts.push(...((bot ? [[x, b1], [-x, b1]] : [[x, h - t], [w, h - t], [w, h], [-w, h], [-w, h - t], [-x, h - t]]) as P2[]));
  for (const b of [...mids].reverse()) pts.push([-x, b]);
  if (!top) pts.push([-x, -h + t], [-w, -h + t]);
  return pts;
}
function pieceI(s: Section, side: 'top' | 'bot', depth: number, splits: number[]): P2[] {
  const [h, w, x, t] = [s.d / 2, s.bf / 2, s.tw / 2, s.tf];
  const [b0, b1] = side === 'top' ? [-h + t, -h + depth] : [h - depth, h - t];
  const mids = splits.map((dd) => dd - h).filter((b) => b > b0 + 0.01 && b < b1 - 0.01).sort((a, b) => a - b);
  const right = mids.map((b): P2 => [x, b]);
  const left = [...mids].reverse().map((b): P2 => [-x, b]);
  return side === 'top'
    ? [[-w, -h], [w, -h], [w, b0], [x, b0], ...right, [x, b1], [-x, b1], ...left, [-x, b0], [-w, b0]]
    : [[x, b0], ...right, [x, b1], [w, b1], [w, h], [-w, h], [-w, b1], [-x, b1], ...left, [-x, b0]];
}

export function memberFaces(g: Geo, seg: number, cuts: number[] = []): Face[] {
  if (!g.copes.length || g.sec.kind !== 'I') return prism(g.p0, g.p1, g.polys, g.u, g.v, g.w, seg, g.sh, cuts);
  const L = len(sub(g.p1, g.p0));
  const splits = g.copes.flatMap((c) => [c.top, c.bot ? g.d - c.bot : 0]).filter((x) => x > 0);
  // same winding as profI
  const raw = outlineI(g.sec, 0, 0, splits);
  const turn = (p: P2[]) => (ccw(raw) === raw ? p : [...p].reverse());
  const full = turn(raw);
  const coped = g.copes.map((c) => ({
    c,
    poly: turn(outlineI(g.sec, c.top, c.bot, splits)),
    pieces: [...(c.top ? [turn(pieceI(g.sec, 'top', c.top, splits))] : []), ...(c.bot ? [turn(pieceI(g.sec, 'bot', c.bot, splits))] : [])],
    span: c.at === 'from' ? [0, c.len] : [L - c.len, L],
  }));
  const marks = [0, ...cuts, ...coped.map((k) => (k.c.at === 'from' ? k.c.len : L - k.c.len))]
    .filter((x) => x > 1 && x < L - 1).sort((a, b) => a - b);
  const ts: number[] = [0];
  for (const b of [...marks, L]) {
    const a = ts[ts.length - 1];
    const k = Math.max(1, Math.ceil((b - a) / seg));
    for (let j = 1; j <= k; j++) ts.push(a + ((b - a) * j) / k);
  }
  const segs = ts.slice(1).map((t1, k) => {
    const mid = (ts[k] + t1) / 2;
    const cp = coped.find((x) => mid > x.span[0] && mid < x.span[1]);
    const poly = cp?.poly ?? full;
    return { t0: ts[k], t1, poly, cp, keys: new Set(poly.map((q, i) => `${q}|${poly[(i + 1) % poly.length]}`)) };
  });
  const P = (q: P2, t: number): V => add(add(add(g.p0, mul(g.u, t)), mul(g.v, q[0])), mul(g.w, q[1] + g.sh));
  const ring = (m: number): [number, number][] => [...Array(m).keys()].map((i) => [i, (i + 1) % m]);
  const faces: Face[] = [];
  segs.forEach((sg, k) => {
    const { t0, t1, poly } = sg;
    const m = poly.length;
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      const key = `${poly[i]}|${poly[j]}`;
      const edges: [number, number][] = [[1, 2], [3, 0]];
      if (k === 0 || !segs[k - 1].keys.has(key)) edges.push([0, 1]);
      if (k === segs.length - 1 || !segs[k + 1].keys.has(key)) edges.push([2, 3]);
      faces.push({ pts: [P(poly[i], t0), P(poly[j], t0), P(poly[j], t1), P(poly[i], t1)], edges });
    }
    if (k === 0) faces.push({ pts: poly.map((q) => P(q, t0)).reverse(), edges: ring(m) });
    if (k === segs.length - 1) faces.push({ pts: poly.map((q) => P(q, t1)), edges: ring(m) });
    else if (segs[k + 1].poly !== poly) {
      // a cope ends here: the cut face, looking at the coped end
      const from = sg.cp?.c.at === 'from';
      for (const pc of (sg.cp ?? segs[k + 1].cp)!.pieces) {
        const pts = pc.map((q) => P(q, t1));
        faces.push({ pts: from ? pts.reverse() : pts, edges: ring(pc.length) });
      }
    }
  });
  return faces;
}

// the member as boxes: flanges and web of an I, one box for a tube
export function memberBoxes(g: Geo): Box[] {
  const { d, bf } = g.sec;
  const [h, w] = [d / 2, bf / 2];
  const rects: [number, number, number, number][] = g.sec.kind === 'I'
    ? [[-w, w, -h, -h + g.sec.tf], [-w, w, h - g.sec.tf, h], [-g.tw / 2, g.tw / 2, -h + g.sec.tf, h - g.sec.tf]]
    : [[-w, w, -h, h]];
  const L = len(sub(g.p1, g.p0));
  // pieces along the member: the coped ends keep only what the cope leaves
  const from = g.copes.find((c) => c.at === 'from');
  const to = g.copes.find((c) => c.at === 'to');
  const spans: [number, number, Cope | undefined][] = [[from?.len ?? 0, L - (to?.len ?? 0), undefined]];
  if (from) spans.push([0, from.len, from]);
  if (to) spans.push([L - to.len, L, to]);
  return spans.flatMap(([t0, t1, c]) => rects.flatMap(([a0, a1, b0, b1]) => {
    if (c) [b0, b1] = [Math.max(b0, -h + c.top), Math.min(b1, h - c.bot)];
    if (b1 - b0 < 0.5 || t1 - t0 < 0.5) return [];
    return [{
      c: add(add(add(g.p0, mul(g.u, (t0 + t1) / 2)), mul(g.v, (a0 + a1) / 2)), mul(g.w, (b0 + b1) / 2 + g.sh)),
      ax: [g.v, g.w, g.u] as [V, V, V],
      h: [(a1 - a0) / 2, (b1 - b0) / 2, (t1 - t0) / 2] as [number, number, number],
    }];
  }));
}

export function closest(S: Geo, p: V): V {
  const L = len(sub(S.p1, S.p0));
  const t = Math.min(Math.max(dot(sub(p, S.p0), S.u), 0), L);
  return add(S.p0, mul(S.u, t));
}

// how far the surface of S is from its axis line, in direction direc.
// Across the width of an I that is the web, otherwise the section outline.
export function supportFace(S: Geo, direc: V): number {
  const [da, db] = [dot(direc, S.v), dot(direc, S.w)];
  if (S.sec.kind === 'I' && Math.abs(da) > 0.9) return S.tw / 2;
  let m = -Infinity;
  for (const poly of S.polys) for (const [pa, pb] of poly) m = Math.max(m, pa * da + (pb + S.sh) * db);
  return m;
}

// `room`: when the member lands on the web of an I beam, the depths (from
// the top of the member) between the flanges of that beam. `cope`: the cut
// that keeps the member clear of those flanges.
export type Resolved = { at: 'from' | 'to'; p: V; inward: V; direc: V; gap: number; fp: V; room?: [number, number]; cope?: Cope };

// where a connection sits: the member end, the direction into the member,
// the support face point and the gap between the two
export function resolve(g: Geo, S: Geo, at: 'from' | 'to'): Resolved {
  const p = at === 'from' ? g.p0 : g.p1;
  const inward = at === 'from' ? g.u : mul(g.u, -1);
  const q = closest(S, p);
  let direc = sub(inward, mul(S.u, dot(inward, S.u)));
  if (len(direc) < 0.1) direc = sub(p, q);
  direc = norm(direc);
  const dist = dot(sub(p, q), direc);
  const face = supportFace(S, direc);
  const r: Resolved = { at, p, inward, direc, gap: Math.max(0, dist - face), fp: add(q, mul(direc, face)) };
  if (S.sec.kind === 'I' && Math.abs(dot(direc, S.v)) > 0.9 && dot(g.w, S.w) > 0.99) {
    const off = dot(sub(p, S.p0), S.w) + g.sh - g.d / 2; // top of g, in the depth of S
    const top = S.sh - S.d / 2;
    r.room = [top + S.sec.tf - off, top + S.d - S.sec.tf - off];
    r.cope = copeFor(g, S, r);
  }
  return r;
}

// cut the flanges of g back where the flanges of S would go through them
function copeFor(g: Geo, S: Geo, r: Resolved): Cope | undefined {
  if (g.sec.kind !== 'I' || !r.room) return undefined;
  const [lo, hi] = r.room;
  const tfS = S.sec.tf;
  const top = lo > 0 && lo - tfS < g.d ? Math.max(lo, g.sec.tf) + 10 : 0;
  const bot = hi < g.d && hi + tfS > 0 ? Math.max(g.d - hi, g.sec.tf) + 10 : 0;
  const len = (S.sec.bf - S.tw) / 2 - r.gap + 12; // past the flange tips
  if ((!top && !bot) || len <= 0 || top + bot > g.d / 2) return undefined; // keep half the depth
  return { at: r.at, len, top, bot };
}

// the depths (from the top of g) where a plate on its web can sit: between
// its flanges, under a cope, and between the flanges of the support
function webWindow(g: Geo, r: Resolved): [number, number] {
  let [lo, hi] = [g.sec.tf + 10, g.d - g.sec.tf - 10];
  if (r.cope) [lo, hi] = [Math.max(lo, r.cope.top + 10), Math.min(hi, g.d - r.cope.bot - 10)];
  if (r.room) [lo, hi] = [Math.max(lo, r.room[0] + 10), Math.min(hi, r.room[1] - 10)];
  return [lo, hi];
}
// w of a depth from the top of g
const wAt = (g: Geo, depth: number) => depth - g.d / 2 + g.sh;

// a full bolt grid, centred on 0: `rows` along one axis, `cols` along the
// other. Every row has the same number of bolts, so the pattern is symmetric.
export function grid(rows: number, cols: number, pitch: number, gauge: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++) out.push([(i - (rows - 1) / 2) * pitch, (j - (cols - 1) / 2) * gauge]);
  return out;
}

// how many bolts fit in one line over `span` mm, and their pitch. At least
// 2, at most `max`. A short span squeezes the pitch down to 55 mm (about 3
// bolt diameters), never less.
export function boltLine(span: number, max: number): { n: number; pitch: number } {
  const n = Math.min(max, Math.max(2, Math.floor((span - 2 * EDGE) / PITCH) + 1));
  return { n, pitch: Math.max(55, Math.min(PITCH, (span - 2 * EDGE) / (n - 1))) };
}

// a plate in the web plane (shear tab), from the support face into the
// member. One vertical line of bolts, as many as the clear web `clear`
// allows. The plate is as tall as the bolt group plus the edge distances.
function webPlate(g: Geo, r: Resolved, t: number, L0: number, max: number, dots: Dot[], reach: number[], boxes: Box[]): Face[] {
  const L = Math.max(L0, r.gap + 2 * EDGE);
  const lin = L - r.gap;
  reach.push(lin);
  const [lo, hi] = webWindow(g, r);
  const { n, pitch } = boltLine(hi - lo, max);
  const h = (n - 1) * pitch + 2 * EDGE;
  const mid = wAt(g, (lo + hi) / 2);
  const centre = add(add(r.p, mul(r.inward, L / 2 - r.gap)), mul(g.w, mid));
  const faces = box3(centre, g.w, r.inward, g.tw + 2 * t, h, L);
  boxes.push(boxOf(centre, g.w, r.inward, g.tw + 2 * t, h, L));
  for (const [dw] of grid(n, 1, pitch, 0))
    dots.push({ p: add(add(r.p, mul(r.inward, lin / 2)), mul(g.w, mid + dw)), axis: g.v, half: g.tw / 2 + t });
  return faces;
}

export type ConnType = 'shear_tab' | 'end_plate' | 'flange_plates' | 'welded' | 'gusset';
export const PINNED: ConnType[] = ['shear_tab', 'gusset'];
// the gap a member leaves at its end, for each connection type. For a
// gusset it leaves room for the 2 x 2 bolt group, whatever the brace angle.
export const SETBACK: Record<ConnType, number> = { shear_tab: 13, flange_plates: 13, end_plate: 25, welded: 0, gusset: 195 };

// the solid of one connection and its bolt dots
// `reach`: how far the plates go along the member, in mm from its end.
export function hardware(g: Geo, typ: ConnType, r: Resolved): { faces: Face[]; dots: Dot[]; reach: number[]; boxes: Box[] } {
  const faces: Face[] = [];
  const boxes: Box[] = [];
  const plate = (centre: V, ay: V, az: V, sx: number, sy: number, sz: number) => {
    faces.push(...box3(centre, ay, az, sx, sy, sz));
    boxes.push(boxOf(centre, ay, az, sx, sy, sz));
  };
  const dots: Dot[] = [];
  const reach: number[] = [];
  const { p, inward, gap } = r;
  if (typ === 'shear_tab') {
    faces.push(...webPlate(g, r, 10, 115, 8, dots, reach, boxes));
  } else if (typ === 'end_plate') {
    const t = 25;
    const gauge = Math.max(PITCH, g.sec.bf + 30 - 2 * EDGE);
    const wp = gauge + 2 * EDGE;
    const th = Math.max(gap, t);
    let ws: number[];
    if (r.room) {
      // on the web of a beam there is no room above or below: a flush plate
      // between the flanges of the support, bolts on the web of g only
      const [p0, p1] = [Math.max(r.room[0] + 8, -40), Math.min(r.room[1] - 8, g.d + 40)];
      plate(add(add(p, mul(inward, -th / 2)), mul(g.w, wAt(g, (p0 + p1) / 2))), g.w, inward, wp, p1 - p0, th);
      const [lo, hi] = webWindow(g, r);
      const { n, pitch } = boltLine(hi - lo - 40 + 2 * EDGE, 4);
      ws = grid(n, 1, pitch, 0).map(([x]) => wAt(g, (lo + hi) / 2 + x));
    } else {
      // extended: bolts above, between and below the flanges
      plate(add(add(p, mul(inward, -th / 2)), mul(g.w, g.sh)), g.w, inward, wp, g.d + 180, th);
      ws = [-45, g.sec.tf + 45, g.d - g.sec.tf - 45, g.d + 45].map((x) => wAt(g, x));
    }
    for (const dw of ws)
      for (const s of [-1, 1])
        dots.push({ p: add(add(add(p, mul(inward, 1)), mul(g.v, (s * gauge) / 2)), mul(g.w, dw)), n: inward });
  } else if (typ === 'flange_plates') {
    const t = 16;
    // bolts in pairs across the flange; a narrow flange gets a wider plate
    const gauge = Math.max(PITCH, g.sec.bf - 2 * EDGE);
    const wp = Math.max(g.sec.bf, gauge + 2 * EDGE);
    const L = Math.max(300, gap + 3 * EDGE);
    for (const top of [true, false]) {
      const dw = top ? -t / 2 : g.d + t / 2;
      plate(add(add(p, mul(inward, L / 2 - gap)), mul(g.w, dw)), g.w, inward, wp, t, L);
      const lin = L - gap;
      if (top) reach.push(lin);
      const rows = Math.max(1, Math.floor((lin - 2 * EDGE) / PITCH) + 1);
      for (let rr = 0; rr < rows; rr++)
        for (const s of [-1, 1]) {
          let pt = add(add(p, mul(inward, EDGE + rr * PITCH)), mul(g.v, (s * gauge) / 2));
          pt = add(pt, mul(g.w, top ? -t : g.d + t));
          dots.push({ p: pt, n: mul(g.w, top ? -1 : 1) });
        }
    }
    faces.push(...webPlate(g, r, 10, 115, 3, dots, reach, boxes));
  } else if (typ === 'gusset') {
    // A knife plate welded to the support face, slotted into the tube. The
    // bolts sit on the free part of the plate, between the support and the
    // tube end: 2 rows along the brace, 2 across, symmetric about its axis.
    const t = 12;
    let nrm = cross(r.direc, g.u);
    if (len(nrm) < 1e-3) nrm = g.v;
    nrm = norm(nrm);
    const across = norm(cross(nrm, r.direc)); // in the plate plane, along the support face
    const side = norm(cross(nrm, inward)); // in the plate plane, across the brace
    const slot = 150;
    reach.push(slot);
    const pts: V[] = [];
    for (const [du, dv] of grid(2, 2, PITCH, PITCH)) {
      const b = add(add(p, mul(inward, -(25 + EDGE + PITCH / 2) + du)), mul(side, dv));
      pts.push(b);
      dots.push({ p: b, axis: nrm, half: t / 2 + 1 });
    }
    // the plate is a rectangle on the support face that covers the bolts
    // (plus the edge distance) and the part inside the slot
    const hw = g.sec.bf / 2 + 10;
    const cover = [...pts, add(p, mul(side, hw)), add(p, mul(side, -hw)), add(add(p, mul(inward, slot)), mul(side, hw)), add(add(p, mul(inward, slot)), mul(side, -hw))];
    const xs = cover.map((q, i) => dot(sub(q, r.fp), r.direc) + (i < pts.length ? EDGE : 0));
    const ys = cover.map((q) => dot(sub(q, r.fp), across));
    const [y0, y1] = [Math.min(...ys) - EDGE, Math.max(...ys) + EDGE];
    const x1 = Math.max(...xs);
    const centre = add(add(r.fp, mul(r.direc, x1 / 2)), mul(across, (y0 + y1) / 2));
    plate(centre, across, r.direc, t, y1 - y0, x1);
  }
  return { faces, dots, reach, boxes };
}

// ---------------------------------------------------------------- camera
export const VIEWS: Record<string, [number, number]> = {
  iso: [225, 35.264], west: [270, 0], east: [90, 0], north: [0, 0], south: [180, 0], plan: [0, 90],
};

export function camera(az: number, el: number): { c: V; r: V; up: V } {
  const [a, e] = [(az * Math.PI) / 180, (el * Math.PI) / 180];
  const c: V = [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)];
  let r = cross([0, 0, 1], c);
  if (len(r) < 1e-6) r = [1, 0, 0];
  r = norm(r);
  return { c, r, up: norm(cross(c, r)) };
}

// ---------------------------------------------------------------- render
export type RenderOpts = {
  az: number;
  el: number;
  scale?: number; // drawing units per mm
  stroke?: number; // line width, mm (the thin lines, with weights)
  outline?: number; // width of the outlines, mm (exact renderer only)
  weights?: boolean; // thick outlines and thin inner edges (default true)
  size?: number; // px: the drawing will be shown this wide, so widths are in px (exact renderer only)
  strokePx?: number; // with size: thin line width, px (default 1)
  outlinePx?: number; // with size: outline width, px (default 2)
  gap?: number | false; // gap where a line goes behind something, mm or px like the widths (default: the outline width)
  bolt?: number; // bolt head size, corner to centre, mm (M20 head: 17)
  maxStep?: number; // draw only the parts up to this build step
  animate?: boolean;
  stepMs?: number;
  bolts?: boolean;
};

// is a 2D point inside a polygon (crossing test)
function inside([x, y]: P2, poly: P2[]): boolean {
  let k = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) k = !k;
  }
  return k;
}

export function render(parts: Part[], o: RenderOpts): { svg: string; faces: number; dots: number } {
  const { c, r, up } = camera(o.az, o.el);
  const scale = o.scale ?? 0.1;
  const f = (x: number) => (Math.round(x * 10) / 10).toString();
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  const proj = (p: V): [number, number] => {
    const x = dot(p, r) * scale;
    const y = -dot(p, up) * scale;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    return [x, y];
  };
  const items: { depth: number; part: number; s: string }[] = [];
  let nFaces = 0;
  let nDots = 0;
  // visible faces, so each bolt can find the face it sits on
  type Vis = { n: V; e1: V; e2: V; poly: P2[]; o: V; depth: number };
  const vis: Vis[] = [];
  parts.forEach((part, pi) => {
    if (o.maxStep !== undefined && part.step > o.maxStep) return;
    for (const { pts, edges } of part.faces) {
      const n = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]));
      if (dot(n, c) <= 1e-9) continue;
      const depth = pts.reduce((s, p) => s + dot(p, c), 0) / pts.length;
      const nu = norm(n);
      const e1 = norm(sub(pts[1], pts[0]));
      const e2 = cross(nu, e1);
      vis.push({ n: nu, e1, e2, o: pts[0], depth, poly: pts.map((p) => [dot(sub(p, pts[0]), e1), dot(sub(p, pts[0]), e2)]) });
      const q = pts.map(proj).map(([x, y]) => `${f(x)} ${f(y)}`);
      const d = 'M' + q.join('L') + 'Z';
      nFaces++;
      // all edges drawn: one filled and stroked path
      if (edges.length === pts.length) {
        items.push({ depth, part: pi, s: `<path class="s" d="${d}"/>` });
        continue;
      }
      const e = edges.map(([i, j]) => `M${q[i]}L${q[j]}`).join('');
      items.push({ depth, part: pi, s: `<path d="${d}"/><path class="e" d="${e}"/>` });
    }
  });
  // Bolts, in a second pass once every face is known. A bolt is a hex head
  // drawn flat on its face, so it foreshortens with the plate. Its depth is
  // just above the depth of that face: sorted by its own depth, a bolt near
  // the far end of a long plate would sort behind the plate and vanish.
  const R = o.bolt ?? 17;
  if (o.bolts !== false)
    parts.forEach((part, pi) => {
      if (o.maxStep !== undefined && part.step > o.maxStep) return;
      for (const dt of part.dots) {
        let b = dt.p;
        let nn: V;
        if (dt.axis) {
          nn = mul(dt.axis, dot(dt.axis, c) >= 0 ? 1 : -1);
          b = add(b, mul(nn, dt.half ?? 0));
        } else nn = dt.n ?? c;
        if (dot(nn, c) < 0.05) continue; // on a face we can't see
        let host = -Infinity;
        for (const fc of vis) {
          if (dot(fc.n, nn) < 0.99 || Math.abs(dot(sub(b, fc.o), fc.n)) > 3) continue;
          const d = sub(b, fc.o);
          if (inside([dot(d, fc.e1), dot(d, fc.e2)], fc.poly)) host = Math.max(host, fc.depth);
        }
        const ref: V = Math.abs(nn[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
        const a1 = norm(cross(nn, ref));
        const a2 = cross(nn, a1);
        const top = add(b, nn);
        const q = [0, 1, 2, 3, 4, 5].map((k) => {
          const t = (k * Math.PI) / 3;
          return proj(add(top, add(mul(a1, R * Math.cos(t)), mul(a2, R * Math.sin(t)))));
        });
        nDots++;
        const depth = Math.max(host + 0.01, dot(b, c) + 5);
        items.push({ depth, part: pi, s: `<path class="b" d="M${q.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z"/>` });
      }
    });
  items.sort((a, b) => a.depth - b.depth);
  const pad = 150 * scale;
  [x0, y0, x1, y1] = [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
  // with a px size, the width is in px (about halfway between the two weights)
  const sw = f(o.size ? ((o.strokePx ?? 1) * 1.5 * (x1 - x0)) / o.size : (o.stroke ?? 7) * scale);
  const drop = f((y1 - y0) * 0.04);
  const css =
    // scoped to the root class, so the svg can sit inline in a page
    `.steel path{fill:var(--bg,#fff);stroke:none}.steel .s,.steel .e{stroke:currentColor;stroke-width:${sw};stroke-linecap:round;stroke-linejoin:round}` +
    `.steel .e{fill:none}.steel .b{fill:currentColor}.steel .a{color:var(--accent,#e30713)}` +
    (o.animate
      ? `.steel g{animation:sb .5s cubic-bezier(.2,.8,.3,1) both;animation-delay:calc(var(--i)*${o.stepMs ?? 60}ms)}` +
        `@keyframes sb{from{opacity:0;transform:translateY(-${drop}px)}}@media (prefers-reduced-motion:reduce){.steel g{animation:none}}`
      : '');
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" class="steel" viewBox="${f(x0)} ${f(y0)} ${f(x1 - x0)} ${f(y1 - y0)}">`,
    `<style>${css}</style>`,
  ];
  let cur = -1;
  for (const it of items) {
    if (it.part !== cur) {
      if (cur >= 0) out.push('</g>');
      const p = parts[it.part];
      const cls = p.accent ? ' class="a"' : '';
      out.push(o.animate ? `<g${cls} style="--i:${p.step}">` : `<g${cls}>`);
      cur = it.part;
    }
    out.push(it.s);
  }
  if (cur >= 0) out.push('</g>');
  out.push('</svg>');
  return { svg: out.join('\n'), faces: nFaces, dots: nDots };
}
