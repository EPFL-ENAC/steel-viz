// Line drawing with exact hidden lines, in plain TypeScript (no package, so
// it runs in Node and in the browser, from the light entry).
//
// Every face is cut in triangles, seen from the camera: x to the right, y
// down the screen, d the depth toward the camera, all in mm. The lines are
// the triangle edges where the surface folds by FOLD degrees or more, where
// it turns away from the camera (a silhouette, the outline of a round bar),
// or where a face has no neighbour. A grid on the screen holds the
// triangles. For each line we take the triangles of the cells it crosses,
// and cut out the pieces that are inside a triangle on screen and behind its
// plane. The rest is visible. A line that lies on a surface is not behind
// it, so it stays.
//
// The build animation needs one more thing. A line hidden in the finished
// drawing can be visible earlier, before the part in front of it arrives.
// So for each hidden piece we find the part in front of it (the grid again),
// and draw the piece from its own step until that part lands.
// Parts fly in from outside the frame (members along their axis, the
// column from above), then their bolts pop in one by one.
//
// Two line weights, as in a technical drawing: outlines thick, inner edges
// thin. We look just beside each line, on both sides. It is an outline when
// one side sees nothing, a surface more than DEEP mm behind the line, or
// another part behind the line (so each part keeps its own outline).
//
// A line that goes behind something stops a little before it, so a gap
// shows the depth. We look just past each end of a line: when a surface
// sits in front of where the line would go, we cut the end back.
//
// Line widths are in mm at the drawing scale, or in px when `size` says
// how many px wide the drawing will be shown (a logo, a favicon).
import { add, cross, dot, mul, norm, sub, type V } from './vec.ts';
import { BOLT_MS, camera, forSize, timeline, type Face, type Part, type RenderOpts } from './steel.ts';
import { triangles } from './triangles.ts';

const HEAD = 13; // bolt head height, mm (M20)
const SOLID = 400; // px: up to this drawing size, bolt heads are solid
const DEEP = 50; // mm: a jump in depth bigger than this makes an outline
const SIDE = 1.5; // mm: how far beside (or past the end of) a line we look
const FRONT = 5; // mm: a surface this much in front of a line end hides it
const FOLD = 50; // degrees: a fold this sharp or more makes a line
const EPS = 1e-3; // mm: a surface must be this much in front of a line to hide it

// a hex head: its corners, and its faces
function hexHead(b: V, nn: V, R: number): { corners: V[]; faces: Face[] } {
  const ref: V = Math.abs(nn[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  const a1 = norm(cross(nn, ref));
  const a2 = cross(nn, a1);
  const ring = (h: number) =>
    [0, 1, 2, 3, 4, 5].map((k) => add(add(b, mul(nn, h)), add(mul(a1, R * Math.cos((k * Math.PI) / 3)), mul(a2, R * Math.sin((k * Math.PI) / 3)))));
  const lo = ring(0);
  const hi = ring(HEAD);
  const faces: Face[] = [{ pts: hi, edges: [] }, { pts: [...lo].reverse(), edges: [] }];
  for (let i = 0; i < 6; i++) faces.push({ pts: [lo[i], lo[(i + 1) % 6], hi[(i + 1) % 6], hi[i]], edges: [] });
  return { corners: [...lo, ...hi], faces };
}

// ------------------------------------------------------------- the lines
// A point in view space is [x, d, y]: screen right, depth toward the camera,
// screen down. A triangle list is 9 numbers per triangle.

// The edges of one part that make a line: where two triangles fold by FOLD
// or more, a silhouette, or an edge with one triangle (or three). Corners are
// matched at 0.1 mm. The two tests only use the third corner of each
// triangle, so the triangles don't need the same winding (ours don't).
function edgesOf(tri: number[], out: V[][]) {
  const ids = new Map<string, number>();
  const id = (p: V) => {
    const k = `${Math.round(p[0] * 10)},${Math.round(p[1] * 10)},${Math.round(p[2] * 10)}`;
    let i = ids.get(k);
    if (i === undefined) ids.set(k, (i = ids.size));
    return i;
  };
  const map = new Map<number, { a: V; b: V; third: V[] }>();
  for (let k = 0; k < tri.length; k += 9) {
    const P: V[] = [0, 3, 6].map((o) => [tri[k + o], tri[k + o + 1], tri[k + o + 2]] as V);
    const I = P.map(id);
    if (I[0] === I[1] || I[1] === I[2] || I[2] === I[0]) continue;
    for (let j = 0; j < 3; j++) {
      const [u, w] = [I[j], I[(j + 1) % 3]];
      const key = Math.min(u, w) * 2 ** 26 + Math.max(u, w);
      let e = map.get(key);
      if (!e) map.set(key, (e = { a: P[j], b: P[(j + 1) % 3], third: [] }));
      e.third.push(P[(j + 2) % 3]);
    }
  }
  const sharp = -Math.cos((FOLD * Math.PI) / 180);
  for (const { a, b, third } of map.values()) {
    const ev = sub(b, a);
    if (Math.hypot(ev[0], ev[2]) < 1e-6) continue; // seen end on: a point
    if (third.length === 2) {
      // from the edge to the third corner, square to the edge
      const [u1, u2] = third.map((t) => {
        const w = sub(t, a);
        return sub(w, mul(ev, dot(w, ev) / dot(ev, ev)));
      });
      const [l1, l2] = [Math.hypot(...u1), Math.hypot(...u2)];
      const fold = dot(u1, u2) / (l1 * l2) >= sharp;
      // on screen, on which side of the edge is the third corner (0: the face is seen edge on)
      const el = Math.hypot(...ev);
      const side = (t: V, l: number) => {
        const s = ev[0] * (t[2] - a[2]) - ev[2] * (t[0] - a[0]);
        return Math.abs(s) < 1e-9 * el * l ? 0 : Math.sign(s);
      };
      // both on the same side: the surface turns away, a silhouette
      const [s1, s2] = [side(third[0], l1), side(third[1], l2)];
      if (!fold && s1 === -s2) continue;
    }
    out.push([a, b]);
  }
}

// All triangles seen on screen (not edge on), in a grid. Each triangle keeps
// its 3 sides as lines (unit normal to the inside, so a point's distance to
// the side is nx x + ny y + off), its plane (depth = pa x + pb y + pc), its
// nearest depth and its part.
type Scene = {
  side: Float64Array; // 9 per triangle
  plane: Float64Array; // 3 per triangle
  dmax: Float64Array;
  part: Int32Array;
  box: [number, number, number, number]; // x0, y0, x1, y1 of all triangles
  gx: number; gy: number; cw: number; ch: number;
  cells: number[][];
};

function scene(per: number[][]): Scene {
  let n = 0;
  const box: Scene['box'] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const tri of per) {
    n += tri.length / 9;
    for (let k = 0; k < tri.length; k += 3) {
      box[0] = Math.min(box[0], tri[k]); box[2] = Math.max(box[2], tri[k]);
      box[1] = Math.min(box[1], tri[k + 2]); box[3] = Math.max(box[3], tri[k + 2]);
    }
  }
  const side = new Float64Array(n * 9);
  const plane = new Float64Array(n * 3);
  const dmax = new Float64Array(n);
  const part = new Int32Array(n);
  const bbox = new Float64Array(n * 4);
  let m = 0;
  per.forEach((tri, pi) => {
    for (let k = 0; k < tri.length; k += 9) {
      let [x0, d0, y0, x1, d1, y1, x2, d2, y2] = tri.slice(k, k + 9);
      let area = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
      if (Math.abs(area) < 1e-6) continue; // seen edge on
      if (area < 0) {
        [x1, d1, y1, x2, d2, y2] = [x2, d2, y2, x1, d1, y1];
        area = -area;
      }
      const pa = ((d1 - d0) * (y2 - y0) - (y1 - y0) * (d2 - d0)) / area;
      const pb = ((x1 - x0) * (d2 - d0) - (d1 - d0) * (x2 - x0)) / area;
      plane.set([pa, pb, d0 - pa * x0 - pb * y0], m * 3);
      const xs = [x0, x1, x2];
      const ys = [y0, y1, y2];
      for (let s = 0; s < 3; s++) {
        const [xi, yi, xj, yj] = [xs[s], ys[s], xs[(s + 1) % 3], ys[(s + 1) % 3]];
        const l = Math.hypot(xj - xi, yj - yi);
        const [nx, ny] = [-(yj - yi) / l, (xj - xi) / l];
        side.set([nx, ny, -(nx * xi + ny * yi)], m * 9 + s * 3);
      }
      dmax[m] = Math.max(d0, d1, d2);
      part[m] = pi;
      bbox.set([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], m * 4);
      m++;
    }
  });
  // about one cell per triangle
  const [W, H] = [Math.max(box[2] - box[0], 1), Math.max(box[3] - box[1], 1)];
  const s = Math.sqrt((W * H) / Math.max(m, 1));
  const gx = Math.min(512, Math.max(1, Math.ceil(W / s)));
  const gy = Math.min(512, Math.max(1, Math.ceil(H / s)));
  const [cw, ch] = [W / gx, H / gy];
  const cells: number[][] = Array.from({ length: gx * gy }, () => []);
  const sc: Scene = { side: side.subarray(0, m * 9), plane: plane.subarray(0, m * 3), dmax: dmax.subarray(0, m), part: part.subarray(0, m), box, gx, gy, cw, ch, cells };
  for (let t = 0; t < m; t++) {
    const [i0, j0] = cellOf(sc, bbox[t * 4], bbox[t * 4 + 1]);
    const [i1, j1] = cellOf(sc, bbox[t * 4 + 2], bbox[t * 4 + 3]);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        // only the cells the triangle really covers: no side has the whole cell outside
        if (i1 > i0 && j1 > j0) {
          const [cx0, cy0] = [box[0] + i * cw, box[1] + j * ch];
          let out = false;
          for (let k = 0; k < 3 && !out; k++) {
            const [nx, ny, off] = [side[t * 9 + k * 3], side[t * 9 + k * 3 + 1], side[t * 9 + k * 3 + 2]];
            // the corner of the cell farthest inside this side
            out = nx * (nx > 0 ? cx0 + cw : cx0) + ny * (ny > 0 ? cy0 + ch : cy0) + off < -1e-6;
          }
          if (out) continue;
        }
        cells[j * gx + i].push(t);
      }
  }
  return sc;
}

function cellOf(sc: Scene, x: number, y: number): [number, number] {
  const i = Math.floor((x - sc.box[0]) / sc.cw);
  const j = Math.floor((y - sc.box[1]) / sc.ch);
  return [Math.min(sc.gx - 1, Math.max(0, i)), Math.min(sc.gy - 1, Math.max(0, j))];
}

// the triangles of the cell under screen point (x, y) that contain it
// a point on a side of a triangle (or 1e-6 mm outside it) is inside it
function under(sc: Scene, x: number, y: number, each: (t: number, d: number) => void) {
  if (x < sc.box[0] || x > sc.box[2] || y < sc.box[1] || y > sc.box[3]) return;
  const [i, j] = cellOf(sc, x, y);
  const { side, plane } = sc;
  for (const t of sc.cells[j * sc.gx + i]) {
    const o = t * 9;
    if (side[o] * x + side[o + 1] * y + side[o + 2] < -1e-6) continue;
    if (side[o + 3] * x + side[o + 4] * y + side[o + 5] < -1e-6) continue;
    if (side[o + 6] * x + side[o + 7] * y + side[o + 8] < -1e-6) continue;
    each(t, plane[t * 3] * x + plane[t * 3 + 1] * y + plane[t * 3 + 2]);
  }
}

// Cut the line a-b: the pieces that some triangle hides, as [t0, t1] along
// the line, sorted and merged. `stamp` marks the triangles already seen.
function hide(sc: Scene, a: V, b: V, stamp: Int32Array, mark: number): [number, number][] {
  const [ax, ad, ay] = a;
  const [bx, bd, by] = b;
  const [dx, dy] = [bx - ax, by - ay];
  const l2 = Math.hypot(dx, dy);
  const dmin = Math.min(ad, bd) + EPS;
  const { side, plane, dmax, cells, box, cw, ch, gx } = sc;
  const [i0, j0] = cellOf(sc, Math.min(ax, bx), Math.min(ay, by));
  const [i1, j1] = cellOf(sc, Math.max(ax, bx), Math.max(ay, by));
  const out: [number, number][] = [];
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      if (i1 > i0 && j1 > j0) {
        // does the line go through this cell? (its 4 corners not all on one side)
        const [cx0, cy0] = [box[0] + i * cw - ax, box[1] + j * ch - ay];
        const s = [dx * cy0 - dy * cx0, dx * (cy0 + ch) - dy * cx0, dx * cy0 - dy * (cx0 + cw), dx * (cy0 + ch) - dy * (cx0 + cw)];
        const tol = 1e-6 * l2;
        if (s.every((v) => v > tol) || s.every((v) => v < -tol)) continue;
      }
      for (const t of cells[j * gx + i]) {
        if (stamp[t] === mark) continue;
        stamp[t] = mark;
        if (dmax[t] <= dmin) continue; // all of it behind the line
        let lo = 0;
        let hi = 1;
        // f(t) > 0 between lo and hi, for f linear from f0 to f1
        const clip = (f0: number, f1: number) => {
          if (f0 <= 0 && f1 <= 0) hi = -1;
          else if (f0 < 0) lo = Math.max(lo, f0 / (f0 - f1));
          else if (f1 < 0) hi = Math.min(hi, f0 / (f0 - f1));
        };
        // inside the triangle on screen
        for (let k = 0; k < 3 && lo < hi; k++) {
          const o = t * 9 + k * 3;
          clip(side[o] * ax + side[o + 1] * ay + side[o + 2] - 1e-6, side[o] * bx + side[o + 1] * by + side[o + 2] - 1e-6);
        }
        // and the plane in front of the line
        const o = t * 3;
        if (lo < hi) clip(plane[o] * ax + plane[o + 1] * ay + plane[o + 2] - ad - EPS, plane[o] * bx + plane[o + 1] * by + plane[o + 2] - bd - EPS);
        if (hi > lo) out.push([lo, hi]);
      }
    }
  out.sort((p, q) => p[0] - q[0]);
  const gap = 1e-3 / Math.max(l2, 1e-9); // 1 µm on screen, along the line
  const merged: [number, number][] = [];
  for (const iv of out) {
    const last = merged[merged.length - 1];
    if (last && iv[0] <= last[1] + gap) last[1] = Math.max(last[1], iv[1]);
    else merged.push(iv);
  }
  // a line through the corner of a triangle in front gets a hidden piece of
  // almost no length: it would only cut the line in two
  const tiny = 1e-2 / Math.max(l2, 1e-9); // 0.01 mm on screen
  return merged.filter((iv) => iv[1] - iv[0] > tiny);
}

// the visible and the hidden pieces of the lines of each part, as
// [x0, d0, y0, x1, d1, y1]
function project(per: number[][], sc: Scene): { vis: number[][]; hid: number[][] }[] {
  const stamp = new Int32Array(sc.dmax.length).fill(-1);
  let mark = 0;
  return per.map((tri) => {
    const lines: V[][] = [];
    edgesOf(tri, lines);
    const vis: number[][] = [];
    const hid: number[][] = [];
    for (const [a, b] of lines) {
      const at = (t: number) => [0, 1, 2].map((k) => a[k] + (b[k] - a[k]) * t);
      const piece = (t0: number, t1: number) => [...at(t0), ...at(t1)];
      let t = 0;
      for (const [h0, h1] of hide(sc, a, b, stamp, mark++)) {
        if (h0 > t) vis.push(piece(t, h0));
        hid.push(piece(h0, h1));
        t = Math.max(t, h1);
      }
      if (t < 1) vis.push(piece(t, 1));
    }
    return { vis, hid };
  });
}

// ------------------------------------------------------------- the drawing
export function renderHLR(parts: Part[], o: RenderOpts): { svg: string; faces: number; dots: number; ms: number } {
  const t0 = performance.now();
  const { c, r, up } = camera(o.az, o.el);
  const toView = (p: V): V => [dot(p, r), dot(p, c), -dot(p, up)];
  const scale = o.scale ?? 0.1;
  const R = o.bolt ?? 17;
  const f = (x: number) => (Math.round(x * 10) / 10).toString();

  // the triangles of each part; bolt heads are real solids
  // less detail when the drawing is small
  const shown = forSize(parts, o.size).filter((p) => o.maxStep === undefined || p.step <= o.maxStep);
  const heads: { part: number; corners: V[] }[] = [];
  let nFaces = 0;
  const per: number[][] = shown.map((part, pi) => {
    const faces = [...part.faces];
    if (o.bolts !== false)
      for (const dt of part.dots) {
        let b = dt.p;
        let nn: V;
        if (dt.axis) {
          nn = mul(dt.axis, dot(dt.axis, c) >= 0 ? 1 : -1);
          b = add(b, mul(nn, dt.half ?? 0));
        } else nn = dt.n ?? c;
        if (dot(nn, c) < 0.05) continue; // on a face we can't see
        const h = hexHead(b, nn, R);
        faces.push(...h.faces);
        heads.push({ part: pi, corners: h.corners.map(toView) });
      }
    const tri: number[] = [];
    for (const fc of faces) triangles(fc.pts.map(toView), tri);
    nFaces += faces.length;
    return tri;
  });
  const sc = scene(per);
  const result = project(per, sc);
  const box = sc.box;

  // the first surface seen at screen point (x, y): its depth and its part
  const NONE = { d: -Infinity, part: -1 };
  const cache = new Map<string, { d: number; part: number }>();
  // the nearest triangle at (x, y)
  const seen = (x: number, y: number) => {
    const key = `${Math.round(x * 100)},${Math.round(y * 100)}`; // 0.01 mm
    let s = cache.get(key);
    if (!s) {
      let best = NONE;
      under(sc, x, y, (t, d) => {
        if (d > best.d) best = { d, part: sc.part[t] };
      });
      s = best;
      cache.set(key, s);
    }
    return s;
  };

  // line widths, in mm at the drawing scale
  const PAD = 150; // mm around the drawing
  const pxMm = o.size ? o.size / (box[2] - box[0] + 2 * PAD) : 0; // px per mm
  const weights = o.weights !== false;
  const solid = !!o.size && o.size <= SOLID; // bolt heads as black dots
  const thinMm = pxMm ? (o.strokePx ?? (weights ? 1 : 1.4)) / pxMm : (o.stroke ?? (weights ? 4 : 7));
  const thickMm = pxMm ? (o.outlinePx ?? 2) / pxMm : (o.outline ?? 9);
  const gapMm = !weights || o.gap === false ? 0 : thickMm / 2 + thinMm / 2 + (typeof o.gap === 'number' ? o.gap : thickMm);

  // is the piece [x0, d0, y0, x1, d1, y1] of part `pi` an outline? Ask at a
  // quarter, the middle and three quarters, and take the majority.
  const outline = (q: ArrayLike<number>, pi: number): boolean => {
    const [dx, dy] = [q[3] - q[0], q[5] - q[2]];
    const l = Math.hypot(dx, dy);
    const [nx, ny] = [(-dy / l) * SIDE, (dx / l) * SIDE];
    const at = (f: number) => {
      const [x, d, y] = [q[0] + dx * f, q[1] + (q[4] - q[1]) * f, q[2] + dy * f];
      const out = (s: number) => {
        const h = seen(x + s * nx, y + s * ny);
        return h.d < d - DEEP || (h.part !== pi && h.d < d - 1);
      };
      return out(1) || out(-1);
    };
    // short pieces: the middle is enough
    if (l < 4 * DEEP) return at(0.5);
    const a = at(0.25);
    const b = at(0.75);
    return a === b ? a : at(0.5);
  };

  // how much to cut from each end of a piece, as a fraction of its length,
  // and the part that hides the cut end (-1: none)
  const ends = (q: ArrayLike<number>): [number, number, number, number] => {
    const res: [number, number, number, number] = [0, -1, 0, -1];
    if (!gapMm) return res;
    const [dx, dy] = [q[3] - q[0], q[5] - q[2]];
    const l = Math.hypot(dx, dy);
    const [ux, uy] = [(dx / l) * SIDE, (dy / l) * SIDE];
    for (const e of [0, 1]) {
      const s = e ? 1 : -1;
      const h = seen(q[e * 3] + s * ux, q[e * 3 + 2] + s * uy);
      if (h.d > q[e * 3 + 1] + FRONT) {
        res[e * 2] = gapMm / l;
        res[e * 2 + 1] = h.part;
      }
    }
    return res;
  };

  // the first step at which something sits between `p` and the camera
  const occluder = (p: ArrayLike<number>): number => {
    let s = Infinity;
    under(sc, p[0], p[2], (t, d) => {
      if (d > p[1] + 0.5) s = Math.min(s, shown[sc.part[t]].step);
    });
    return s;
  };

  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  const pt = (x: number, y: number) => {
    const [X, Y] = [x * scale, y * scale];
    x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
    return `${f(X)} ${f(Y)}`;
  };
  // per part: visible lines (thin and thick, as 2D pieces in drawing units),
  // and hidden pieces keyed by the step that hides them
  type Out = { vis: Seg[]; edge: Seg[]; until: Map<number, string[]>; fills: { d: string; until: number; head: number; ring: boolean }[] };
  const outs: Out[] = shown.map(() => ({ vis: [], edge: [], until: new Map(), fills: [] }));
  const flat = (q: ArrayLike<number>): Seg => [q[0] * scale, q[2] * scale, q[3] * scale, q[5] * scale];
  const seg = (q: ArrayLike<number>) => `M${pt(q[0], q[2])}L${pt(q[3], q[5])}`;
  const part = (q: ArrayLike<number>, a: number, b: number) => {
    const at = (t: number) => [0, 1, 2].map((k) => q[k] + (q[k + 3] - q[k]) * t);
    return [...at(a), ...at(b)];
  };
  // rounding leaves slivers of hidden edges, a fraction of a mm long: drop them
  const MIN = 2; // mm, on screen
  const short = (q: ArrayLike<number>) => Math.hypot(q[3] - q[0], q[5] - q[2]) < Math.max(MIN, pxMm ? 0.5 / pxMm : 0);
  const later = (pi: number, s: number, q: ArrayLike<number>) => {
    const list = outs[pi].until.get(s) ?? [];
    list.push(seg(q));
    outs[pi].until.set(s, list);
  };
  result.forEach(({ vis, hid }, pi) => {
    const own = shown[pi].step;
    for (const q of vis) {
      if (short(q)) continue;
      const [a, ha, b, hb] = ends(q);
      if (a + b < 1) {
        const piece = part(q, a, 1 - b);
        if (!short(piece)) (weights && outline(q, pi) ? outs[pi].edge : outs[pi].vis).push(flat(piece));
      }
      // while the build runs, the cut ends show until the part in front arrives
      if (!o.animate) continue;
      if (a && shown[ha].step > own) later(pi, shown[ha].step, part(q, 0, Math.min(a, 1)));
      if (b && shown[hb].step > own) later(pi, shown[hb].step, part(q, Math.max(1 - b, 0), 1));
    }
    if (!o.animate) return;
    for (const q of hid) {
      if (short(q)) continue;
      const s = occluder([(q[0] + q[3]) / 2, (q[1] + q[4]) / 2, (q[2] + q[5]) / 2]);
      if (s <= own || s === Infinity) continue; // hidden from the start, or never
      later(pi, s, q);
    }
  });
  for (const [hi, h] of heads.entries()) {
    // the centre of the top face: if it can be seen, fill the whole head
    const ctr = h.corners.slice(6).reduce((s, p) => add(s, p), [0, 0, 0] as V).map((x) => x / 6) as V;
    const s = occluder(ctr);
    const own = shown[h.part].step;
    if (s <= own) continue;
    // small: a solid head reads best. Big: the hex outline (drawn with the
    // other lines) and the chamfer circle on its top face, like a drawing
    if (solid) {
      outs[h.part].fills.push({ d: 'M' + hull(h.corners).map((p) => pt(p[0], p[2])).join('L') + 'Z', until: s, head: hi, ring: false });
      continue;
    }
    const top = h.corners.slice(6);
    const [e1, e2] = [mul(sub(top[0], ctr), 0.85), mul(sub(top[1], ctr), 0.85)];
    // a circle through the corners has a1 = top[0] - ctr and a2 = (2 top[1] - top[0] - ctr) / sqrt 3 from the centre
    const a2 = mul(sub(mul(e2, 2), e1), 1 / Math.sqrt(3));
    const ring = Array.from({ length: 24 }, (_, k) => {
      const t = (k / 24) * 2 * Math.PI;
      const q = add(ctr, add(mul(e1, Math.cos(t)), mul(a2, Math.sin(t))));
      return pt(q[0], q[2]);
    });
    outs[h.part].fills.push({ d: 'M' + ring.join('L') + 'Z', until: s, head: hi, ring: true });
  }

  // merge the lines that lie on top of each other
  const merged = outs.map((oo) => {
    const edge = merge(oo.edge, []);
    return { edge, vis: merge(oo.vis, edge) };
  });
  const d = (list: Seg[]) => list.map((g) => `M${pt(g[0] / scale, g[1] / scale)}L${pt(g[2] / scale, g[3] / scale)}`).join('');
  const lines = merged.map((m) => ({ vis: d(m.vis), edge: d(m.edge) }));

  const pad = PAD * scale;
  [x0, y0, x1, y1] = [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
  const sw = f(thinMm * scale);
  const ow = f(thickMm * scale);
  const ms = (x: number) => `${Math.round(x)}ms`;
  const css =
    `.steel path{fill:none;stroke:currentColor;stroke-width:${sw};stroke-linecap:round;stroke-linejoin:round}` +
    `.steel .o{stroke-width:${ow}}.steel .b{fill:currentColor;stroke:none}.steel .r{fill:none}.steel .a{color:var(--accent,#e30713)}` +
    // the test rig: grey, and its outline no heavier than its other lines
    `.steel .g{color:var(--rig,#9e9e9e)}.steel .g path{stroke-width:${sw}}` +
    (o.animate
      ? `.steel .f{animation:fly .6s cubic-bezier(.2,.7,.25,1) both}` +
        `@keyframes fly{from{opacity:0;transform:translate(var(--dx),var(--dy))}15%{opacity:1}}` +
        `.steel .k{animation:pop .25s cubic-bezier(.3,1.5,.5,1) both;transform-box:fill-box;transform-origin:center}` +
        `@keyframes pop{from{opacity:0;transform:scale(2.5)}}` +
        `.steel .h{animation:sh .2s ease-in both}@keyframes sh{to{opacity:0}}` +
        `@media (prefers-reduced-motion:reduce){.steel .f,.steel .k{animation:none}.steel .h{display:none}}`
      : '');
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" class="steel" viewBox="${f(x0)} ${f(y0)} ${f(x1 - x0)} ${f(y1 - y0)}">`,
    `<style>${css}</style>`,
  ];

  // the build animation: when each part moves, and from where
  const slots = timeline(shown, { speed: o.speed, duration: o.duration });
  const landAt = (step: number) => slots.get(step)?.land ?? 0;
  // how far to move a part along the 2D direction (ux, uy) so it is out of the frame
  const away = (pi: number, ux: number, uy: number) => {
    const all = [...merged[pi].vis, ...merged[pi].edge];
    if (!all.length) return x1 - x0;
    let [bx0, by0, bx1, by1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const g of all) {
      bx0 = Math.min(bx0, g[0], g[2]); bx1 = Math.max(bx1, g[0], g[2]);
      by0 = Math.min(by0, g[1], g[3]); by1 = Math.max(by1, g[1], g[3]);
    }
    let t = Infinity;
    if (ux > 1e-3) t = Math.min(t, (x1 - bx0) / ux);
    if (ux < -1e-3) t = Math.min(t, (bx1 - x0) / -ux);
    if (uy > 1e-3) t = Math.min(t, (y1 - by0) / uy);
    if (uy < -1e-3) t = Math.min(t, (by1 - y0) / -uy);
    return t + 0.05 * (x1 - x0);
  };
  const fly = (pi: number): string => {
    const p = shown[pi];
    const sl = slots.get(p.step)!;
    const v = p.from ?? [0, 0, 1];
    let [ux, uy] = [dot(v, r), -dot(v, up)];
    const l = Math.hypot(ux, uy);
    // a member that points at the camera comes from above instead
    if (l < 0.3) [ux, uy] = [0, -1];
    else [ux, uy] = [ux / l, uy / l];
    // plates, the base and the rig only slide a little, members come from outside
    const t = p.kind === 'plate' || p.kind === 'base' || p.kind === 'rig' ? 0.06 * (x1 - x0) : away(pi, ux, uy);
    return `--dx:${f(ux * t)}px;--dy:${f(uy * t)}px;animation-delay:${ms(sl.start)};animation-duration:${ms(sl.dur)}`;
  };
  const hidden = (pi: number) => [...outs[pi].until].map(([s, list]) => `<path class="h" style="animation-delay:${ms(landAt(s))}" d="${list.join('')}"/>`);
  const fill = (fl: Out['fills'][number]) => {
    const k = fl.ring ? 'r' : 'b';
    return fl.until === Infinity ? `<path class="${k}" d="${fl.d}"/>` : o.animate ? `<path class="${k} h" style="animation-delay:${ms(landAt(fl.until))}" d="${fl.d}"/>` : '';
  };

  // in step order, so a later part paints over an earlier one (only the bolt fills care)
  const order = shown.map((_, i) => i).sort((i, j) => shown[i].step - shown[j].step);
  let nDots = 0;
  for (const pi of order) {
    const p = shown[pi];
    const { until, fills } = outs[pi];
    const { vis, edge } = lines[pi];
    if (!vis && !edge && !until.size && !fills.length) continue;
    nDots += fills.length;
    const acc = p.accent ? 'a' : p.kind === 'rig' ? 'g' : '';
    if (o.animate && p.kind === 'bolts') {
      // one group per bolt, each line goes with the nearest head
      const start = slots.get(p.step)!.start;
      const ids = [...new Set(fills.map((fl) => fl.head))];
      const ctr = ids.map((hi) => {
        const cs = heads[hi].corners;
        return [cs.reduce((s, q) => s + q[0], 0) / cs.length * scale, cs.reduce((s, q) => s + q[2], 0) / cs.length * scale];
      });
      const near = (g: Seg) => {
        const [mx, my] = [(g[0] + g[2]) / 2, (g[1] + g[3]) / 2];
        let [best, bd] = [0, Infinity];
        ctr.forEach(([cx, cy], k) => { const dd = Math.hypot(cx - mx, cy - my); if (dd < bd) [best, bd] = [k, dd]; });
        return best;
      };
      out.push(acc ? `<g class="${acc}">` : '<g>');
      ids.forEach((hi, k) => {
        const v = merged[pi].vis.filter((g) => near(g) === k);
        const e = merged[pi].edge.filter((g) => near(g) === k);
        out.push(`<g class="k" style="animation-delay:${ms(start + k * BOLT_MS / (o.speed ?? 1))}">`);
        if (v.length) out.push(`<path d="${d(v)}"/>`);
        if (e.length) out.push(`<path class="o" d="${d(e)}"/>`);
        for (const fl of fills) if (fl.head === hi) out.push(fill(fl));
        out.push('</g>');
      });
      // lines with no visible head (rare): with the first bolt
      if (!ids.length || until.size) out.push(`<g class="k" style="animation-delay:${ms(start)}">`, ...(ids.length ? [] : [vis && `<path d="${vis}"/>`, edge && `<path class="o" d="${edge}"/>`]), ...hidden(pi), '</g>');
      out.push('</g>');
      continue;
    }
    const cls = [acc, o.animate ? 'f' : ''].filter(Boolean).join(' ');
    out.push(`<g${cls ? ` class="${cls}"` : ''}${o.animate ? ` style="${fly(pi)}"` : ''}>`);
    if (vis) out.push(`<path d="${vis}"/>`);
    if (edge) out.push(`<path class="o" d="${edge}"/>`);
    if (o.animate) out.push(...hidden(pi));
    for (const fl of fills) out.push(fill(fl));
    out.push('</g>');
  }
  out.push('</svg>');
  return { svg: out.join('\n'), faces: nFaces, dots: nDots, ms: performance.now() - t0 };
}

// a 2D piece [x0, y0, x1, y1], in drawing units
type Seg = [number, number, number, number];

// Merge the pieces that lie on the same line and touch or overlap (a flange
// seen edge-on gives its front and back edges on the same line). Pieces
// covered by `over` (the thick lines) are removed.
function merge(segs: Seg[], over: Seg[]): Seg[] {
  const TOL = 0.05; // drawing units
  type Line = { d: [number, number]; c: number; list: [number, number][]; over: [number, number][] };
  const lines = new Map<string, Line>();
  const add = (g: Seg, into: 'list' | 'over') => {
    let [dx, dy] = [g[2] - g[0], g[3] - g[1]];
    const l = Math.hypot(dx, dy);
    if (l < 1e-9) return;
    [dx, dy] = [dx / l, dy / l];
    if (dx < -1e-9 || (Math.abs(dx) < 1e-9 && dy < 0)) [dx, dy] = [-dx, -dy];
    const c = -dy * g[0] + dx * g[1]; // distance of the line to the origin
    const [ka, kc] = [Math.round(Math.atan2(dy, dx) * 2000), Math.round(c / TOL)];
    // a line close to the edge of a bucket can be in the next one
    let ln: Line | undefined;
    for (const i of [0, -1, 1]) {
      for (const j of [0, -1, 1]) {
        const m = lines.get(`${ka + i},${kc + j}`);
        if (m && Math.abs(m.c - c) < TOL && Math.abs(m.d[0] * dy - m.d[1] * dx) < 1e-3) ln ??= m;
      }
    }
    const key = `${ka},${kc}`;
    if (!ln) {
      if (into === 'over') return; // a thick line with nothing thin under it
      ln = { d: [dx, dy], c, list: [], over: [] };
      lines.set(key, ln);
    }
    const [t0, t1] = [g[0] * ln.d[0] + g[1] * ln.d[1], g[2] * ln.d[0] + g[3] * ln.d[1]];
    ln[into].push([Math.min(t0, t1), Math.max(t0, t1)]);
  };
  for (const g of segs) add(g, 'list');
  for (const g of over) add(g, 'over');
  const union = (iv: [number, number][]) => {
    iv.sort((a, b) => a[0] - b[0]);
    const u: [number, number][] = [];
    for (const [a, b] of iv) {
      const last = u[u.length - 1];
      if (last && a <= last[1] + TOL) last[1] = Math.max(last[1], b);
      else u.push([a, b]);
    }
    return u;
  };
  const out: Seg[] = [];
  for (const ln of lines.values()) {
    let iv = union(ln.list);
    // take away what a thick line already covers
    for (const [a, b] of union(ln.over)) {
      const next: [number, number][] = [];
      for (const [p, q] of iv) {
        if (b <= p + TOL || a >= q - TOL) next.push([p, q]);
        else {
          if (a > p + TOL) next.push([p, a]);
          if (b < q - TOL) next.push([b, q]);
        }
      }
      iv = next;
    }
    const [dx, dy] = ln.d;
    const [ox, oy] = [-dy * ln.c, dx * ln.c];
    for (const [a, b] of iv) if (b - a > TOL) out.push([ox + dx * a, oy + dy * a, ox + dx * b, oy + dy * b]);
  }
  return out;
}

// outline of points seen on screen (x, z): a convex hull, monotone chain
function hull(pts: V[]): V[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[2] - b[2]);
  const turn = (o: V, a: V, b: V) => (a[0] - o[0]) * (b[2] - o[2]) - (a[2] - o[2]) * (b[0] - o[0]);
  const half = (list: V[]) => {
    const h: V[] = [];
    for (const q of list) {
      while (h.length >= 2 && turn(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop();
      h.push(q);
    }
    h.pop();
    return h;
  };
  return [...half(p), ...half([...p].reverse())];
}
