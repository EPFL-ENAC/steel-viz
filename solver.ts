// A small 3D frame solver: direct stiffness method, dense Gauss elimination.
// Units: N, mm, MPa. 6 DOF per node: ux uy uz rx ry rz (global).
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
export type ElemForces = { N: number; My: number; Mz: number };
export type Solved =
  | { ok: true; d: Float64Array; forces: ElemForces[] }
  | { ok: false; node: number; dof: number; dofName: string };

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

type M = number[][];
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

type Prepared = { k: M; f0: number[]; R: V[]; rel: number[]; kFull: M; f0Full: number[]; ql: V; L: number };

// Element matrix after releases (static condensation), in local coordinates.
function prepare(nodes: FNode[], e: Elem): Prepared {
  const { u, v, w, L } = localFrame(nodes[e.i].x, nodes[e.j].x);
  const R = [u, v, w];
  const kFull = localK(e.p, L);
  const qg = e.q ?? [0, 0, 0];
  const ql: V = [dot(qg, u), dot(qg, v), dot(qg, w)];
  const f0Full = localF0(ql, L);
  const rel = [...(e.pinI ? [4, 5] : []), ...(e.pinJ ? [10, 11] : [])];
  if (!rel.length) return { k: kFull, f0: f0Full, R, rel, kFull, f0Full, ql, L };
  const keep = [...Array(12).keys()].filter((i) => !rel.includes(i));
  const kcc = invert(rel.map((i) => rel.map((j) => kFull[i][j])));
  const k = zeros(12, 12);
  const f0 = new Array(12).fill(0);
  for (const a of keep) {
    // row a of K_rc * Kcc^-1
    const t = rel.map((_, c) => rel.reduce((s, ci, x) => s + kFull[a][ci] * kcc[x][c], 0));
    for (const b of keep) k[a][b] = kFull[a][b] - rel.reduce((s, cj, c) => s + t[c] * kFull[cj][b], 0);
    f0[a] = f0Full[a] - rel.reduce((s, cj, c) => s + t[c] * f0Full[cj], 0);
  }
  return { k, f0, R, rel, kFull, f0Full, ql, L };
}

// global = T^T local, T = blockdiag(R, R, R, R)
const toLocal = (R: V[], g: number[]): number[] => {
  const l = new Array(12).fill(0);
  for (let b = 0; b < 4; b++)
    for (let r = 0; r < 3; r++) l[3 * b + r] = R[r][0] * g[3 * b] + R[r][1] * g[3 * b + 1] + R[r][2] * g[3 * b + 2];
  return l;
};

export function solve(nodes: FNode[], elems: Elem[], pivotTol = 1e-9): Solved {
  const n = nodes.length * 6;
  const K = zeros(n, n);
  const F = new Array(n).fill(0);
  const prep = elems.map((e) => prepare(nodes, e));
  elems.forEach((e, ei) => {
    const { k, f0, R } = prep[ei];
    const idx = [...[0, 1, 2, 3, 4, 5].map((x) => e.i * 6 + x), ...[0, 1, 2, 3, 4, 5].map((x) => e.j * 6 + x)];
    // kg = T^T k T, assembled block by block
    for (let a = 0; a < 4; a++)
      for (let b = 0; b < 4; b++)
        for (let r = 0; r < 3; r++)
          for (let c = 0; c < 3; c++) {
            let s = 0;
            for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) s += R[x][r] * k[3 * a + x][3 * b + y] * R[y][c];
            K[idx[3 * a + r]][idx[3 * b + c]] += s;
          }
    for (let a = 0; a < 4; a++)
      for (let r = 0; r < 3; r++) {
        let s = 0;
        for (let x = 0; x < 3; x++) s += R[x][r] * f0[3 * a + x];
        F[idx[3 * a + r]] -= s; // equivalent nodal load
      }
  });

  const free: number[] = [];
  nodes.forEach((nd, i) => {
    for (let x = 0; x < 6; x++) {
      if (nd.f) F[i * 6 + x] += nd.f[x] ?? 0;
      const fx = Array.isArray(nd.fixed) ? nd.fixed[x] : nd.fixed;
      if (!fx) free.push(i * 6 + x);
    }
  });
  const m = free.length;
  const A = free.map((r) => [...free.map((c) => K[r][c]), F[r]]);
  const scale = free.map((_, c) => Math.max(...free.map((_, r) => Math.abs(A[r][c]))));
  for (let c = 0; c < m; c++) {
    let p = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (!(Math.abs(A[p][c]) > pivotTol * scale[c])) {
      const g = free[c];
      return { ok: false, node: Math.floor(g / 6), dof: g % 6, dofName: DOF_NAMES[g % 6] };
    }
    [A[c], A[p]] = [A[p], A[c]];
    const rowc = A[c];
    for (let r = c + 1; r < m; r++) {
      const f = A[r][c] / rowc[c];
      if (!f) continue;
      const rowr = A[r];
      for (let j = c; j <= m; j++) rowr[j] -= f * rowc[j];
    }
  }
  const x = new Array(m).fill(0);
  for (let r = m - 1; r >= 0; r--) {
    let s = A[r][m];
    for (let j = r + 1; j < m; j++) s -= A[r][j] * x[j];
    x[r] = s / A[r][r];
  }
  const d = new Float64Array(n);
  free.forEach((g, i) => (d[g] = x[i]));

  const forces = elems.map((e, ei) => {
    const { R, rel, kFull, f0Full, ql, L } = prep[ei];
    const dg = [...d.slice(e.i * 6, e.i * 6 + 6), ...d.slice(e.j * 6, e.j * 6 + 6)];
    const dl = toLocal(R, dg);
    if (rel.length) {
      // released rotations: the element end turns freely, its end moment is 0
      const keep = [...Array(12).keys()].filter((i) => !rel.includes(i));
      const kcc = invert(rel.map((i) => rel.map((j) => kFull[i][j])));
      const rhs = rel.map((i) => -(f0Full[i] + keep.reduce((s, j) => s + kFull[i][j] * dl[j], 0)));
      rel.forEach((i, a) => (dl[i] = rel.reduce((s, _, b) => s + kcc[a][b] * rhs[b], 0)));
    }
    const f = kFull.map((row, i) => row.reduce((s, kij, j) => s + kij * dl[j], 0) + f0Full[i]);
    // moments along the element, sampled; f[] are forces on the element
    let My = 0;
    let Mz = 0;
    for (let s = 0; s <= 10; s++) {
      const x = (L * s) / 10;
      Mz = Math.max(Mz, Math.abs(-f[5] + x * f[1] + (ql[1] * x * x) / 2));
      My = Math.max(My, Math.abs(f[4] + x * f[2] + (ql[2] * x * x) / 2));
    }
    return { N: Math.max(Math.abs(f[0]), Math.abs(f[6])), My, Mz };
  });
  return { ok: true, d, forces };
}
