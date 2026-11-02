// node --test tools/steel-generator/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadCatalog } from './sections.ts';
import { floating, generate, type Form } from './generate.ts';
import { clashes } from './clash.ts';

const A = new URL('../../frontend/src/assets/', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, A), 'utf8');
const cats = {
  aisc: loadCatalog('aisc', read('connection/aisc-sections.csv'), read('hss/hss-aisc-sections.csv')),
  eu: loadCatalog('eu', read('connection/european-sections.csv'), read('hss/hss-european-sections.csv')),
};

const forms: Form[] = ['tree', 'portal', 'corner'];

test('no part goes through another one', () => {
  for (const [name, cat] of Object.entries(cats))
    for (const form of forms)
      for (let seed = 1; seed <= 40; seed++) {
        const found = clashes(generate({ seed, form }, cat).parts);
        assert.deepEqual(found, [], `${name} ${form} seed ${seed}`);
      }
});

test('every form stands up and every part has a support', () => {
  for (const [name, cat] of Object.entries(cats))
    for (const form of forms)
      for (let seed = 1; seed <= 40; seed++) {
        const r = generate({ seed, form }, cat);
        assert.ok(r.ok, `${name} ${form} seed ${seed}: mechanism`);
        assert.equal(r.st.form, form);
        assert.deepEqual(floating(r.parts), [], `${name} ${form} seed ${seed}`);
      }
});
