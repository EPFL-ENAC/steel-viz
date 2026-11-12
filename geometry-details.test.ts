// node --test
// Beam splices and posts at 0, every brace and truss diagonal a round tube,
// and the end cap plates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { braceConn, DEFAULTS, floating, generate } from './generate.ts';
import { memberRatio, tooThin } from './checks.ts';
import { clashes } from './clash.ts';
import { CAP_MIN_D, CAP_WIDE_D } from './steel.ts';
import type { Section } from './sections.ts';
import { cats, forms, make, names, shapes } from './geometry-check.ts';

// with their chances at 0, none of them comes in
test('no beam splice or post when their chances are 0', () => {
  for (const [name, cat] of Object.entries(cats))
    for (const form of forms)
      for (let seed = 1; seed <= 20; seed++) {
        const ids = generate({ seed, form, postP: 0, beamSpliceP: 0 }, cat).parts.map((p) => p.id);
        assert.deepEqual(ids.filter((i) => /-post|-far|^arm\d+-splice/.test(i)), [], `${name} ${form} seed ${seed}`);
      }
});

// roundP 1: every brace is a round tube, with a slotted end or an end cap
// plate, and the structure still stands, with no clash
test('round tube braces', () => {
  for (const name of names) {
    const ends = new Set<string>();
    for (const form of forms)
      for (let seed = 1; seed <= 12; seed++) {
        const r = make({ seed, form, roundP: 1, shapeP: 0, braceP: 1 }, name);
        const at = `${name} ${form} seed ${seed}`;
        assert.ok(r.ok, `${at}: mechanism`);
        assert.deepEqual(clashes(r.parts), [], at);
        assert.deepEqual(floating(r.parts), [], at);
        assert.deepEqual(shapes(r.st).filter((k) => k.startsWith('brace') && k !== 'brace CHS'), [], at);
        for (const q of r.parts) if (q.info?.type === 'Brace') for (const c of q.info.conn ?? []) ends.add(c);
      }
    for (const k of ['gusset', 'gusset_cap']) assert.ok(ends.has(k), `${name}: no ${k} end`);
  }
});

// roundP 1 and shapeP 0: the diagonals of every truss are round tubes, with
// the ends of a round tube brace (slot or end cap, and the small gusset on a
// low truss). They are checked like the braces: D / t under the F8 limit, the
// ratio of their own section. No clash, no floating part.
test('round tube truss diagonals', () => {
  for (const name of names) {
    const ends = new Set<string>();
    let n = 0;
    for (const form of forms)
      for (let seed = 1; seed <= 40; seed++) {
        const r = generate({ seed, form, roundP: 1, shapeP: 0 }, cats[name]);
        const at = `${name} ${form} seed ${seed}`;
        if (!r.st.arms.some((a) => a.truss)) continue;
        assert.deepEqual(clashes(r.parts), [], at);
        assert.deepEqual(floating(r.parts), [], at);
        assert.deepEqual(shapes(r.st).filter((k) => k.startsWith('diagonal') && k !== 'diagonal CHS'), [], at);
        for (const q of r.parts) {
          if (q.info?.type !== 'Truss diagonal') continue;
          const m = r.members[q.info.member!];
          assert.ok(q.round, `${at} ${q.id}: no round flag`);
          assert.ok(!tooThin(q.info.sec!, DEFAULTS.fy), `${at} ${q.id}: too thin`);
          assert.ok(Math.abs(m.ratio - memberRatio(q.info.sec!, m, m.L, DEFAULTS.fy)) < 1e-9, `${at} ${q.id}: not the ratio of its section`);
          for (const c of q.info.conn ?? []) ends.add(c);
          n++;
        }
      }
    assert.ok(n >= 20, `${name}: only ${n} round tube diagonals`);
    for (const k of ['gusset', 'gusset_cap', 'gusset_small']) assert.ok(ends.has(k), `${name}: no ${k} end on a diagonal`);
  }
});

// The limit comes from the bolt, its edge distance and the welds (steel.ts).
// Under it a tube keeps its slot, even when its arm drew the cap.
test('the end of a round tube: slot, small cap or wide cap', () => {
  assert.equal(CAP_MIN_D, 82);
  const end = (d: number) => braceConn({ cap: true, sec: { id: `CHS ${d}`, kind: 'CHS', d } as Section });
  assert.equal(end(76.2), 'gusset');
  assert.equal(end(88.9), 'gusset_cap');
  assert.equal(end(114.3), 'gusset_cap');
});

// A cap under CAP_WIDE_D has a narrow tab with one line of 2 bolts, so 4
// bolts on the brace. From CAP_WIDE_D, the 4 bolts of today at each end.
test('small end cap plates', () => {
  for (const name of names) {
    const seen = { small: 0, wide: 0 };
    for (const form of forms)
      for (let seed = 1; seed <= 12; seed++) {
        const r = make({ seed, form, roundP: 1, shapeP: 0, braceP: 1 }, name);
        const at = `${name} ${form} seed ${seed}`;
        for (const q of r.parts) {
          if (q.info?.type !== 'Brace' || !q.info.conn?.includes('gusset_cap')) continue;
          const d = q.info.sec!.d;
          const bolts = r.parts.find((b) => b.id === `${q.id}-bolts`)!;
          const small = d < CAP_WIDE_D;
          seen[small ? 'small' : 'wide']++;
          assert.ok(d >= CAP_MIN_D, `${at} ${q.id}: a cap on a ${d} mm tube`);
          assert.equal(bolts.dots.length, small ? 4 : 8, `${at} ${q.id}: ${d} mm`);
        }
      }
    assert.ok(seen.small > 0, `${name}: no small cap`);
    assert.ok(seen.wide > 0, `${name}: no wide cap`);
  }
});
