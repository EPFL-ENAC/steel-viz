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

// how many seeds of each form get a truss: trees need the low truss, and a
// box (4 to 8 bay beams) must not get one on almost every seed
test('trusses on every form', (t) => {
  for (const [name, cat] of Object.entries(cats)) {
    const count: Record<string, number> = {};
    for (const form of forms) {
      count[form] = 0;
      for (let seed = 1; seed <= 40; seed++) if (generate({ seed, form }, cat).st.arms.some((a) => a.truss)) count[form]++;
    }
    t.diagnostic(`${name}, seeds with a truss of 40: ${forms.map((f) => `${f} ${count[f]}`).join(', ')}`);
    assert.ok(count.tree >= 3, `${name}: ${count.tree} trees with a truss`);
    assert.ok(count.box <= 16, `${name}: ${count.box} boxes with a truss`);
  }
});

// the new details show up on some seeds, not on all of them
test('beam splices and posts on some seeds', (t) => {
  for (const [name, cat] of Object.entries(cats)) {
    const n = { splice: 0, post: 0, all: 0 };
    for (const form of forms)
      for (let seed = 1; seed <= 40; seed++) {
        const ids = generate({ seed, form }, cat).parts.map((p) => p.id);
        n.all++;
        if (ids.some((i) => /^arm\d+-splice$/.test(i))) n.splice++;
        if (ids.some((i) => /-post$/.test(i))) n.post++;
      }
    t.diagnostic(`${name}, structures of ${n.all}: beam splice ${n.splice}, post ${n.post}`);
    for (const k of ['splice', 'post'] as const) assert.ok(n[k] > 0 && n[k] < n.all, `${name}: ${k} on ${n[k]} of ${n.all}`);
  }
});

// with their chances at 0, none of them comes in
test('no beam splice or post when their chances are 0', () => {
  for (const [name, cat] of Object.entries(cats))
    for (const form of forms)
      for (let seed = 1; seed <= 20; seed++) {
        const ids = generate({ seed, form, postP: 0, beamSpliceP: 0 }, cat).parts.map((p) => p.id);
        assert.deepEqual(ids.filter((i) => /-post|-far|^arm\d+-splice/.test(i)), [], `${name} ${form} seed ${seed}`);
      }
});
