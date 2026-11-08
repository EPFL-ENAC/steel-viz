// The concrete slab of a beam-to-column test, on the top flange: the concrete,
// and the deck ribs under it. Only a specimen gets one, so seeds don't change.
//
// The data gives the widths, the depths and the mean rib width. It gives no
// slab length and no rib spacing, so we take them here (SLAB_NOTE says so).
// - One part per beam, on its beam: follow() of deform.ts moves it with the
//   beam. So its faces are cut at the same stations as the beam.
// - An opening around the column. An interior slab stops at the column axis,
//   where the part of the other beam starts. An exterior slab goes around the
//   column and stops past its back flange.
// - One side for all the beams: `left` and `right` look along the first beam,
//   so they don't flip on the second beam.
//
// The renderers draw the slab light, so it hides no steel (hlr.ts, webgl.ts).
// Units are mm. No three.js and no Node API here.
import { boxOf, type Box, type Face, type Part } from './steel.ts';
import type { ConnSpecimen } from './specimen.ts';
import { cross, dot, mul, sub, type V } from './vec.ts';

export type Slab = NonNullable<ConnSpecimen['slab']>;
// a beam under the slab. o: on the column axis, h: along the beam, z: the top
// of steel, end: where the slab stops, from the column axis.
export type SlabBeam = { id: string; z: number; o: V; h: V; end: number };

export const SLAB_GAP = 25; // free around the column
export const TIP_GAP = 100; // between the slab end and the pin plate at the beam tip
export const RIB_PITCH = 305; // the usual 12 in of a 2 in or 3 in deck
const BACK = 100; // an exterior slab, past the back flange of the column
const Z: V = [0, 0, 1];

export const SLAB_NOTE = `the slab length and the rib spacing are not in the data: it stops ${TIP_GAP} mm before the tip rig, with a rib every ${RIB_PITCH} mm`;

// sorted, with `must` as given. Another station closer than this to a kept one
// would only give a sliver.
const NEAR = 0.5;
function stations(must: number[], more: number[], lo: number, hi: number): number[] {
  const out = [...new Set(must)];
  for (const s of [...more].sort((a, b) => a - b))
    if (s > lo && s < hi && out.every((k) => Math.abs(k - s) > NEAR)) out.push(s);
  return out.sort((a, b) => a - b);
}

// A solid with a flat top and bottom, as a grid of cells: ss along the beam,
// xs across it, `at` gives the points. has(i, j): is there a cell. The cells
// share their corners exactly, so hlr.ts sees no line between them. edges has
// only the real outline, for the 3D view. Corners go counter clockwise from
// outside: the painter render skips the faces that look away.
function solid(ss: number[], xs: number[], z0: number, z1: number, at: (s: number, x: number, z: number) => V, has: (i: number, j: number) => boolean, top: boolean): Face[] {
  const faces: Face[] = [];
  const quad = (pts: V[], out: V, edges: [number, number][]) => {
    const n = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]));
    faces.push(dot(n, out) > 0 ? { pts, edges } : { pts: [...pts].reverse(), edges: edges.map(([a, b]) => [3 - a, 3 - b]) });
  };
  const there = (i: number, j: number) => i >= 0 && j >= 0 && i < ss.length - 1 && j < xs.length - 1 && has(i, j);
  // the direction of +s and +x in space (a grid can be mirrored)
  const [ds, dx] = [sub(at(1, 0, 0), at(0, 0, 0)), sub(at(0, 1, 0), at(0, 0, 0))];
  for (let i = 0; i + 1 < ss.length; i++)
    for (let j = 0; j + 1 < xs.length; j++) {
      if (!there(i, j)) continue;
      const [s0, s1, x0, x1] = [ss[i], ss[i + 1], xs[j], xs[j + 1]];
      const flat = (z: number): V[] => [at(s0, x0, z), at(s1, x0, z), at(s1, x1, z), at(s0, x1, z)];
      const line: [number, number][] = [];
      if (!there(i, j - 1)) line.push([0, 1]);
      if (!there(i + 1, j)) line.push([1, 2]);
      if (!there(i, j + 1)) line.push([2, 3]);
      if (!there(i - 1, j)) line.push([3, 0]);
      if (top) quad(flat(z1), Z, line);
      quad(flat(z0), mul(Z, -1), line);
      // the walls, where no cell is next to this one: [di, dj, its two ends, normal]
      const walls: [number, number, [number, number], [number, number], V][] = [
        [0, -1, [s0, x0], [s1, x0], mul(dx, -1)],
        [0, 1, [s0, x1], [s1, x1], dx],
        [-1, 0, [s0, x0], [s0, x1], mul(ds, -1)],
        [1, 0, [s1, x0], [s1, x1], ds],
      ];
      for (const [di, dj, a, b, out] of walls) {
        if (there(i + di, j + dj)) continue;
        // no corner line where the wall goes straight on in the next cell
        const [ai, aj] = dj ? [1, 0] : [0, 1];
        const on = (k: number) => there(i + k * ai, j + k * aj) && !there(i + k * ai + di, j + k * aj + dj);
        const edges: [number, number][] = [[0, 1], [2, 3]];
        if (!on(1)) edges.push([1, 2]);
        if (!on(-1)) edges.push([3, 0]);
        quad([at(a[0], a[1], z0), at(b[0], b[1], z0), at(b[0], b[1], z1), at(a[0], a[1], z1)], out, edges);
      }
    }
  return faces;
}

// One part per beam, after the beams in `res`. across: where `right` is.
export function slabParts(slab: Slab, col: { d: number; bf: number }, beams: SlabBeam[], across: V, res: Part[]): Part[] {
  const [openS, openX] = [col.d / 2 + SLAB_GAP, col.bf / 2 + SLAB_GAP];
  return beams.map(({ id, z, o, h, end }) => {
    if (end <= openS + SLAB_GAP) throw new Error(`${id}: the beam is too short for a slab, it would stop ${end} mm from the column axis`);
    const beam = res.find((p) => p.id === id)!;
    const along = (p: V) => dot(sub(p, o), h);
    const at = (s: number, x: number, zz: number): V => [o[0] + h[0] * s + across[0] * x, o[1] + h[1] * s + across[1] * x, zz];
    const [zr, zc] = [z + slab.rib, z + slab.rib + slab.concrete];
    const interior = beams.some((b) => dot(b.h, h) < -0.5);
    const from = interior ? 0 : -(col.d / 2 + BACK);

    // the ribs start past the opening and the connection plates: only the
    // concrete is above a flange plate
    const conn = res.find((p) => p.id === `${id}-from-conn`)?.boxes ?? [];
    const s0 = Math.max(openS, ...conn.map((b) => along(b.c) + b.ax.reduce((t, ax, k) => t + Math.abs(dot(ax, h)) * b.h[k], 0))) + SLAB_GAP;
    const half = slab.ribWidth / 2;
    const ribs: [number, number, number, number][] = []; // s0, s1, x0, x1
    if (slab.ribs === 'parallel') {
      if (s0 < end)
        for (const side of [0, -1, 1])
          for (let k = side ? 1 : 0, x = side * k * RIB_PITCH; side ? x - half >= -slab.left && x + half <= slab.right : k < 1; k++, x = side * k * RIB_PITCH)
            ribs.push([s0, end, x - half, x + half]);
    } else {
      for (let s = s0; s + slab.ribWidth <= end; s += RIB_PITCH) ribs.push([s, s + slab.ribWidth, -slab.left, slab.right]);
    }

    // the stations: all those of the beam, so the slab bends like it
    const must = [from, ...(interior ? [] : [-openS]), openS, end, ...ribs.flatMap(([a, b]) => [a, b])];
    const ss = stations(must, beam.faces.flatMap((f) => f.pts.map(along)), from, end);
    const xs = [-slab.left, -openX, openX, slab.right];
    const inOpening = (i: number, j: number) => j === 1 && ss[i] >= -openS - NEAR && ss[i + 1] <= openS + NEAR;
    const faces = solid(ss, xs, zr, zc, at, (i, j) => !inOpening(i, j), true);
    for (const [a, b, x0, x1] of ribs)
      faces.push(...solid(ss.filter((s) => s >= a && s <= b), [x0, x1], z, zr, at, () => true, false));

    // boxes: strips around the opening (one box would swallow the column), and the ribs
    const box = (a: number, b: number, x0: number, x1: number, z0: number, z1: number): Box =>
      boxOf(at((a + b) / 2, (x0 + x1) / 2, (z0 + z1) / 2), across, Z, b - a, x1 - x0, z1 - z0);
    const boxes = [
      box(from, end, -slab.left, -openX, zr, zc),
      box(from, end, openX, slab.right, zr, zc),
      box(openS, end, -openX, openX, zr, zc),
      ...(interior ? [] : [box(from, -openS, -openX, openX, zr, zc)]),
      ...ribs.map(([a, b, x0, x1]) => box(a, b, x0, x1, z, zr)),
    ];
    return { id: `${id}-slab`, step: 0, supports: [id], kind: 'slab', from: Z, faces, boxes, dots: [], info: { type: 'Concrete slab', of: id } };
  });
}
