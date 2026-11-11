// node --test
// Every member in its other shape, and none of them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { floating, generate } from './generate.ts';
import { clashes } from './clash.ts';
import { cats, forms, shapes } from './geometry-check.ts';
import type { Part } from './steel.ts';
import type { V } from './vec.ts';

// A tee bottom chord has its stem up, like on a real truss: at its lowest
// level it is as wide as its flange, at its highest only as wide as its stem.
// The gusset of each diagonal stands on the stem tip. A chord runs along x or
// y (a skewed arm has no truss), so its width is the smaller of the two spans.
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
    tr.webs.forEach((_, k) => {
      const g = byId.get(`${a.id}-web${k + 1}-from-conn`);
      assert.ok(g, `${at} ${a.id}-web${k + 1}: no gusset on the chord`);
      assert.ok(Math.abs(Math.min(...pts(g).map((q) => q[2])) - z1) < 1, `${at} ${g.id}: not on the stem tip`);
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
        assert.deepEqual(shapes(all.st).filter((k) => !/ (2L|C|T)$/.test(k)), [], at);
        assert.deepEqual(shapes(generate({ seed, form, shapeP: 0 }, cat).st).filter((k) => / (2L|C|T)$/.test(k)), [], at);
      }
  assert.ok(tees >= 10, `only ${tees} tee chords`);
});
