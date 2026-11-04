// The tests of RESSLab Hub that are not beam-to-column tests: one specimen
// in its test rig, from a BraceSpecimen or a ColumnSpecimen (specimen.ts).
// generate() sends them here. No solve: the specimen is only drawn (ok, no
// ratio). No three.js here.
//
// ------------------------------------------------------------- brace tests
// The `braces` table: one brace in its test rig.
//
// The brace is in the plane x = 0. Its bottom work point is at the origin,
// its top work point `length` away, `angle` above the horizontal toward +y.
// - SB: the bottom end on a floor block, the top end under a loading beam
//   that a horizontal actuator pushes along y.
// - SBF: a one bay frame of rig members around the brace, pinned at the
//   feet, the actuator on the top beam. The brace goes from a foot corner to
//   the opposite top corner. DBF: a second brace on the other diagonal, side
//   by side with the first one (x > 0 and x < 0).
// The rig faces (the floor block top, the frame flanges) come as close to the
// work points as the end details let them. Each end detail (a gusset, a seat)
// fills the corner between the brace end and the rig faces.
//
// ------------------------------------------------------------- column tests
// The `columns` table: one column on a floor block. See buildColumn.
import type { V } from './vec.ts';
import type { Catalog, Section } from './sections.ts';
import { boxOf, flat, geo, memberBoxes, memberFaces, type P2, type Part } from './steel.ts';
import { actuator, block, clevis, crosshead, hingeSize, rigMember, rigSection, seat, type RigOpts } from './rig.ts';
import { findSection, type BraceSpecimen, type ColumnSpecimen } from './specimen.ts';
import type { Detail, Params, Result, Structure } from './generate.ts';

// ------------------------------------------------------------- the plane
type Q = [number, number]; // a point or a direction in the brace plane: (y, z)
const plus = (a: Q, b: Q, k = 1): Q => [a[0] + k * b[0], a[1] + k * b[1]];
const dot2 = (a: Q, b: Q) => a[0] * b[0] + a[1] * b[1];
const turn = (u: Q): Q => [-u[1], u[0]]; // u turned 90°
const at = (x: number, p: Q): V => [x, p[0], p[1]];
const dir = (u: Q): V => [0, u[0], u[1]];
const X: V = [1, 0, 0];
const Y: V = [0, 1, 0];
const Z: V = [0, 0, 1];
const r5 = (x: number) => Math.round(x / 5) * 5;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const rect = (a: number, b: number): P2[] => [[-a / 2, -b / 2], [a / 2, -b / 2], [a / 2, b / 2], [-a / 2, b / 2]];

// The rig faces around the brace. The free side of a face is dot(n, p) >= c.
// floor and load: the floor block and the loading beam of SB. colA, colB,
// base, beam: the inner flanges of the frame (colA at the bottom work point).
type Side = 'floor' | 'load' | 'colA' | 'colB' | 'base' | 'beam';
const NORMAL: Record<Side, Q> = { floor: [0, 1], load: [0, -1], colA: [1, 0], colB: [-1, 0], base: [0, 1], beam: [0, -1] };
type Faces = Partial<Record<Side, number>>;

function hull(ps: Q[]): Q[] {
  const s = [...ps].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o: Q, a: Q, b: Q) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (pts: Q[]) => {
    const h: Q[] = [];
    for (const p of pts) {
      while (h.length >= 2 && cr(h[h.length - 2], h[h.length - 1], p) <= 1e-9) h.pop();
      h.push(p);
    }
    h.pop();
    return h;
  };
  return [...half(s), ...half(s.reverse())];
}

// the part of a polygon on the free side of a face
function clip(poly: Q[], n: Q, c: number): Q[] {
  const out: Q[] = [];
  for (let i = 0; i < poly.length; i++) {
    const [a, b] = [poly[i], poly[(i + 1) % poly.length]];
    const [da, db] = [dot2(n, a) - c, dot2(n, b) - c];
    if (da >= 0) out.push(a);
    if (da >= 0 !== db >= 0) out.push(plus(a, plus(b, a, -1), da / (da - db)));
  }
  return out;
}

// The outline of an end detail: the points pts, pushed back to the rig faces
// of the end, and the corner between its two faces. uin: from the end into
// the brace. The detail is convex, and it stays on the free side of every face.
function outline(pts: Q[], sides: Side[], c: Faces, uin: Q): Q[] {
  const all = [...pts];
  for (const s of sides) {
    const n = NORMAL[s];
    const nu = dot2(n, uin);
    for (const p of pts) {
      const k = dot2(n, p) - c[s]!;
      all.push(plus(p, n, -k)); // straight onto the face
      if (nu > 1e-6) all.push(plus(p, uin, -k / nu)); // back along the brace
    }
  }
  if (sides.length === 2) {
    const [n1, n2] = sides.map((s) => NORMAL[s]);
    const [c1, c2] = sides.map((s) => c[s]!);
    const det = n1[0] * n2[1] - n1[1] * n2[0];
    if (Math.abs(det) > 1e-9) all.push([(c1 * n2[1] - n1[1] * c2) / det, (n1[0] * c2 - c1 * n2[0]) / det]);
  }
  let poly = hull(all);
  for (const s of Object.keys(c) as Side[]) poly = clip(poly, NORMAL[s], c[s]!);
  return poly;
}

// how far p goes back along the brace (-uin) before it meets a face of the end
function depth(p: Q, sides: Side[], c: Faces, uin: Q): number {
  let k = Infinity;
  for (const s of sides) {
    const nu = dot2(NORMAL[s], uin);
    if (nu > 1e-6) k = Math.min(k, (dot2(NORMAL[s], p) - c[s]!) / nu);
  }
  return Number.isFinite(k) ? k : 100;
}

// ------------------------------------------------------------- the ends
// One end of a brace: where the brace starts (from the work point W, along
// uin), the points that stay clear of the rig faces, the points its outline
// grows from, and its parts once the faces are known. The bottom end builds
// from the rig to the brace (it returns the part the brace stands on), the
// top end from the brace to the rig. rig: the rig parts it is fixed to.
type Add = (p: Part) => Part;
type End = {
  W: Q; uin: Q; sides: Side[];
  start: number;
  keep: [Q, number][];
  pts: Q[];
  build: (c: Faces, add: Add, brace: string | undefined, rig: string[]) => string;
};

// g: how far a gusset goes along the brace, lap: the part of it inside the
// tube, t: the thickness of the gussets or end plates (top, bottom)
type EndSize = { g: number; lap: number; t: [number, number] };

function endOf(spec: BraceSpecimen, sec: Section, sz: EndSize, bid: string, top: boolean, W: Q, uin: Q, x: number, sides: Side[]): End {
  const name = top ? 'to' : 'from';
  const q = turn(uin);
  const P = (s: number, w: number) => plus(plus(W, uin, s), q, w);
  const fromDir: V = Z;
  const plate = (o: Q, tp: number, hp: number, wx: number, on: string[], add: Add) => {
    const f = flat(at(x, plus(o, uin, tp / 2)), dir(q), X, tp, rect(2 * hp, wx));
    return add({ id: `${bid}-${name}-plate`, step: 0, supports: on, kind: 'plate', from: fromDir, faces: f.faces, boxes: [f.box], dots: [], info: { type: 'End plate', of: bid } }).id;
  };
  // a seat behind the face through o (at right angles to the brace): its
  // outline from the two front corners, its box the block straight behind them
  const seatAt = (corners: Q[], o: Q, hw: number, wx: number, c: Faces, on: string[], add: Add) => {
    const k = Math.min(...corners.map((p) => depth(p, sides, c, uin)));
    const box = boxOf(at(x, plus(o, uin, -k / 2)), X, dir(uin), 2 * hw, wx, k);
    return add(seat(`${bid}-${name}-seat`, [x, 0, 0], Y, Z, wx, outline(corners, sides, c, uin), { step: 0, supports: on, from: fromDir }, box)).id;
  };

  if (spec.ends === 'gusset') {
    const { g, lap } = sz;
    const t = sz.t[top ? 0 : 1];
    const s0 = g - lap;
    const hw = sec.d / 2 + 25;
    const pts = [P(s0, hw), P(s0, -hw), P(g, hw), P(g, -hw)];
    return {
      W, uin, sides, start: s0, pts,
      keep: [[P(s0, sec.d / 2), 25], [P(s0, -sec.d / 2), 25]],
      build: (c, add, brace, rig) => {
        const f = flat([x, 0, 0], Y, Z, t, outline(pts, sides, c, uin));
        const on = brace ? [brace, ...rig] : rig;
        return add({ id: `${bid}-${name}-conn`, step: 0, supports: on, kind: 'plate', from: fromDir, faces: f.faces, boxes: [f.box], dots: [], info: { type: 'Gusset plate', of: bid } }).id;
      },
    };
  }

  const tp = sz.t[top ? 0 : 1];
  if (spec.ends === 'fixed') {
    const hp = sec.d / 2 + 20;
    const wx = sec.bf + 40;
    const pts = [P(0, hp), P(0, -hp)];
    return {
      W, uin, sides, start: tp, pts,
      keep: [[pts[0], 60], [pts[1], 60], [P(tp, hp), 25], [P(tp, -hp), 25]],
      build: (c, add, brace, rig) => {
        if (brace) return seatAt(pts, W, hp, wx, c, [plate(W, tp, hp, wx, [brace], add), ...rig], add);
        return plate(W, tp, hp, wx, [seatAt(pts, W, hp, wx, c, rig, add)], add);
      },
    };
  }

  // pin: a pin joint on a seat, the pin at the work point
  const D = clamp(r5(0.45 * Math.min(sec.d, sec.bf)), 20, 80);
  const hz = hingeSize(D);
  const M = plus(W, uin, -hz.pin); // the mount face of the joint
  const T = hz.reach - hz.pin; // the tongue end, from W
  const hp = Math.max(sec.d / 2 + 20, hz.R + 10);
  const wx = Math.max(sec.bf + 40, hz.tt + 40);
  const pts = [plus(M, q, hz.side / 2), plus(M, q, -hz.side / 2)];
  return {
    W, uin, sides, start: T + tp, pts,
    keep: [[pts[0], 60], [pts[1], 60], [P(T, hp), 25], [P(T, -hp), 25], [P(T + tp, hp), 25], [P(T + tp, -hp), 25]],
    build: (c, add, brace, rig) => {
      const pin = (on: string[]) => add(clevis(`${bid}-${name}-pin`, at(x, M), dir(uin), X, D, hz.reach, { step: 0, supports: on, from: fromDir })).id;
      const seatHere = (on: string[]) => seatAt(pts, M, hz.side / 2, hz.width, c, on, add);
      if (brace) return seatHere([pin([plate(plus(W, uin, T), tp, hp, wx, [brace], add)]), ...rig]);
      return plate(plus(W, uin, T), tp, hp, wx, [pin([seatHere(rig)])], add);
    },
  };
}

// the parts of the members detail: no plates (what stood on a plate stands
// on what held it). The other details keep them all.
function forDetail(parts: Part[], detail: Detail): Part[] {
  if (detail !== 'members') return parts;
  const gone = new Map(parts.filter((q) => q.kind === 'plate').map((q) => [q.id, q.supports]));
  const keep = (ids: string[]): string[] => ids.flatMap((s) => (gone.has(s) ? keep(gone.get(s)!) : [s]));
  return parts.filter((q) => !gone.has(q.id)).map((q) => ({ ...q, supports: [...new Set(keep(q.supports))] }));
}

// ------------------------------------------------------------- the test
export function buildBrace(p: Params, spec: BraceSpecimen, cat: Catalog, detail: Detail): Result {
  const t0 = performance.now();
  const sec = findSection(spec.section, cat);
  const L = spec.length;
  if (!(L > 0)) throw new Error(`${spec.id}: length must be a number above 0, not ${JSON.stringify(L)}`);
  const a = (spec.angle * Math.PI) / 180;
  const u: Q = [Math.cos(a), Math.sin(a)];
  const log = [...(spec.notes ?? [])];

  // the end sizes
  const clear = spec.clear;
  let g = clear !== undefined && clear > 0 && clear < L ? (L - clear) / 2 : 0;
  if (spec.ends === 'gusset' && !g) {
    g = r5(Math.min(0.2 * L, Math.max(200, 1.5 * sec.d + 100)));
    log.push(`clear length ${clear === undefined ? 'not given' : `${clear} mm, not shorter than the brace`}: each gusset drawn ${g} mm long`);
  }
  const lap = Math.min(clamp(1.2 * sec.d, 80, 300), 0.6 * g);
  const thick = (given: number | undefined, min: number, what: string) => {
    if (given !== undefined && given > 0) return given;
    const t = Math.max(min, Math.round(1.5 * sec.tf));
    log.push(`${what} thickness not given, drawn ${t} mm`);
    return t;
  };
  const kind = spec.ends === 'gusset' ? 'gusset' : 'end plate';
  const min = spec.ends === 'gusset' ? 10 : 20;
  const sz: EndSize = { g, lap, t: [thick(spec.plates?.top, min, `top ${kind}`), thick(spec.plates?.bottom, min, `bottom ${kind}`)] };

  // the braces and their ends
  const frame = spec.frame;
  const inFrame = frame !== 'SB';
  const e = frame === 'DBF' ? sec.bf / 2 + 5 : 0;
  const W1: Q = [L * u[0], L * u[1]];
  const down: Q = [-u[0], -u[1]];
  const [bot, top]: Side[][] = inFrame ? [['colA', 'base'], ['colB', 'beam']] : [['floor'], ['load']];
  const braces: { id: string; x: number; ends: [End, End] }[] = [
    { id: 'brace', x: e, ends: [endOf(spec, sec, sz, 'brace', false, [0, 0], u, e, bot), endOf(spec, sec, sz, 'brace', true, W1, down, e, top)] },
  ];
  if (frame === 'DBF') {
    // the other diagonal: from the foot of colB up to the top of colA
    const v: Q = [-u[0], u[1]];
    const B0: Q = [W1[0], 0];
    const B1: Q = [0, W1[1]];
    braces.push({ id: 'brace2', x: -e, ends: [endOf(spec, sec, sz, 'brace2', false, B0, v, -e, ['colB', 'base']), endOf(spec, sec, sz, 'brace2', true, B1, [-v[0], -v[1]], -e, ['colA', 'beam'])] });
  }
  const ends = braces.flatMap((b) => b.ends);
  for (const b of braces) {
    const room = L - b.ends[0].start - b.ends[1].start;
    if (room < Math.max(100, sec.d)) throw new Error(`${spec.id}: length ${L} mm is too short for the end details`);
  }

  // the rig faces: through the work points (the frame member axes through
  // them), then pushed back until every end detail fits
  const R = rigSection(cat, Math.max(300, 2 * sec.d), frame === 'DBF' ? 2 * sec.bf + 60 : sec.bf + 60);
  const c: Faces = {};
  for (const en of ends)
    for (const s of en.sides) {
      const v = dot2(NORMAL[s], en.W) + (inFrame ? R.d / 2 : 0);
      c[s] = Math.min(c[s] ?? Infinity, v);
    }
  for (const en of ends)
    for (const [pt, gap] of en.keep)
      for (const s of Object.keys(c) as Side[]) c[s] = Math.min(c[s]!, dot2(NORMAL[s], pt) - gap);
  for (const s of Object.keys(c) as Side[]) c[s] = Math.floor(c[s]! / 5) * 5;
  const t1 = performance.now();

  // the parts, in build order. A part that stands on others gets the next
  // step, a part on the floor (a block, a wall) step 0.
  const parts: Part[] = [];
  let step = 1;
  const add: Add = (pt) => {
    pt.step = pt.supports.length ? step++ : 0;
    parts.push(pt);
    return pt;
  };
  const ro = (supports: string[], type?: string): RigOpts => ({ step: 0, supports, ...(type ? { type } : {}) });
  const ground = (type?: string): RigOpts => ({ step: 0, supports: [], from: [0, 0, -1], ...(type ? { type } : {}) });
  const extent = (en: End) => {
    const ys = outline(en.pts, en.sides, c, en.uin).map((q) => q[0]);
    return [Math.min(...ys) - 150, Math.max(...ys) + 150];
  };
  // the actuator on the loaded beam end at y1, height zc, from a reaction
  // wall on the side s (+1: toward +y). The wall stands on the floor zf.
  const push = (zf: number, zc: number, y1: number, s: number) => {
    const D = clamp(r5(0.2 * R.d), 40, 80);
    const y0 = y1 + s * Math.max(1000, 14 * D);
    add(block('rig-wall', [0, y0 + s * 200, (zf + zc + 400) / 2], [Math.max(600, R.bf + 200), 400, zc + 400 - zf], ground('Reaction wall')));
    add(actuator('rig-actuator', [0, y0, zc], [0, y1, zc], X, D, ro(['rig-wall', 'rig-beam'])));
  };

  // the rig before the braces, and what comes after them
  let after = () => {};
  const bottomRig: string[][] = [];
  const topRig: string[] = [];
  if (!inFrame) {
    // SB: the floor block under the bottom end, then (after the brace) the
    // loading beam on the top end and the actuator from the wall at +y
    const [bot, tp] = braces[0].ends;
    const [y0, y1] = extent(bot);
    const zf = c.floor!;
    add(block('rig-floor', [0, (y0 + y1) / 2, zf - 200], [Math.max(600, sec.bf + 240), y1 - y0, 400], ground()));
    bottomRig.push(['rig-floor']);
    after = () => {
      const [b0, b1] = extent(tp);
      const zc = -c.load! + R.d / 2;
      add(rigMember('rig-beam', R, [0, b0, zc], [0, b1, zc], ro([parts[parts.length - 1].id], 'Loading beam')));
      push(zf - 400, zc, b1, 1);
    };
  } else {
    // SBF, DBF: the frame, its columns pinned on the base beam
    const dR = R.d;
    const [yA, yB, zb, zt] = [c.colA!, -c.colB!, c.base!, -c.beam!];
    const [axA, axB] = [yA - dR / 2, yB + dR / 2];
    const zfb = zb - dR; // the base beam bottom, on the floor blocks
    const bw = Math.max(600, R.bf + 200);
    add(block('rig-block', [0, axA, zfb - 200], [bw, 600, 400], ground()));
    add(block('rig-block2', [0, axB, zfb - 200], [bw, 600, 400], ground()));
    add(rigMember('rig-base', R, [0, axA - 300, zb - dR / 2], [0, axB + 300, zb - dR / 2], ro(['rig-block', 'rig-block2'], 'Base beam')));
    const Df = clamp(r5(0.25 * dR), 40, 100);
    const reach = hingeSize(Df).reach;
    add(clevis('rig-footA', [0, axA, zb], Z, X, Df, reach, ro(['rig-base'])));
    add(clevis('rig-footB', [0, axB, zb], Z, X, Df, reach, ro(['rig-base'])));
    add(rigMember('rig-colA', R, [0, axA, zb + reach], [0, axA, zt], ro(['rig-footA'], 'Frame column')));
    add(rigMember('rig-colB', R, [0, axB, zb + reach], [0, axB, zt], ro(['rig-footB'], 'Frame column')));
    add(rigMember('rig-beam', R, [0, yA - dR, zt + dR / 2], [0, yB + dR, zt + dR / 2], ro(['rig-colA', 'rig-colB'], 'Frame beam')));
    bottomRig.push(['rig-base', 'rig-colA'], ['rig-base', 'rig-colB']);
    topRig.push('rig-beam');
    after = () => push(zfb - 400, zt + dR / 2, yA - dR, -1);
    if (frame === 'DBF') log.push('the two braces are drawn side by side where they cross, the middle connection is not drawn');
  }

  // each brace, from its bottom end to its top end
  braces.forEach((b, i) => {
    const [bot, tp] = b.ends;
    const on = bot.build(c, add, undefined, bottomRig[i]);
    const gm = geo(b.id, sec, at(b.x, plus(bot.W, bot.uin, bot.start)), at(b.x, plus(tp.W, tp.uin, tp.start)), false);
    add({ id: b.id, step: 0, supports: [on], kind: 'member', from: Z, faces: memberFaces(gm, p.seg), boxes: memberBoxes(gm), dots: [], info: { type: 'Brace', sec, L } });
    tp.build(c, add, b.id, topRig);
  });
  after();

  const out = forDetail(parts, detail);
  log.push(`brace test ${frame}, ${spec.ends} ends, not solved (only drawn)`);
  const st: Structure = {
    form: 'specimen', id: spec.id, H: Math.round(W1[1]), col: sec, cols: [], arms: [], secs: [],
    brace: { frame, L, angle: spec.angle, ends: spec.ends },
  };
  return { st, parts: out, ok: true, log, ratio: 0, alpha: Infinity, solves: 0, ms: { topology: t1 - t0, solve: 0, geometry: performance.now() - t1 }, nodes: 0, members: {} };
}

// ------------------------------------------------------------- column tests
const COLUMN_ENDS: ColumnSpecimen['ends'][] = ['fixed-free', 'fixed-fixed', 'fixed-flexible'];

// One column test. The column axis is on z, from z = 0 to its length (the end
// plates are outside it). The column is turned by `angle` in plan, its web
// `angle` away from y: the push is always along y, so the rig stays square
// to the axes. Under the foot plate a floor block. On the top plate the
// loading head, pushed by an actuator from a reaction wall at -y. Above the
// head the vertical actuators, hung from a crosshead across x: one in the
// middle, or for fixed-fixed two side by side along y (from a spreader beam
// under the crosshead), so the head can't turn.
export function buildColumn(p: Params, spec: ColumnSpecimen, cat: Catalog, detail: Detail): Result {
  const t0 = performance.now();
  const sec = findSection(spec.section, cat);
  const L = spec.length;
  if (!(L > 0)) throw new Error(`${spec.id}: length must be a number above 0, not ${JSON.stringify(L)}`);
  if (!COLUMN_ENDS.includes(spec.ends)) throw new Error(`${spec.id}: ends must be one of ${COLUMN_ENDS.join(', ')}, not ${JSON.stringify(spec.ends)}`);
  if (!Number.isFinite(spec.angle)) throw new Error(`${spec.id}: angle must be a number, not ${JSON.stringify(spec.angle)}`);
  const log = [...(spec.notes ?? [])];
  const a = (spec.angle * Math.PI) / 180;
  const [sa, ca] = [Math.abs(Math.sin(a)), Math.abs(Math.cos(a))];

  // the end plates: square to the axes, past the section by m on each side
  // (the bolts go there)
  const [ex, ey] = [sa * sec.d / 2 + ca * sec.bf / 2, ca * sec.d / 2 + sa * sec.bf / 2];
  const m = clamp(r5(0.25 * Math.max(sec.d, sec.bf)), 60, 150);
  const [px, py] = [2 * ex + 2 * m, 2 * ey + 2 * m];
  const thick = (given: number | undefined, what: string) => {
    if (given !== undefined && given > 0) return given;
    const t = Math.max(25, Math.round(1.5 * sec.tf));
    log.push(`${what} end plate thickness not given, drawn ${t} mm`);
    return t;
  };
  const [tt, tb] = [thick(spec.plates?.top, 'top'), thick(spec.plates?.bottom, 'bottom')];
  const zh = L + tt; // the top of the top plate, where the head sits

  // the rig sizes: the actuator pins, the head, the floor
  const Da = clamp(r5(0.2 * Math.max(sec.d, sec.bf)), 40, 80);
  const hz = hingeSize(Da);
  const two = spec.ends === 'fixed-fixed';
  const e = two ? r5(Math.max(hz.side / 2 + 30, ey)) : 0; // the vertical actuators, from the axis along y
  const hh = Math.max(250, r5(2.6 * Da + 80)); // the head height
  const hx = Math.max(ex + m / 2 - 25, hz.width / 2 + 20);
  const hy = Math.max(ey + m / 2 - 25, two ? e + hz.side / 2 + 20 : hz.side / 2 + 20);
  const zf = -tb - 400; // the floor
  const Wb = r5(Math.max(px, py) + 300); // the floor block
  const reach = Math.max(1000, 14 * Da); // the length of an actuator
  const R = rigSection(cat, Math.max(300, Math.min(600, 0.5 * Math.max(sec.d, sec.bf) + 150)));
  const t1 = performance.now();

  // the parts, in build order (as for the braces: a part on others gets the
  // next step, a part on the floor step 0)
  const parts: Part[] = [];
  let step = 1;
  const add = (pt: Part) => {
    pt.step = pt.supports.length ? step++ : 0;
    parts.push(pt);
    return pt;
  };
  const ro = (supports: string[], type?: string): RigOpts => ({ step: 0, supports, ...(type ? { type } : {}) });
  const ground = (type?: string): RigOpts => ({ step: 0, supports: [], from: [0, 0, -1], ...(type ? { type } : {}) });
  // an end plate centred at height z, its bolts on the face toward n
  const bolts = (z: number, n: number) => {
    if (detail !== 'bolts') return [];
    const [bx, by] = [ex + m / 2, ey + m / 2];
    const at: [number, number][] = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
    return at.map(([i, j]) => ({ p: [i * bx, j * by, z] as V, n: [0, 0, n] as V }));
  };
  const plate = (id: string, z: number, t: number, n: number, on: string) => {
    const f = flat([0, 0, z], X, Y, t, rect(px, py));
    return add({ id, step: 0, supports: [on], kind: 'plate', from: [0, 0, -1], faces: f.faces, boxes: [f.box], dots: bolts(z + (n * t) / 2, n), info: { type: 'End plate', of: 'column' } });
  };

  add(block('rig-floor', [0, 0, zf + 200], [Wb, Wb, 400], ground()));
  plate('column-foot', -tb / 2, tb, 1, 'rig-floor');
  const g = geo('column', sec, [0, 0, 0], [0, 0, L], false);
  g.w = [Math.sin(a), Math.cos(a), 0];
  g.v = [g.w[1], -g.w[0], 0]; // cross(w, u), u = z
  add({ id: 'column', step: 0, supports: ['column-foot'], kind: 'column', from: Z, faces: memberFaces(g, p.seg), boxes: memberBoxes(g), dots: [], info: { type: 'Column', sec, L } });
  plate('column-cap', L + tt / 2, tt, 1, 'column');
  add(block('rig-head', [0, 0, zh + hh / 2], [2 * hx, 2 * hy, hh], ro(['column-cap'], 'Loading head')));

  // the push: from the wall at -y to the head face, at mid head height
  const zc = zh + hh / 2;
  const y0 = -hy - reach;
  add(block('rig-wall', [0, y0 - 200, (zf + zc + 400) / 2], [Math.max(600, 2 * hx + 200), 400, zc + 400 - zf], ground('Reaction wall')));
  add(actuator('rig-actuator', [0, y0, zc], [0, -hy, zc], X, Da, ro(['rig-wall', 'rig-head'])));

  // the axial load: the crosshead posts clear the floor block and the wall
  const top = zh + hh + reach + (two ? R.d : 0); // the crosshead beam bottom
  const span = r5(Math.max(Wb, 600, 2 * hx + 200) + R.d + 200);
  add(crosshead('rig-crosshead', [0, 0, top], X, span, zf, R, ground()));
  if (two) {
    const zs = top - R.d / 2;
    add(rigMember('rig-spreader', R, [0, -e - hz.side / 2 - 100, zs], [0, e + hz.side / 2 + 100, zs], ro(['rig-crosshead'], 'Spreader beam')));
    for (const [k, s] of [[1, -1], [2, 1]])
      add(actuator(`rig-axial${k === 1 ? '' : k}`, [0, s * e, top - R.d], [0, s * e, zh + hh], X, Da, ro(['rig-spreader', 'rig-head'])));
  } else add(actuator('rig-axial', [0, 0, top], [0, 0, zh + hh], X, Da, ro(['rig-crosshead', 'rig-head'])));

  log.push(`column test ${spec.ends}, pushed at ${spec.angle}° from the web, not solved (only drawn)`);
  const st: Structure = {
    form: 'specimen', id: spec.id, H: Math.round(L), col: sec, cols: [], arms: [], secs: [],
    columnTest: { ends: spec.ends, L, angle: spec.angle },
  };
  return { st, parts: forDetail(parts, detail), ok: true, log, ratio: 0, alpha: Infinity, solves: 0, ms: { topology: t1 - t0, solve: 0, geometry: performance.now() - t1 }, nodes: 0, members: {} };
}
