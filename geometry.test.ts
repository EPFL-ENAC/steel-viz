// node --test tools/steel-generator/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadCatalog } from './sections.ts';
import { generate } from './generate.ts';
import { clashes } from './clash.ts';

const A = new URL('../../frontend/src/assets/', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, A), 'utf8');
const cats = {
  aisc: loadCatalog('aisc', read('connection/aisc-sections.csv'), read('hss/hss-aisc-sections.csv')),
  eu: loadCatalog('eu', read('connection/european-sections.csv'), read('hss/hss-european-sections.csv')),
};

test('no part goes through another one', () => {
  for (const [name, cat] of Object.entries(cats))
    for (let seed = 1; seed <= 60; seed++) {
      const found = clashes(generate({ seed }, cat).parts);
      assert.deepEqual(found, [], `${name} seed ${seed}`);
    }
});
