// How well a structure reads as a logo, from 0 to 1. Only the big shapes
// count (the column and the members), seen from the given view:
//
// - fill: the outline (convex hull) fills a square, so the icon is not a thin
//   stick or a flat bar.
// - aspect: about as wide as it is tall.
// - balance: the weight sits on the columns, not all on one side.
// - members: a few members read better than many (4 to 6 is best).
// - crossings: members that cross each other on screen make a knot.
//
// The variety says something else: how many different kinds of detail one
// structure shows, for a teaching sculpture. One kind is one detail a student
// can point at and name. It counts 1 if the structure has it at least once.
// It reads the structure, not the parts, so it works at any detail level
// (`pick.ts` uses `members`, where the plates don't exist yet).
import { braceConn, X_KINDS, X_LABEL, type Structure } from './generate.ts';
import { BEAM_CONN_KINDS, camera, CONNS, type Part } from './steel.ts';
import { dot, type V } from './vec.ts';

export type Score = { score: number; fill: number; aspect: number; balance: number; members: number; crossings: number };

function hull(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const turn = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: [number, number][]) => {
    const h: [number, number][] = [];
    for (const q of list) {
      while (h.length >= 2 && turn(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop();
      h.push(q);
    }
    h.pop();
    return h;
  };
  return [...half(p), ...half([...p].reverse())];
}

// the axis of a member on screen: the long axis of its points (PCA)
type Seg2 = [number, number, number, number];
function axis(pts: [number, number][]): Seg2 {
  const n = pts.length;
  const [mx, my] = [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
  let [xx, xy, yy] = [0, 0, 0];
  for (const [x, y] of pts) [xx, xy, yy] = [xx + (x - mx) ** 2, xy + (x - mx) * (y - my), yy + (y - my) ** 2];
  const a = 0.5 * Math.atan2(2 * xy, xx - yy);
  const [ux, uy] = [Math.cos(a), Math.sin(a)];
  let [lo, hi] = [Infinity, -Infinity];
  for (const [x, y] of pts) {
    const t = (x - mx) * ux + (y - my) * uy;
    [lo, hi] = [Math.min(lo, t), Math.max(hi, t)];
  }
  return [mx + ux * lo, my + uy * lo, mx + ux * hi, my + uy * hi];
}

// do two axes cross away from their ends (members that meet at a connection don't count)
function cross2(a: Seg2, b: Seg2): boolean {
  const [dx, dy, ex, ey] = [a[2] - a[0], a[3] - a[1], b[2] - b[0], b[3] - b[1]];
  const den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-9) return false;
  const t = ((b[0] - a[0]) * ey - (b[1] - a[1]) * ex) / den;
  const u = ((b[0] - a[0]) * dy - (b[1] - a[1]) * dx) / den;
  return t > 0.1 && t < 0.9 && u > 0.1 && u < 0.9;
}

export function logoScore(parts: Part[], az: number, el: number): Score {
  const { r, up } = camera(az, el);
  const big = parts.filter((p) => p.kind === 'column' || p.kind === 'member');
  const pts: [number, number][] = [];
  let [colX, colN] = [0, 0];
  const axes: Seg2[] = [];
  for (const p of big) {
    const own: [number, number][] = [];
    for (const f of p.faces) for (const q of f.pts) own.push([dot(q as V, r), -dot(q as V, up)]);
    pts.push(...own);
    if (p.kind === 'member') axes.push(axis(own));
    else for (const [x] of own) [colX, colN] = [colX + x, colN + 1];
  }
  let crossings = 0;
  for (let i = 0; i < axes.length; i++) for (let j = i + 1; j < axes.length; j++) if (cross2(axes[i], axes[j])) crossings++;
  const h = hull(pts);
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of h) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
  const [w, ht] = [x1 - x0, y1 - y0];
  // area and centroid of the hull (shoelace)
  let [A, cx] = [0, 0];
  for (let i = 0; i < h.length; i++) {
    const [a, b] = [h[i], h[(i + 1) % h.length]];
    const c = a[0] * b[1] - b[0] * a[1];
    A += c;
    cx += (a[0] + b[0]) * c;
  }
  cx /= 3 * A;
  A = Math.abs(A) / 2;
  const side = Math.max(w, ht);
  const fill = A / (side * side); // a full square is 1, a disc 0.79
  const aspect = Math.min(w, ht) / side;
  const balance = Math.abs(cx - colX / colN) / w; // from the middle of the columns
  const members = big.filter((p) => p.kind === 'member').length;
  const mScore = members < 4 ? members / 4 : members <= 6 ? 1 : Math.max(0, 1 - (members - 6) / 6);
  const score =
    0.25 * Math.min(1, fill / 0.75) + 0.2 * aspect ** 2 + 0.2 * Math.max(0, 1 - 8 * balance) + 0.15 * mScore + 0.2 / (1 + crossings / 2);
  return { score, fill, aspect, balance, members, crossings };
}

export type Variety = { variety: number; kinds: string[] };

const xKind = (k: keyof typeof X_LABEL) => `X brace, ${X_LABEL[k]}`;

// every kind we count, in the order `variety()` lists them
export const VARIETY_KINDS: string[] = [
  ...BEAM_CONN_KINDS.map((k) => CONNS[k].label),
  'secondary beam',
  'brace',
  ...X_KINDS.map(xKind),
  'double angle brace',
  'round tube brace',
  'round tube brace, end caps',
  'channel secondary',
  'tee chord',
  'truss',
  'tension rod',
  'post',
  'skewed arm',
  'gable roof',
  'column splice, bearing',
  'column splice, flange plates',
  'beam splice',
  'foot gussets',
];

export function variety(st: Structure): Variety {
  const { arms, secs, splice, base } = st;
  const braces = arms.flatMap((a) => a.braces);
  const plain = braces.filter((b) => !b.x);
  const round = plain.filter((b) => b.sec.kind === 'CHS');
  const trusses = arms.flatMap((a) => a.truss ?? []);
  const seen: Record<string, boolean> = {
    'secondary beam': secs.length > 0,
    brace: plain.length > 0,
    'double angle brace': plain.some((b) => b.sec.kind === '2L'),
    // one tube end or the other: a small tube keeps its slot, even with `cap`
    'round tube brace': round.some((b) => braceConn(b) !== 'gusset_cap'),
    'round tube brace, end caps': round.some((b) => braceConn(b) === 'gusset_cap'),
    'channel secondary': secs.some((s) => s.sec.kind === 'C'),
    'tee chord': trusses.some((t) => t.chord.kind === 'T'),
    truss: trusses.length > 0,
    'tension rod': arms.some((a) => a.rod),
    post: arms.some((a) => a.post),
    'skewed arm': arms.some((a) => a.skew),
    'gable roof': arms.some((a) => a.gable),
    'column splice, bearing': splice?.kind === 'bearing',
    'column splice, flange plates': splice?.kind === 'flange',
    'beam splice': arms.some((a) => a.splice !== undefined),
    'foot gussets': base === 'flange' || base === 'all',
  };
  // the ends of arms, chords and secondaries. Only the beam end kinds: a gusset or a clevis comes with its brace, truss or rod.
  for (const c of [...arms.flatMap((a) => [a.conn, a.conn2]), ...trusses.flatMap((t) => [t.conn, t.conn2]), ...secs.map((s) => s.conn)])
    if (c && CONNS[c].fits) seen[CONNS[c].label] = true;
  for (const b of braces) if (b.x) seen[xKind(b.x)] = true;
  const kinds = VARIETY_KINDS.filter((k) => seen[k]);
  return { variety: kinds.length, kinds };
}

// the variety that counts as full in the mix: about 3 % of the default seeds reach it
export const VARIETY_FULL = 12;
// half logo, half variety, both from 0 to 1
export const mixScore = (logo: number, v: number) => 0.5 * logo + 0.5 * Math.min(1, v / VARIETY_FULL);

export type By = 'logo' | 'variety' | 'mix';
export const BY: By[] = ['logo', 'variety', 'mix'];
// to sort a scan, best first. Many seeds have the same variety: the logo score decides.
export function better(by: By): (a: Score & Variety, b: Score & Variety) => number {
  const key = (s: Score & Variety) => (by === 'logo' ? s.score : by === 'variety' ? s.variety : mixScore(s.score, s.variety));
  return (a, b) => key(b) - key(a) || b.score - a.score;
}
