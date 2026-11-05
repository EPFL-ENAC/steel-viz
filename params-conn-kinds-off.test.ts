// node --test
// The newer connection kinds at 0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from './generate.ts';
import { NEW, cat, kinds } from './params-check.ts';

// With connKindsP 0, a seed gives the parts of before the newer kinds (the
// branch was checked against main once, part by part). Here: no new kind,
// and the members stand where the default run has them (a new kind never
// moves a member, it only changes where its lines are cut at the end). No
// column splice here: it keeps clear of a seat, so a seat can move it.
test('more connection kinds at 0 change nothing', () => {
  for (const form of ['tree', 'portal', 'box', 'mix'] as const)
    for (let seed = 1; seed <= 20; seed++) {
      const off = generate({ seed, form, connKindsP: 0, colSpliceP: 0 }, cat);
      const on = generate({ seed, form, colSpliceP: 0 }, cat);
      assert.deepEqual(kinds(off).filter((k) => NEW.includes(k)), [], `${form} seed ${seed}`);
      const members = (r: typeof on) => r.parts.filter((q) => q.kind === 'member').map((q) => [q.id, q.boxes, q.info?.sec?.id, q.info?.L]);
      assert.deepEqual(members(off), members(on), `${form} seed ${seed}`);
    }
});
