// node --test
// Every member in its other shape, and none of them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { floating, generate } from './generate.ts';
import { clashes } from './clash.ts';
import { cats, forms, shapes } from './geometry-check.ts';

// shapeP 1: every brace, secondary and chord gets its other shape, and the
// structure still stands, with no clash. shapeP 0: none of them.
test('shapeP 1 and shapeP 0', () => {
  for (const [name, cat] of Object.entries(cats))
    for (const form of forms)
      for (let seed = 1; seed <= 12; seed++) {
        const all = generate({ seed, form, shapeP: 1 }, cat);
        const at = `${name} ${form} seed ${seed}`;
        assert.ok(all.ok, `${at}: mechanism`);
        assert.deepEqual(clashes(all.parts), [], at);
        assert.deepEqual(floating(all.parts), [], at);
        assert.deepEqual(shapes(all.st).filter((k) => !/ (2L|C|T)$/.test(k)), [], at);
        assert.deepEqual(shapes(generate({ seed, form, shapeP: 0 }, cat).st).filter((k) => / (2L|C|T)$/.test(k)), [], at);
      }
});
