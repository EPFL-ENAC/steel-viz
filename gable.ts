// A gable portal: the top bay beam of a portal goes up to a ridge in the
// middle of the span, like the frame of a shed. On two storeys, the floor
// beam stays flat.
//
// - Two rafters, each from an eave (on its column) up to the ridge. Both
//   ends are cut plumb: a square cut on a sloped beam leaves a wedge gap at a
//   vertical plate.
// - A haunch under each rafter at the eave: a deeper part of the beam near
//   the column, cut from an I or made of welded plates. A web triangle and a
//   bottom flange.
// - A moment end plate on the column at each eave, as deep as the rafter and
//   the haunch, and a bolted end plate splice at the ridge (two plates face
//   to face).
// - Purlins (a chance of their own): short channels across each rafter, on
//   its top flange, turned to the pitch. Each one is bolted to a cleat, a
//   plate welded on the rafter on the down slope side of the channel web.
//
// generate.ts calls this file from small hooks: the draw (drawGable), the
// solver model (gableModel), the parts (gableParts) and the thrust for the
// log. The arm stays one Arm: `a.z` is the top of steel at the eave, on the
// face of the end plate. Units are mm.
import { add, cross, dot, len, mul, norm, sub, type V } from './vec.ts';
import { EDGE, flat, geo, memberBoxes, memberFaces, PITCH, SETBACK, type Box, type Dot, type Face, type Geo, type Part } from './steel.ts';
import type { Section } from './sections.ts';
import type { Elem, FNode } from './solver.ts';

// slope: the roof slope, in degrees. The haunch: L, its length along the
// span from the eave plate (mm), k its depth at the eave, times the depth of
// the rafter (so it follows the sizing), and how it is made.
export type Haunch = { L: number; k: number; kind: 'cut' | 'plates' };
// The purlins: about `spacing` mm apart along each rafter, each one L mm
// long, centred on the rafter. sec: set after the sizing (purlinSec).
export type Purlins = { spacing: number; L: number; sec?: Section };
export type Gable = { slope: number; haunch: Haunch; purlins?: Purlins };
// what this file reads of an Arm (generate.ts)
type GArm = { id: string; z: number; L: number; sec: Section; gable?: Gable };

const T = SETBACK.end_plate; // the eave and ridge plates, mm
const Z: V = [0, 0, 1];
const r10 = (x: number) => Math.round(x / 10) * 10;
const r50 = (x: number) => Math.round(x / 50) * 50;
const rad = (g: Gable) => (g.slope * Math.PI) / 180;

// The draws, from the gable stream, always in this order and all of them,
// so a change in one never moves the others: yes or no, the slope (10 to 20
// degrees, by half degrees: steeper than most sheds, so it shows on our
// short spans), the haunch length (10 to 15 % of the span, at
// least 300 mm, and at most 40 % of a rafter), its depth (0.6 to 1.0 times
// the rafter) and its kind.
export function drawGable(rng: () => number, span: number, P: number): Gable | undefined {
  const yes = rng() < P;
  const slope = 10 + Math.round(rng() * 20) / 2;
  const L = r50(Math.min(Math.max(300, (0.1 + 0.05 * rng()) * span), 0.4 * (span / 2 - 300)));
  const k = Math.round((0.6 + 0.4 * rng()) * 20) / 20;
  const kind = rng() < 0.5 ? 'cut' : 'plates';
  return yes ? { slope, haunch: { L, k, kind } } : undefined;
}

// The purlin draws, from their own stream, always all of them and in this
// order: yes or no, the spacing (800 to 1400 mm) and the length (600 to 1200
// mm), by 50 mm.
export function drawPurlins(rng: () => number, P: number): Purlins | undefined {
  const yes = rng() < P;
  const spacing = r50(800 + 600 * rng());
  const L = r50(600 + 600 * rng());
  return yes ? { spacing, L } : undefined;
}

// The purlin section: the deepest channel up to 0.6 times the rafter depth,
// the lightest of those, else the smallest channel. A rule, not the solver:
// the purlins are not in the model (the line load on the rafter is the roof
// they carry, and their own weight is about 0.1 % of it).
export function purlinSec(channels: Section[], rafter: Section): Section | undefined {
  const ok = channels.filter((c) => c.d <= 0.6 * rafter.d);
  if (!ok.length) return channels.reduce<Section | undefined>((m, c) => (!m || c.d < m.d ? c : m), undefined);
  return ok.reduce((m, c) => (c.d > m.d || (c.d === m.d && c.A < m.A) ? c : m));
}

// the haunch depth at the eave, under the rafter, flange included
export const haunchDepth = (a: GArm) => r10(a.gable!.haunch.k * a.sec.d);
// how deep the eave is on the column face: rafter (cut plumb) and haunch
export const eaveDepth = (a: GArm) => a.sec.d / Math.cos(rad(a.gable!)) + haunchDepth(a);

// Along the span, from the axis of the column of a side, with f the column
// face: x0 the eave plate face, xm the ridge (the middle of the span), x1
// the ridge plate face. The top of steel is a.z at x0 and climbs at `tan`.
function dims(a: GArm, f: number) {
  const g = a.gable!;
  const [tan, cos] = [Math.tan(rad(g)), Math.cos(rad(g))];
  const x0 = f + T;
  const xm = a.L / 2;
  const x1 = xm - T;
  return { tan, cos, x0, xm, x1, top: (x: number) => a.z + (x - x0) * tan };
}
// the rise of the ridge above the eave, at the middle of the span
export const rise = (a: GArm, f: number) => {
  const { xm, top } = dims(a, f);
  return top(xm) - a.z;
};
// a point x along hs from the column axis o (at z = 0), at height z
const at = (o: V, hs: V, x: number, z: number): V => add(add(o, mul(hs, x)), [0, 0, z]);

// The section of the haunched part for the solver: deeper, so stiffer. Its
// owner has no section in generate.ts (sectionOf), so it is not sized or
// checked: the rafter at the haunch tip is the part that governs.
function haunched(a: GArm): Section {
  const D = haunchDepth(a);
  const r = 1 + D / a.sec.d;
  return { ...a.sec, id: `${a.sec.id} haunched`, d: a.sec.d + D, A: a.sec.A + D * a.sec.tw, Is: a.sec.Is * r * r };
}

export type Chain = (who: string, pts: V[], s: Section, pinFirst: boolean, q: number) => void;
// The solver model of the gable: from each column (o0, o1 on their axes at
// z = 0) a haunched piece to the haunch tip, then the two rafters over the
// ridge as one member (the ridge splice is full strength). No pin: both
// eaves are moment end plates. q: the line load. Returns the buckling length
// of the rafter: one rafter, from the haunch tip to the ridge.
export function gableModel(a: GArm, o0: V, o1: V, h: V, f: number, chain: Chain, q: number): number {
  const { cos, tan, x0, xm, top } = dims(a, f);
  const Lh = a.gable!.haunch.L;
  const hb = mul(h, -1);
  const tip0 = at(o0, h, x0 + Lh, a.z + Lh * tan);
  const tip1 = at(o1, hb, x0 + Lh, a.z + Lh * tan);
  const hs = haunched(a);
  chain(`${a.id}-haunch`, [at(o0, h, 0, a.z), tip0], hs, false, q);
  chain(a.id, [tip0, at(o0, h, xm, top(xm)), tip1], a.sec, false, q);
  chain(`${a.id}-haunch`, [tip1, at(o1, hb, 0, a.z)], hs, false, q);
  return (xm - x0 - Lh) / cos;
}

// The horizontal thrust at the eaves, in N, from a solve of the model: the
// rafter element at the ridge. With a symmetric load the ridge has no shear,
// so the half of that element up to the ridge gives N = -(H cos + W sin),
// with W the load on it. `axial` is the mean axial force of each element
// (tension > 0): the one at its middle.
export function thrust(a: GArm, nodes: FNode[], elems: Elem[], owner: string[], axial: ArrayLike<number>): number {
  let k = -1;
  let zMax = -Infinity;
  elems.forEach((e, i) => {
    const z = Math.max(nodes[e.i].x[2], nodes[e.j].x[2]);
    if (owner[i] === a.id && z > zMax) [k, zMax] = [i, z];
  });
  if (k < 0) return 0;
  const e = elems[k];
  const d = sub(nodes[e.j].x, nodes[e.i].x);
  const l = len(d);
  const [sin, cos] = [Math.abs(d[2]) / l, Math.hypot(d[0], d[1]) / l];
  const W = (-(e.q?.[2] ?? 0) * l) / 2;
  return (-axial[k] - W * sin) / cos;
}

// the log line: the rise, the haunch and the thrust (N) at the eaves
export function gableLog(a: GArm, f: number, H: number): string {
  const { haunch: hn, purlins: pu } = a.gable!;
  const purlins = pu?.sec ? `, purlins ${pu.sec.id} about ${pu.spacing} mm apart` : '';
  return `${a.id}: gable, rise ${Math.round(rise(a, f))} mm, haunch ${hn.L} x ${haunchDepth(a)} mm${purlins}, thrust at the eaves ${(H / 1000).toFixed(1)} kN`;
}

// ------------------------------------------------------------- parts
// o0, o1: the axes of the near and far columns at z = 0, h: from the near
// column to the far one, f: the column face from its axis, s0 and s1: the
// ids of the column shafts the eaves land on. reach: how far the column goes
// toward the ridge from its axis, its cap plate included (on a web face, its
// flange tips): the column rises above the eave, so the purlins keep clear.
export type GableCtx = { o0: V; o1: V; h: V; f: number; reach: number; s0: string; s1: string; seg: number; plates: boolean; bolts: boolean };

// the plate thicknesses we weld a haunch from
const PLATES = [8, 10, 12, 15, 20, 25, 30, 35, 40, 50];
const plateT = (t: number) => PLATES.find((x) => x >= t) ?? Math.ceil(t);

// A rafter cut plumb at both ends. memberFaces gives square ends: move each
// point back along the axis by its depth times tan (a shear). The sides of
// the prism stay where they are, only the ends turn vertical, and every face
// stays flat. The boxes stay inside the sheared solid: at depth b it runs
// from -b tan to L - b tan along the axis.
function rafter(g: Geo, seg: number, tan: number): { faces: Face[]; boxes: Box[] } {
  const L = len(sub(g.p1, g.p0));
  const depth = (q: V) => dot(sub(q, g.p0), g.w);
  const faces = memberFaces(g, seg).map((fc) => ({ ...fc, pts: fc.pts.map((q) => add(q, mul(g.u, -depth(q) * tan))) }));
  const boxes = memberBoxes(g).map((b): Box => {
    // memberBoxes: axes [v, w, u]
    const mid = depth(b.c);
    const [b0, b1] = [mid - b.h[1], mid + b.h[1]];
    const [s0, s1] = [-b0 * tan, L - b1 * tan];
    const now = dot(sub(b.c, g.p0), g.u);
    return { c: add(b.c, mul(g.u, (s0 + s1) / 2 - now)), ax: b.ax, h: [b.h[0], b.h[1], (s1 - s0) / 2] };
  });
  return { faces, boxes };
}

// The gable as parts, in build order. For each side: the eave plate on the
// column, the rafter, the haunch, the eave bolts, the ridge plate (welded to
// the rafter). Then the ridge bolts. Also the near rafter geo (details()
// reads it from armGeo).
export function gableParts(a: GArm, c: GableCtx): { parts: Part[]; near: Geo } {
  const { tan, cos, x0, xm, x1, top } = dims(a, c.f);
  const { sec } = a;
  const hn = a.gable!.haunch;
  const D = haunchDepth(a);
  const out: Part[] = [];
  const push = (q: Omit<Part, 'step'>) => out.push({ ...q, step: 0 });
  const gauge = Math.max(PITCH, sec.bf + 30 - 2 * EDGE);
  const wp = gauge + 2 * EDGE;
  const [twH, tfH, bfH] = hn.kind === 'cut' ? [sec.tw, sec.tf, sec.bf] : [plateT(sec.tw), plateT(sec.tf), sec.bf];
  const ids = [a.id, `${a.id}-rafter2`];
  const ridge: { id: string; dots: Dot[] }[] = [];
  const roofs: { g: Geo; hs: V; across: V }[] = [];
  let near: Geo | undefined;
  [0, 1].forEach((side) => {
    const [o, hs, sId, id] = side ? [c.o1, mul(c.h, -1), c.s1, ids[1]] : [c.o0, c.h, c.s0, ids[0]];
    const P = (x: number, z: number) => at(o, hs, x, z);
    const across: V = [hs[1], -hs[0], 0];
    const zr = top(x1);
    // eave plate: from 90 mm above the rafter to 90 mm under the haunch
    const zA = a.z - sec.d / cos; // the rafter bottom at the plate
    const zB = zA - D; // the haunch bottom at the plate
    const pid = `${id}-from-conn`;
    if (c.plates) {
      const [zt, zb] = [a.z + 90, zB - 90];
      const pc = P(c.f + T / 2, (zt + zb) / 2);
      const pl = flat(pc, across, Z, T, rect(wp, zt - zb));
      push({ id: pid, supports: [sId], kind: 'plate', from: Z, faces: pl.faces, boxes: [pl.box], dots: [], info: { type: 'Connection', of: id, conn: ['end_plate'] } });
    }
    // the rafter, eave to ridge
    const g = geo(id, sec, P(x0, a.z), P(x1, zr), true);
    if (!side) near = g;
    roofs.push({ g, hs, across });
    const r = rafter(g, c.seg, tan);
    const Lg = len(sub(g.p1, g.p0));
    push({
      id, supports: [c.plates ? pid : sId], kind: 'member', from: Z, faces: r.faces, boxes: r.boxes, dots: [],
      info: { type: side ? 'Rafter, far side' : 'Rafter', sec, L: Lg, conn: ['end_plate', 'end_plate'], member: a.id },
    });
    // the haunch, in the plane (hs, Z) through the column axis. A: the
    // rafter bottom at the plate, B: the haunch bottom there, C: its tip on
    // the rafter bottom. Bi, Ci: the inner face of its flange.
    const A: [number, number] = [x0, zA];
    const B: [number, number] = [x0, zB];
    const C: [number, number] = [x0 + hn.L, zA + hn.L * tan];
    const e = norm([C[0] - B[0], 0, C[1] - B[1]]);
    const [ex, ez] = [e[0], e[2]];
    const Bi: [number, number] = [x0, zB + tfH / ex];
    const s = (zA - Bi[1]) / (ez - ex * tan);
    const Ci: [number, number] = [x0 + s * ex, Bi[1] + s * ez];
    const web = flat(o, hs, Z, twH, [A, Bi, Ci]);
    const fl = flat(o, hs, Z, bfH, [B, C, Ci, Bi]);
    // boxes: flat() gives the box around the outline, too big for a
    // triangle. The flange: along BC, where it is full thickness.
    const e3 = add(mul(hs, ex), mul(Z, ez));
    const n3 = add(mul(hs, -ez), mul(Z, ex));
    const ax3 = cross(e3, n3);
    const B3 = P(B[0], B[1]);
    const [sa, sb] = [(tfH * ez) / ex, dot(sub(P(Ci[0], Ci[1]), B3), e3)];
    const boxes: Box[] = [{ c: add(add(B3, mul(e3, (sa + sb) / 2)), mul(n3, tfH / 2)), ax: [e3, n3, ax3], h: [(sb - sa) / 2, tfH / 2, bfH / 2] }];
    // the web: three boxes under the rafter, as deep as the flange leaves
    // at their far end. sigma along the rafter from A, rho down from it.
    const u3 = add(mul(hs, cos), mul(Z, tan * cos));
    const w3 = add(mul(hs, tan * cos), mul(Z, -cos));
    const A3 = P(A[0], A[1]);
    const sB = dot(sub(P(Bi[0], Bi[1]), A3), u3);
    const rB = dot(sub(P(Bi[0], Bi[1]), A3), w3);
    const sC = dot(sub(P(Ci[0], Ci[1]), A3), u3);
    const rho = (x: number) => (rB * (sC - x)) / (sC - sB);
    for (let i = 0; i < 3; i++) {
      const [s0, s1] = [(sC * i) / 3, (sC * (i + 1)) / 3];
      const dr = rho(s1);
      if (dr > 2) boxes.push({ c: add(add(A3, mul(u3, (s0 + s1) / 2)), mul(w3, dr / 2)), ax: [u3, w3, cross(u3, w3)], h: [(s1 - s0) / 2, dr / 2, twH / 2] });
    }
    push({
      id: `${id}-haunch`, supports: [id, ...(c.plates ? [pid] : [])], kind: 'member', from: [0, 0, -1], faces: [...web.faces, ...fl.faces], boxes, dots: [],
      info: { type: hn.kind === 'cut' ? 'Haunch, cut from an I' : 'Haunch, welded plates', of: id, sec: hn.kind === 'cut' ? sec : undefined, L: hn.L, member: a.id },
    });
    // eave bolts: above the rafter, then along its web and along the haunch
    // web (clear of the flanges, about 150 mm apart), then under the haunch
    const zs = [a.z + 45, ...rows(a.z - sec.tf / cos - 45, zA + sec.tf / cos + 45), ...rows(zA - 45, Bi[1] + 45), zB - 45];
    const dots = zs.flatMap((z) => [-1, 1].map((sg): Dot => ({ p: add(P(x0 + 1, z), mul(across, (sg * gauge) / 2)), n: hs })));
    if (c.bolts) push({ id: `${id}-bolts`, supports: [id, pid], kind: 'bolts', faces: [], dots, info: { type: 'Bolts', of: id, conn: ['end_plate'] } });
    // the ridge plate, welded on the rafter end: 25 mm above its top, 110
    // mm under its bottom (one row of bolts there)
    if (c.plates) {
      const rid = `${id}-to-conn`;
      const [zt, zb] = [zr + 25, zr - sec.d / cos - 110];
      const pl = flat(P(xm - T / 2, (zt + zb) / 2), across, Z, T, rect(wp, zt - zb));
      push({ id: rid, supports: [id], kind: 'plate', from: Z, faces: pl.faces, boxes: [pl.box], dots: [], info: { type: 'Ridge end plate', of: id, conn: ['end_plate'] } });
      const rows = [zr - sec.tf / cos - 45, zr - sec.d / cos + sec.tf / cos + 45, zr - sec.d / cos - 55];
      // one bolt through both plates: p on the ridge, given on the first side only
      const dots = side ? [] : rows.flatMap((z) => [-1, 1].map((sg): Dot => ({ p: add(P(xm, z), mul(across, (sg * gauge) / 2)), axis: mul(hs, -1), half: xm - x1 + 1 })));
      ridge.push({ id: rid, dots });
    }
  });
  if (c.bolts && ridge.length === 2)
    push({ id: `${a.id}-ridge-bolts`, supports: ridge.map((q) => q.id), kind: 'bolts', faces: [], dots: ridge.flatMap((q) => q.dots), info: { type: 'Bolts', of: `${a.id}-ridge`, conn: ['end_plate'] } });
  // the roof goes on last: the purlins of both rafters
  const pu = a.gable!.purlins;
  // the column, as a distance along the rafter top from its eave end
  const col = (c.reach - x0) / cos;
  if (pu?.sec) for (const r of roofs) out.push(...purlinParts(r.g, r.hs, r.across, a.gable!, pu, c, sec, col));
  return { parts: out, near: near! };
}

const CLEAT_T = 10; // mm

// Where the purlins go on a rafter: s, along its top from the eave end (mm).
// The first one keeps 100 mm clear of the eave plate (it stands 90 mm above
// the rafter, and the top of the purlin leans toward it by d tan), and 30 mm
// clear of the column at `col` (the column reach, along the rafter top). The
// last one 60 mm clear of the ridge plate. About `spacing` apart, at least
// two, or one in the middle when two don't fit.
export function purlinAt(Lg: number, c: Section, tan: number, spacing: number, col = 0): number[] {
  const s0 = Math.max(100, col + 30) + c.tw / 2 + CLEAT_T + c.d * tan;
  const s1 = Lg - (c.bf - c.tw / 2) - 60;
  if (s1 < s0) return [];
  if (s1 - s0 < 2 * (c.bf + CLEAT_T)) return [(s0 + s1) / 2];
  const n = Math.max(2, Math.round((s1 - s0) / spacing) + 1);
  return Array.from({ length: n }, (_, k) => s0 + ((s1 - s0) * k) / (n - 1));
}

// The purlins of one rafter g (its top of steel line, from the eave up), in
// build order: for each one the cleat, the channel, the bolts. hs: from the
// column to the ridge, across: out of the frame plane. The channel web is
// square to the roof, its flanges toward the ridge, and its cleat on the
// other side of the web.
function purlinParts(g: Geo, hs: V, across: V, gb: Gable, pu: Purlins, c: GableCtx, rafter: Section, col: number): Part[] {
  const ch = pu.sec!;
  const [sin, cos, tan] = [Math.sin(rad(gb)), Math.cos(rad(gb)), Math.tan(rad(gb))];
  const up = add(mul(hs, cos), mul(Z, sin)); // up the slope, along the rafter
  const n = add(mul(hs, -sin), mul(Z, cos)); // the roof normal
  const Lg = len(sub(g.p1, g.p0));
  const out: Part[] = [];
  // the cleat: as wide as two bolts need, but not wider than the rafter flange
  const wc = Math.min(rafter.bf, PITCH + 2 * EDGE);
  const offs = wc >= PITCH + 2 * EDGE ? [-PITCH / 2, PITCH / 2] : [0];
  const hc = Math.min(ch.d, ch.d / 2 + EDGE);
  purlinAt(Lg, ch, tan, pu.spacing, col).forEach((s, k) => {
    const id = `${g.id}-purlin${k + 1}`;
    const T = add(g.p0, mul(g.u, s)); // on the rafter top, on its axis
    const top = add(T, mul(n, ch.d));
    const pg = geo(id, ch, add(top, mul(across, -pu.L / 2)), add(top, mul(across, pu.L / 2)), true);
    pg.w = mul(n, -1);
    pg.v = cross(pg.w, pg.u);
    if (dot(pg.v, up) < 0) {
      [pg.p0, pg.p1, pg.u] = [pg.p1, pg.p0, mul(pg.u, -1)];
      pg.v = cross(pg.w, pg.u);
    }
    const cid = `${id}-cleat`;
    if (c.plates) {
      const pl = flat(add(add(T, mul(up, -ch.tw / 2 - CLEAT_T / 2)), mul(n, hc / 2)), across, n, CLEAT_T, rect(wc, hc));
      out.push({ id: cid, step: 0, supports: [g.id], kind: 'plate', from: Z, faces: pl.faces, boxes: [pl.box], dots: [], info: { type: 'Purlin cleat', of: id } });
    }
    out.push({
      id, step: 0, supports: [c.plates ? cid : g.id], kind: 'member', from: Z, faces: memberFaces(pg, c.seg), boxes: memberBoxes(pg), dots: [],
      info: { type: 'Purlin', sec: ch, L: pu.L }, // not in the solver model, so no member
    });
    // through the web and the cleat, half way up the channel
    const mid = add(add(T, mul(n, ch.d / 2)), mul(up, -CLEAT_T / 2));
    const dots = offs.map((o): Dot => ({ p: add(mid, mul(across, o)), axis: up, half: (ch.tw + CLEAT_T) / 2 }));
    if (c.bolts && c.plates) out.push({ id: `${id}-bolts`, step: 0, supports: [id, cid], kind: 'bolts', faces: [], dots, info: { type: 'Bolts', of: id } });
  });
  return out;
}

// bolt rows from z0 down to z1, about 150 mm apart. No room: one in the middle.
function rows(z0: number, z1: number): number[] {
  if (z0 - z1 < 40) return [(z0 + z1) / 2];
  const n = Math.max(1, Math.round((z0 - z1) / 150));
  return Array.from({ length: n + 1 }, (_, k) => z0 - ((z0 - z1) * k) / n);
}
const rect = (w: number, h: number): [number, number][] => [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
