// Geometry and line drawing renderer, ported from sculpture_render.py
// (branch feat/logo-aisc), in mm.
//
// Every member is its real cross section extruded along its axis. The
// `render` here is the fast one: the painter's trick (faces filled with the
// background, drawn back to front, back faces culled, long members cut in
// segments so the depth sort stays honest). It is wrong in some places.
// hlr.ts draws the exact hidden lines, and is the default.
import { add, cross, dot, len, mul, norm, sub, type V } from './vec.ts';
import { ANGLE_GAP, rects, type Section } from './sections.ts';

export const PITCH = 75; // bolt pitch
export const EDGE = 38; // bolt edge distance

export type P2 = [number, number];
export type Face = { pts: V[]; edges: [number, number][] };
// a bolt: on the side of `axis` that looks at the camera, or on a face with normal `n`
export type Dot = { p: V; axis?: V; half?: number; n?: V };
// a solid box, for the clash check (clash.ts): centre, 3 unit axes, half sizes
export type Box = { c: V; ax: [V, V, V]; h: [number, number, number] };
export type Kind = 'base' | 'column' | 'plate' | 'member' | 'bolts';
// kind and from: how the part arrives in the build animation (from: the 3D
// direction it comes from)
// What a part is, for the tooltip of the playground (the renderers don't read
// it). type: 'Column', 'Brace', 'Cap plate'... of: the part it belongs to (a
// plate, bolts). sec, L (mm), conn (one per end): for a member. member: its
// id in the solver model, the key of Result.members (all columns are 'column').
export type PartInfo = { type: string; of?: string; sec?: Section; L?: number; conn?: string[]; member?: string };
export type Part = {
  id: string; step: number; faces: Face[]; dots: Dot[]; supports: string[]; boxes?: Box[]; accent?: boolean; kind?: Kind; from?: V; info?: PartInfo;
};

// Less detail when the drawing is small: at 160 px or less bolts are only
// noise, at 64 px plates too, at 40 px the secondary beams.
export const DETAIL = { bolts: 160, plates: 64, secondaries: 40 };
export function forSize(parts: Part[], size?: number): Part[] {
  if (!size) return parts;
  return parts
    .filter((p) => !(size <= DETAIL.bolts && p.kind === 'bolts'))
    .filter((p) => !(size <= DETAIL.plates && p.kind === 'plate'))
    .filter((p) => !(size <= DETAIL.secondaries && /^sec\d/.test(p.id)))
    .map((p) => (size <= DETAIL.bolts && p.dots.length ? { ...p, dots: [] } : p));
}

// When each part starts to move and when it lands, in ms. A part waits for
// the parts it stands on to land. Columns and members also wait for a free
// crane (there are CRANES), and two of them never start closer than GAP, so
// a few beams come in at once, one a bit after the other. Plates are put on
// by hand: no crane. Bolts start when their member lands.
export type Slot = { start: number; dur: number; land: number };
export const BOLT_MS = 60; // between two bolts of one connection
export const CRANES = 3;
const MS: Record<Kind, number> = { base: 350, column: 600, plate: 220, member: 550, bolts: 0 };
const GAP = { big: 150, plate: 50 };
// when the last part lands, in ms
export const buildEnd = (slots: Map<number, Slot>) => Math.max(0, ...[...slots.values()].map((s) => s.land));

export function timeline(parts: Part[], speed = 1): Map<number, Slot> {
  const out = new Map<number, Slot>();
  const byId = new Map(parts.map((p) => [p.id, p]));
  const k = 1 / speed;
  const cranes: number[] = Array(CRANES).fill(0);
  let [lastBig, lastPlate] = [-Infinity, -Infinity];
  const landOf = (id: string) => {
    const q = byId.get(id);
    return (q && out.get(q.step)?.land) ?? 0;
  };
  for (const p of [...parts].sort((a, b) => a.step - b.step)) {
    const ready = Math.max(0, ...p.supports.map(landOf));
    const kind = p.kind ?? 'plate';
    let slot: Slot;
    if (kind === 'bolts') {
      const start = landOf(p.supports[0]);
      const dur = (220 + BOLT_MS * Math.max(0, p.dots.length - 1)) * k;
      slot = { start, dur, land: start + dur };
    } else if (kind === 'column' || kind === 'member') {
      const c = cranes.indexOf(Math.min(...cranes));
      const start = Math.max(ready, cranes[c], lastBig + GAP.big * k);
      slot = { start, dur: MS[kind] * k, land: start + MS[kind] * k };
      cranes[c] = slot.land;
      lastBig = start;
    } else {
      const start = Math.max(ready, lastPlate + GAP.plate * k);
      slot = { start, dur: MS[kind] * k, land: start + MS[kind] * k };
      lastPlate = start;
    }
    out.set(p.step, slot);
  }
  return out;
}

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

// a round bar, as 16 sides: few enough to stay light, enough to read as round
export const profRound = (D: number): P2[][] => [
  ccw([...Array(16).keys()].map((i): P2 => [(D / 2) * Math.cos((i * Math.PI) / 8), (D / 2) * Math.sin((i * Math.PI) / 8)])),
];

// a channel: the web on v = 0, the flanges toward +v
export function profC(d: number, bf: number, tw: number, tf: number): P2[][] {
  const [h, l, r, x, t] = [d / 2, -tw / 2, bf - tw / 2, tw / 2, tf];
  return [ccw([[l, -h], [r, -h], [r, -h + t], [x, -h + t], [x, h - t], [r, h - t], [r, h], [l, h]])];
}

// a tee: the flange on top, the stem down
export function profT(d: number, bf: number, tw: number, tf: number): P2[][] {
  const [h, w, x, t] = [d / 2, bf / 2, tw / 2, tf];
  return [ccw([[-w, -h], [w, -h], [w, -h + t], [x, -h + t], [x, h], [-x, h], [-x, -h + t], [-w, -h + t]])];
}

// two angles back to back, ANGLE_GAP apart: the legs along the gap go down,
// the outstanding legs are on top
export function prof2L(d: number, bf: number, t: number): P2[][] {
  const [h, w, g] = [d / 2, bf / 2, ANGLE_GAP / 2];
  const right: P2[] = [[g, -h], [w, -h], [w, -h + t], [g + t, -h + t], [g + t, h], [g, h]];
  return [ccw(right), ccw(right.map(([a, b]): P2 => [-a, b]))];
}

export function profile(s: Section): P2[][] {
  switch (s.kind) {
    case 'I': return profI(s.d, s.bf, s.tw, s.tf);
    case 'C': return profC(s.d, s.bf, s.tw, s.tf);
    case 'T': return profT(s.d, s.bf, s.tw, s.tf);
    case '2L': return prof2L(s.d, s.bf, s.tf);
    case 'ROD': return profRound(s.d);
    default: return profRect(s.d, s.bf);
  }
}

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
  const web = sec.kind === 'I' || sec.kind === 'C' || sec.kind === 'T';
  return { id, sec, p0, p1, u, v, w, sh: tos ? sec.d / 2 : 0, polys: profile(sec), d: sec.d, tw: web ? sec.tw : sec.bf, copes: [] };
}

// The flanges of a section in its profile, each one [left, right, thickness],
// and the two sides of its web. An I has both flanges, a C too (toward +v
// from its web), a T only the top one. Other kinds have none.
type Flanged = { top: [number, number, number]; bot?: [number, number, number]; web: [number, number] };
function flanged(s: Section): Flanged | undefined {
  const [w, x] = [s.bf / 2, s.tw / 2];
  if (s.kind === 'I') return { top: [-w, w, s.tf], bot: [-w, w, s.tf], web: [-x, x] };
  if (s.kind === 'C') return { top: [-x, s.bf - x, s.tf], bot: [-x, s.bf - x, s.tf], web: [-x, x] };
  if (s.kind === 'T') return { top: [-w, w, s.tf], web: [-x, x] };
  return undefined;
}

// remove a point equal to the one before it (also the last against the first)
function dedupe(pts: P2[]): P2[] {
  const out = pts.filter((q, i) => {
    const o = pts[(i + pts.length - 1) % pts.length];
    return Math.abs(q[0] - o[0]) > 1e-9 || Math.abs(q[1] - o[1]) > 1e-9;
  });
  return out.length ? out : pts.slice(0, 1);
}

// The outline of a flanged section cut to the depths [top, d - bot] (0 = no
// cut), with extra corners on the web sides at `splits` (depths from the
// top). With the same corners, the coped end and the full section share
// their edges, so the faces of the two parts join without a seam. `piece`
// gives instead what a cope takes away: the top (or bottom) `depth` mm.
function outline(s: Section, f: Flanged, top: number, bot: number, splits: number[]): P2[] {
  const h = s.d / 2;
  const [[tl, tr, tt], [bl, br, tb], [wl, wr]] = [f.top, f.bot ?? [0, 0, 0], f.web];
  const [b0, b1] = [top ? -h + top : -h + tt, bot ? h - bot : h - tb];
  const mids = splits.map((dd) => dd - h).filter((b) => b > b0 + 0.01 && b < b1 - 0.01).sort((a, b) => a - b);
  const pts: P2[] = top ? [[wl, b0], [wr, b0]] : [[tl, -h], [tr, -h], [tr, -h + tt], [wr, -h + tt]];
  for (const b of mids) pts.push([wr, b]);
  if (bot) pts.push([wr, b1], [wl, b1]);
  else if (f.bot) pts.push([wr, h - tb], [br, h - tb], [br, h], [bl, h], [bl, h - tb], [wl, h - tb]);
  else pts.push([wr, h], [wl, h]);
  for (const b of [...mids].reverse()) pts.push([wl, b]);
  if (!top) pts.push([wl, -h + tt], [tl, -h + tt]);
  return dedupe(pts);
}
function piece(s: Section, f: Flanged, side: 'top' | 'bot', depth: number, splits: number[]): P2[] {
  const h = s.d / 2;
  const [[tl, tr, tt], [bl, br, tb], [wl, wr]] = [f.top, f.bot ?? [0, 0, 0], f.web];
  const [b0, b1] = side === 'top' ? [-h + tt, -h + depth] : [h - depth, h - tb];
  const mids = splits.map((dd) => dd - h).filter((b) => b > b0 + 0.01 && b < b1 - 0.01).sort((a, b) => a - b);
  const right = mids.map((b): P2 => [wr, b]);
  const left = [...mids].reverse().map((b): P2 => [wl, b]);
  return dedupe(side === 'top'
    ? [[tl, -h], [tr, -h], [tr, b0], [wr, b0], ...right, [wr, b1], [wl, b1], ...left, [wl, b0], [tl, b0]]
    : [[wr, b0], ...right, [wr, b1], [br, b1], [br, h], [bl, h], [bl, b1], [wl, b1], ...left, [wl, b0]]);
}

export function memberFaces(g: Geo, seg: number, cuts: number[] = []): Face[] {
  // a round bar has no edges along it, only its outline (the renderers find it)
  if (g.sec.kind === 'ROD')
    return prism(g.p0, g.p1, g.polys, g.u, g.v, g.w, seg, g.sh, cuts).map((f) =>
      f.pts.length === 4 ? { ...f, edges: f.edges.filter(([i, j]) => !((i === 1 && j === 2) || (i === 3 && j === 0))) } : f);
  const f = flanged(g.sec);
  if (!g.copes.length || !f) return prism(g.p0, g.p1, g.polys, g.u, g.v, g.w, seg, g.sh, cuts);
  const L = len(sub(g.p1, g.p0));
  const splits = g.copes.flatMap((c) => [c.top, c.bot ? g.d - c.bot : 0]).filter((x) => x > 0);
  // same winding as the profile
  const raw = outline(g.sec, f, 0, 0, splits);
  const turn = (p: P2[]) => (ccw(raw) === raw ? p : [...p].reverse());
  const full = turn(raw);
  const coped = g.copes.map((c) => ({
    c,
    poly: turn(outline(g.sec, f, c.top, c.bot, splits)),
    pieces: [...(c.top ? [turn(piece(g.sec, f, 'top', c.top, splits))] : []), ...(c.bot ? [turn(piece(g.sec, f, 'bot', c.bot, splits))] : [])],
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
    // no long edge at a corner that is not one (the split points on a flat
    // side): the painter and webgl draw the edges they are given
    const straight = poly.map((q, i) => {
      const [a, b] = [poly[(i + m - 1) % m], poly[(i + 1) % m]];
      return Math.abs((q[0] - a[0]) * (b[1] - a[1]) - (q[1] - a[1]) * (b[0] - a[0])) < 1e-6;
    });
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      const key = `${poly[i]}|${poly[j]}`;
      const edges: [number, number][] = [];
      if (!straight[j]) edges.push([1, 2]);
      if (!straight[i]) edges.push([3, 0]);
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

// the member as boxes: the rectangles of its section (flanges and web of an
// I, the legs of the angles), one box for a tube
export function memberBoxes(g: Geo): Box[] {
  const h = g.sec.d / 2;
  const L = len(sub(g.p1, g.p0));
  // pieces along the member: the coped ends keep only what the cope leaves
  const from = g.copes.find((c) => c.at === 'from');
  const to = g.copes.find((c) => c.at === 'to');
  const spans: [number, number, Cope | undefined][] = [[from?.len ?? 0, L - (to?.len ?? 0), undefined]];
  if (from) spans.push([0, from.len, from]);
  if (to) spans.push([L - to.len, L, to]);
  return spans.flatMap(([t0, t1, c]) => rects(g.sec).flatMap(([a0, a1, b0, b1]) => {
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
  if ((g.sec.kind !== 'I' && g.sec.kind !== 'C') || !r.room) return undefined;
  const [lo, hi] = r.room;
  const tfS = S.sec.tf;
  const top = lo > 0 && lo - tfS < g.d ? Math.max(lo, g.sec.tf) + 10 : 0;
  const bot = hi < g.d && hi + tfS > 0 ? Math.max(g.d - hi, g.sec.tf) + 10 : 0;
  const len = (S.sec.bf - S.tw) / 2 - r.gap + 12; // past the flange tips
  if ((!top && !bot) || len <= 0 || top + bot > g.d / 2) return undefined; // keep half the depth
  return { at: r.at, len, top, bot };
}

// the depths (from the top of g) where a plate on its web can sit: between
// its flanges, under a cope, and between the flanges of the support. A tee
// has no bottom flange.
function webWindow(g: Geo, r: Resolved): [number, number] {
  let [lo, hi] = [g.sec.tf + 10, g.d - (g.sec.kind === 'T' ? 0 : g.sec.tf) - 10];
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

// the convex outline of points that lie in one plane, given two axes of it
function hull2(pts: V[], ax: V, ay: V): V[] {
  const o = pts[0];
  const q = pts.map((v) => ({ v, x: dot(sub(v, o), ax), y: dot(sub(v, o), ay) })).sort((a, b) => a.x - b.x || a.y - b.y);
  const turn = (a: (typeof q)[0], b: (typeof q)[0], c: (typeof q)[0]) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const half = (list: typeof q) => {
    const h: typeof q = [];
    for (const c of list) {
      while (h.length >= 2 && turn(h[h.length - 2], h[h.length - 1], c) <= 1e-6) h.pop();
      h.push(c);
    }
    h.pop();
    return h;
  };
  return [...half(q), ...half([...q].reverse())].map((c) => c.v);
}

// a flat plate with any outline: `poly` is one face, the other is `t` along n
function slab(poly: V[], n: V, t: number): Face[] {
  const top = poly.map((v) => add(v, mul(n, t)));
  const ring = poly.map((_, i) => [i, (i + 1) % poly.length] as [number, number]);
  const faces: Face[] = [{ pts: poly, edges: ring }, { pts: [...top].reverse(), edges: ring }];
  for (let i = 0; i < poly.length; i++) {
    const k = (i + 1) % poly.length;
    faces.push({ pts: [poly[i], poly[k], top[k], top[i]], edges: [[1, 2]] });
  }
  return faces;
}

// A flat plate of thickness t, centred on the plane through o that holds
// the unit axes ax and ay (at right angles). `pts` is its outline in that
// plane, in any winding. Also its box, for the clash check.
export type Plate = { faces: Face[]; box: Box };
export function flat(o: V, ax: V, ay: V, t: number, pts: P2[]): Plate {
  const n = cross(ax, ay);
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [a, b] = [pts[i], pts[(i + 1) % pts.length]];
    s += a[0] * b[1] - b[0] * a[1];
  }
  // slab wants its first face looking along -n
  const ring = s > 0 ? [...pts].reverse() : pts;
  const poly = ring.map(([x, y]) => add(add(add(o, mul(ax, x)), mul(ay, y)), mul(n, -t / 2)));
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const c = add(add(o, mul(ax, (x0 + x1) / 2)), mul(ay, (y0 + y1) / 2));
  return { faces: slab(poly, n, t), box: { c, ax: [ax, ay, n], h: [(x1 - x0) / 2, (y1 - y0) / 2, t / 2] } };
}

// A stiffener in an I section: a plate between the two flanges, on one side
// of the web, with its two inner corners clipped (the weld at the root of
// the web runs through there). o: on the web axis, half way between the
// flanges. side: from the web toward the flange tips. depth: across, from
// one flange to the other.
export function stiffener(sec: Section, o: V, side: V, depth: V, t: number): Plate {
  const [x0, x1, h, c] = [sec.tw / 2, sec.bf / 2 - 5, sec.d / 2 - sec.tf, 15];
  return flat(o, side, depth, t, [[x0, -h + c], [x0 + c, -h], [x1, -h], [x1, h], [x0 + c, h], [x0, h - c]]);
}

// A splice between two pieces of a member, lo and hi, their axes on one
// line: a column splice (lo the lower shaft), or a beam splice (kind flange
// only). lo.p1 is the cut. The plates use the frame of lo: w across the
// flanges, v across the web, u along the member. A column keeps the world
// axes: its frame is off by 1e-16 (norm), and the column splices of the
// old seeds must stay the same to the last bit.
// - bearing: a cap plate on lo, a base plate under hi, 4 bolts at the corners.
// - flange: plates on the outer faces of both flanges and on both sides of
//   the web, bolted to both shafts. When the shafts don't have the same
//   depth, a fill plate makes up the difference on the thinner one.
// BEARING_T: the height the bearing plates add between the two shafts.
export const BEARING_T = 40;
// half the height of the flange splice plates: two bolt rows on each shaft
export const SPLICE_HALF = 2 * EDGE + PITCH + 5;
export function splicePlates(lo: Geo, hi: Geo, kind: 'bearing' | 'flange'): { faces: Face[]; boxes: Box[]; dots: Dot[] } {
  const faces: Face[] = [];
  const boxes: Box[] = [];
  const dots: Dot[] = [];
  const c = add(lo.p1, mul(lo.w, lo.sh));
  const [x, y, z]: V[] = Math.abs(lo.u[2]) > 0.99 ? [[1, 0, 0], [0, 1, 0], [0, 0, 1]] : [lo.v, lo.w, lo.u];
  const at = (dx: number, dy: number, dz: number) => add(c, add(add(mul(x, dx), mul(y, dy)), mul(z, dz)));
  const plate = (centre: V, sx: number, sy: number, sz: number) => {
    faces.push(...box3(centre, y, z, sx, sy, sz));
    boxes.push(boxOf(centre, y, z, sx, sy, sz));
  };
  const [L, H] = [lo.sec, hi.sec];
  if (kind === 'bearing') {
    const t = BEARING_T / 2;
    const [hx, hy] = [Math.max(L.bf, H.bf) / 2 + 60, Math.max(L.d, H.d) / 2 + 60];
    plate(at(0, 0, t / 2), 2 * hx, 2 * hy, t);
    plate(at(0, 0, 1.5 * t), 2 * hx, 2 * hy, t);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) dots.push({ p: at(sx * (hx - 35), sy * (hy - 35), 2 * t), n: z });
    return { faces, boxes, dots };
  }
  const t = 16;
  const len = 2 * SPLICE_HALF;
  const rows = [-1, 1].flatMap((s) => [s * (5 + EDGE), s * (5 + EDGE + PITCH)]);
  const bw = Math.min(L.bf, H.bf);
  const gauge = Math.min(140, bw - 2 * EDGE);
  const outer = Math.max(L.d, H.d) / 2;
  for (const s of [-1, 1]) {
    plate(at(0, s * (outer + t / 2), 0), bw, t, len);
    for (const [sec, dz] of [[L, -len / 4], [H, len / 4]] as const) {
      const fill = outer - sec.d / 2;
      if (fill > 1) plate(at(0, s * (sec.d / 2 + fill / 2), dz), bw, fill, len / 2);
    }
    for (const dz of rows) for (const gx of [-gauge / 2, gauge / 2]) dots.push({ p: at(gx, s * (outer + t), dz), n: mul(y, s) });
  }
  const tw = Math.max(L.tw, H.tw);
  const hw = Math.min(L.d - 2 * L.tf, H.d - 2 * H.tf) - 30;
  for (const s of [-1, 1]) plate(at(s * (tw / 2 + 5), 0, 0), 10, hw, len);
  const { n, pitch } = boltLine(hw, 3);
  for (const dz of rows)
    for (const [dy] of grid(n, 1, pitch, 0)) dots.push({ p: at(0, dy, dz), axis: x, half: tw / 2 + 10 });
  return { faces, boxes, dots };
}

export type ConnType = 'shear_tab' | 'end_plate' | 'flange_plates' | 'welded' | 'gusset' | 'gusset_small' | 'gusset_lap' | 'clevis';
export const PINNED: ConnType[] = ['shear_tab', 'gusset', 'gusset_small', 'gusset_lap', 'clevis'];
// the gap a member leaves at its end, for each connection type. For a
// gusset it leaves room for the 2 x 2 bolt group, whatever the brace angle.
// The small gusset (the diagonals of a low truss) has one row of 2 bolts.
// The lapped gusset (a double angle) has its bolts in the angles: the gap is
// only a clearance, measured from the corner of the angles nearest the face
// (see the braces in parts(), generate.ts).
export const SETBACK: Record<ConnType, number> = { shear_tab: 13, flange_plates: 13, end_plate: 25, welded: 0, gusset: 195, gusset_small: 130, gusset_lap: 40, clevis: 110 };

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
    // the plate and its bolts are centred on the section box: 0 for an I or
    // a tube, half the flange from the web for a channel
    const rs = rects(g.sec);
    const cv = (Math.min(...rs.map((x) => x[0])) + Math.max(...rs.map((x) => x[1]))) / 2;
    const q = add(p, mul(g.v, cv));
    const wp = gauge + 2 * EDGE;
    const th = Math.max(gap, t);
    let ws: number[];
    if (r.room) {
      // on the web of a beam there is no room above or below: a flush plate
      // between the flanges of the support, bolts on the web of g only
      const [p0, p1] = [Math.max(r.room[0] + 8, -40), Math.min(r.room[1] - 8, g.d + 40)];
      plate(add(add(q, mul(inward, -th / 2)), mul(g.w, wAt(g, (p0 + p1) / 2))), g.w, inward, wp, p1 - p0, th);
      const [lo, hi] = webWindow(g, r);
      const { n, pitch } = boltLine(hi - lo - 40 + 2 * EDGE, 4);
      ws = grid(n, 1, pitch, 0).map(([x]) => wAt(g, (lo + hi) / 2 + x));
    } else {
      // extended: bolts above, between and below the flanges
      plate(add(add(q, mul(inward, -th / 2)), mul(g.w, g.sh)), g.w, inward, wp, g.d + 180, th);
      ws = [-45, g.sec.tf + 45, g.d - g.sec.tf - 45, g.d + 45].map((x) => wAt(g, x));
    }
    for (const dw of ws)
      for (const s of [-1, 1])
        dots.push({ p: add(add(add(q, mul(inward, 1)), mul(g.v, (s * gauge) / 2)), mul(g.w, dw)), n: inward });
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
  } else if (typ === 'gusset' || typ === 'gusset_small') {
    // Two plates and 4 bolts through both. The gusset is welded to the
    // support face. The knife plate sits in a slot at the tube end and laps
    // over the gusset. The bolts: 2 rows along the brace, 2 across. The
    // small gusset has 1 row (2 bolts) and a shorter slot.
    const t = 12;
    let nrm = cross(r.direc, g.u);
    if (len(nrm) < 1e-3) nrm = g.v;
    nrm = norm(nrm);
    const across = norm(cross(nrm, r.direc)); // in the plate plane, along the support face
    const side = norm(cross(nrm, inward)); // in the plate plane, across the brace
    const slot = typ === 'gusset' ? 150 : 100;
    reach.push(slot);
    const near = EDGE + 12; // the bolt rows, mm before the tube end
    const far = typ === 'gusset' ? near + PITCH : near;
    const half = PITCH / 2 + EDGE; // half width of the bolt area
    const at = (u: number, s2: number, n = 0) => add(add(add(p, mul(inward, u)), mul(side, s2)), mul(nrm, n));
    for (const u of far > near ? [-near, -far] : [-near])
      for (const s2 of [-PITCH / 2, PITCH / 2]) dots.push({ p: at(u, s2, -t / 2), axis: nrm, half: t + 1 });
    // knife plate: from the bolts into the slot, in the plane of the brace
    // full width under the bolts, then down to the tube width at its end
    const lk = far + EDGE + slot;
    const w = Math.min(half, g.sec.bf / 2 + 10);
    const knife = [at(-far - EDGE, -half), at(-far - EDGE, half), at(-near + EDGE, half), at(0, w), at(slot, w), at(slot, -w), at(0, -w), at(-near + EDGE, -half)];
    faces.push(...slab(knife.map((q) => add(q, mul(nrm, -t / 2))), nrm, t));
    boxes.push(boxOf(at((slot - far - EDGE) / 2, 0), side, inward, t, 2 * half, lk));
    // gusset: beside the knife plate, from the support face to the bolts. Its
    // outline joins the bolt area to its own foot on the face.
    const area = [at(-near + EDGE, -half, -t), at(-near + EDGE, half, -t), at(-far - EDGE, half, -t), at(-far - EDGE, -half, -t)];
    const foot = area.map((q) => sub(q, mul(r.direc, dot(sub(q, r.fp), r.direc))));
    const poly = hull2([...area, ...foot], across, r.direc);
    faces.push(...slab(poly, nrm, t));
    // its solid for the clash check: the box around it, in the support frame
    const xs = poly.map((q) => dot(sub(q, r.fp), r.direc));
    const ys = poly.map((q) => dot(sub(q, r.fp), across));
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const zc = dot(sub(poly[0], r.fp), nrm);
    boxes.push(boxOf(add(add(add(r.fp, mul(r.direc, (x0 + x1) / 2)), mul(across, (y0 + y1) / 2)), mul(nrm, zc)), across, r.direc, t, y1 - y0, x1 - x0));
  } else if (typ === 'gusset_lap') {
    // A double angle on a gusset plate. The plate is welded to the support
    // face and goes into the gap between the two angles. One line of 2 bolts
    // along the brace, through both angles and the plate, in the middle of
    // the free part of the legs.
    const t = ANGLE_GAP;
    const nrm = g.v;
    // the plate is in the plane of the legs: its foot goes to the face along
    // the direction to the face, seen in that plane
    const flat = sub(r.direc, mul(nrm, dot(r.direc, nrm)));
    const dir = len(flat) > 0.3 ? norm(flat) : r.direc;
    const across = norm(cross(nrm, dir));
    const far = EDGE + PITCH;
    reach.push(far + EDGE);
    const at = (u: number, dw: number, n = 0) => add(add(add(p, mul(inward, u)), mul(g.w, dw)), mul(nrm, n));
    const wb = wAt(g, (g.sec.tf + g.d) / 2);
    for (const u of [EDGE, far]) dots.push({ p: at(u, wb), axis: nrm, half: t / 2 + g.sec.tw });
    // the bolt area, a bit wider than the angles, joined to its foot on the face
    const [w0, w1] = [wAt(g, -15), wAt(g, g.d + 15)];
    const area = [at(0, w0, -t / 2), at(far + EDGE, w0, -t / 2), at(far + EDGE, w1, -t / 2), at(0, w1, -t / 2)];
    const k = dot(dir, r.direc);
    const foot = area.map((q) => sub(q, mul(dir, dot(sub(q, r.fp), r.direc) / k)));
    const poly = hull2([...area, ...foot], across, dir);
    faces.push(...slab(poly, nrm, t));
    const xs = poly.map((q) => dot(sub(q, r.fp), dir));
    const ys = poly.map((q) => dot(sub(q, r.fp), across));
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const zc = dot(sub(p, r.fp), nrm);
    boxes.push(boxOf(add(add(add(r.fp, mul(dir, (x0 + x1) / 2)), mul(across, (y0 + y1) / 2)), mul(nrm, zc)), across, dir, t, y1 - y0, x1 - x0));
  } else if (typ === 'clevis') {
    // A rod end. A tab plate is welded to the support face. The rod ends in
    // a clevis: a short block, then a fork of two plates on both sides of
    // the tab, held by one pin through all three.
    const t = 12;
    let nrm = cross(r.direc, g.u);
    if (len(nrm) < 1e-3) nrm = g.v;
    nrm = norm(nrm);
    const across = norm(cross(nrm, r.direc)); // in the tab plane, along the support face
    const side = norm(cross(nrm, inward)); // in the tab plane, across the rod
    const at = (u: number, s2: number, n = 0) => add(add(add(p, mul(inward, u)), mul(side, s2)), mul(nrm, n));
    const pin = -60; // mm before the rod end
    const w = Math.max(25, g.sec.d / 2 + 8); // half width of the fork
    const [f0, f1] = [pin - 35, -10]; // the fork, along the rod
    for (const s of [-1, 1]) plate(at((f0 + f1) / 2, 0, s * (t / 2 + 5)), side, inward, 8, 2 * w, f1 - f0);
    plate(at(2.5, 0), side, inward, t + 18, 2 * w, 25);
    reach.push(15);
    dots.push({ p: at(pin, 0), axis: nrm, half: t / 2 + 9 });
    // the tab: around the pin, down to its own foot on the face
    const area = [at(pin - 30, -30, -t / 2), at(pin - 30, 30, -t / 2), at(pin + 30, 30, -t / 2), at(pin + 30, -30, -t / 2)];
    const foot = area.map((q) => sub(q, mul(r.direc, dot(sub(q, r.fp), r.direc))));
    const poly = hull2([...area, ...foot], across, r.direc);
    faces.push(...slab(poly, nrm, t));
    const xs = poly.map((q) => dot(sub(q, r.fp), r.direc));
    const ys = poly.map((q) => dot(sub(q, r.fp), across));
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    boxes.push(boxOf(add(add(r.fp, mul(r.direc, (x0 + x1) / 2)), mul(across, (y0 + y1) / 2)), across, r.direc, t, y1 - y0, x1 - x0));
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
  stepMs?: number; // painter only: ms between two steps
  speed?: number; // exact renderer: speed of the build animation (default 1)
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
  parts = forSize(parts, o.size);
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
