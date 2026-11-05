// node --test
// Skewed arms on trees.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { floating } from './generate.ts';
import { clashes } from './clash.ts';
import { area, make, names } from './geometry-check.ts';
import { noClash } from './params-check.ts';
import { triangles } from './triangles.ts';
import { cross, len, sub, type V } from './vec.ts';

// Skewed arms on trees: they stand, nothing clashes, and they keep only what
// a skewed end can carry. The triangles cover the cut end of each one.
test('skewed arms', () => {
  let n = 0;
  for (const name of names)
    for (let seed = 1; seed <= 40; seed++) {
      const r = make({ seed, form: 'tree', skewP: 1 }, name);
      const at = `${name} tree seed ${seed}`;
      assert.ok(r.ok, `${at}: mechanism`);
      assert.deepEqual(clashes(r.parts), [], at);
      assert.deepEqual(floating(r.parts), [], at);
      r.st.arms.forEach((a, i) => {
        if (!a.skew) return;
        n++;
        const arm = `${at} ${a.id}`;
        assert.ok(a.face === 0 || a.face === 180, `${arm}: face ${a.face}`);
        assert.ok([30, 45].includes(Math.abs(a.skew)), `${arm}: skew ${a.skew}`);
        assert.equal(a.bearing, (a.face + a.skew + 360) % 360, arm);
        assert.ok(a.conn === 'end_plate' || a.conn === 'welded', `${arm}: ${a.conn}`);
        assert.ok(!a.braces.length && !a.truss && !a.rod, `${arm}: a brace, truss or rod`);
        assert.ok(!r.st.secs.some((q) => q.arm === i), `${arm}: a secondary`);
        const ids = r.parts.map((q) => q.id).filter((id) => id.startsWith(`${a.id}-`));
        assert.deepEqual(ids.filter((id) => /-(brace|rod|chord|web)/.test(id)), [], arm);
        for (const f of r.parts.find((q) => q.id === a.id)!.faces) {
          const out: number[] = [];
          triangles(f.pts, out);
          let sum = 0;
          for (let k = 0; k < out.length; k += 9) {
            const [p, q, c] = [0, 3, 6].map((o) => out.slice(k + o, k + o + 3) as V);
            sum += len(cross(sub(q, p), sub(c, p))) / 2;
          }
          const want = area(f.pts);
          assert.ok(Math.abs(sum - want) <= 1e-6 * want + 1e-6, `${arm}: area ${sum}, not ${want}`);
        }
      });
    }
  assert.ok(n > 40, `only ${n} skewed arms`);
});

// a case of the params-*.test.ts files, here to use the structures of 'skewed arms'
noClash([['skewed arms', { skewP: 1, form: 'tree' }]], make);
