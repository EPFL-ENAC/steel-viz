// node --test
// Short braces at 0, and where they show.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from './generate.ts';
import { cat } from './params-check.ts';

// With shortBraceP 0, no arm of a default tree has room for a brace, so braceP
// changes nothing (the branch was checked against main once, part by part).
test('short braces at 0 change nothing', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const off = generate({ seed, form: 'tree', braceP: 1, shortBraceP: 0 }, cat);
    assert.ok(!off.st.arms.some((a) => a.braces.length), `seed ${seed}`);
    assert.deepEqual(off.parts, generate({ seed, form: 'tree', braceP: 0, shortBraceP: 0 }, cat).parts, `seed ${seed}`);
  }
});

test('braceP changes the trees', () => {
  const braces = (braceP: number) => {
    let n = 0;
    for (let seed = 1; seed <= 20; seed++) n += generate({ seed, form: 'tree', braceP }, cat).st.arms.filter((a) => a.braces.some((b) => b.short)).length;
    return n;
  };
  assert.equal(braces(0), 0);
  assert.ok(braces(1) > braces(0.3) && braces(0.3) > 0);
});

// the rule is only on tree arms
test('short braces do not change a portal or a box', () => {
  for (const form of ['portal', 'box'] as const)
    for (let seed = 1; seed <= 20; seed++)
      assert.deepEqual(generate({ seed, form, shortBraceP: 1 }, cat).parts, generate({ seed, form, shortBraceP: 0 }, cat).parts, `${form} seed ${seed}`);
});
