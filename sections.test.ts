// The section properties: the rectangle formulas, the new shapes against the
// values of their source, and the catalog lists.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { iSection, loadCatalog, rectProps, rects, type Section } from './sections.ts';
import { readTables } from './tables.ts';

const cats = { aisc: loadCatalog('aisc', ...readTables('aisc')), eu: loadCatalog('eu', ...readTables('eu')) };
const IN2 = 25.4 ** 2;
const IN4 = 25.4 ** 4;
const near = (x: number, ref: number, tol: number, what: string) =>
  assert.ok(Math.abs(x / ref - 1) <= tol, `${what}: ${x.toFixed(0)} vs ${ref.toFixed(0)}`);

test('rectangles of an I give the same props as iSection', () => {
  for (const s of [iSection('a', 300, 150, 10.7, 7.1), iSection('b', 1000, 300, 31, 19)]) {
    const p = rectProps(rects(s));
    for (const k of ['A', 'Is', 'Iw', 'Ws', 'Ww'] as const) near(p[k], s[k], 1e-9, `${s.id} ${k}`);
  }
});

test('the new shapes are close to the values of their source', () => {
  const find = (xs: Section[], id: string) => {
    const s = xs.find((x) => x.id === id);
    assert.ok(s, `${id} not found`);
    return s;
  };
  // [section, A, Is] in mm. Our shapes have no fillets and parallel flanges,
  // so they are a bit off. AISC: the steelpy CSV files (AISC Shapes Database
  // v16.0). EU: the EN 10365 values (UPN 200: 32.2 cm2, 1910 cm4; L 100x100x10:
  // 19.2 cm2, 177 cm4). A 2L is twice the angle.
  const refs: [Section, number, number][] = [
    [find(cats.aisc.channels, 'C10X15.3'), 4.48 * IN2, 67.3 * IN4],
    [find(cats.aisc.angles, '2L4X4X1/2'), 2 * 3.75 * IN2, 2 * 5.52 * IN4],
    [find(cats.aisc.tees, 'WT8X25'), 7.37 * IN2, 42.3 * IN4],
    [find(cats.eu.channels, 'UPN 200'), 3220, 19.1e6],
    [find(cats.eu.angles, '2L 100x100x10'), 2 * 1920, 2 * 1.77e6],
  ];
  for (const [s, A, Is] of refs) {
    near(s.A, A, 0.05, `${s.id} A`);
    near(s.Is, Is, 0.05, `${s.id} Is`);
  }
});

test('the catalogs have the shape lists, with unique ids', () => {
  for (const cat of Object.values(cats)) {
    for (const k of ['channels', 'angles', 'tees'] as const) {
      const xs = cat[k];
      assert.ok(xs.length > 5, `${cat.family} ${k}: ${xs.length}`);
      assert.equal(new Set(xs.map((s) => s.id)).size, xs.length, `${cat.family} ${k}: same id twice`);
      for (const s of xs) assert.ok(s.A > 0 && s.Is > 0 && s.Iw > 0 && s.J > 0 && s.Ws > 0 && s.Ww > 0 && s.rmin > 0, s.id);
    }
    assert.ok(cat.channels.every((s) => s.kind === 'C') && cat.angles.every((s) => s.kind === '2L') && cat.tees.every((s) => s.kind === 'T'));
  }
  assert.ok(cats.aisc.tees.every((s) => /^WT[\d.]+X[\d.]+$/.test(s.id)));
  assert.ok(cats.eu.tees.every((s) => /^1\/2 (IPE|HE) /.test(s.id)));
});

test('a catalog without the shape tables has empty shape lists', () => {
  const [i, hss] = readTables('eu');
  const cat = loadCatalog('eu', i, hss);
  assert.deepEqual([cat.channels.length, cat.angles.length, cat.tees.length > 0], [0, 0, true]);
});
