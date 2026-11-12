// The match of "Compare with main" (app/diff.ts): the box at the bottom right
// and the one view use it.
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Result } from '../generate.ts';
import type { Part } from '../steel.ts';
import { WAS, diffParts, overlayParts } from './diff.ts';

const part = (id: string, x = 0, more: Partial<Part> = {}): Part => ({
  id, step: 0, supports: [], dots: [],
  faces: [{ pts: [[x, 0, 0], [x + 1, 0, 0], [x, 1, 0]], edges: [[0, 1]] }] as Part['faces'],
  ...more,
});
const result = (parts: Part[], col = 'W14X90', ok = true) => ({ parts, ok, st: { col: { id: col } } }) as unknown as Result;

// the base has col, b1 (a pin joint on col) and old; this branch has col, b1
// moved, and brace
const base = result([part('col'), part('b1', 0, { joint: { of: 'col', pin: [0, 0, 0], end: [1, 0, 0] }, supports: ['col'] }), part('old')]);
const here = result([part('col'), part('b1', 5, { supports: ['col'] }), part('brace')]);

test('diffParts finds the new, gone and changed parts', () => {
  const d = diffParts(base, here);
  assert.deepEqual(d, { added: ['brace'], gone: ['old'], changed: ['b1'], notes: [] });
});

test('diffParts says when the column or the status changes', () => {
  const d = diffParts(result([part('col')], 'W14X90', true), result([part('col')], 'W14X120', false));
  assert.deepEqual(d.notes, ['column W14X90 → W14X120', 'now a mechanism']);
});

test('overlayParts shows a changed part twice, with the two marks', () => {
  const o = overlayParts(base, here, diffParts(base, here));
  assert.deepEqual(o.parts.map((p) => p.id), ['col', 'b1', 'brace', `${WAS}b1`, `${WAS}old`]);
  assert.deepEqual(o.marks, { b1: 'new', brace: 'new', [`${WAS}b1`]: 'gone', [`${WAS}old`]: 'gone' });
  assert.equal(o.how.b1, 'changed, its new shape');
  assert.equal(o.how[`${WAS}b1`], 'changed, its old shape');
  assert.equal(o.how.brace, 'new');
  assert.equal(o.how[`${WAS}old`], 'gone');
  // the copy keeps the base part for the tooltip, its links get the new ids
  assert.equal(o.was.get(`${WAS}b1`), base.parts[1]);
  const copy = o.parts[3];
  assert.deepEqual(copy.supports, [`${WAS}col`]);
  assert.equal(copy.joint?.of, `${WAS}col`);
  assert.deepEqual(copy.faces, base.parts[1].faces);
  assert.equal(o.base, base);
});

test('overlayParts with no change has no mark', () => {
  const o = overlayParts(here, here, diffParts(here, here));
  assert.deepEqual(o.marks, {});
  assert.equal(o.parts.length, here.parts.length);
});

// the welds only show in the build: a part that gets them is the same part
test('diffParts: a part with welds is the same part', () => {
  const welds: Part['welds'] = [[[0, 0, 0], [1, 0, 0]]];
  const d = diffParts(result([part('col'), part('b1')]), result([part('col', 0, { welds }), part('b1')]));
  assert.deepEqual(d, { added: [], gone: [], changed: [], notes: [] });
});
