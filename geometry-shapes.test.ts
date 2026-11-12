// node --test
// Every member in its other shape, and none of them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { floating, generate } from './generate.ts';
import { clashes } from './clash.ts';
import { cats, forms, shapes } from './geometry-check.ts';
import { centroidDepth } from './sections.ts';
import type { Part } from './steel.ts';
import type { V } from './vec.ts';

// A tee bottom chord has its stem up, like on a real truss: at its lowest
// level it is as wide as its flange, at its highest only as wide as its stem.
// The plate of each diagonal stands on the stem tip, in the plane of the stem
// (centred on it, t = 12 thick), with no bolts. The axis of the diagonal
// meets the chord on its centroid. A chord runs along x or y (a skewed arm has
// no truss), so its width is the smaller of the two spans.
// Returns how many tee chords it looked at.
function teeStemUp(r: ReturnType<typeof generate>, at: string): number {
  const byId = new Map(r.parts.map((q) => [q.id, q]));
  const pts = (q: Part): V[] => q.faces.flatMap((f) => f.pts);
  let n = 0;
  for (const a of r.st.arms) {
    const tr = a.truss;
    if (!tr || tr.chord.kind !== 'T') continue;
    const c = byId.get(`${a.id}-chord`)!;
    const ps = pts(c);
    const zs = ps.map((q) => q[2]);
    const [z0, z1] = [Math.min(...zs), Math.max(...zs)];
    const width = (z: number) => {
      const at = ps.filter((q) => Math.abs(q[2] - z) < 0.5);
      const span = (i: number) => Math.max(...at.map((q) => q[i])) - Math.min(...at.map((q) => q[i]));
      return Math.min(span(0), span(1));
    };
    assert.ok(Math.abs(width(z0) - tr.chord.bf) < 0.5, `${at} ${c.id}: the flange is not at the bottom`);
    assert.ok(Math.abs(width(z1) - tr.chord.tw) < 0.5, `${at} ${c.id}: the stem is not up`);
    // the chord axis (al) and the axis across the truss plane (ac)
    const spanOf = (i: number) => Math.max(...ps.map((q) => q[i])) - Math.min(...ps.map((q) => q[i]));
    const [al, ac] = spanOf(0) > spanOf(1) ? [0, 1] : [1, 0];
    const tip = ps.filter((q) => Math.abs(q[2] - z1) < 0.5).map((q) => q[ac]);
    const mid = (Math.max(...tip) + Math.min(...tip)) / 2;
    const zc = z0 + centroidDepth(tr.chord);
    const zArm = Math.max(...pts(byId.get(a.id)!).map((q) => q[2])) - a.sec.d;
    tr.webs.forEach((wb, k) => {
      const g = byId.get(`${a.id}-web${k + 1}-from-conn`);
      assert.ok(g, `${at} ${a.id}-web${k + 1}: no gusset on the chord`);
      assert.ok(Math.abs(Math.min(...pts(g).map((q) => q[2])) - z1) < 1, `${at} ${g.id}: not on the stem tip`);
      const off = pts(g).map((q) => q[ac] - mid);
      assert.ok(Math.abs(Math.min(...off) + 6) < 0.5 && Math.abs(Math.max(...off) - 6) < 0.5, `${at} ${g.id}: not in the plane of the stem`);
      assert.equal(g.dots.length, 0, `${at} ${g.id}: bolts on the stem`);
      // the tube axis in the truss plane: through the mean of its corners,
      // along their main direction. From the centroid level to the bottom of
      // the arm it runs t - b along the chord.
      const tp = pts(byId.get(`${a.id}-web${k + 1}`)!).map((q) => [q[al], q[2]]);
      const [mx, mz] = [0, 1].map((i) => tp.reduce((m, q) => m + q[i], 0) / tp.length);
      const [sxx, sxz, szz] = [[0, 0], [0, 1], [1, 1]].map(([i, j]) => tp.reduce((m, q) => m + (q[i] - [mx, mz][i]) * (q[j] - [mx, mz][j]), 0));
      const ang = Math.atan2(2 * sxz, sxx - szz) / 2;
      const xAt = (z: number) => mx + ((z - mz) * Math.cos(ang)) / Math.sin(ang);
      const run = Math.abs(xAt(zArm) - xAt(zc));
      assert.ok(Math.abs(run - Math.abs(wb.t - wb.b)) < 3, `${at} ${a.id}-web${k + 1}: its axis misses the chord centroid (runs ${run.toFixed(1)}, not ${Math.abs(wb.t - wb.b).toFixed(1)})`);
    });
    n++;
  }
  return n;
}

// shapeP 1: every brace, secondary and chord gets its other shape, and the
// structure still stands, with no clash. shapeP 0: none of them. Each tee
// chord has its stem up (teeStemUp).
test('shapeP 1 and shapeP 0', () => {
  let tees = 0;
  for (const [name, cat] of Object.entries(cats))
    for (const form of forms)
      for (let seed = 1; seed <= 12; seed++) {
        const all = generate({ seed, form, shapeP: 1 }, cat);
        const at = `${name} ${form} seed ${seed}`;
        assert.ok(all.ok, `${at}: mechanism`);
        assert.deepEqual(clashes(all.parts), [], at);
        assert.deepEqual(floating(all.parts), [], at);
        tees += teeStemUp(all, at);
        assert.deepEqual(shapes(all.st).filter((k) => !/ (2L|L|C|T)$/.test(k)), [], at);
        assert.deepEqual(shapes(generate({ seed, form, shapeP: 0 }, cat).st).filter((k) => / (2L|L|C|T)$/.test(k)), [], at);
      }
  assert.ok(tees >= 10, `only ${tees} tee chords`);
});
