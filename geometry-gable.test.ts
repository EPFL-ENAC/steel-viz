// node --test
// The gable portal: every portal with gableP 1, on its top bay beam, and only
// there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { floating, generate, type Result } from './generate.ts';
import { clashes } from './clash.ts';
import { cats, make, names } from './geometry-check.ts';
import { noClash } from './params-check.ts';
import { len, sub } from './vec.ts';

// It stands, with no clash, its parts are all there, the ridge is up, the
// columns take the thrust, and the tooltip knows every part. Returns the
// gable arm.
function gableOk(r: Result, at: string) {
  assert.ok(r.ok, `${at}: mechanism`);
  assert.deepEqual(clashes(r.parts), [], at);
  assert.deepEqual(floating(r.parts), [], at);
  const gables = r.st.arms.filter((a) => a.gable);
  assert.equal(gables.length, 1, at);
  const a = gables[0];
  const ids = new Set(r.parts.map((p) => p.id));
  for (const id of ['', '-rafter2', '-haunch', '-rafter2-haunch', '-from-conn', '-rafter2-from-conn', '-to-conn', '-rafter2-to-conn'])
    assert.ok(ids.has(a.id + id), `${at}: no ${a.id + id}`);
  // the top of the ridge plate is 25 mm over the top of steel at the ridge.
  // The column face and the end plates take a bit of the half span.
  const plate = r.parts.find((p) => p.id === `${a.id}-to-conn`)!;
  const ridge = Math.max(...plate.faces.flatMap((f) => f.pts.map((q) => q[2]))) - 25;
  const half = len(sub(r.st.cols[a.to!].x, r.st.cols[a.col].x)) / 2;
  const rise = (ridge - a.z) / (Math.tan((a.gable!.slope * Math.PI) / 180) * half);
  assert.ok(rise > 0.7 && rise < 1, `${at}: rise ${rise.toFixed(2)} of tan · span / 2`);
  const thrust = r.log.join('\n').match(/thrust at the eaves (-?[\d.]+) kN/);
  assert.ok(thrust && Number.isFinite(+thrust[1]), `${at}: no thrust in the log`);
  assert.ok(r.members.column.ratio < 1, `${at}: column ratio ${r.members.column.ratio}`);
  assert.deepEqual(r.parts.filter((p) => !p.info?.type).map((p) => p.id), [], at);
  assert.deepEqual(r.parts.filter((p) => p.info?.member && !r.members[p.info.member]).map((p) => p.id), [], at);
  return a;
}

// gableP 1: every one storey portal gets a pitched roof
test('gable portals', () => {
  for (const name of names)
    for (let seed = 1; seed <= 40; seed++) gableOk(make({ seed, form: 'portal', storeys: 1, gableP: 1 }, name), `${name} seed ${seed}`);
});

// two storeys: the gable on the top bay beam, the floor beam stays flat
test('gable on two storey portals', () => {
  for (const name of names)
    for (let seed = 1; seed <= 40; seed++) {
      const r = make({ seed, form: 'portal', storeys: 2, gableP: 1 }, name);
      const at = `${name} seed ${seed}`;
      const a = gableOk(r, at);
      const bays = r.st.arms.filter((b) => b.to !== undefined);
      assert.equal(bays.length, 2, at);
      const floor = bays.find((b) => b !== a)!;
      assert.ok(a.z > floor.z, `${at}: the gable is not on the top beam`);
      assert.ok(!r.parts.some((p) => p.id.startsWith(`${floor.id}-`) && /haunch|rafter|ridge/.test(p.id)), `${at}: a gable part on the floor beam`);
    }
});

// The floor storey keeps the bracing it has without the gable: the gable
// draw is on its own stream and frame() comes before it.
test('the floor storey of a two storey gable keeps its bracing', () => {
  for (const bracing of ['knee', 'chevron', 'diagonal', 'x'] as const) {
    let braced = 0; // a floor storey can be too low for its bracing, so a high portal
    for (let seed = 1; seed <= 8; seed++) {
      const at = `${bracing} seed ${seed}`;
      const [flat, gable] = [0, 1].map((gableP) => generate({ seed, form: 'portal', storeys: 2, height: 3500, bracing, gableP }, cats.aisc));
      const floor = (r: Result) => r.st.arms.filter((b) => b.to !== undefined).reduce((x, y) => (y.z < x.z ? y : x));
      const braces = (r: Result) => floor(r).braces.map((b) => [b.a, b.zb, b.end, b.x]);
      assert.ok(gable.st.arms.some((b) => b.gable), at);
      if (braces(flat).length) braced++;
      assert.deepEqual(braces(gable), braces(flat), at);
    }
    assert.ok(braced >= 3, `${bracing}: only ${braced} seeds with a floor bracing`);
  }
});

// a gable only on a portal
test('no gable on a tree or a box', () => {
  for (const form of ['tree', 'box'] as const)
    for (const storeys of [1, 2] as const)
      for (let seed = 1; seed <= 10; seed++)
        assert.ok(!generate({ seed, form, storeys, gableP: 1 }, cats.aisc).st.arms.some((a) => a.gable), `${form} ${storeys} seed ${seed}`);
});

// cases of the params-*.test.ts files, here to use the structures of the tests above
noClash([
  ['gable portals', { form: 'portal', storeys: 1, gableP: 1 }],
  ['gable portals, two storeys', { form: 'portal', storeys: 2, gableP: 1 }],
], make);
