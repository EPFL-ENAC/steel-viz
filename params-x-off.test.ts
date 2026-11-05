// node --test
// The X at 0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from './generate.ts';
import { cat } from './params-check.ts';

// With xP 0, a seed gives the parts of before the X (the branch was checked
// against main once, part by part, on 40 seeds of every form and family).
// Here: no X part, and on with xP 1 there are some.
test('X at 0 changes nothing', () => {
  const xParts = (r: ReturnType<typeof generate>) => r.parts.filter((q) => q.info?.type.startsWith('X brace'));
  let on = 0;
  for (const form of ['tree', 'portal', 'box', 'mix'] as const)
    for (let seed = 1; seed <= 30; seed++) {
      assert.deepEqual(xParts(generate({ seed, form, xP: 0 }, cat)), [], `${form} seed ${seed}`);
      on += xParts(generate({ seed, form, xP: 1 }, cat)).length;
    }
  assert.ok(on > 0);
});
