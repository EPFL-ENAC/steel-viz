// The test rig parts (rig.ts): each one alone, then a small rig put together.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from './sections.ts';
import { readTables } from './tables.ts';
import { floating } from './generate.ts';
import { clashes } from './clash.ts';
import { render } from './steel.ts';
import { renderHLR } from './hlr.ts';
import { actuator, block, clevis, crosshead, hingeSize, link, rigMember, rigSection, roller } from './rig.ts';

const cat = loadCatalog('aisc', ...readTables('aisc'));
const X: [number, number, number] = [1, 0, 0];
const Z: [number, number, number] = [0, 0, 1];
const D = 60;
const reach = hingeSize(D).reach;

// a block on the floor, a clevis on it, a post on the clevis, an actuator
// from a wall to the post, a link from the post to an anchor, a roller and a
// crosshead next to it
function smallRig() {
  const sec = rigSection(cat, 300);
  const top = 400 + reach;
  return [
    block('floor', [0, 0, 200], [800, 800, 400], { step: 0 }),
    clevis('foot', [0, 0, 400], Z, X, D, reach, { step: 1, supports: ['floor'] }),
    rigMember('post', sec, [0, 0, top], [0, 0, top + 2000], { step: 2, supports: ['foot'] }),
    block('wall', [0, -2500, 1500], [800, 600, 3000], { step: 0 }),
    actuator('jack', [0, -2200, top + 1800], [0, -sec.d / 2, top + 1800], X, D, { step: 3, supports: ['wall', 'post'] }),
    block('anchor', [0, 2500, 1500], [800, 600, 3000], { step: 0 }),
    link('tie', [0, 2200, top + 1000], [0, sec.d / 2, top + 1000], X, D, { step: 3, supports: ['anchor', 'post'] }),
    roller('roll', [2000, 0, 300], X, 80, 400, { step: 0 }),
    crosshead('head', [-2000, 0, 3000], X, 1500, 0, sec, { step: 0 }),
  ];
}

test('every rig part has the rig kind, faces, boxes and a type', () => {
  for (const p of smallRig()) {
    assert.equal(p.kind, 'rig', p.id);
    assert.ok(p.faces.length > 0, p.id);
    assert.ok(p.boxes?.length, p.id);
    assert.ok(p.info?.type, p.id);
  }
});

test('a small rig: no clash, no floating part', () => {
  const ps = smallRig();
  assert.deepEqual(clashes(ps), []);
  assert.deepEqual(floating(ps), []);
});

test('the clevis ends where it says: its tongue touches the next part', () => {
  const [, foot] = smallRig();
  const zs = foot.faces.flatMap((f) => f.pts.map((p) => p[2]));
  assert.ok(Math.abs(Math.max(...zs) - (400 + reach)) < 1e-6);
  assert.ok(Math.abs(Math.min(...zs) - 400) < 1e-6);
});

test('the renderers draw the rig with its own class', () => {
  const ps = smallRig();
  assert.match(renderHLR(ps, { az: 225, el: 35.264 }).svg, /class="g"/);
  assert.match(render(ps, { az: 225, el: 35.264 }).svg, /class="g"/);
});

test('a joint or an actuator too short for its pins is an error', () => {
  assert.throws(() => clevis('c', [0, 0, 0], Z, X, D, reach - 10, { step: 0 }), /needs/);
  assert.throws(() => actuator('a', [0, 0, 0], [0, 0, 2 * reach], X, D, { step: 0 }), /too short/);
  assert.throws(() => link('l', [0, 0, 0], [0, 0, 2 * reach + D], X, D, { step: 0 }), /too short/);
});

test('rigSection: the lightest I deep enough', () => {
  const s = rigSection(cat, 400);
  assert.ok(s.d >= 400);
  for (const o of [...cat.columns, ...cat.beams]) if (o.d >= 400) assert.ok(o.A >= s.A, `${o.id} is lighter than ${s.id}`);
  assert.ok(rigSection(cat, 10000).d > 600);
});
