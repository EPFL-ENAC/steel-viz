// A flat tension rod puts its clevis tab far back from the point where it
// lands, and the tab went through the top flange plate of its arm
// (flange_plates). clearRods() in generate.ts moves the rod out along the arm.
// These are the 3 trees that had the hit in seeds 0 to 600.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog, type Family } from './sections.ts';
import { floating, generate } from './generate.ts';
import { clashes } from './clash.ts';
import { readTables } from './tables.ts';

const CASES: [Family, number, string][] = [
  ['aisc', 140, 'arm3'],
  ['eu', 140, 'arm3'],
  ['eu', 469, 'arm4'],
];

for (const [family, seed, arm] of CASES) {
  test(`${family} tree ${seed}: the clevis of the ${arm} rod keeps clear of its flange plate`, () => {
    const r = generate({ seed, form: 'tree' }, loadCatalog(family, ...readTables(family)));
    assert.ok(r.ok);
    assert.deepEqual(clashes(r.parts), []);
    assert.deepEqual(floating(r.parts), []);
    const a = r.st.arms.find((x) => x.id === arm)!;
    assert.equal(a.conn, 'flange_plates');
    assert.equal(a.rod?.a, 650, 'moved out from 600 mm, not dropped');
    assert.ok(r.log.includes(`${arm}: tension rod moved out to 650 mm, its clevis went through ${arm}-from-conn`), r.log.join('\n'));
  });
}
