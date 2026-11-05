// node --test
// The gable portal: with gableP 0 no gable, with gableP 1 no clash and no
// floating part.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from './generate.ts';
import { cat, noClash } from './params-check.ts';

// With gableP 0, a seed gives the parts of main (the branch was checked
// against main once, part by part). Here: no gable and no haunch.
test('gableP 0 gives no gable', () => {
  for (const form of ['tree', 'portal', 'box', 'mix'] as const)
    for (const storeys of [1, 2] as const)
      for (let seed = 1; seed <= 30; seed++) {
        const r = generate({ seed, form, storeys, gableP: 0 }, cat);
        assert.ok(!r.st.arms.some((a) => a.gable), `${form} seed ${seed}`);
        assert.deepEqual(r.parts.filter((q) => /haunch|rafter/.test(q.id)).map((q) => q.id), [], `${form} seed ${seed}`);
      }
});

noClash([
  ['gable portals', { form: 'portal', storeys: 1, gableP: 1 }],
  ['gable portals, long spans, all details', { form: 'portal', storeys: 1, gableP: 1, spanK: 1.6, braceP: 1, secondaryP: 1, colSpliceP: 1 }],
]);
