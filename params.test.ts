// node --test
// The look settings of Params (storeys, span, bracing, arm bands, connections,
// detail chances): at their default nothing changes. Set, they still give
// structures with no clash and no floating part: params-*.test.ts. The newer
// settings at 0: here and in params-*-off.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, generate } from './generate.ts';
import { cat } from './params-check.ts';

test('the look settings at their default change nothing', () => {
  const { storeys, spanK, bracing, xP, xKind, armL, armZ, conn, trussK, rodP, colSpliceP, connKindsP, skewP, gableP, roundP, shortBraceP } = DEFAULTS;
  const set = { storeys, spanK, bracing, xP, xKind, armL, armZ, conn, trussK, rodP, colSpliceP, connKindsP, skewP, gableP, roundP, shortBraceP };
  for (let seed = 1; seed <= 30; seed++) assert.deepEqual(generate({ seed, ...set }, cat).parts, generate({ seed }, cat).parts, `seed ${seed}`);
});

// With skewP 0 no arm is skewed: every arm is square to the column (the
// branch was checked against main once, part by part).
test('skewed arms at 0 change nothing', () => {
  for (const form of ['tree', 'portal', 'box'] as const)
    for (let seed = 1; seed <= 20; seed++) {
      const r = generate({ seed, form, skewP: 0 }, cat);
      const at = `${form} seed ${seed}`;
      assert.ok(r.st.arms.every((a) => a.bearing % 90 === 0 && a.face === undefined && a.skew === undefined), at);
      assert.ok(r.parts.every((q) => !/skewed/.test(q.info?.type ?? '')), at);
    }
});

test('the settings do what they say', () => {
  for (let seed = 1; seed <= 10; seed++) {
    assert.equal(generate({ seed, form: 'portal', storeys: 2 }, cat).st.H, Math.round((DEFAULTS.height * 1.5) / 150) * 150);
    const welded = generate({ seed, conn: 'welded' }, cat).st;
    assert.ok(welded.arms.every((a) => a.conn === 'welded' || a.conn === 'gusset' || a.truss), `seed ${seed}`);
  }
});
