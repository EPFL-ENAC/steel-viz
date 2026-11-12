// node --test
// The bottom chord of a cantilever truss sways sideways (out of the truss
// plane) when it has a shear tab on the column. holdChord() in generate.ts
// gives it an end plate when alphaCr is under 3. These are the trees that
// stayed under 3 before (seeds 0 to 600): now they are at 3 or more, with
// no clash and no floating part.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { floating, generate, type Params } from './generate.ts';
import { clashes } from './clash.ts';
import { cats } from './geometry-check.ts';

const held = (r: ReturnType<typeof generate>, arm: string) => r.st.arms.find((a) => a.id === arm)?.truss?.conn;

test('eu tree 19: arm2-chord gets an end plate, alphaCr 3 or more', () => {
  const r = generate({ seed: 19, form: 'tree' }, cats.eu);
  assert.equal(held(r, 'arm2'), 'end_plate');
  assert.ok(r.alpha >= 3, `alphaCr ${r.alpha}`);
  assert.ok(r.log.some((l) => l.includes('arm2-chord shear tab -> end_plate')));
});

test('eu tree 7 with shapes 0: arm7-chord gets an end plate', () => {
  const r = generate({ seed: 7, form: 'tree', shapeP: 0 }, cats.eu);
  assert.equal(held(r, 'arm7'), 'end_plate');
  assert.ok(r.alpha >= 3, `alphaCr ${r.alpha}`);
});

const LOW: [keyof typeof cats, number, Partial<Params>?][] = [
  ['aisc', 274], ['eu', 7], ['eu', 7, { shapeP: 0 }], ['eu', 19], ['eu', 69], ['eu', 90], ['eu', 95], ['eu', 107], ['eu', 218],
  ['eu', 274], ['eu', 388], ['eu', 413], ['eu', 504], ['eu', 540], ['eu', 550], ['eu', 558],
];

test('the trees that were under alphaCr 3: now 3 or more, no clash, no floating part', () => {
  for (const [fam, seed, over] of LOW) {
    const r = generate({ seed, form: 'tree', ...over }, cats[fam]);
    const at = `${fam} tree ${seed}${over ? ' ' + JSON.stringify(over) : ''}`;
    assert.ok(r.alpha >= 3, `${at}: alphaCr ${r.alpha}`);
    assert.deepEqual(clashes(r.parts), [], at);
    assert.deepEqual(floating(r.parts), [], at);
  }
});
