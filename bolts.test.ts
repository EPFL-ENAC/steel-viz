// node --test
// The grip of the bolts (grips() and gripAt() in steel.ts): the 3D view puts
// the nut at the end of it, so it must stop at the far face of the steel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { generate } from './generate.ts';
import { gripAt, type Box, type Dot, type Part } from './steel.ts';
import { toSpecimen } from './hub.ts';
import { cats, forms } from './geometry-check.ts';
import { add, dot, len, mul, sub, type V } from './vec.ts';

const I: [V, V, V] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
// a flat box under z = top, t thick
const plate = (top: number, t: number): Box => ({ c: [0, 0, top - t / 2], ax: I, h: [100, 100, t / 2] });
const UP: V = [0, 0, 1];
const O: V = [0, 0, 0];

test('gripAt: the steel under the head, up to the first gap', () => {
  assert.equal(gripAt(O, UP, [plate(0, 20)]), 20);
  assert.equal(gripAt(O, UP, [plate(0, 20), plate(-20, 15)]), 35);
  assert.equal(gripAt(O, UP, [plate(-20, 15), plate(0, 20)]), 35, 'the order of the boxes');
  assert.equal(gripAt(O, UP, [plate(0, 20), plate(-21, 15)]), 36, 'a gap of 1 mm is no gap');
  assert.equal(gripAt(O, UP, [plate(0, 20), plate(-23, 15)]), 20, 'a gap of 3 mm ends it');
  assert.equal(gripAt([0, 0, 1], UP, [plate(0, 20)]), 21, 'a head 1 mm off the face');
});

test('gripAt: no grip when we do not know the far side', () => {
  assert.equal(gripAt(O, UP, []), undefined, 'no steel');
  assert.equal(gripAt([200, 0, 0], UP, [plate(0, 20)]), undefined, 'beside the plate');
  assert.equal(gripAt(O, UP, [plate(0, 200)]), undefined, 'too thick');
  // a stiffener under the plate, in line with the bolt
  const along: Box = { c: [0, 0, -70], ax: I, h: [5, 100, 50] };
  assert.equal(gripAt(O, UP, [plate(0, 20), along]), undefined, 'a stiffener along the bolt');
});

// Where each end of each bolt is, as the 3D view draws it (show() in webgl.ts)
function ends(parts: Part[]) {
  const heads: { p: V; n: V; d: Dot }[] = [];
  const nuts: { p: V; n: V; d: Dot }[] = [];
  for (const d of parts.flatMap((q) => q.dots)) {
    if (d.axis) {
      const h = d.half ?? 0;
      heads.push({ p: add(d.p, mul(d.axis, h)), n: d.axis, d });
      nuts.push({ p: sub(d.p, mul(d.axis, h)), n: mul(d.axis, -1), d });
    } else if (d.n && !d.anchor && !d.far) {
      heads.push({ p: d.p, n: d.n, d });
      if (d.grip !== undefined) nuts.push({ p: sub(d.p, mul(d.n, d.grip)), n: mul(d.n, -1), d });
    }
  }
  return { heads, nuts };
}

function check(parts: Part[], at: string) {
  const all = parts.flatMap((q) => q.dots);
  for (const d of all) {
    if (d.anchor || d.far || d.axis) assert.equal(d.grip, undefined, `${at}: an anchor, a far end or a through bolt has no grip`);
    if (d.grip !== undefined) assert.ok(d.grip > 0 && d.grip <= 150, `${at}: grip ${d.grip}`);
  }
  // a nut never lands on the head of another bolt (back-to-back plates)
  const { heads, nuts } = ends(parts);
  for (const k of nuts)
    for (const h of heads)
      if (h.d !== k.d && dot(h.n, k.n) > 0.9 && len(sub(h.p, k.p)) < 4) assert.fail(`${at}: a nut on a head at ${k.p.map(Math.round)}`);
  return all;
}

test('the seeds: grips in range, no nut on a head', () => {
  let grip = 0;
  for (const [name, cat] of Object.entries(cats))
    for (const form of forms)
      for (let seed = 1; seed <= 15; seed++) grip += check(generate({ seed, form }, cat).parts, `${name} ${form} seed ${seed}`).filter((d) => d.grip !== undefined).length;
  assert.ok(grip > 1000, `only ${grip} bolts with a grip`);
});

// trees with end plates back to back on a column web: one bolt for the two,
// so one of the two dots is the far end
test('back-to-back end plates: one bolt, its nut on the other plate', () => {
  for (const seed of [22, 35, 36]) {
    const parts = generate({ seed, form: 'tree' }, cats.aisc).parts;
    const all = check(parts, `aisc tree seed ${seed}`);
    assert.ok(all.some((d) => d.far), `seed ${seed}: no far end`);
  }
});

test('the specimens: grips in range, no nut on a head', () => {
  const dir = new URL('./specimens/', import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const spec = toSpecimen(JSON.parse(readFileSync(new URL(f, dir), 'utf8')));
    const r = Object.values(cats)
      .map((cat) => {
        try {
          return generate({ specimen: spec }, cat);
        } catch {
          return undefined;
        }
      })
      .find((x) => x?.ok);
    if (r) check(r.parts, f);
  }
});

test('the gable ridge: one bolt through both plates, a head and a nut', () => {
  let seen = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const r = generate({ seed, form: 'portal', storeys: 1, gableP: 1 }, cats.aisc);
    const bolts = r.parts.find((q) => q.id.endsWith('-ridge-bolts'));
    if (!bolts) continue;
    seen++;
    assert.ok(bolts.dots.length > 0);
    for (const d of bolts.dots) assert.ok(d.axis && d.half && !d.n, `seed ${seed}: a ridge bolt goes through both plates`);
  }
  assert.ok(seen > 3, `only ${seen} ridges with bolts`);
});
