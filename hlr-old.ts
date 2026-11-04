// The old renderer, on three-edge-projection. Only for compare.ts, removed once the new hlr.ts matches it.
// Line drawing with exact hidden lines, from three-edge-projection.
//
// The library finds the edges of each mesh (sharp edges and silhouettes),
// then cuts each edge where a triangle
// is in front of it. It projects along +Y, so we first turn the scene: X is
// screen right, Y points to the camera, Z is screen down. And we give it
// metres, not mm: it only looks for faces up to 1000 units in front of an
// edge (its `heightOffset`), which is only 1 m in mm.
//
// The build animation needs one more thing. A line hidden in the finished
// drawing can be visible earlier, before the part in front of it arrives.
// So for each hidden piece we find the part in front of it (a ray to the
// camera), and draw the piece from its own step until that part lands.
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
import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshBasicMaterial, Ray, ShapeUtils, Vector2, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { ProjectionGenerator } from 'three-edge-projection/src/ProjectionGenerator.js';
import { add, cross, dot, mul, norm, sub, type V } from './vec.ts';
import { BOLT_MS, camera, forSize, timeline, type Face, type Part, type RenderOpts } from './steel.ts';

const HEAD = 13; // bolt head height, mm (M20)
const SOLID = 400; // px: up to this drawing size, bolt heads are solid
const DEEP = 50; // mm: a jump in depth bigger than this makes an outline
const SIDE = 1.5; // mm: how far beside (or past the end of) a line we look
const FRONT = 5; // mm: a surface this much in front of a line end hides it

// triangles of a planar polygon (webgl.ts uses it too)
export function triangles(pts: V[], out: number[]) {
  if (pts.length === 3 || pts.length === 4) {
    for (let i = 1; i + 1 < pts.length; i++) out.push(...pts[0], ...pts[i], ...pts[i + 1]);
    return;
  }
  // not always convex (the end of an I section): earcut in the face plane
  const n = norm(cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])));
  const e1 = norm(sub(pts[1], pts[0]));
  const e2 = cross(n, e1);
  const flat = pts.map((p) => new Vector2(dot(sub(p, pts[0]), e1), dot(sub(p, pts[0]), e2)));
  for (const [a, b, c] of ShapeUtils.triangulateShape(flat, [])) out.push(...pts[a], ...pts[b], ...pts[c]);
}

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

export function renderHLR(parts: Part[], o: RenderOpts): { svg: string; faces: number; dots: number; ms: number } {
  const t0 = performance.now();
  const { c, r, up } = camera(o.az, o.el);
  const M = 1e-3; // mm to m
  const toView = (p: V): V => [dot(p, r) * M, dot(p, c) * M, -dot(p, up) * M];
  const scale = o.scale ?? 0.1;
  const R = o.bolt ?? 17;
  const f = (x: number) => (Math.round(x * 10) / 10).toString();

  // one mesh per part; bolt heads are real solids
  // less detail when the drawing is small
  const shown = forSize(parts, o.size).filter((p) => o.maxStep === undefined || p.step <= o.maxStep);
  const meshes: Mesh[] = [];
  const both = new MeshBasicMaterial({ side: DoubleSide });
  const heads: { part: number; corners: V[] }[] = [];
  let nFaces = 0;
  const all: number[] = []; // every triangle, for the outline probes
  const owner: number[] = []; // the part of each of them
  shown.forEach((part, pi) => {
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
    if (!faces.length) return;
    const tri: number[] = [];
    for (const fc of faces) triangles(fc.pts.map(toView), tri);
    for (const x of tri) all.push(x);
    for (let k = 0; k < tri.length / 9; k++) owner.push(pi);
    nFaces += faces.length;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(tri), 3));
    g.boundsTree = new MeshBVH(g);
    const m = new Mesh(g, both); // face winding is not consistent, so no culling
    m.userData.part = pi;
    meshes.push(m);
  });

  const gen = new ProjectionGenerator();
  gen.iterationTime = Infinity;
  gen.includeIntersectionEdges = false; // our parts touch, they never cross
  const task = gen.generate(meshes);
  let res = task.next();
  while (!res.done) res = task.next();
  const result = res.value;

  // depth (toward the camera) of the first surface seen at screen point (x, z)
  const scene = new BufferGeometry();
  scene.setAttribute('position', new BufferAttribute(new Float32Array(all), 3));
  const sceneBVH = new MeshBVH(scene);
  scene.computeBoundingBox();
  const box = scene.boundingBox!;
  const probe = new Ray(new Vector3(), new Vector3(0, -1, 0));
  // the first surface seen at screen point (x, z): its depth and its part
  const NONE = { y: -Infinity, part: -1 };
  const cache = new Map<string, { y: number; part: number }>();
  const seen = (x: number, z: number) => {
    const key = `${Math.round(x * 1e5)},${Math.round(z * 1e5)}`; // 0.01 mm
    let s = cache.get(key);
    if (!s) {
      probe.origin.set(x, box.max.y + 1, z);
      const hit = sceneBVH.raycastFirst(probe, DoubleSide);
      s = hit ? { y: hit.point.y, part: owner[Math.floor(hit.face!.a / 3)] } : NONE;
      cache.set(key, s);
    }
    return s;
  };

  // line widths, in mm at the drawing scale
  const PAD = 150; // mm around the drawing
  const pxMm = o.size ? o.size / ((box.max.x - box.min.x) / M + 2 * PAD) : 0; // px per mm
  const weights = o.weights !== false;
  const solid = !!o.size && o.size <= SOLID; // bolt heads as black dots
  const thinMm = pxMm ? (o.strokePx ?? (weights ? 1 : 1.4)) / pxMm : (o.stroke ?? (weights ? 4 : 7));
  const thickMm = pxMm ? (o.outlinePx ?? 2) / pxMm : (o.outline ?? 9);
  const gapMm = !weights || o.gap === false ? 0 : thickMm / 2 + thinMm / 2 + (typeof o.gap === 'number' ? o.gap : thickMm);

  // is the piece [x0, y0, z0, x1, y1, z1] of part `pi` an outline? Ask at a
  // quarter, the middle and three quarters, and take the majority.
  const outline = (q: ArrayLike<number>, pi: number): boolean => {
    const [dx, dz] = [q[3] - q[0], q[5] - q[2]];
    const l = Math.hypot(dx, dz);
    const [nx, nz] = [(-dz / l) * SIDE * M, (dx / l) * SIDE * M];
    const at = (f: number) => {
      const [x, y, z] = [q[0] + dx * f, q[1] + (q[4] - q[1]) * f, q[2] + dz * f];
      const out = (s: number) => {
        const h = seen(x + s * nx, z + s * nz);
        return h.y < y - DEEP * M || (h.part !== pi && h.y < y - M);
      };
      return out(1) || out(-1);
    };
    // short pieces: the middle is enough
    if (l < 4 * DEEP * M) return at(0.5);
    const a = at(0.25);
    const b = at(0.75);
    return a === b ? a : at(0.5);
  };

  // how much to cut from each end of a piece, as a fraction of its length,
  // and the part that hides the cut end (-1: none)
  const ends = (q: ArrayLike<number>): [number, number, number, number] => {
    const res: [number, number, number, number] = [0, -1, 0, -1];
    if (!gapMm) return res;
    const [dx, dz] = [q[3] - q[0], q[5] - q[2]];
    const l = Math.hypot(dx, dz);
    const [ux, uz] = [(dx / l) * SIDE * M, (dz / l) * SIDE * M];
    for (const e of [0, 1]) {
      const s = e ? 1 : -1;
      const h = seen(q[e * 3] + s * ux, q[e * 3 + 2] + s * uz);
      if (h.y > q[e * 3 + 1] + FRONT * M) {
        res[e * 2] = (gapMm * M) / l;
        res[e * 2 + 1] = h.part;
      }
    }
    return res;
  };

  // the first step at which something sits between `p` and the camera
  const ray = new Ray();
  const occluder = (p: Vector3): number => {
    ray.origin.set(p.x, p.y + 0.5 * M, p.z);
    ray.direction.set(0, 1, 0);
    let s = Infinity;
    for (const m of meshes) {
      const st = shown[m.userData.part].step;
      if (st >= s) continue;
      if ((m.geometry.boundsTree as MeshBVH).raycastFirst(ray, DoubleSide)) s = st;
    }
    return s;
  };

  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  const pt = (x: number, z: number) => {
    const [X, Y] = [(x / M) * scale, (z / M) * scale];
    x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
    return `${f(X)} ${f(Y)}`;
  };
  // per part: visible lines (thin and thick, as 2D pieces in drawing units),
  // and hidden pieces keyed by the step that hides them
  type Out = { vis: Seg[]; edge: Seg[]; until: Map<number, string[]>; fills: { d: string; until: number; head: number; ring: boolean }[] };
  const outs: Out[] = shown.map(() => ({ vis: [], edge: [], until: new Map(), fills: [] }));
  const mid = new Vector3();
  const flat = (q: ArrayLike<number>): Seg => [(q[0] / M) * scale, (q[2] / M) * scale, (q[3] / M) * scale, (q[5] / M) * scale];
  const seg = (q: ArrayLike<number>) => `M${pt(q[0], q[2])}L${pt(q[3], q[5])}`;
  const part = (q: ArrayLike<number>, a: number, b: number) => {
    const at = (t: number) => [0, 1, 2].map((k) => q[k] + (q[k + 3] - q[k]) * t);
    return [...at(a), ...at(b)];
  };
  // rounding leaves slivers of hidden edges, a fraction of a mm long: drop them
  const MIN = 2; // mm, on screen
  const short = (q: ArrayLike<number>) => Math.hypot(q[3] - q[0], q[5] - q[2]) < Math.max(MIN, pxMm ? 0.5 / pxMm : 0) * M;
  const later = (pi: number, s: number, q: ArrayLike<number>) => {
    const list = outs[pi].until.get(s) ?? [];
    list.push(seg(q));
    outs[pi].until.set(s, list);
  };
  for (const m of meshes) {
    const pi = m.userData.part as number;
    const own = shown[pi].step;
    // pieces keep their 3D ends: [x0, y0, z0, x1, y1, z1]
    for (const q of result.visibleEdges.meshToSegments.get(m) ?? []) {
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
    if (!o.animate) continue;
    for (const q of result.hiddenEdges.meshToSegments.get(m) ?? []) {
      if (short(q)) continue;
      mid.set((q[0] + q[3]) / 2, (q[1] + q[4]) / 2, (q[2] + q[5]) / 2);
      const s = occluder(mid);
      if (s <= own || s === Infinity) continue; // hidden from the start, or never
      later(pi, s, q);
    }
  }
  for (const [hi, h] of heads.entries()) {
    // the centre of the top face: if it can be seen, fill the whole head
    const ctr = h.corners.slice(6).reduce((s, p) => add(s, p), [0, 0, 0] as V).map((x) => x / 6) as V;
    const s = occluder(new Vector3(...ctr));
    const own = shown[h.part].step;
    if (s <= own) continue;
    // small: a solid head reads best. Big: the hex outline (drawn by the
    // projection) and the chamfer circle on its top face, like a drawing
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
  const d = (list: Seg[]) => list.map((g) => `M${pt(g[0] / scale * M, g[1] / scale * M)}L${pt(g[2] / scale * M, g[3] / scale * M)}`).join('');
  const lines = merged.map((m) => ({ vis: d(m.vis), edge: d(m.edge) }));

  const pad = PAD * scale;
  [x0, y0, x1, y1] = [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
  const sw = f(thinMm * scale);
  const ow = f(thickMm * scale);
  const ms = (x: number) => `${Math.round(x)}ms`;
  const css =
    `.steel path{fill:none;stroke:currentColor;stroke-width:${sw};stroke-linecap:round;stroke-linejoin:round}` +
    `.steel .o{stroke-width:${ow}}.steel .b{fill:currentColor;stroke:none}.steel .r{fill:none}.steel .a{color:var(--accent,#e30713)}` +
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
    // plates and the base only slide a little, members come from outside
    const t = p.kind === 'plate' || p.kind === 'base' ? 0.06 * (x1 - x0) : away(pi, ux, uy);
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
    const acc = p.accent ? 'a' : '';
    if (o.animate && p.kind === 'bolts') {
      // one group per bolt, each line goes with the nearest head
      const start = slots.get(p.step)!.start;
      const ids = [...new Set(fills.map((fl) => fl.head))];
      const ctr = ids.map((hi) => {
        const cs = heads[hi].corners;
        return [cs.reduce((s, q) => s + q[0], 0) / cs.length / M * scale, cs.reduce((s, q) => s + q[2], 0) / cs.length / M * scale];
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
  for (const m of meshes) m.geometry.dispose();
  scene.dispose();
  return { svg: out.join('\n'), faces: nFaces, dots: nDots, ms: performance.now() - t0 };
}

// a 2D piece [x0, y0, x1, y1], in drawing units
type Seg = [number, number, number, number];

// Merge the pieces that lie on the same line and touch or overlap (a flange
// seen edge-on gives its front and back edges on the same line). Pieces
// covered by `over` (the thick lines) are removed.
function merge(segs: Seg[], over: Seg[]): Seg[] {
  const TOL = 0.05; // drawing units
  const lines = new Map<string, { d: [number, number]; c: number; list: [number, number][]; over: [number, number][] }>();
  const add = (g: Seg, into: 'list' | 'over') => {
    let [dx, dy] = [g[2] - g[0], g[3] - g[1]];
    const l = Math.hypot(dx, dy);
    if (l < 1e-9) return;
    [dx, dy] = [dx / l, dy / l];
    if (dx < -1e-9 || (Math.abs(dx) < 1e-9 && dy < 0)) [dx, dy] = [-dx, -dy];
    const c = -dy * g[0] + dx * g[1]; // distance of the line to the origin
    const key = `${Math.round(Math.atan2(dy, dx) * 2000)},${Math.round(c / TOL)}`;
    let ln = lines.get(key);
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
