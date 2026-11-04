// Triangles of a planar polygon, for the WebGL viewer (webgl.ts) and the
// exact drawing (hlr.ts). No three.js here, so the viewer loads none.
//
// A polygon with 5 corners or more can be concave (the end of an I section),
// so it goes through earcut: the part of mapbox/earcut v3.0.2 that three.js
// ran for us (ShapeUtils.triangulateShape), for a polygon with no hole and
// under 80 corners. Same steps, so the same triangles in the same order, and
// hlr.ts draws the same lines. earcut: ISC license, Copyright (c) 2016, Mapbox.
import { cross, dot, norm, sub, type V } from './vec.ts';

type Node = { i: number; x: number; y: number; prev: Node; next: Node };

// pts: the corners of one face, in order, all in one plane. The triangles go
// to out, 9 floats each.
export function triangles(pts: V[], out: number[]) {
  if (pts.length === 3 || pts.length === 4) {
    for (let i = 1; i + 1 < pts.length; i++) out.push(...pts[0], ...pts[i], ...pts[i + 1]);
    return;
  }
  // flat, in the plane of the face
  const n = norm(cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])));
  const e1 = norm(sub(pts[1], pts[0]));
  const e2 = cross(n, e1);
  const flat = pts.map((p) => [dot(sub(p, pts[0]), e1), dot(sub(p, pts[0]), e2)]);
  const m = flat.length;
  if (m > 2 && flat[m - 1][0] === flat[0][0] && flat[m - 1][1] === flat[0][1]) flat.pop();
  for (const i of earcut(flat)) out.push(...pts[i]);
}

// the corner ids, three per triangle
function earcut(flat: number[][]): number[] {
  const tris: number[] = [];
  const ear = ring(flat);
  if (ear && ear.next !== ear.prev) slice(ear, tris, 0);
  return tris;
}

// twice the signed area, in the sign of earcut
const area = (p: Node, q: Node, r: Node) => (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
const same = (a: Node, b: Node) => a.x === b.x && a.y === b.y;

// the corners as a ring, turning clockwise in earcut's terms
function ring(flat: number[][]): Node | undefined {
  let sum = 0;
  for (let i = 0, j = flat.length - 1; i < flat.length; j = i++) sum += (flat[j][0] - flat[i][0]) * (flat[i][1] + flat[j][1]);
  let last: Node | undefined;
  const ids = flat.map((_, i) => i);
  for (const i of sum > 0 ? ids : ids.reverse()) last = insert(i, flat[i][0], flat[i][1], last);
  if (last && same(last, last.next)) {
    remove(last);
    last = last.next;
  }
  return last;
}

function insert(i: number, x: number, y: number, last?: Node): Node {
  const p = { i, x, y } as Node;
  if (!last) [p.prev, p.next] = [p, p];
  else {
    [p.next, p.prev] = [last.next, last];
    last.next.prev = p;
    last.next = p;
  }
  return p;
}

function remove(p: Node) {
  p.next.prev = p.prev;
  p.prev.next = p.next;
}

// drop the corners that sit twice, or on a straight line
function filter(start: Node): Node {
  let [p, end] = [start, start];
  let again: boolean;
  do {
    again = false;
    if (same(p, p.next) || area(p.prev, p, p.next) === 0) {
      remove(p);
      p = end = p.prev;
      if (p === p.next) break;
      again = true;
    } else p = p.next;
  } while (again || p !== end);
  return end;
}

// cut ears one by one. Pass 0 as is, pass 1 after filter(). earcut has two
// more passes for polygons that cross themselves; ours never do, so what is
// left then is a fan.
function slice(ear: Node, tris: number[], pass: number) {
  let stop = ear;
  while (ear.prev !== ear.next) {
    const [prev, next] = [ear.prev, ear.next];
    if (isEar(ear)) {
      tris.push(prev.i, ear.i, next.i);
      remove(ear);
      // skipping the next corner gives fewer thin triangles
      ear = stop = next.next;
      continue;
    }
    ear = next;
    if (ear === stop) {
      if (!pass) slice(filter(ear), tris, 1);
      else for (let p = ear.next; p.next !== ear; p = p.next) tris.push(ear.i, p.i, p.next.i);
      return;
    }
  }
}

function isEar(ear: Node): boolean {
  const [a, b, c] = [ear.prev, ear, ear.next];
  if (area(a, b, c) >= 0) return false; // reflex
  // no reflex corner inside the triangle
  const [x0, y0] = [Math.min(a.x, b.x, c.x), Math.min(a.y, b.y, c.y)];
  const [x1, y1] = [Math.max(a.x, b.x, c.x), Math.max(a.y, b.y, c.y)];
  for (let p = c.next; p !== a; p = p.next)
    if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && !(a.x === p.x && a.y === p.y) && inside(a, b, c, p) && area(p.prev, p, p.next) >= 0)
      return false;
  return true;
}

const inside = (a: Node, b: Node, c: Node, p: Node) =>
  (c.x - p.x) * (a.y - p.y) >= (a.x - p.x) * (c.y - p.y) &&
  (a.x - p.x) * (b.y - p.y) >= (b.x - p.x) * (a.y - p.y) &&
  (b.x - p.x) * (c.y - p.y) >= (c.x - p.x) * (b.y - p.y);
