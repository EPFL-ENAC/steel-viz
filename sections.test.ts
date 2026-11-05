// The section properties: the rectangle formulas, the new shapes against the
// values of their source, and the catalog lists.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chsSection, flatBar, iSection, loadCatalog, rectProps, rects, type Section } from './sections.ts';
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

test('one angle and a flat bar: rmin about the weak axis', () => {
  // L 100x100x10: iv 1.95 cm (EN 10056). L4X4X1/2: rz 0.776 in (AISC).
  // No root radius here, so a bit off.
  const one = (cat: (typeof cats)['eu'], id: string) => cat.singles.find((s) => s.id === id)!;
  near(one(cats.eu, 'L 100x100x10').rmin, 19.5, 0.05, 'L 100x100x10 rmin');
  near(one(cats.aisc, 'L4X4X1/2').rmin, 0.776 * 25.4, 0.05, 'L4X4X1/2 rmin');
  const fb = flatBar('FL 100x10', 100, 10);
  near(fb.A, 1000, 1e-9, 'FB A');
  near(fb.rmin, 10 / Math.sqrt(12), 1e-9, 'FB rmin');
  for (const cat of Object.values(cats)) {
    assert.ok(cat.flats.length > 10 && cat.singles.length > 5, cat.family);
    assert.ok(cat.flats.every((s) => s.kind === 'FB' && s.bf <= s.d / 4) && cat.singles.every((s) => s.kind === 'L'));
  }
});

test('a round tube: the EN 10210 values', () => {
  // CHS 168.3x7.1: 35.9 cm2, I 1170 cm4, Wpl 185 cm3, i 5.71 cm
  const s = chsSection('CHS 168.3x7.1', 168.3, 7.1);
  near(s.A, 3590, 0.01, 'A');
  near(s.Is, 11.7e6, 0.01, 'I');
  assert.equal(s.Iw, s.Is);
  near(s.Ws, 185e3, 0.01, 'Wpl');
  near(s.rmin, 57.1, 0.01, 'i');
  // no table has one: the random generator never picks it
  for (const cat of Object.values(cats)) assert.ok(!cat.all.some((x) => x.kind === 'CHS'));
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
