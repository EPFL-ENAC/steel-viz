// Triangles of a planar polygon, for the WebGL viewer (webgl.ts) and the
// exact drawing (hlr.ts). No package.
//
// A corner on a straight side is dropped first: a flat triangle leaves a
// diagonal with only one triangle on it, and hlr.ts would draw it. A polygon
// with 5 corners or more can be concave (the end of an I section), so it is
// cut into ears, in the plane of the face.
import { add, cross, dot, norm, sub, type V } from './vec.ts';

// pts: the corners of one face, in order, all in one plane. The triangles go
// to out, 9 floats each.
export function triangles(pts: V[], out: number[]) {
  // drop the corners on a straight side, or they give flat triangles, and a
  // flat triangle leaves a diagonal with one triangle, so it gets drawn
  const flatAt = (p: V[], i: number) => {
    const a = sub(p[i], p[(i + p.length - 1) % p.length]);
    const b = sub(p[(i + 1) % p.length], p[i]);
    const k = cross(a, b);
    return dot(k, k) <= 1e-12 * dot(a, a) * dot(b, b);
  };
  if (pts.some((_, i) => flatAt(pts, i))) {
    pts = [...pts];
    for (let i = 0; i < pts.length && pts.length > 3; ) {
      if (flatAt(pts, i)) {
        pts.splice(i, 1);
        i = Math.max(0, i - 1);
      } else i++;
    }
  }
  if (pts.length < 3) return;
  if (pts.length === 3 || pts.length === 4) {
    for (let i = 1; i + 1 < pts.length; i++) out.push(...pts[0], ...pts[i], ...pts[i + 1]);
    return;
  }
  // not always convex (the end of an I section): cut off ears, in the face plane
  let n: V = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) n = add(n, cross(pts[i], pts[(i + 1) % pts.length]));
  n = norm(n);
  const e1 = norm(sub(pts[1], pts[0]));
  const e2 = cross(n, e1);
  const flat = pts.map((p) => [dot(sub(p, pts[0]), e1), dot(sub(p, pts[0]), e2)]);
  const turn = (a: number, b: number, c: number) =>
    (flat[b][0] - flat[a][0]) * (flat[c][1] - flat[a][1]) - (flat[b][1] - flat[a][1]) * (flat[c][0] - flat[a][0]);
  // the points are rotated to the view: a corner exactly on a line can come
  // out a hair off it, so the tests get a tolerance (in mm², from the face size)
  const size = Math.max(...flat.map((q) => Math.abs(q[0]) + Math.abs(q[1])));
  const tol = 1e-9 * size * size;
  const emit = (a: number, b: number, c: number) => {
    if (Math.abs(turn(a, b, c)) > tol) out.push(...pts[a], ...pts[b], ...pts[c]);
  };
  const left = pts.map((_, i) => i);
  while (left.length > 3) {
    let cut = false;
    for (let k = 0; k < left.length && !cut; k++) {
      const [a, b, c] = [left[(k + left.length - 1) % left.length], left[k], left[(k + 1) % left.length]];
      if (turn(a, b, c) <= tol) continue; // a corner that turns in, or a flat one: not an ear
      // an ear has no other corner inside it, or on its sides
      if (left.some((m) => m !== a && m !== b && m !== c && turn(a, b, m) >= -tol && turn(b, c, m) >= -tol && turn(c, a, m) >= -tol)) continue;
      emit(a, b, c);
      left.splice(k, 1);
      cut = true;
    }
    if (!cut) break; // a bad polygon: a fan for the rest
  }
  for (let i = 1; i + 1 < left.length; i++) emit(left[0], left[i], left[i + 1]);
}

