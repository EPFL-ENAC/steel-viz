// "Sculpture" mode: one column on a base plate, arms at random levels and
// bearings, sometimes a brace under an arm or a secondary beam off it.
// The solver checks it stands up, fixes it if not, and sizes the members.
import { add, mul, sub, type V } from './vec.ts';
import { solve, type Elem, type FNode } from './solver.ts';
import type { Catalog, Section } from './sections.ts';
import {
  box3, geo, hardware, memberFaces, resolve, supportFace, PINNED, SETBACK,
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
};
export const DEFAULTS: Params = { seed: 1, arms: 8, height: 2500, load: 100, fy: 345, braceP: 0.3, secondaryP: 0.35, seg: 400 };

export function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Arm = { id: string; z: number; bearing: number; L: number; conn: ConnType; sec: Section; brace?: Brace };
type Brace = { a: number; drop: number; sec: Section };
type Secondary = { id: string; arm: number; a: number; side: 1 | -1; L: number; conn: ConnType; sec: Section };
export type Structure = { H: number; col: Section; arms: Arm[]; secs: Secondary[] };

const hdir = (bearing: number): V => [Math.sin((bearing * Math.PI) / 180), Math.cos((bearing * Math.PI) / 180), 0];
const mid = <T>(xs: T[]) => xs[Math.floor(xs.length / 2)];

function pick<T extends string>(rng: () => number, w: Record<T, number>): T {
  const total = Object.values<number>(w).reduce((s, x) => s + x, 0);
  let x = rng() * total;
  for (const [k, v] of Object.entries<number>(w)) if ((x -= v) < 0) return k as T;
  return Object.keys(w)[0] as T;
}

// ------------------------------------------------------------- topology
function topology(p: Params, cat: Catalog, rng: () => number): Structure {
  const H = p.height;
  const arms: Arm[] = [];
  for (let k = 0, tries = 0; k < p.arms && tries < 200; tries++) {
    const z = Math.round((0.35 + 0.6 * rng()) * H / 150) * 150;
    const bearing = 90 * Math.floor(rng() * 4);
    // arms on the same side need room between them
    if (arms.some((a) => a.bearing === bearing && Math.abs(a.z - z) < 900)) continue;
    const L = Math.round((0.3 + 0.4 * rng()) * H / 50) * 50;
    const conn = pick(rng, { shear_tab: 0.4, end_plate: 0.2, flange_plates: 0.2, welded: 0.2 });
    arms.push({ id: `arm${k + 1}`, z, bearing, L, conn, sec: mid(cat.beams) });
    k++;
  }
  arms.sort((a, b) => a.z - b.z);
  arms.forEach((a, i) => (a.id = `arm${i + 1}`));
  for (const a of arms) if (rng() < p.braceP) addBrace(a, cat);
  const secs: Secondary[] = [];
  arms.forEach((a, i) => {
    if (rng() >= p.secondaryP) return;
    secs.push({
      id: `sec${secs.length + 1}`, arm: i, a: Math.round((0.6 + 0.35 * rng()) * a.L / 50) * 50,
      side: rng() < 0.5 ? 1 : -1, L: Math.round((0.25 + 0.25 * rng()) * a.L / 50) * 50,
      conn: pick(rng, { shear_tab: 0.6, end_plate: 0.25, welded: 0.15 }), sec: mid(cat.beams),
    });
  });
  return { H, col: mid(cat.columns), arms, secs };
}

function addBrace(a: Arm, cat: Catalog): boolean {
  const drop = Math.min(0.55 * a.L, a.z - a.sec.d - 600);
  if (drop < 600) return false;
  a.brace = { a: Math.round(drop / 50) * 50, drop, sec: mid(cat.tubes) };
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
  const chain = (who: string, pts: V[], s: Section, pinFirst: boolean, q: number) => {
    const ids = pts.map((x) => node(x, who));
    for (let k = 0; k + 1 < ids.length; k++) {
      elems.push({ i: ids[k], j: ids[k + 1], p: s, pinI: k === 0 && pinFirst, q: [0, 0, -q] });
      owner.push(who);
    }
  };
  // column, cut at every level something lands on
  const zs = new Set([0, st.H]);
  for (const a of st.arms) {
    zs.add(a.z);
    if (a.brace) zs.add(a.z - a.sec.d - a.brace.drop);
  }
  node([0, 0, 0], 'column', true);
  chain('column', [...zs].sort((x, y) => x - y).map((z) => [0, 0, z] as V), st.col, false, w(st.col));
  st.arms.forEach((a, i) => {
    const h = hdir(a.bearing);
    const at = new Set([0, a.L]);
    if (a.brace) at.add(a.brace.a);
    for (const s of st.secs) if (s.arm === i) at.add(s.a);
    const pts = [...at].sort((x, y) => x - y).map((t) => add([0, 0, a.z], mul(h, t)));
    chain(a.id, pts, a.sec, PINNED.includes(a.conn), w(a.sec) + p.load);
    if (a.brace) {
      const b0: V = [0, 0, a.z - a.sec.d - a.brace.drop];
      const b1 = add([0, 0, a.z], mul(h, a.brace.a));
      elems.push({ i: node(b0, a.id + '-brace'), j: node(b1, a.id + '-brace'), p: a.brace.sec, pinI: true, pinJ: true, q: [0, 0, -w(a.brace.sec)] });
      owner.push(a.id + '-brace');
    }
  });
  for (const s of st.secs) {
    const a = st.arms[s.arm];
    const h = hdir(a.bearing);
    const side: V = mul([h[1], -h[0], 0], s.side);
    const p0 = add([0, 0, a.z], mul(h, s.a));
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
    if (!PINNED.includes(a.conn)) continue;
    if (!a.brace && rng() < 0.5 && addBrace(a, cat)) {
      log.push(`${a.id}: mechanism, added a brace`);
      return true;
    }
    a.conn = pick(rng, { end_plate: 1, flange_plates: 1, welded: 1 });
    log.push(`${a.id}: mechanism, shear tab -> ${a.conn}`);
    return true;
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
  const choose = (list: Section[], who: string, ok: (s: Section) => boolean = () => true) => {
    const f = worst.get(who)!;
    if (check) {
      const cur = who === 'column' ? st.col : who.endsWith('-brace') ? st.arms.find((a) => a.id + '-brace' === who)!.brace!.sec
        : (st.arms.find((a) => a.id === who) ?? st.secs.find((x) => x.id === who))!.sec;
      maxRatio = Math.max(maxRatio, ratio(cur, f));
      return cur;
    }
    const s = list.find((s) => ok(s) && ratio(s, f) < LIMIT) ?? list[list.length - 1];
    maxRatio = Math.max(maxRatio, ratio(s, f));
    return s;
  };
  for (const a of st.arms) {
    a.sec = choose(cat.beams, a.id, (s) => s.d >= 200);
    if (a.brace) {
      const L = Math.hypot(a.brace.a, a.brace.drop);
      a.brace.sec = choose(cat.tubes, a.id + '-brace', (s) => L / s.rmin < 200);
    }
  }
  for (const s of st.secs) {
    const arm = st.arms[s.arm];
    s.sec = choose(cat.beams, s.id, (x) => x.d <= arm.sec.d - 2 * arm.sec.tf);
  }
  // beams that frame into the column web must fit between its flanges
  const webArms = st.arms.filter((a) => a.bearing % 180 === 90).map((a) => a.sec.bf + 40);
  const needClear = Math.max(0, ...webArms);
  st.col = choose(cat.columns, 'column', (c) => c.d - 2 * c.tf >= needClear && c.d >= 250);
  return maxRatio;
}

// ------------------------------------------------------------- geometry
function parts(st: Structure, detail: Detail, seg: number): Part[] {
  const out: Part[] = [];
  let step = 0;
  const plates = detail !== 'members';
  const bolts = detail === 'bolts';
  const col = geo('column', st.col, [0, 0, 0], [0, 0, st.H], false);
  const tb = 40;
  out.push({
    id: 'base', step: step++, supports: [],
    faces: box3([0, 0, -tb / 2], [0, 1, 0], [0, 0, 1], st.col.bf + 150, st.col.d + 150, tb),
    dots: bolts ? [-1, 1].flatMap((sx) => [-1, 1].map((sy) => ({ p: [sx * (st.col.bf / 2 + 40), sy * (st.col.d / 2 + 40), 1] as V, n: [0, 0, 1] as V }))) : [],
  });
  out.push({ id: 'column', step: step++, supports: ['base'], faces: memberFaces(col, seg), dots: [], accent: false });

  // one member and its end connections, in build order: plates, member, bolts
  type End = { S: Geo; sId: string; conn: ConnType; at: 'from' | 'to' };
  const member = (g: Geo, ends: End[]) => {
    const hws = ends.map((e) => ({ e, r: resolve(g, e.S, e.at) })).map(({ e, r }) => ({ e, hw: hardware(g, e.conn, r) }));
    const supports: string[] = [];
    for (const { e, hw } of hws) {
      if (plates && hw.faces.length) {
        out.push({ id: `${g.id}-${e.at}-conn`, step: step++, supports: [e.sId], faces: hw.faces, dots: [] });
        supports.push(`${g.id}-${e.at}-conn`);
      } else supports.push(e.sId);
    }
    out.push({ id: g.id, step: step++, supports, faces: memberFaces(g, seg), dots: [] });
    const dots = hws.flatMap(({ hw }) => hw.dots);
    if (bolts && dots.length) out.push({ id: `${g.id}-bolts`, step: step++, supports: [g.id, ...supports], faces: [], dots });
  };

  const armGeo = new Map<string, Geo>();
  for (const a of st.arms) {
    const h = hdir(a.bearing);
    const base: V = [0, 0, a.z];
    const p0 = add(base, mul(h, supportFace(col, h) + SETBACK[a.conn]));
    const g = geo(a.id, a.sec, p0, add(base, mul(h, a.L)), true);
    armGeo.set(a.id, g);
    member(g, [{ S: col, sId: 'column', conn: a.conn, at: 'from' }]);
    if (a.brace) {
      const B: V = [0, 0, a.z - a.sec.d - a.brace.drop];
      const C = add(add(base, mul(h, a.brace.a)), [0, 0, -a.sec.d]);
      const u = sub(C, B);
      const L = Math.hypot(...u);
      const un = mul(u, 1 / L);
      const t0 = (supportFace(col, h) + SETBACK.gusset) / (un[0] * h[0] + un[1] * h[1]);
      const t1 = SETBACK.gusset / un[2];
      const bg = geo(a.id + '-brace', a.brace.sec, add(B, mul(un, t0)), sub(C, mul(un, t1)), false);
      member(bg, [
        { S: col, sId: 'column', conn: 'gusset', at: 'from' },
        { S: g, sId: a.id, conn: 'gusset', at: 'to' },
      ]);
    }
  }
  for (const s of st.secs) {
    const a = st.arms[s.arm];
    const ag = armGeo.get(a.id)!;
    const side = mul(ag.v, s.side);
    const p = add(add([0, 0, a.z], mul(hdir(a.bearing), s.a)), mul(side, supportFace(ag, side) + SETBACK[s.conn]));
    const g = geo(s.id, s.sec, p, add(add([0, 0, a.z], mul(hdir(a.bearing), s.a)), mul(side, s.L)), true);
    member(g, [{ S: ag, sId: a.id, conn: s.conn, at: 'from' }]);
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
  const st = topology(p, cat, rng);
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
