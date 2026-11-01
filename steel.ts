// Geometry and line drawing renderer, ported from sculpture_render.py
// (branch feat/logo-aisc), in mm.
//
// Every member is its real cross section extruded along its axis. Hidden
// lines use the painter's trick: faces filled with the background, drawn
// back to front, back faces culled, long members cut in segments so the
// depth sort stays honest.
import { add, cross, dot, len, mul, norm, sub, type V } from './vec.ts';
import type { Section } from './sections.ts';

export const PITCH = 75; // bolt pitch
export const EDGE = 38; // bolt edge distance

type P2 = [number, number];
export type Face = { pts: V[]; edges: [number, number][] };
// a bolt: on the side of `axis` that looks at the camera, or on a face with normal `n`
export type Dot = { p: V; axis?: V; half?: number; n?: V };
export type Part = { id: string; step: number; faces: Face[]; dots: Dot[]; supports: string[]; accent?: boolean };

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
export function prism(p0: V, p1: V, polys: P2[][], u: V, v: V, w: V, seg: number, shift = 0): Face[] {
  const L = len(sub(p1, p0));
  const n = Math.max(1, Math.ceil(L / seg));
  const faces: Face[] = [];
  for (const poly of polys) {
    const base = poly.map(([a, b]) => add(p0, add(mul(v, a), mul(w, b + shift))));
    const m = base.length;
    for (let k = 0; k < n; k++) {
      const A = base.map((pt) => add(pt, mul(u, (L * k) / n)));
      const B = base.map((pt) => add(pt, mul(u, (L * (k + 1)) / n)));
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
};

export function geo(id: string, sec: Section, p0: V, p1: V, tos: boolean): Geo {
  const { u, v, w } = frame(p0, p1);
  const polys = sec.kind === 'I' ? profI(sec.d, sec.bf, sec.tw, sec.tf) : profRect(sec.d, sec.bf);
  return { id, sec, p0, p1, u, v, w, sh: tos ? sec.d / 2 : 0, polys, d: sec.d, tw: sec.kind === 'I' ? sec.tw : sec.bf };
}

export const memberFaces = (g: Geo, seg: number) => prism(g.p0, g.p1, g.polys, g.u, g.v, g.w, seg, g.sh);

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

export type Resolved = { at: 'from' | 'to'; p: V; inward: V; direc: V; gap: number; fp: V };

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
  return { at, p, inward, direc, gap: Math.max(0, dist - face), fp: add(q, mul(direc, face)) };
}

// bolt offsets on a plate: `cols` columns, rows `pitch` apart, centred,
// squeezed to fit `span`
export function rowsCols(n: number, cols: number, span: number, pitch = PITCH): P2[] {
  if (n <= 0) return [];
  const rows = Math.ceil(n / cols);
  if (rows > 1) pitch = Math.min(pitch, (span - 2 * EDGE) / (rows - 1));
  return [...Array(n).keys()].map((i) => [i % cols, (Math.floor(i / cols) - (rows - 1) / 2) * pitch]);
}

// a plate in the web plane (shear tab), from the support face into the member
function webPlate(g: Geo, r: Resolved, t: number, L0: number, h: number, n: number, dots: Dot[]): Face[] {
  const L = Math.max(L0, r.gap + EDGE);
  const lin = L - r.gap;
  const centre = add(add(r.p, mul(r.inward, L / 2 - r.gap)), mul(g.w, g.sh));
  const faces = box3(centre, g.w, r.inward, g.tw + 2 * t, h, L);
  const cols = n <= 4 || lin < 100 ? 1 : 2;
  for (const [k, dw] of rowsCols(n, cols, h)) {
    const du = lin / 2 + (k - (cols - 1) / 2) * PITCH;
    dots.push({ p: add(add(r.p, mul(r.inward, du)), mul(g.w, g.sh + dw)), axis: g.v, half: g.tw / 2 + t });
  }
  return faces;
}

export type ConnType = 'shear_tab' | 'end_plate' | 'flange_plates' | 'welded' | 'gusset';
export const PINNED: ConnType[] = ['shear_tab', 'gusset'];
// the gap a member leaves at its end, for each connection type
export const SETBACK: Record<ConnType, number> = { shear_tab: 13, flange_plates: 13, end_plate: 25, welded: 0, gusset: 100 };

// the solid of one connection and its bolt dots
export function hardware(g: Geo, typ: ConnType, r: Resolved): { faces: Face[]; dots: Dot[] } {
  const faces: Face[] = [];
  const dots: Dot[] = [];
  const { p, inward, gap } = r;
  const nRows = Math.max(2, Math.floor((g.d - 2 * EDGE - 30) / PITCH) + 1);
  if (typ === 'shear_tab') {
    faces.push(...webPlate(g, r, 10, 115, g.d - 2 * EDGE, Math.min(nRows, 6), dots));
  } else if (typ === 'end_plate') {
    // extended end plate, bolts above, between and below the flanges
    const t = 25;
    const wp = g.sec.bf + 30;
    const hp = g.d + 180;
    const th = Math.max(gap, t);
    faces.push(...box3(add(add(p, mul(inward, -th / 2)), mul(g.w, g.sh)), g.w, inward, wp, hp, th));
    const ws = [-45, g.sec.tf + 45, g.d - g.sec.tf - 45, g.d + 45].map((x) => x - g.d / 2 + g.sh);
    for (const dw of ws)
      for (const s of [-1, 1])
        dots.push({ p: add(add(add(p, mul(inward, 1)), mul(g.v, (s * (wp - 2 * EDGE)) / 2)), mul(g.w, dw)), n: inward });
  } else if (typ === 'flange_plates') {
    const t = 16;
    const wp = g.sec.bf;
    const L = Math.max(300, gap + 3 * EDGE);
    for (const top of [true, false]) {
      const dw = top ? -t / 2 : g.d + t / 2;
      faces.push(...box3(add(add(p, mul(inward, L / 2 - gap)), mul(g.w, dw)), g.w, inward, wp, t, L));
      const lin = L - gap;
      const rows = Math.max(1, Math.floor((lin - 2 * EDGE) / PITCH) + 1);
      for (let rr = 0; rr < rows; rr++)
        for (const s of [-1, 1]) {
          let pt = add(add(p, mul(inward, EDGE + rr * PITCH)), mul(g.v, (s * (wp - 2 * EDGE)) / 2));
          pt = add(pt, mul(g.w, top ? -t : g.d + t));
          dots.push({ p: pt, n: mul(g.w, top ? -1 : 1) });
        }
    }
    faces.push(...webPlate(g, r, 10, 115, g.d - 2 * g.sec.tf - 2 * EDGE, 3, dots));
  } else if (typ === 'gusset') {
    // a knife plate from the support face into the slotted tube
    const t = 12;
    const L = Math.max(250, gap + 150);
    const hp = Math.max(160, g.sec.bf + 60);
    let nrm = cross(r.direc, g.u);
    if (len(nrm) < 1e-3) nrm = g.v;
    nrm = norm(nrm);
    const across = norm(cross(nrm, r.direc));
    faces.push(...box3(add(r.fp, mul(r.direc, L / 2)), across, r.direc, t, hp, L));
    for (let i = 0; i < 2; i++)
      dots.push({ p: add(p, mul(inward, EDGE + PITCH * i)), axis: nrm, half: Math.max(g.tw / 2, t / 2) + 1 });
  }
  return { faces, dots };
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
  stroke?: number; // line width, mm
  bolt?: number; // bolt dot radius, mm
  maxStep?: number; // draw only the parts up to this build step
  animate?: boolean;
  stepMs?: number;
  bolts?: boolean;
};

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
  parts.forEach((part, pi) => {
    if (o.maxStep !== undefined && part.step > o.maxStep) return;
    for (const { pts, edges } of part.faces) {
      const n = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]));
      if (dot(n, c) <= 1e-9) continue;
      const depth = pts.reduce((s, p) => s + dot(p, c), 0) / pts.length;
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
    if (o.bolts === false) return;
    for (const dt of part.dots) {
      let p = dt.p;
      if (dt.axis) p = add(p, mul(dt.axis, (dot(dt.axis, c) >= 0 ? 1 : -1) * (dt.half ?? 0)));
      else if (dt.n && dot(dt.n, c) < 0.05) continue; // on a face we can't see
      const [x, y] = proj(p);
      nDots++;
      items.push({ depth: dot(p, c) + 25, part: pi, s: `<circle cx="${f(x)}" cy="${f(y)}" r="${f((o.bolt ?? 11) * scale)}"/>` });
    }
  });
  items.sort((a, b) => a.depth - b.depth);
  const pad = 150 * scale;
  [x0, y0, x1, y1] = [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
  const sw = f((o.stroke ?? 7) * scale);
  const drop = f((y1 - y0) * 0.04);
  const css =
    // scoped to the root class, so the svg can sit inline in a page
    `.steel path{fill:var(--bg,#fff);stroke:none}.steel .s,.steel .e{stroke:currentColor;stroke-width:${sw};stroke-linecap:round;stroke-linejoin:round}` +
    `.steel .e{fill:none}.steel circle{fill:currentColor}.steel .a{color:var(--accent,#e30713)}` +
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
