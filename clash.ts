// Clash check: do two parts go through each other?
//
// Each part also carries its solid as boxes (plates, flanges, webs). Two
// boxes clash when they overlap by more than TOL: parts that only touch
// (a plate on a column face) are fine. A member and its own connection
// plates overlap on purpose (a shear tab is drawn around the web, a gusset
// sits in the slot of its tube), so we skip those pairs.
import { cross, dot, len, sub, type V } from './vec.ts';
import type { Box, Part } from './steel.ts';

const TOL = 1; // mm

// separating axis test for two boxes, each shrunk by TOL
export function overlap(a: Box, b: Box): boolean {
  const T = sub(b.c, a.c);
  const axes: V[] = [...a.ax, ...b.ax];
  for (const x of a.ax) for (const y of b.ax) {
    const c = cross(x, y);
    if (len(c) > 1e-6) axes.push(c);
  }
  const reach = (B: Box, L: V) => B.ax.reduce((s, x, i) => s + Math.max(0, B.h[i] - TOL) * Math.abs(dot(x, L)), 0);
  for (const L of axes) {
    if (Math.abs(dot(T, L)) >= reach(a, L) + reach(b, L)) return false;
  }
  return true;
}

const own = (a: string, b: string) => b === `${a}-from-conn` || b === `${a}-to-conn`;

// every pair of parts that go through each other
export function clashes(parts: Part[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < parts.length; i++)
    for (let j = i + 1; j < parts.length; j++) {
      const [p, q] = [parts[i], parts[j]];
      if (!p.boxes?.length || !q.boxes?.length || own(p.id, q.id) || own(q.id, p.id)) continue;
      if (p.boxes.some((a) => q.boxes!.some((b) => overlap(a, b)))) out.push([p.id, q.id]);
    }
  return out;
}
