// node --test
// The look settings of Params (storeys, span, bracing, arm bands, connections,
// detail chances): at their default nothing changes. Set, they still give
// structures with no clash and no floating part: params-*.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, generate } from './generate.ts';
import { OLD, cat, kinds } from './params-check.ts';

test('the look settings at their default change nothing', () => {
  const { storeys, spanK, bracing, xP, xKind, armL, armZ, conn, trussK, rodP, colSpliceP, connKindsP, skewP, gableP } = DEFAULTS;
  const set = { storeys, spanK, bracing, xP, xKind, armL, armZ, conn, trussK, rodP, colSpliceP, connKindsP, skewP, gableP };
  for (let seed = 1; seed <= 30; seed++) assert.deepEqual(generate({ seed, ...set }, cat).parts, generate({ seed }, cat).parts, `seed ${seed}`);
});

// With connKindsP 0, a seed gives the parts of before the newer kinds (the
// branch was checked against main once, part by part). Here: no new kind,
// and the members stand where the default run has them (a new kind never
// moves a member, it only changes where its lines are cut at the end). No
// column splice here: it keeps clear of a seat, so a seat can move it.
test('more connection kinds at 0 change nothing', () => {
  for (const form of ['tree', 'portal', 'box', 'mix'] as const)
    for (let seed = 1; seed <= 20; seed++) {
      const off = generate({ seed, form, connKindsP: 0, colSpliceP: 0 }, cat);
      const on = generate({ seed, form, colSpliceP: 0 }, cat);
      assert.deepEqual(kinds(off).filter((k) => !OLD.includes(k)), [], `${form} seed ${seed}`);
      const members = (r: typeof on) => r.parts.filter((q) => q.kind === 'member').map((q) => [q.id, q.boxes, q.info?.sec?.id, q.info?.L]);
      assert.deepEqual(members(off), members(on), `${form} seed ${seed}`);
    }
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

// With xP 0, a seed gives the parts of before the X (the branch was checked
// against main once, part by part, on 40 seeds of every form and family).
// Here: no X part, and on with xP 1 there are some.
test('X at 0 changes nothing', () => {
  const xParts = (r: ReturnType<typeof generate>) => r.parts.filter((q) => q.info?.type.startsWith('X brace'));
  let on = 0;
  for (const form of ['tree', 'portal', 'box', 'mix'] as const)
    for (let seed = 1; seed <= 30; seed++) {
      assert.deepEqual(xParts(generate({ seed, form, xP: 0 }, cat)), [], `${form} seed ${seed}`);
      on += xParts(generate({ seed, form, xP: 1 }, cat)).length;
    }
  assert.ok(on > 0);
});

test('the settings do what they say', () => {
  for (let seed = 1; seed <= 10; seed++) {
    assert.equal(generate({ seed, form: 'portal', storeys: 2 }, cat).st.H, Math.round((DEFAULTS.height * 1.5) / 150) * 150);
    const welded = generate({ seed, conn: 'welded' }, cat).st;
    assert.ok(welded.arms.every((a) => a.conn === 'welded' || a.conn === 'gusset' || a.truss), `seed ${seed}`);
  }
});
