// The deformed shape of a hub test, from its measured responses.
//
// The responses are one or two numbers per step, not a field. So the shape is
// a schematic model that matches the measured numbers. Each table has its own
// model (deform-<table>.ts, listed in deforms.ts). It gives one Move per part,
// and the same three renderers take it: movePoint() here, the MOVE chunk of
// webgl.ts (the same math on the GPU), and deformParts() for a drawing.
//
// All the math is linear in the angles (a turn of r moves a point by r times
// its lever arm). So `scale` only multiplies the angles, and two parts glued
// together stay glued at any scale. Sections stretch a little: 0.5 % at 0.1 rad.
//
// No WebGL and no Node API here.
import { add, cross, dot, mul, norm, sub, type V } from './vec.ts';
import type { Result } from './generate.ts';
import type { HubRecord } from './hub.ts';
import type { Specimen } from './specimen.ts';
import type { Part } from './steel.ts';

// ------------------------------------------------------------- the moves
export type M4 = number[]; // 4x4, by column
// A knot along the axis of a part. s: mm from Move.o. w: the deflection along
// Move.n. t: dw/ds (rad). r: the turn of the cross section (rad). r = t:
// plane sections stay square to the axis (bending). r != t: shear (a panel
// zone, later an EBF link).
export type Knot = { s: number; w: number; t: number; r: number };
// How a part moves. First the bend along its axis (w, t: cubic Hermite between
// the knots, r: linear, past the ends: straight on). Then the affine moves A
// and B, blended along the axis from split[0] to split[1] (a hard split when
// they are equal). No knots: no bend. No B: A alone.
export type Move = { o: V; u: V; n: V; knots: Knot[]; A: M4; B?: M4; split?: [number, number] };
// A working zone: a box in the undeformed frame, colored by level (1: the
// capacity). slot: its color in Colors.zones. 0 moment, 1 shear.
export type Zone = { c: V; axes: [V, V, V]; half: V; level: number; slot: number; label: string; ratio: string };
// notes: what the model had to guess, for the legend
export type DeformState = { moves: Record<string, Move>; zones: Zone[]; scale: number; notes?: string[] };

export const MAX_KNOTS = 8; // webgl.ts has room for this many
export const MAX_ZONES = 4;

export const I4 = (): M4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export const applyM = (m: M4, p: V): V => [0, 1, 2].map((i) => m[i] * p[0] + m[4 + i] * p[1] + m[8 + i] * p[2] + m[12 + i]) as V;
export function mulM(a: M4, b: M4): M4 {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}
export const shift = (v: V): M4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, v[0], v[1], v[2], 1];
// A small turn of r about c, that takes direction b toward direction a. Linear:
// p + r * (a (b . d) - b (a . d)), with d = p - c.
export function tilt(c: V, a: V, b: V, r: number): M4 {
  const m = I4();
  for (let col = 0; col < 3; col++) for (let row = 0; row < 3; row++) m[col * 4 + row] += r * (a[row] * b[col] - b[row] * a[col]);
  const t = applyM(m, c);
  for (let row = 0; row < 3; row++) m[12 + row] = c[row] - t[row];
  return m;
}
// the real turn that takes unit vector a to unit vector b
function turnTo(a: V, b: V): M4 {
  const [v, c] = [cross(a, b), dot(a, b)];
  const k = 1 / (1 + c);
  const [x, y, z] = v;
  return [
    1 - k * (y * y + z * z), z + k * x * y, -y + k * x * z, 0,
    -z + k * x * y, 1 - k * (x * x + z * z), x + k * y * z, 0,
    y + k * x * z, -x + k * y * z, 1 - k * (x * x + y * y), 0,
    0, 0, 0, 1,
  ];
}

// w and t at s, between two knots
export function hermite(p: Knot, q: Knot, s: number) {
  const h = q.s - p.s;
  const x = (s - p.s) / h;
  const [x2, x3] = [x * x, x * x * x];
  return {
    w: (2 * x3 - 3 * x2 + 1) * p.w + (x3 - 2 * x2 + x) * h * p.t + (3 * x2 - 2 * x3) * q.w + (x3 - x2) * h * q.t,
    t: ((6 * x2 - 6 * x) * (p.w - q.w)) / h + (3 * x2 - 4 * x + 1) * p.t + (3 * x2 - 2 * x) * q.t,
  };
}
// w and r at s
function bendAt(k: Knot[], s: number) {
  const [a, z] = [k[0], k[k.length - 1]];
  if (s <= a.s) return { w: a.w + a.t * (s - a.s), r: a.r };
  if (s >= z.s) return { w: z.w + z.t * (s - z.s), r: z.r };
  let i = 0;
  while (s > k[i + 1].s) i++;
  const [p, q] = [k[i], k[i + 1]];
  return { w: hermite(p, q, s).w, r: p.r + ((q.r - p.r) * (s - p.s)) / (q.s - p.s) };
}

// Where a point of a part goes. The MOVE chunk of webgl.ts does the same math:
// change both, or the view and the tests stop matching.
export function movePoint(p: V, m: Move): V {
  const d = sub(p, m.o);
  const s = dot(d, m.u);
  let q = p;
  if (m.knots.length) {
    const { w, r } = bendAt(m.knots, s);
    q = add(p, add(mul(m.n, w), mul(m.u, -dot(d, m.n) * r)));
  }
  const a = applyM(m.A, q);
  if (!m.B) return a;
  const [s0, s1] = m.split ?? [0, 0];
  const f = s1 > s0 ? Math.min(1, Math.max(0, (s - s0) / (s1 - s0))) : s >= s0 ? 1 : 0;
  return add(mul(a, 1 - f), mul(applyM(m.B, q), f));
}

// The parts with a move, with their points moved. For the tests and for one
// deformed frame in the SVG.
export function deformParts(parts: Part[], d: DeformState): Part[] {
  return parts.map((p) => {
    const m = d.moves[p.id];
    if (!m) return p;
    return {
      ...p,
      faces: p.faces.map((f) => ({ ...f, pts: f.pts.map((x) => movePoint(x, m)) })),
      dots: p.dots.map((t) => ({ ...t, p: movePoint(t.p, m) })),
    };
  });
}

// A part with no move of its own takes the move of the first part it stands
// on (Part.supports) that has one, so plates, bolts and the loading head
// follow with no rule each. A part that stands on nothing that moves stays.
export function follow(parts: Part[], moves: Record<string, Move>): Record<string, Move> {
  const out = { ...moves };
  const byId = new Map(parts.map((p) => [p.id, p]));
  const find = (id: string, seen: Set<string>): Move | undefined => {
    if (out[id]) return out[id];
    if (seen.has(id)) return undefined;
    seen.add(id);
    for (const s of byId.get(id)?.supports ?? []) {
      const m = find(s, seen);
      if (m) return m;
    }
    return undefined;
  };
  for (const p of parts) {
    const m = find(p.id, new Set());
    if (m) out[p.id] = m;
  }
  return out;
}

// A straight rig part between two pins, p0 and p1, that go to q0 and q1: an
// actuator or a pinned link. Each end turns with the new direction and stays
// on its pin. The piece from split[0] to split[1] (mm from p0) takes the
// change of length: the rod of an actuator, the bar of a link.
export function strut(p0: V, p1: V, q0: V, q1: V, split: [number, number]): Move {
  const [u, v] = [norm(sub(p1, p0)), norm(sub(q1, q0))];
  const R = turnTo(u, v);
  const at = (p: V, q: V) => mulM(shift(q), mulM(R, shift(mul(p, -1))));
  return { o: p0, u, n: [0, 0, 0], knots: [], A: at(p0, q0), B: at(p1, q1), split };
}

// ------------------------------------------------------------- the responses
// One file of a test: resslab-hub-data/<table>/<folder>/<id>.csv, x and y its
// two columns, for the chart.
// slot: the zone it speaks about (Zone.slot): the chart takes the same color
export type ResponseSpec = { folder: string; x: string; y: string; label: string; xUnit: string; yUnit: string; slot?: number };
export type Curve = { x: number[]; y: number[] };

// The first two columns of a response file. It takes a BOM, a quoted header, a
// trailing comma and E notation. Rows that are not two numbers (NA, NR) go.
export function readResponse(csv: string): Curve {
  const c: Curve = { x: [], y: [] };
  for (const line of csv.replace(/^﻿/, '').split(/\r?\n/).slice(1)) {
    const [a, b] = line.split(',');
    const [x, y] = [Number(a), Number(b)];
    if (!a?.trim() || !b?.trim() || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    c.x.push(x);
    c.y.push(y);
  }
  return c;
}

// the largest |x| (a spread is too much for a file of 57000 rows)
export const biggest = (x: number[]) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

// the rows where x turns back by more than eps
function turns(x: number[], eps: number): number[] {
  const out: number[] = [];
  let [dir, top] = [0, 0];
  for (let i = 1; i < x.length; i++) {
    if (!dir) {
      if (Math.abs(x[i] - x[0]) > eps) [dir, top] = [Math.sign(x[i] - x[0]), i];
    } else if (dir * (x[i] - x[top]) > 0) top = i;
    else if (dir * (x[top] - x[i]) > eps) {
      out.push(top);
      [dir, top] = [-dir, i];
    }
  }
  return out;
}
// At most max rows: the first, the last, every turn of x, then even steps. A
// noisy file has more turns than that: then the small ones go first.
function thinRows(x: number[], max: number): number[] {
  const n = x.length;
  if (n <= max) return [...x.keys()];
  let eps = 0;
  const range = biggest(x) || 1;
  let peaks = turns(x, eps);
  while (peaks.length > max - 2) peaks = turns(x, (eps = eps ? 2 * eps : range / 1000));
  const rows = new Set([0, n - 1, ...peaks]);
  const free = max - rows.size;
  for (let k = 1; k <= free; k++) rows.add(Math.round((k * (n - 1)) / (free + 1)));
  return [...rows].sort((a, b) => a - b);
}
export function thin(c: Curve, max = 2000): Curve {
  const rows = thinRows(c.x, max);
  return { x: rows.map((i) => c.x[i]), y: rows.map((i) => c.y[i]) };
}

// The pseudo time of each row, 0 to 1: how far x has traveled. Moves under
// eps don't count, or the noise of a long file makes its time run fast.
function travel(x: number[]): number[] {
  const eps = biggest(x) / 500;
  const t = new Array<number>(x.length).fill(0);
  let [a, sum] = [x[0], 0];
  for (let i = 1; i < x.length; i++) {
    if (Math.abs(x[i] - a) > eps) [sum, a] = [sum + Math.abs(x[i] - a), x[i]];
    t[i] = sum;
  }
  return t.map((v, i) => (sum ? v / sum : i / Math.max(1, x.length - 1)));
}
// x and y at pseudo time t
function atTime(t: number, time: number[], c: Curve) {
  let [lo, hi] = [0, time.length - 1];
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (time[m] < t) lo = m + 1;
    else hi = m;
  }
  if (!lo) return { x: c.x[0], y: c.y[0] };
  const f = time[lo] > time[lo - 1] ? (t - time[lo - 1]) / (time[lo] - time[lo - 1]) : 1;
  return { x: c.x[lo - 1] + f * (c.x[lo] - c.x[lo - 1]), y: c.y[lo - 1] + f * (c.y[lo] - c.y[lo - 1]) };
}

// One step of one file. along: x, with the sign that goes with the driver. The
// files of a test don't all count the same way (the west beam turns the other
// way in some of them).
export type Sample = { x: number; y: number; along: number };
export type Samples = Record<string, Sample>;
// The steps of a test. driver: the file that gives the steps. series: each
// file read at the steps. at(i): every file at step i.
export type Protocol = { n: number; driver: string; series: Record<string, Curve>; at(i: number): Samples };

// The files of a test don't share a step. When they have the same row count,
// row i is step i. Otherwise the steps are the rows of the driver (Global if
// there is one, else the longest file) and each file is read at the same
// pseudo time. A loading protocol is cycles of growing amplitude, so this is
// close. It is not exact.
export function protocol(curves: Record<string, Curve>, max = 2000): Protocol {
  const names = Object.keys(curves).filter((k) => curves[k].x.length);
  if (!names.length) throw new Error('no response with data');
  const driver = names.includes('Global') ? 'Global' : names.reduce((a, b) => (curves[b].x.length > curves[a].x.length ? b : a));
  const d = curves[driver];
  const rows = thinRows(d.x, max);
  const same = names.every((k) => curves[k].x.length === d.x.length);
  const series: Record<string, Curve> = {};
  const dt = same ? [] : travel(d.x);
  for (const k of names) {
    const c = curves[k];
    if (same) series[k] = { x: rows.map((i) => c.x[i]), y: rows.map((i) => c.y[i]) };
    else {
      const t = travel(c.x);
      const at = rows.map((i) => atTime(dt[i], t, c));
      series[k] = { x: at.map((p) => p.x), y: at.map((p) => p.y) };
    }
  }
  const sign = Object.fromEntries(names.map((k) => {
    const s = series[k].x.reduce((sum, x, i) => sum + x * series[driver].x[i], 0);
    return [k, s < 0 ? -1 : 1];
  }));
  return {
    n: rows.length, driver, series,
    at: (i) => Object.fromEntries(names.map((k) => {
      const [x, y] = [series[k].x[i], series[k].y[i]];
      return [k, { x, y, along: sign[k] * x }];
    })),
  };
}

// The smallest usual scale that makes the largest angle reach about `angle`
export function scaleFor(largest: number, angle = 0.1): number {
  return SCALES.find((k) => largest * k >= angle) ?? SCALES[SCALES.length - 1];
}
export const SCALES = [1, 2, 5, 10, 20];

// ------------------------------------------------------------- a table
// How a hub table plugs in: deforms.ts lists one of these for each table.
export type DeformTable = {
  responses: ResponseSpec[]; // its folders in resslab-hub-data/<table>/
  // the moves and the zones at one step, the angles times scale
  shape(r: Result, spec: Specimen, record: HubRecord, at: Samples, scale: number): DeformState;
  autoScale(p: Protocol): number;
};
