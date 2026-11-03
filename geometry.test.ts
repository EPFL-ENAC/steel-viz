// node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from './sections.ts';
import { floating, generate, type Form } from './generate.ts';
import { clashes } from './clash.ts';
import { readTables } from './tables.ts';

const cats = {
  aisc: loadCatalog('aisc', ...readTables('aisc')),
  eu: loadCatalog('eu', ...readTables('eu')),
};

const forms: Form[] = ['tree', 'portal', 'box'];

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
