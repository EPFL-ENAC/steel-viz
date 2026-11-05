// node --test
// Beam splices and posts at 0, and every brace a round tube.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { floating, generate } from './generate.ts';
import { clashes } from './clash.ts';
import { cats, forms, shapes } from './geometry-check.ts';

// with their chances at 0, none of them comes in
test('no beam splice or post when their chances are 0', () => {
  for (const [name, cat] of Object.entries(cats))
    for (const form of forms)
      for (let seed = 1; seed <= 20; seed++) {
        const ids = generate({ seed, form, postP: 0, beamSpliceP: 0 }, cat).parts.map((p) => p.id);
        assert.deepEqual(ids.filter((i) => /-post|-far|^arm\d+-splice/.test(i)), [], `${name} ${form} seed ${seed}`);
      }
});

// roundP 1: every brace is a round tube, with a slotted end or an end cap
// plate, and the structure still stands, with no clash
test('round tube braces', () => {
  for (const [name, cat] of Object.entries(cats)) {
    const ends = new Set<string>();
    for (const form of forms)
      for (let seed = 1; seed <= 12; seed++) {
        const r = generate({ seed, form, roundP: 1, shapeP: 0, braceP: 1 }, cat);
        const at = `${name} ${form} seed ${seed}`;
        assert.ok(r.ok, `${at}: mechanism`);
        assert.deepEqual(clashes(r.parts), [], at);
        assert.deepEqual(floating(r.parts), [], at);
        assert.deepEqual(shapes(r.st).filter((k) => k.startsWith('brace') && k !== 'brace CHS'), [], at);
        for (const q of r.parts) if (q.info?.type === 'Brace') for (const c of q.info.conn ?? []) ends.add(c);
      }
    for (const k of ['gusset', 'gusset_cap']) assert.ok(ends.has(k), `${name}: no ${k} end`);
  }
});
