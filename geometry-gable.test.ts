// node --test
// The gable portal: every one storey portal with gableP 1, and only there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { floating, generate } from './generate.ts';
import { clashes } from './clash.ts';
import { cats, make, names } from './geometry-check.ts';
import { noClash } from './params-check.ts';
import { len, sub } from './vec.ts';

// gableP 1: every one storey portal gets a pitched roof. It stands, with no
// clash, its parts are all there, the ridge is up, the columns take the
// thrust, and the tooltip knows every part.
test('gable portals', () => {
  for (const name of names)
    for (let seed = 1; seed <= 40; seed++) {
      const r = make({ seed, form: 'portal', storeys: 1, gableP: 1 }, name);
      const at = `${name} seed ${seed}`;
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
    }
});

// a gable only on a one storey portal
test('no gable on other forms or on two storeys', () => {
  for (const [form, storeys] of [['tree', 1], ['box', 1], ['mix', 1], ['portal', 2]] as const)
    for (let seed = 1; seed <= 10; seed++)
      assert.ok(!generate({ seed, form, storeys, gableP: 1 }, cats.aisc).st.arms.some((a) => a.gable), `${form} ${storeys} seed ${seed}`);
});

// a case of the params-*.test.ts files, here to use the structures of 'gable portals'
noClash([['gable portals', { form: 'portal', storeys: 1, gableP: 1 }]], make);
