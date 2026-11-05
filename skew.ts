// Skewed arms: a tree arm that leaves a column flange at 30 or 45 degrees
// off the face normal (skewArms() in generate.ts). The beam end is cut at
// the skew, so it lies flat on the face: on an end plate (flat on the
// flange, bolted through it), or welded right on the flange.
//
// The cut end is the plane through g.p0 with normal n (the face normal, out
// of the column). The member is first made with square ends, then the points
// of its first ring slide along its axis onto that plane.
import { add, cross, dot, mul, norm, sub, type V } from './vec.ts';
import { box3, boxOf, EDGE, PITCH, SETBACK, type Box, type ConnType, type Face, type Geo, type Hardware } from './steel.ts';

// How far a point `a` mm across the member (along g.v) slides along g.u to
// reach the cut plane. The depth (g.w) is vertical and n is level, so the
// depth doesn't move it.
const slide = (g: Geo, n: V, a: number) => (-a * dot(g.v, n)) / dot(g.u, n);

// how far the cut end reaches past p0 along the member, at most, plus 10:
// the cut mark there keeps the first ring behind the second one
const skewReach = (g: Geo, n: V) => Math.max(slide(g, n, g.sec.bf / 2), slide(g, n, -g.sec.bf / 2), 0) + 10;

// the faces of the member, its first ring moved onto the cut plane. The side
// faces stay flat (a point moves along u, in their plane), the end face lies
// on the plane.
export function cutEnd(faces: Face[], g: Geo, n: V): Face[] {
  return faces.map((f) => {
    let hit = false;
    const pts = f.pts.map((p) => {
      const d = sub(p, g.p0);
      if (Math.abs(dot(d, g.u)) > 1e-6) return p;
      hit = true;
      return add(p, mul(g.u, slide(g, n, dot(d, g.v))));
    });
    return hit ? { ...f, pts } : f;
  });
}

// The boxes of the member (memberBoxes), the ones at the cut end made
// shorter so they stay inside the solid: each one starts where its farthest
// corner meets the plane. A wide box (a flange) is split in two first, so
// each half stays close to the cut.
export function cutBoxes(boxes: Box[], g: Geo, n: V): Box[] {
  return boxes.flatMap((b) => {
    const mid = dot(sub(b.c, g.p0), g.u);
    if (Math.abs(mid - b.h[2]) > 1e-6) return [b];
    const a = dot(sub(b.c, g.p0), g.v);
    const halves: [number, number][] = b.h[0] > 20 ? [[a - b.h[0], a], [a, a + b.h[0]]] : [[a - b.h[0], a + b.h[0]]];
    return halves.flatMap(([a0, a1]) => {
      const t0 = Math.max(0, slide(g, n, a0), slide(g, n, a1));
      const t1 = 2 * b.h[2];
      if (t1 - t0 < 1) return [];
      const c = add(add(b.c, mul(g.v, (a0 + a1) / 2 - a)), mul(g.u, (t0 + t1) / 2 - mid));
      return [{ c, ax: b.ax, h: [(a1 - a0) / 2, b.h[1], (t1 - t0) / 2] as [number, number, number] }];
    });
  });
}

// The skewed end plate: flat on the column flange S (its normal n), `t`
// thick (the gap the beam leaves). It covers the cut end of the beam plus 15
// mm on each side, and reaches 90 mm above and below the beam, like the
// square extended end plate. Four rows of bolts, two lines centred on the
// column, so every bolt goes through its flange.
function skewEndPlate(g: Geo, n: V, t: number, S: Geo, hw: Hardware) {
  const up: V = [0, 0, 1];
  const along = norm(cross(up, n)); // on the face, level
  const half = g.sec.bf / (2 * Math.abs(dot(g.u, n)));
  const o = dot(sub(g.p0, S.p0), along); // the beam, across from the column axis
  const gauge = Math.max(PITCH, Math.min(2 * half + 30 - 2 * EDGE, S.sec.bf - 2 * EDGE));
  const [lo, hi] = [Math.min(o - half - 15, -gauge / 2 - EDGE), Math.max(o + half + 15, gauge / 2 + EDGE)];
  const c0 = add(g.p0, mul(along, -o)); // on the column axis, at the top of the beam
  const centre = add(add(add(c0, mul(along, (lo + hi) / 2)), mul(g.w, g.d / 2)), mul(n, -t / 2));
  const [sy, sz] = [hi - lo, g.d + 180];
  hw.faces.push(...box3(centre, along, up, t, sy, sz));
  hw.boxes.push(boxOf(centre, along, up, t, sy, sz));
  for (const depth of [-45, g.sec.tf + 45, g.d - g.sec.tf - 45, g.d + 45])
    for (const s of [-1, 1]) hw.dots.push({ p: add(add(add(c0, mul(g.w, depth)), mul(along, (s * gauge) / 2)), mul(n, 1)), n });
}

// The hardware of a skewed end on the column S: the end plate, or nothing
// for a weld. Its reach puts a cut mark past the cut end (see cutEnd).
export function skewHardware(g: Geo, conn: ConnType, n: V, S: Geo): Hardware {
  const hw: Hardware = { faces: [], dots: [], reach: [], boxes: [] };
  if (conn === 'end_plate') skewEndPlate(g, n, SETBACK.end_plate, S, hw);
  hw.reach.push(skewReach(g, n));
  return hw;
}
