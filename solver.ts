// A small 3D frame solver: direct stiffness method, dense Gauss elimination.
// Units: N, mm, MPa. 6 DOF per node: ux uy uz rx ry rz (global).
// alphaCr() gives the elastic critical load factor of the whole structure
// (linear buckling with the geometric stiffness, EC3 5.2.1). sideCase() solves
// one more load case on the same factored matrix (the notional loads).
//
// Local frame of an element: x along it (u), z along the section depth (w),
// y = w x u (v). Same rule as the renderer: a vertical member has its depth
// along global Y, any other member has its depth pointing down. So bending
// with uz (about local y) uses the strong inertia, bending with uy (about
// local z) uses the weak one.
import { cross, dot, len, mul, norm, sub, type V } from './vec.ts';

export const E = 210000;
export const G = 81000;

export type Props = { A: number; Is: number; Iw: number; J: number };
export type FNode = { x: V; fixed?: boolean | boolean[]; f?: number[] }; // fixed: all 6 DOF, or per DOF
export type Elem = {
  i: number;
  j: number;
  p: Props;
  pinI?: boolean; // end i releases both bending rotations (shear tab, gusset)
  pinJ?: boolean;
  q?: V; // uniform load along the element, global, N/mm
};
// N: max axial force, tension or compression. Nc: max compression (>= 0).
// Vy, Vz: the largest shear along v and along w (Vz goes with My, the strong
// axis). With a uniform load the shear is linear, so the max is at an end.
export type ElemForces = { N: number; Nc: number; My: number; Mz: number; Vy: number; Vz: number };
// the factored stiffness of the free DOFs, kept for alphaCr()
type System = { free: number[]; Kff: M; lu: Factored; prep: Prepared[] };
export type Solved =
  | { ok: true; d: Float64Array; forces: ElemForces[]; axial: Float64Array; sys: System } // axial: mean axial force, tension > 0
  | { ok: false; node: number; dof: number; dofName: string };

type M = number[][];

export const DOF_NAMES = ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'];

export function localFrame(a: V, b: V): { u: V; v: V; w: V; L: number } {
  const d = sub(b, a);
  const L = len(d);
  const u = mul(d, 1 / L);
  let w: V;
  if (Math.abs(u[2]) > 0.99) w = [0, 1, 0];
  else {
    const down: V = [0, 0, -1];
    w = norm(sub(down, mul(u, dot(down, u))));
  }
  return { u, v: cross(w, u), w, L };
}

const zeros = (r: number, c: number): M => Array.from({ length: r }, () => new Array(c).fill(0));

function localK(p: Props, L: number): M {
  const k = zeros(12, 12);
  const set = (i: number, j: number, x: number) => {
    k[i][j] += x;
    if (i !== j) k[j][i] += x;
  };
  const ea = (E * p.A) / L;
  set(0, 0, ea); set(6, 6, ea); set(0, 6, -ea);
  const gj = (G * p.J) / L;
  set(3, 3, gj); set(9, 9, gj); set(3, 9, -gj);
  // uy / rz, weak inertia
  const z = E * p.Iw;
  set(1, 1, (12 * z) / L ** 3); set(7, 7, (12 * z) / L ** 3); set(1, 7, (-12 * z) / L ** 3);
  set(1, 5, (6 * z) / L ** 2); set(1, 11, (6 * z) / L ** 2);
  set(7, 5, (-6 * z) / L ** 2); set(7, 11, (-6 * z) / L ** 2);
  set(5, 5, (4 * z) / L); set(11, 11, (4 * z) / L); set(5, 11, (2 * z) / L);
  // uz / ry, strong inertia
  const y = E * p.Is;
  set(2, 2, (12 * y) / L ** 3); set(8, 8, (12 * y) / L ** 3); set(2, 8, (-12 * y) / L ** 3);
  set(2, 4, (-6 * y) / L ** 2); set(2, 10, (-6 * y) / L ** 2);
  set(8, 4, (6 * y) / L ** 2); set(8, 10, (6 * y) / L ** 2);
  set(4, 4, (4 * y) / L); set(10, 10, (4 * y) / L); set(4, 10, (2 * y) / L);
  return k;
}

// fixed end forces of a uniform local load (forces on the element, d = 0)
function localF0(ql: V, L: number): number[] {
  const [qx, qy, qz] = ql;
  const f = new Array(12).fill(0);
  f[0] = f[6] = (-qx * L) / 2;
  f[1] = f[7] = (-qy * L) / 2;
  f[5] = (-qy * L * L) / 12;
  f[11] = (qy * L * L) / 12;
  f[2] = f[8] = (-qz * L) / 2;
  f[4] = (qz * L * L) / 12;
  f[10] = (-qz * L * L) / 12;
  return f;
}

function invert(a: M): M {
  const n = a.length;
  const m = a.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    [m[c], m[p]] = [m[p], m[c]];
    const d = m[c][c];
    for (let j = 0; j < 2 * n; j++) m[c][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c];
      if (f) for (let j = 0; j < 2 * n; j++) m[r][j] -= f * m[c][j];
    }
  }
  return m.map((r) => r.slice(n));
}

type Prepared = { k: M; f0: number[]; R: V[]; rel: number[]; kFull: M; f0Full: number[]; ql: V; L: number; kcc?: M };

// Element matrix after releases (static condensation), in local coordinates,
// and the fixed end forces of its load (q, or q plus a side part, see loadOf).
function prepare(nodes: FNode[], e: Elem): Prepared {
  const { u, v, w, L } = localFrame(nodes[e.i].x, nodes[e.j].x);
  const R = [u, v, w];
  const kFull = localK(e.p, L);
  const rel = [...(e.pinI ? [4, 5] : []), ...(e.pinJ ? [10, 11] : [])];
  if (!rel.length) return { k: kFull, R, rel, kFull, L, ...loadOf(e.q ?? [0, 0, 0], R, L, kFull, rel) };
  const keep = [...Array(12).keys()].filter((i) => !rel.includes(i));
  const kcc = invert(rel.map((i) => rel.map((j) => kFull[i][j])));
  const k = zeros(12, 12);
  for (const a of keep) {
    // row a of K_rc * Kcc^-1
    const t = rel.map((_, c) => rel.reduce((s, ci, x) => s + kFull[a][ci] * kcc[x][c], 0));
    for (const b of keep) k[a][b] = kFull[a][b] - rel.reduce((s, cj, c) => s + t[c] * kFull[cj][b], 0);
  }
  return { k, R, rel, kFull, L, kcc, ...loadOf(e.q ?? [0, 0, 0], R, L, kFull, rel, kcc) };
}

// the load part of an element: its local load and fixed end forces, condensed
function loadOf(qg: V, R: V[], L: number, kFull: M, rel: number[], kcc?: M) {
  const [u, v, w] = R;
  const ql: V = [dot(qg, u), dot(qg, v), dot(qg, w)];
  const f0Full = localF0(ql, L);
  if (!kcc) return { ql, f0Full, f0: f0Full };
  const f0 = new Array(12).fill(0);
  for (let a = 0; a < 12; a++) {
    if (rel.includes(a)) continue;
    const t = rel.map((_, c) => rel.reduce((s, ci, x) => s + kFull[a][ci] * kcc[x][c], 0));
    f0[a] = f0Full[a] - rel.reduce((s, cj, c) => s + t[c] * f0Full[cj], 0);
  }
  return { ql, f0Full, f0 };
}

// global = T^T local, T = blockdiag(R, R, R, R)
const toLocal = (R: V[], g: number[]): number[] => {
  const l = new Array(12).fill(0);
  for (let b = 0; b < 4; b++)
    for (let r = 0; r < 3; r++) l[3 * b + r] = R[r][0] * g[3 * b] + R[r][1] * g[3 * b + 1] + R[r][2] * g[3 * b + 2];
  return l;
};

// LU with partial pivoting, in place. A pivot under tol * (largest value of
// its column) means the structure is a mechanism: the result names the column.
type Factored = { a: M; piv: number[] };
function factor(a: M, tol: number): Factored | { bad: number } {
  const m = a.length;
  const scale = a.map((_, c) => Math.max(...a.map((row) => Math.abs(row[c]))));
  const piv: number[] = [];
  for (let c = 0; c < m; c++) {
    let p = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (!(Math.abs(a[p][c]) > tol * scale[c])) return { bad: c };
    [a[c], a[p]] = [a[p], a[c]];
    piv.push(p);
    const rowc = a[c];
    for (let r = c + 1; r < m; r++) {
      const rowr = a[r];
      const f = rowr[c] / rowc[c];
      rowr[c] = f;
      if (!f) continue;
      for (let j = c + 1; j < m; j++) rowr[j] -= f * rowc[j];
    }
  }
  return { a, piv };
}

function backsub({ a, piv }: Factored, b: ArrayLike<number>): Float64Array {
  const m = a.length;
  const x = Float64Array.from(b);
  // the rows were swapped whole (with their multipliers): all swaps first, then L
  piv.forEach((p, c) => p !== c && ([x[c], x[p]] = [x[p], x[c]]));
  for (let r = 1; r < m; r++) {
    const row = a[r];
    let s = x[r];
    for (let j = 0; j < r; j++) s -= row[j] * x[j];
    x[r] = s;
  }
  for (let r = m - 1; r >= 0; r--) {
    let s = x[r];
    const row = a[r];
    for (let j = r + 1; j < m; j++) s -= row[j] * x[j];
    x[r] = s / row[r];
  }
  return x;
}

// global block of an element matrix: kg = T^T k T, added into K at idx
function assemble(K: M, k: M, R: V[], idx: number[]) {
  for (let a = 0; a < 4; a++)
    for (let b = 0; b < 4; b++)
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 3; c++) {
          let s = 0;
          for (let x = 0; x < 3; x++) {
            const kx = k[3 * a + x];
            for (let y = 0; y < 3; y++) s += R[x][r] * kx[3 * b + y] * R[y][c];
          }
          if (s) K[idx[3 * a + r]][idx[3 * b + c]] += s;
        }
}

const dofs = (e: Elem) => [...[0, 1, 2, 3, 4, 5].map((x) => e.i * 6 + x), ...[0, 1, 2, 3, 4, 5].map((x) => e.j * 6 + x)];

// the load vector: equivalent nodal loads of the elements, then the node loads
function loads(nodes: FNode[], elems: Elem[], prep: Prepared[]): number[] {
  const F = new Array(nodes.length * 6).fill(0);
  elems.forEach((e, ei) => {
    const { f0, R } = prep[ei];
    const idx = dofs(e);
    for (let a = 0; a < 4; a++)
      for (let r = 0; r < 3; r++) {
        let t = 0;
        for (let x = 0; x < 3; x++) t += R[x][r] * f0[3 * a + x];
        F[idx[3 * a + r]] -= t; // equivalent nodal load
      }
  });
  nodes.forEach((nd, i) => {
    if (!nd.f) return;
    for (let x = 0; x < 6; x++) F[i * 6 + x] += nd.f[x] ?? 0;
  });
  return F;
}

// the forces of one element from the moves d (f[] are forces on the element)
function elemForces(e: Elem, p: Prepared, d: Float64Array): { f: number[]; forces: ElemForces } {
  const { R, rel, kFull, f0Full, ql, L } = p;
  const dg = [...d.slice(e.i * 6, e.i * 6 + 6), ...d.slice(e.j * 6, e.j * 6 + 6)];
  const dl = toLocal(R, dg);
  if (rel.length) {
    // released rotations: the element end turns freely, its end moment is 0
    const keep = [...Array(12).keys()].filter((i) => !rel.includes(i));
    const kcc = p.kcc!;
    const rhs = rel.map((i) => -(f0Full[i] + keep.reduce((s, j) => s + kFull[i][j] * dl[j], 0)));
    rel.forEach((i, a) => (dl[i] = rel.reduce((s, _, b) => s + kcc[a][b] * rhs[b], 0)));
  }
  const f = kFull.map((row, i) => row.reduce((s, kij, j) => s + kij * dl[j], 0) + f0Full[i]);
  // moments along the element, sampled
  let My = 0;
  let Mz = 0;
  for (let s = 0; s <= 10; s++) {
    const x = (L * s) / 10;
    Mz = Math.max(Mz, Math.abs(-f[5] + x * f[1] + (ql[1] * x * x) / 2));
    My = Math.max(My, Math.abs(f[4] + x * f[2] + (ql[2] * x * x) / 2));
  }
  const Vy = Math.max(Math.abs(f[1]), Math.abs(f[7]));
  const Vz = Math.max(Math.abs(f[2]), Math.abs(f[8]));
  return { f, forces: { N: Math.max(Math.abs(f[0]), Math.abs(f[6])), Nc: Math.max(0, f[0], -f[6]), My, Mz, Vy, Vz } };
}

const backsubAll = (r: { sys: System }, F: number[], n: number) => {
  const { free, lu } = r.sys;
  const x = backsub(lu, free.map((g) => F[g]));
  const d = new Float64Array(n);
  free.forEach((g, i) => (d[g] = x[i]));
  return d;
};

export function solve(nodes: FNode[], elems: Elem[], pivotTol = 1e-9): Solved {
  const n = nodes.length * 6;
  const K = zeros(n, n);
  const prep = elems.map((e) => prepare(nodes, e));
  elems.forEach((e, ei) => assemble(K, prep[ei].k, prep[ei].R, dofs(e)));
  const F = loads(nodes, elems, prep);

  const free: number[] = [];
  nodes.forEach((nd, i) => {
    for (let x = 0; x < 6; x++) {
      const fx = Array.isArray(nd.fixed) ? nd.fixed[x] : nd.fixed;
      if (!fx) free.push(i * 6 + x);
    }
  });
  const Kff = free.map((r) => free.map((c) => K[r][c]));
  const lu = factor(Kff.map((row) => [...row]), pivotTol);
  if ('bad' in lu) {
    const g = free[lu.bad];
    return { ok: false, node: Math.floor(g / 6), dof: g % 6, dofName: DOF_NAMES[g % 6] };
  }
  const sys = { free, Kff, lu, prep };
  const d = backsubAll({ sys }, F, n);
  const axial = new Float64Array(elems.length);
  const forces = elems.map((e, ei) => {
    const { f, forces } = elemForces(e, prep[ei], d);
    // f[6] > 0 (f[0] < 0) pulls the element: tension
    axial[ei] = (f[6] - f[0]) / 2;
    return forces;
  });
  return { ok: true, d, forces, axial, sys };
}

// One more load case on a solved structure, with the same factored matrix
// (one back substitution): all the loads of the structure, plus the forces
// `extra` on some nodes (the notional loads of generate.ts).
export function sideCase(nodes: FNode[], elems: Elem[], r: Extract<Solved, { ok: true }>, extra: { node: number; f: V }[]): ElemForces[] {
  const F = loads(nodes, elems, r.sys.prep);
  for (const { node, f } of extra) for (let x = 0; x < 3; x++) F[node * 6 + x] += f[x];
  const d = backsubAll(r, F, nodes.length * 6);
  return elems.map((e, ei) => elemForces(e, r.sys.prep[ei], d).forces);
}

// Geometric stiffness of an element under the axial force N (tension > 0),
// local coordinates. A fixed-fixed element gets the consistent matrix of a
// cubic beam (no torsion term), on (uy, rz) and on (uz, ry) with the same
// signs as localK. An element with a release gets the string part only (N/L
// on the transverse moves of its ends): its own buckling between its ends is
// the member check (checks.ts), not the global one.
export function localKg(N: number, L: number, released: boolean): M {
  const k = zeros(12, 12);
  const put = (ids: number[], m: number[][], f: number) => ids.forEach((a, r) => ids.forEach((b, c) => (k[a][b] += f * m[r][c])));
  if (released) {
    const s = [[1, -1], [-1, 1]];
    put([1, 7], s, N / L);
    put([2, 8], s, N / L);
    return k;
  }
  const c = (sg: number) => [
    [36, sg * 3 * L, -36, sg * 3 * L],
    [sg * 3 * L, 4 * L * L, -sg * 3 * L, -L * L],
    [-36, -sg * 3 * L, 36, -sg * 3 * L],
    [sg * 3 * L, -L * L, -sg * 3 * L, 4 * L * L],
  ];
  put([1, 5, 7, 11], c(1), N / (30 * L));
  put([2, 4, 8, 10], c(-1), N / (30 * L));
  return k;
}

// Elastic critical load factor: the smallest a > 0 with (K + a Kg) x = 0,
// Kg from the axial forces of the solve. a < 1 means the loads are above
// the buckling load. Inverse iteration on K^-1 G (G = -Kg) gives mu = 1/a, the
// largest eigenvalue in size. If it is negative (a mode only tension could
// drive), shift by |mu| and run again to get the largest positive one.
// Infinity: nothing is in compression.
// energy: the strain energy of each element in the buckling mode (x.K.x).
// Raising the stiffness of the elements with the most energy raises alphaCr
// the most: generate.ts uses it to pick the member to make heavier.
export type Buckling = { alpha: number; energy: Float64Array };

export const alphaCr = (nodes: FNode[], elems: Elem[], r: Extract<Solved, { ok: true }>): number => buckling(nodes, elems, r).alpha;

export function buckling(nodes: FNode[], elems: Elem[], r: Extract<Solved, { ok: true }>): Buckling {
  const { free, Kff, lu, prep } = r.sys;
  if (!elems.some((_, i) => r.axial[i] < 0)) return { alpha: Infinity, energy: new Float64Array(elems.length) };
  // G on the free DOFs, sparse: one entry per element block term (repeats add up)
  const at = new Int32Array(nodes.length * 6).fill(-1);
  free.forEach((d, i) => (at[d] = i));
  const gi: number[] = [];
  const gj: number[] = [];
  const gv: number[] = [];
  const local = Array.from({ length: 12 }, (_, i) => i);
  elems.forEach((e, ei) => {
    if (!r.axial[ei]) return;
    const ke = zeros(12, 12);
    assemble(ke, localKg(-r.axial[ei], prep[ei].L, prep[ei].rel.length > 0), prep[ei].R, local);
    const idx = dofs(e).map((d) => at[d]);
    for (let a = 0; a < 12; a++)
      for (let b = 0; b < 12; b++)
        if (idx[a] >= 0 && idx[b] >= 0 && ke[a][b]) gi.push(idx[a]), gj.push(idx[b]), gv.push(ke[a][b]);
  });
  const m = free.length;
  const Gx = (x: Float64Array) => {
    const y = new Float64Array(m);
    for (let k = 0; k < gv.length; k++) y[gi[k]] += gv[k] * x[gj[k]];
    return y;
  };
  const dotv = (a: Float64Array, b: Float64Array) => {
    let t = 0;
    for (let i = 0; i < m; i++) t += a[i] * b[i];
    return t;
  };
  // Inverse iteration y = (K^-1 G + shift) x. Kx is carried along
  // (K y = G x + shift K x), so a step costs one back substitution and one
  // sparse product. mu: the Rayleigh quotient of the pencil, x.Gx / x.Kx.
  const run = (shift: number) => {
    let x: Float64Array = Float64Array.from({ length: m }, (_, i) => 1 + 0.5 * Math.sin(i * 12.9898));
    let kx = Float64Array.from(Kff, (row) => row.reduce((t, v, j) => t + v * x[j], 0));
    let gx = Gx(x);
    let mu = 0;
    for (let it = 0; it < 400; it++) {
      const y = backsub(lu, gx);
      const ky = Float64Array.from(gx);
      if (shift) for (let i = 0; i < m; i++) (y[i] += shift * x[i]), (ky[i] += shift * kx[i]);
      const n = Math.sqrt(dotv(y, y)) || 1;
      for (let i = 0; i < m; i++) (y[i] /= n), (ky[i] /= n);
      x = y;
      kx = ky;
      gx = Gx(x);
      const next = dotv(x, gx) / dotv(x, kx);
      if (it > 3 && Math.abs(next - mu) <= 1e-6 * Math.abs(next)) return { mu: next, x };
      mu = next;
    }
    return { mu, x };
  };
  let res = run(0);
  if (res.mu < 0) res = run(-res.mu);
  const { mu, x } = res;
  // element energy in local coordinates: ul = R ue on each 3-block
  const energy = new Float64Array(elems.length);
  elems.forEach((e, ei) => {
    const { k, R } = prep[ei];
    const ue = dofs(e).map((d) => (at[d] >= 0 ? x[at[d]] : 0));
    const ul = ue.map((_, i) => {
      const b = i - (i % 3);
      return R[i % 3][0] * ue[b] + R[i % 3][1] * ue[b + 1] + R[i % 3][2] * ue[b + 2];
    });
    let t = 0;
    for (let a = 0; a < 12; a++) for (let b = 0; b < 12; b++) t += ul[a] * k[a][b] * ul[b];
    energy[ei] = t;
  });
  return { alpha: mu > 0 ? 1 / mu : Infinity, energy };
}
