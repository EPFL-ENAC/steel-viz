// node --test
// Round tubes at 0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from './generate.ts';
import { loadCatalog } from './sections.ts';
import { readTables } from './tables.ts';
import { cat } from './params-check.ts';

// With roundP 0, a seed gives the parts of a catalog with no round tube
// table (like main, and like the hub), at any roundP: no draw moves.
test('round tubes at 0 change nothing', () => {
  const [i, hss, c, l] = readTables('aisc');
  const old = loadCatalog('aisc', i, hss, c, l);
  for (const form of ['tree', 'portal', 'box', 'mix'] as const)
    for (let seed = 1; seed <= 20; seed++) {
      const off = generate({ seed, form, roundP: 0 }, cat);
      assert.ok(!off.parts.some((q) => q.info?.sec?.kind === 'CHS'), `${form} seed ${seed}`);
      assert.deepEqual(off.parts, generate({ seed, form }, old).parts, `${form} seed ${seed}`);
    }
});
