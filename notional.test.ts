// node --test
// The notional loads of generate.ts: the share phi of each rule, and where
// the log and the member checks show them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generate, notionalShare } from './generate.ts';
import { toSpecimen } from './hub.ts';
import { cats, make } from './geometry-check.ts';

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) <= 1e-6 * b, `${a} is not ${b}`);

test('notionalShare: AISC 360-22 C2.2b is 0.002, whatever the height', () => {
  for (const [H, m] of [[3000, 1], [9000, 2]]) assert.equal(notionalShare('aisc', H, m), 0.002);
});

test('notionalShare: EC3 5.3.2(3), 1/200 alpha_h alpha_m', () => {
  near(notionalShare('eu', 3000, 1), 1 / 200); // alpha_h 2 / sqrt(3) = 1.15, kept at 1
  near(notionalShare('eu', 3000, 2), 0.005 * Math.sqrt(0.75)); // 0.004330
  near(notionalShare('eu', 9000, 1), 1 / 300); // alpha_h 2 / 3
  near(notionalShare('eu', 20000, 1), 1 / 300); // alpha_h 0.45, kept at 2/3
  near(notionalShare('eu', 6000, 2), 0.005 * (2 / Math.sqrt(6)) * Math.sqrt(0.75)); // 0.003536
});

const line = (log: string[]) => log.find((l) => l.startsWith('notional loads'));
const frac = (x: number) => `1/${Math.round(1 / x)}`;

for (const seed of [1, 2, 3])
  test(`a two storey eu portal, seed ${seed}: m = 2 in its plane, 1 across`, () => {
    const r = make({ seed, form: 'portal', storeys: 2 }, 'eu');
    const [a, b] = r.st.cols;
    const inX = Math.abs(a.x[0] - b.x[0]) > 1;
    const plane = frac(notionalShare('eu', r.st.H, 2));
    const across = frac(notionalShare('eu', r.st.H, 1));
    const [px, py] = inX ? [plane, across] : [across, plane];
    assert.equal(line(r.log), `notional loads ${px} of the vertical loads along x, ${py} along y (EC3 5.3.2)`);
    // the side load bends the columns: their worst case is a side case
    assert.notEqual(r.members.column.case, 'gravity');
  });

test('aisc: one share in both directions, and a case on every member', () => {
  const r = make({ seed: 5 });
  assert.equal(line(r.log), 'notional loads 0.002 of the vertical loads (AISC 360-22 C2.2b)');
  for (const [who, m] of Object.entries(r.members)) assert.ok(['gravity', '+x', '-x', '+y', '-y'].includes(m.case), who);
});

test('a tree: one column, 1/200 both ways when it is short', () => {
  const r = generate({ seed: 5, form: 'tree' }, cats.eu);
  assert.equal(line(r.log), `notional loads ${frac(notionalShare('eu', r.st.H, 1))} of the vertical loads (EC3 5.3.2)`);
});

test('a specimen has no notional loads', () => {
  const spec = toSpecimen(JSON.parse(readFileSync(new URL('./specimens/Chi_and_Uang_2002_DC2.json', import.meta.url), 'utf8')));
  const r = generate({ specimen: spec }, cats.aisc);
  assert.equal(line(r.log), undefined);
  for (const m of Object.values(r.members)) assert.equal(m.case, 'gravity');
});
