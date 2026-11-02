// A steel structure from a seed, in one of three forms:
// - tree: one column on a base plate, arms at random levels and bearings,
//   sometimes a brace under an arm or a secondary beam off it.
// - portal: two columns with beams between them, one or two storeys, braced
//   or not, and a few arms out of the columns.
// - box: four columns in a rectangle, beams and braces only in its four
//   walls, nothing sticks out.
// The solver checks it stands up, fixes it if not, and sizes the members.
import { add, len, mul, sub, type V } from './vec.ts';
import { solve, type Elem, type FNode } from './solver.ts';
import type { Catalog, Section } from './sections.ts';
import {
  box3, boxOf, geo, hardware, memberBoxes, memberFaces, resolve, supportFace, PINNED, SETBACK,
  type ConnType, type Geo, type Part,
} from './steel.ts';

export type Detail = 'members' | 'plates' | 'bolts';
export type Params = {
  seed: number;
  arms: number;
  height: number; // mm
  load: number; // line load on the arms, N/mm (= kN/m)
  fy: number; // MPa
  braceP: number;
  secondaryP: number;
  seg: number;
  form: Form | 'mix'; // mix: the seed picks the form
};
export const DEFAULTS: Params = { seed: 1, arms: 8, height: 2500, load: 100, fy: 345, braceP: 0.3, secondaryP: 0.35, seg: 400, form: 'mix' };

export function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// a: where the brace meets the arm, measured from the column it starts on
// (the column at the `end` of the arm: 0 its start, 1 its far end). zb:
// where it meets that column, a height that stays put when sizing changes
// the depth of the arm.
type Brace = { a: number; zb: number; sec: Section; end: 0 | 1 };
// An arm starts on column `col`. A bay beam also ends on column `to`.
type Arm = { id: string; col: number; to?: number; z: number; bearing: number; L: number; conn: ConnType; conn2?: ConnType; sec: Section; braces: Brace[] };
const drop = (a: Arm, b: Brace) => a.z - a.sec.d - b.zb;
const braceId = (a: Arm, i: number) => `${a.id}-brace${i ? i + 1 : ''}`;
type Secondary = { id: string; arm: number; a: number; side: 1 | -1; L: number; conn: ConnType; sec: Section };
type Col = { x: V };
export type Form = 'tree' | 'portal' | 'box';
export type Structure = { form: Form; H: number; col: Section; cols: Col[]; arms: Arm[]; secs: Secondary[] };
const colId = (i: number) => (i ? `column${i + 1}` : 'column');
const baseId = (i: number) => (i ? `base${i + 1}` : 'base');

const hdir = (bearing: number): V => [Math.sin((bearing * Math.PI) / 180), Math.cos((bearing * Math.PI) / 180), 0];
const mid = <T>(xs: T[]) => xs[Math.floor(xs.length / 2)];
const r50 = (x: number) => Math.round(x / 50) * 50;
const r150 = (x: number) => Math.round(x / 150) * 150;
// where the arm starts: on the axis of its column
const start = (st: Structure, a: Arm): V => add(st.cols[a.col].x, [0, 0, a.z]);

function pick<T extends string>(rng: () => number, w: Record<T, number>): T {
  const total = Object.values<number>(w).reduce((s, x) => s + x, 0);
  let x = rng() * total;
  for (const [k, v] of Object.entries<number>(w)) if ((x -= v) < 0) return k as T;
  return Object.keys(w)[0] as T;
}
const BEAM_CONN = { shear_tab: 0.4, end_plate: 0.2, flange_plates: 0.2, welded: 0.2 };

// every face of a column an arm lands on: its column, bearing and height
function faces(arms: Arm[]) {
  return arms.flatMap((a) => [
    { a, col: a.col, bearing: a.bearing, z: a.z },
    ...(a.to === undefined ? [] : [{ a, col: a.to, bearing: (a.bearing + 180) % 360, z: a.z }]),
  ]);
}

// ------------------------------------------------------------- topology
// tree: one column with arms (the first form, keep its random draws as they
// are so old seeds give the same structure)
function tree(p: Params, cat: Catalog, rng: () => number): Structure {
  const H = p.height;
  const arms: Arm[] = [];
  for (let k = 0, tries = 0; k < p.arms && tries < 200; tries++) {
    const z = Math.round((0.35 + 0.6 * rng()) * H / 150) * 150;
    const bearing = 90 * Math.floor(rng() * 4);
    // arms on the same side need room between them
    if (arms.some((a) => a.bearing === bearing && Math.abs(a.z - z) < 900)) continue;
    const L = r50((0.3 + 0.4 * rng()) * H);
    const conn = pick(rng, BEAM_CONN);
    arms.push({ id: `arm${k + 1}`, col: 0, z, bearing, L, conn, sec: mid(cat.beams), braces: [] });
    k++;
  }
  arms.sort((a, b) => a.z - b.z);
  arms.forEach((a, i) => (a.id = `arm${i + 1}`));
  for (const a of arms) if (rng() < p.braceP) addBrace(a, arms, cat);
  return { form: 'tree', H, col: mid(cat.columns), cols: [{ x: [0, 0, 0] }], arms, secs: secondaries(p, cat, rng, arms) };
}

function secondaries(p: Params, cat: Catalog, rng: () => number, arms: Arm[]): Secondary[] {
  const secs: Secondary[] = [];
  arms.forEach((a, i) => {
    if (rng() >= p.secondaryP) return;
    // on a bay beam, away from the columns and the knee braces
    const at = a.to === undefined ? 0.6 + 0.35 * rng() : 0.4 + 0.2 * rng();
    secs.push({
      id: `sec${secs.length + 1}`, arm: i, a: r50(at * a.L),
      side: rng() < 0.5 ? 1 : -1, L: r50((0.25 + 0.25 * rng()) * (a.to === undefined ? a.L : Math.min(a.L, p.height))),
      conn: pick(rng, { shear_tab: 0.6, end_plate: 0.25, welded: 0.15 }), sec: mid(cat.beams),
    });
  });
  return secs;
}

// portal: two columns and the beams between them, one or two storeys.
// box: four columns in a rectangle, so four walls. Nothing sticks out of
// them: no arms out of the columns, no secondary beams.
// Each bay storey gets its bracing: none (the connections take the
// moments), knee braces at both ends, a chevron (two braces up to the
// middle of the beam) or one diagonal. A portal also gets a few arms out of
// its columns.
function frame(form: 'portal' | 'box', p: Params, cat: Catalog, rng: () => number): Structure {
  const storeys = rng() < 0.4 ? 2 : 1;
  const H = r150(p.height * (storeys === 2 ? 1.5 : 1));
  const b0 = 90 * Math.floor(rng() * 4);
  const cols: Col[] = [{ x: [0, 0, 0] }];
  const bays: [number, number, number][] = []; // from column, to column, bearing
  const span = () => r50((0.8 + 0.5 * rng()) * p.height);
  if (form === 'portal') {
    cols.push({ x: mul(hdir(b0), span()) });
    bays.push([0, 1, b0]);
  } else {
    const b1 = (b0 + 90) % 360;
    const [u, v] = [mul(hdir(b0), span()), mul(hdir(b1), span())];
    cols.push({ x: u }, { x: v }, { x: add(u, v) });
    bays.push([0, 1, b0], [0, 2, b1], [1, 3, b1], [2, 3, b0]);
  }
  const levels = storeys === 2 ? [r150(0.5 * H), H - 150] : [H - 150];
  const arms: Arm[] = [];
  const bracing: string[] = [];
  for (const [i, j, bearing] of bays)
    for (const z of levels) {
      const L = Math.round(len(sub(cols[j].x, cols[i].x)));
      arms.push({ id: '', col: i, to: j, z, bearing, L, conn: pick(rng, BEAM_CONN), conn2: pick(rng, BEAM_CONN), sec: mid(cat.beams), braces: [] });
      bracing.push(pick(rng, { none: 0.2, knee: 0.3, chevron: 0.3, diagonal: 0.2 }));
    }
  // a few arms out of the columns, never on the side of a bay
  const nArms = form === 'box' ? 0 : Math.max(0, Math.min(3, Math.round((p.arms - arms.length) / 3)));
  for (let k = 0, tries = 0; k < nArms && tries < 100; tries++) {
    const col = Math.floor(rng() * cols.length);
    const bearing = 90 * Math.floor(rng() * 4);
    const z = r150((0.35 + 0.6 * rng()) * H);
    const L = r50((0.3 + 0.3 * rng()) * p.height);
    if (faces(arms).some((f) => f.col === col && f.bearing === bearing && (f.a.to !== undefined || Math.abs(f.z - z) < 900))) continue;
    arms.push({ id: '', col, z, bearing, L, conn: pick(rng, BEAM_CONN), sec: mid(cat.beams), braces: [] });
    k++;
  }
  arms.forEach((a, i) => (a.id = `arm${i + 1}`));
  // bracing, from the bottom storey up, so a brace knows the beams under it
  arms.forEach((a, i) => {
    const kind = bracing[i];
    if (kind === 'knee') addBrace(a, arms, cat, 0, 0.4) && addBrace(a, arms, cat, 1, 0.4);
    if (kind === 'chevron') addBrace(a, arms, cat, 0, 0, a.L / 2 - 250) && addBrace(a, arms, cat, 1, 0, a.L / 2 - 250);
    if (kind === 'diagonal') addBrace(a, arms, cat, rng() < 0.5 ? 0 : 1, 0, a.L - 500);
    if (kind === undefined && rng() < p.braceP) addBrace(a, arms, cat);
  });
  return { form, H, col: mid(cat.columns), cols, arms, secs: form === 'box' ? [] : secondaries(p, cat, rng, arms) };
}

// A brace under the arm, down to the column at its `end`. It must stay
// above the arms below it on the same face of that column (or it goes
// through them), and be long enough that its two gussets don't run into
// each other. A knee brace goes as far along the arm as down the column
// (at most `reach` of the arm). A brace with `along` set lands at that
// point of the arm, from as low as it can.
const BRACE_MIN = 1000; // mm, along the arm and down the column
function addBrace(a: Arm, arms: Arm[], cat: Catalog, end: 0 | 1 = 0, reach = 0.55, along = 0): boolean {
  const col = end ? a.to! : a.col;
  const bearing = end ? (a.bearing + 180) % 360 : a.bearing;
  const below = faces(arms).filter((f) => f.a !== a && f.col === col && f.bearing === bearing && f.z < a.z).map((f) => f.z + 600);
  const zb = Math.max(600, ...below);
  if (along) {
    // a steep brace: its gussets are far apart along it, the rule is on its length
    const dz = a.z - a.sec.d - zb;
    if (along < 500 || dz < 800 || Math.hypot(along, dz) < 1.4 * BRACE_MIN) return false;
    a.braces.push({ a: r50(along), zb, sec: mid(cat.tubes), end });
    return true;
  }
  const d = Math.min(reach * a.L, a.z - a.sec.d - zb);
  if (d < BRACE_MIN) return false;
  a.braces.push({ a: r50(d), zb: a.z - a.sec.d - d, sec: mid(cat.tubes), end });
  return true;
}

// ------------------------------------------------------------- analysis
type Model = { nodes: FNode[]; elems: Elem[]; owner: string[]; nodeOwner: string[][] };

function model(st: Structure, p: Params): Model {
  const nodes: FNode[] = [];
  const elems: Elem[] = [];
  const owner: string[] = [];
  const nodeOwner: string[][] = [];
  const node = (x: V, who: string, fixed = false) => {
    let i = nodes.findIndex((n) => Math.hypot(...sub(n.x, x)) < 1);
    if (i < 0) {
      i = nodes.push({ x, fixed }) - 1;
      nodeOwner.push([]);
    }
    if (!nodeOwner[i].includes(who)) nodeOwner[i].push(who);
    return i;
  };
  const w = (s: Section) => s.A * 7.7e-5; // self weight, N/mm
  const chain = (who: string, pts: V[], s: Section, pinFirst: boolean, q: number, pinLast = false) => {
    const ids = pts.map((x) => node(x, who));
    for (let k = 0; k + 1 < ids.length; k++) {
      elems.push({ i: ids[k], j: ids[k + 1], p: s, pinI: k === 0 && pinFirst, pinJ: k === ids.length - 2 && pinLast, q: [0, 0, -q] });
      owner.push(who);
    }
  };
  // each column, cut at every level something lands on
  st.cols.forEach((c, ci) => {
    const zs = new Set([0, st.H]);
    for (const a of st.arms) {
      if (a.col === ci || a.to === ci) zs.add(a.z);
      for (const b of a.braces) if ((b.end ? a.to : a.col) === ci) zs.add(b.zb);
    }
    node(c.x, 'column', true);
    chain('column', [...zs].sort((x, y) => x - y).map((z) => add(c.x, [0, 0, z])), st.col, false, w(st.col));
  });
  st.arms.forEach((a, i) => {
    const h = hdir(a.bearing);
    const o = start(st, a);
    const at = new Set([0, a.L]);
    for (const b of a.braces) at.add(b.end ? a.L - b.a : b.a);
    for (const s of st.secs) if (s.arm === i) at.add(s.a);
    const pts = [...at].sort((x, y) => x - y).map((t) => add(o, mul(h, t)));
    chain(a.id, pts, a.sec, PINNED.includes(a.conn), w(a.sec) + p.load, a.conn2 !== undefined && PINNED.includes(a.conn2));
    a.braces.forEach((b, k) => {
      const b0 = add(st.cols[b.end ? a.to! : a.col].x, [0, 0, b.zb]);
      const b1 = add(o, mul(h, b.end ? a.L - b.a : b.a));
      const id = braceId(a, k);
      elems.push({ i: node(b0, id), j: node(b1, id), p: b.sec, pinI: true, pinJ: true, q: [0, 0, -w(b.sec)] });
      owner.push(id);
    });
  });
  for (const s of st.secs) {
    const a = st.arms[s.arm];
    const h = hdir(a.bearing);
    const side: V = mul([h[1], -h[0], 0], s.side);
    const p0 = add(start(st, a), mul(h, s.a));
    chain(s.id, [p0, add(p0, mul(side, s.L))], s.sec, PINNED.includes(s.conn), w(s.sec) + p.load / 2);
  }
  return { nodes, elems, owner, nodeOwner };
}

// a mechanism at a node: fix the pinned connection highest up the support
// chain of the members that meet there (arm before its secondary)
function fix(st: Structure, m: Model, nodeIdx: number, cat: Catalog, rng: () => number, log: string[]): boolean {
  const who = m.nodeOwner[nodeIdx];
  const arms = st.arms.filter((a) => who.includes(a.id) || st.secs.some((s) => who.includes(s.id) && st.arms[s.arm] === a));
  for (const a of arms) {
    if (PINNED.includes(a.conn)) {
      if (!a.braces.length && rng() < 0.5 && addBrace(a, st.arms, cat, 0, a.to === undefined ? 0.55 : 0.4)) {
        log.push(`${a.id}: mechanism, added a brace`);
        return true;
      }
      a.conn = pick(rng, { end_plate: 1, flange_plates: 1, welded: 1 });
      log.push(`${a.id}: mechanism, shear tab -> ${a.conn}`);
      return true;
    }
    if (a.conn2 && PINNED.includes(a.conn2)) {
      a.conn2 = pick(rng, { end_plate: 1, flange_plates: 1, welded: 1 });
      log.push(`${a.id}: mechanism, far end shear tab -> ${a.conn2}`);
      return true;
    }
  }
  for (const s of st.secs.filter((s) => who.includes(s.id))) {
    if (!PINNED.includes(s.conn)) continue;
    s.conn = rng() < 0.6 ? 'end_plate' : 'welded';
    log.push(`${s.id}: mechanism, shear tab -> ${s.conn}`);
    return true;
  }
  return false;
}

// ------------------------------------------------------------- sizing
const LIMIT = 0.6;

function size(st: Structure, m: Model, res: { N: number; My: number; Mz: number }[], cat: Catalog, fy: number, check = false): number {
  const worst = new Map<string, { N: number; My: number; Mz: number }>();
  m.owner.forEach((who, i) => {
    const w = worst.get(who) ?? { N: 0, My: 0, Mz: 0 };
    worst.set(who, { N: Math.max(w.N, res[i].N), My: Math.max(w.My, res[i].My), Mz: Math.max(w.Mz, res[i].Mz) });
  });
  const ratio = (s: Section, f: { N: number; My: number; Mz: number }) => f.N / (s.A * fy) + f.My / (s.Ws * fy) + f.Mz / (s.Ww * fy);
  let maxRatio = 0;
  // the lightest section that works; in check mode, the current one is kept
  const choose = (list: Section[], who: string, cur: Section, ok: (s: Section) => boolean = () => true) => {
    const f = worst.get(who)!;
    const s = check ? cur : (list.find((s) => ok(s) && ratio(s, f) < LIMIT) ?? list[list.length - 1]);
    maxRatio = Math.max(maxRatio, ratio(s, f));
    return s;
  };
  for (const a of st.arms) {
    a.sec = choose(cat.beams, a.id, a.sec, (s) => s.d >= 200);
    a.braces.forEach((b, k) => {
      const L = Math.hypot(b.a, drop(a, b));
      b.sec = choose(cat.tubes, braceId(a, k), b.sec, (s) => L / s.rmin < 200);
    });
  }
  for (const s of st.secs) {
    const arm = st.arms[s.arm];
    s.sec = choose(cat.beams, s.id, s.sec, (x) => x.d <= arm.sec.d - 2 * arm.sec.tf);
  }
  // beams that frame into the column web must fit between its flanges
  const webArms = st.arms.filter((a) => a.bearing % 180 === 90).map((a) => a.sec.bf + 40);
  const needClear = Math.max(0, ...webArms);
  st.col = choose(cat.columns, 'column', st.col, (c) => c.d - 2 * c.tf >= needClear && c.d >= 250);
  return maxRatio;
}

// ------------------------------------------------------------- geometry
function parts(st: Structure, detail: Detail, seg: number): Part[] {
  const out: Part[] = [];
  let step = 0;
  const plates = detail !== 'members';
  const bolts = detail === 'bolts';
  const tb = 40;
  const cols = st.cols.map((c, ci) => {
    const g = geo(colId(ci), st.col, c.x, add(c.x, [0, 0, st.H]), false);
    const centre = add(c.x, [0, 0, -tb / 2]);
    out.push({
      id: baseId(ci), step: step++, supports: [], kind: 'base', from: [0, 0, -1],
      faces: box3(centre, [0, 1, 0], [0, 0, 1], st.col.bf + 150, st.col.d + 150, tb),
      boxes: [boxOf(centre, [0, 1, 0], [0, 0, 1], st.col.bf + 150, st.col.d + 150, tb)],
      dots: bolts ? [-1, 1].flatMap((sx) => [-1, 1].map((sy) => ({ p: add(c.x, [sx * (st.col.bf / 2 + 40), sy * (st.col.d / 2 + 40), 1]), n: [0, 0, 1] as V }))) : [],
    });
    out.push({ id: colId(ci), step: step++, supports: [baseId(ci)], kind: 'column', from: [0, 0, 1], faces: memberFaces(g, seg), boxes: memberBoxes(g), dots: [], accent: false });
    return g;
  });

  // one member and its end connections, in build order: plates, member, bolts
  type End = { S: Geo; sId: string; conn: ConnType; at: 'from' | 'to' };
  // from: the direction the member (and its plates) come from
  const member = (g: Geo, ends: End[], from: V) => {
    const rs = ends.map((e) => resolve(g, e.S, e.at));
    g.copes = rs.flatMap((r) => (r.cope ? [r.cope] : []));
    const hws = ends.map((e, i) => ({ e, hw: hardware(g, e.conn, rs[i]) }));
    const supports: string[] = [];
    for (const { e, hw } of hws) {
      if (plates && hw.faces.length) {
        out.push({ id: `${g.id}-${e.at}-conn`, step: step++, supports: [e.sId], kind: 'plate', from, faces: hw.faces, boxes: hw.boxes, dots: [] });
        supports.push(`${g.id}-${e.at}-conn`);
      } else supports.push(e.sId);
    }
    const Lg = len(sub(g.p1, g.p0));
    const cuts = hws.flatMap(({ e, hw }) => hw.reach.map((x) => (e.at === 'from' ? x : Lg - x)));
    out.push({ id: g.id, step: step++, supports, kind: 'member', from, faces: memberFaces(g, seg, cuts), boxes: memberBoxes(g), dots: [] });
    const dots = hws.flatMap(({ hw }) => hw.dots);
    if (bolts && dots.length) out.push({ id: `${g.id}-bolts`, step: step++, supports: [g.id, ...supports], kind: 'bolts', faces: [], dots });
  };

  const armGeo = new Map<string, Geo>();
  for (const a of st.arms) {
    const h = hdir(a.bearing);
    const o = start(st, a);
    const S = cols[a.col];
    const p0 = add(o, mul(h, supportFace(S, h) + SETBACK[a.conn]));
    const ends: End[] = [{ S, sId: colId(a.col), conn: a.conn, at: 'from' }];
    let p1 = add(o, mul(h, a.L));
    if (a.to !== undefined) {
      const Sj = cols[a.to];
      p1 = add(p1, mul(h, -(supportFace(Sj, mul(h, -1)) + SETBACK[a.conn2!])));
      ends.push({ S: Sj, sId: colId(a.to), conn: a.conn2!, at: 'to' });
    }
    const g = geo(a.id, a.sec, p0, p1, true);
    armGeo.set(a.id, g);
    // an arm slides in along its axis, a bay beam is lowered between its columns
    member(g, ends, a.to === undefined ? h : [0, 0, 1]);
    a.braces.forEach((b, k) => {
      const hb = b.end ? mul(h, -1) : h; // from its column, toward the arm
      const B = add(st.cols[b.end ? a.to! : a.col].x, [0, 0, b.zb]);
      const C = add(add(o, mul(h, b.end ? a.L - b.a : b.a)), [0, 0, -a.sec.d]);
      const u = sub(C, B);
      const L = Math.hypot(...u);
      const un = mul(u, 1 / L);
      const Sb = cols[b.end ? a.to! : a.col];
      const t0 = (supportFace(Sb, hb) + SETBACK.gusset) / (un[0] * hb[0] + un[1] * hb[1]);
      const t1 = SETBACK.gusset / un[2];
      const bg = geo(braceId(a, k), b.sec, add(B, mul(un, t0)), sub(C, mul(un, t1)), false);
      member(bg, [
        { S: Sb, sId: colId(b.end ? a.to! : a.col), conn: 'gusset', at: 'from' },
        { S: g, sId: a.id, conn: 'gusset', at: 'to' },
      ], a.to === undefined ? hb : [h[1], -h[0], 0]); // from outside, level; in a bay, from the side
    });
  }
  for (const s of st.secs) {
    const a = st.arms[s.arm];
    const ag = armGeo.get(a.id)!;
    const side = mul(ag.v, s.side);
    const at = add(start(st, a), mul(hdir(a.bearing), s.a));
    const g = geo(s.id, s.sec, add(at, mul(side, supportFace(ag, side) + SETBACK[s.conn])), add(at, mul(side, s.L)), true);
    member(g, [{ S: ag, sId: a.id, conn: s.conn, at: 'from' }], side);
  }
  return out;
}

// every part comes after the parts it stands on
export function floating(ps: Part[]): string[] {
  const step = new Map(ps.map((p) => [p.id, p.step]));
  return ps.flatMap((p) => p.supports.filter((s) => !((step.get(s) ?? Infinity) < p.step)).map((s) => `${p.id} before ${s}`));
}

export type Result = {
  st: Structure;
  parts: Part[];
  ok: boolean;
  log: string[];
  ratio: number;
  solves: number;
  ms: { topology: number; solve: number; geometry: number };
  nodes: number;
};

export function generate(p0: Partial<Params>, cat: Catalog, detail: Detail = 'bolts'): Result {
  const p = { ...DEFAULTS, ...p0 };
  const rng = mulberry32(p.seed * 7919 + 13);
  const t0 = performance.now();
  // a draw of its own, so a tree seed gives the same tree in mix and in tree
  const roll = mulberry32(p.seed * 104729 + 7)();
  const form: Form = p.form !== 'mix' ? p.form : roll < 0.45 ? 'tree' : roll < 0.75 ? 'portal' : 'box';
  const st = form === 'tree' ? tree(p, cat, rng) : frame(form, p, cat, rng);
  const t1 = performance.now();
  const log: string[] = [];
  let solves = 0;
  let ok = false;
  let ratio = 0;
  let m = model(st, p);
  let sized = 0;
  for (let k = 0; k < 40; k++) {
    m = model(st, p);
    const r = solve(m.nodes, m.elems);
    solves++;
    if (!r.ok) {
      ok = false;
      if (!fix(st, m, r.node, cat, rng, log)) {
        log.push(`mechanism at node ${r.node} (${m.nodeOwner[r.node].join(', ')}) ${r.dofName}, no fix found`);
        break;
      }
      continue;
    }
    ok = true;
    // three sizing passes, then one more solve to check the final sections
    ratio = size(st, m, r.forces, cat, p.fy, sized === 3);
    if (sized === 3) break;
    sized++;
  }
  log.push(`${sized} sizing passes, final max ratio ${ratio.toFixed(2)} (limit ${LIMIT})`);
  const t2 = performance.now();
  const ps = parts(st, detail, p.seg);
  const t3 = performance.now();
  return { st, parts: ps, ok, log, ratio, solves, ms: { topology: t1 - t0, solve: t2 - t1, geometry: t3 - t2 }, nodes: m.nodes.length };
}
