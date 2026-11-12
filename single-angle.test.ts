// node --test
// A small brace of an arm can be one angle, bolted by one leg on its gusset
// (see braceList() in generate.ts). Its compression check is E5 (checks.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { floating, generate } from './generate.ts';
import { clashes } from './clash.ts';
import { angleFits, angleSlenderness, compression } from './checks.ts';
import { cats, forms } from './geometry-check.ts';
import { E } from './solver.ts';
import { ANGLE_GAP, type Family } from './sections.ts';
import type { Part } from './steel.ts';
import { cross, dot, len, norm, sub, type V } from './vec.ts';

const near = (a: number, b: number, tol: number, msg: string) => assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${msg}: ${a} vs ${b}`);

test('E5: the slenderness of one angle', () => {
  // L 100x100x10: i about a leg 3.04 cm (EN 10056). No root radius here, so
  // a bit off.
  const s = cats.eu.braceAngles.find((q) => q.id === 'L 100x100x10')!;
  const ra = Math.sqrt(s.Iw / s.A);
  near(ra, 30.4, 0.03, 'ra');
  // E5-1 up to L / ra = 80, E5-2 after, and the two meet at 80 (Lc / r 132)
  near(angleSlenderness(s, 50 * ra), 72 + 0.75 * 50, 1e-9, 'E5-1');
  near(angleSlenderness(s, 120 * ra), 32 + 1.25 * 120, 1e-9, 'E5-2');
  near(angleSlenderness(s, 80 * ra), 132, 1e-9, 'at 80');
  near(angleSlenderness(s, 80.0001 * ra), 132, 1e-5, 'just after 80');
  // E3 with that slenderness: Fe = pi^2 E / (Lc / r)^2
  const L = 2000;
  const lr = angleSlenderness(s, L);
  const Fe = (Math.PI ** 2 * E) / lr ** 2;
  const Fcr = 345 / Fe <= 2.25 ? 0.658 ** (345 / Fe) * 345 : 0.877 * Fe;
  near(compression(s, L, 345), Fcr * s.A, 1e-9, "Pn");
  // up to Lc / r 200, and b / t up to 0.71 sqrt(E / Fy) (E5): 100 / 10 = 10
  // is under 17.5 at 345 MPa
  assert.ok(angleFits(s, 1000, 345));
  assert.ok(!angleFits(s, 140 * ra, 345), 'Lc / r over 200');
  assert.ok(!angleFits({ ...s, tf: 5, tw: 5 }, 1000, 345), 'legs too thin');
});

test('E5: one unequal angle, bolted by its long leg', () => {
  // L 150x100x10: i about the axis along the long leg 2.86 cm (EN 10056-1,
  // iz), i about the other one 4.78 cm. The long leg is on the gusset (d), so
  // ra is the small one.
  const s = cats.eu.braceAngles.find((q) => q.id === 'L 150x100x10')!;
  assert.deepEqual([s.kind, s.d, s.bf], ['L', 150, 100]);
  const ra = Math.sqrt(s.Iw / s.A);
  near(ra, 28.6, 0.04, 'ra');
  near(Math.sqrt(s.Is / s.A), 47.8, 0.04, 'the other radius');
  near(angleSlenderness(s, 2000), 72 + (0.75 * 2000) / ra, 1e-9, 'E5-1');
  // the new small ones of the EU table (blue-prints), legs up to 1.7 to 1
  const small = cats.eu.braceAngles.find((q) => q.id === 'L 60x40x6')!;
  assert.deepEqual([small.d, small.bf, small.tf], [60, 40, 6]);
  for (const cat of Object.values(cats)) {
    assert.ok(cat.braceAngles.every((q) => q.d >= q.bf && q.d < 1.7 * q.bf), cat.family);
    assert.ok(!cat.braceAngles.some((q) => q.id === 'L 100x50x10' || q.id === 'L6X3-1/2X1/2'), `${cat.family}: legs over 1.7 to 1`);
    // a double angle: the long legs back to back
    assert.ok(cat.angles.every((q) => q.kind === '2L' && q.d >= (q.bf - ANGLE_GAP) / 2), cat.family);
    assert.ok(cat.angles.some((q) => q.d > (q.bf - ANGLE_GAP) / 2), `${cat.family}: no unequal double angle`);
  }
  // the X braces keep their equal angles
  for (const cat of Object.values(cats)) assert.ok(cat.singles.every((q) => q.d === q.bf), cat.family);
});

// the parts of a structure by id, and all the corners of one
const byId = (r: ReturnType<typeof generate>) => new Map(r.parts.map((q) => [q.id, q]));
const pts = (q: Part): V[] => q.faces.flatMap((f) => f.pts);

// The back of the angle is on the plate face: the plate is ANGLE_GAP thick
// and the angle starts where it ends, on the side of its outstanding leg (the
// same as sideShift() of bench.ts on a hub brace test). The normal of the
// plate is the one of its biggest face. Two bolts at each end.
function onPlate(r: ReturnType<typeof generate>, id: string, at: string) {
  const parts = byId(r);
  const brace = parts.get(id)!;
  for (const end of ['from', 'to']) {
    const plate = parts.get(`${id}-${end}-conn`);
    assert.ok(plate, `${at} ${id}: no ${end} plate`);
    const big = plate.faces.reduce((m, f) => {
      const n = cross(sub(f.pts[1], f.pts[0]), sub(f.pts[2], f.pts[0]));
      return len(n) > m.a ? { a: len(n), n: norm(n) } : m;
    }, { a: 0, n: [0, 0, 1] as V });
    const along = (ps: V[]) => ps.map((q) => dot(q, big.n));
    const [p0, p1] = [Math.min(...along(pts(plate))), Math.max(...along(pts(plate)))];
    near(p1 - p0, ANGLE_GAP, 0.01, `${at} ${plate.id}: thickness`);
    // the corners of the brace near this plate (its end): on one side, from
    // the face of the plate
    const ends = pts(brace).filter((q) => Math.min(...pts(plate).map((g) => len(sub(q, g)))) < 200);
    const b = along(ends);
    const touch = Math.min(Math.abs(Math.min(...b) - p1), Math.abs(Math.max(...b) - p0));
    assert.ok(touch < 0.5, `${at} ${id}: the angle is ${touch.toFixed(1)} mm off the ${end} plate`);
  }
  assert.equal(parts.get(`${id}-bolts`)!.dots.length, 4, `${at} ${id}: two bolts at each end`);
}

test('shapeP 1: single angle braces, on their gusset, no clash, nothing floating', () => {
  for (const family of Object.keys(cats) as Family[]) {
    let [single, unequal] = [0, 0];
    for (const form of forms)
      for (let seed = 1; seed <= 40; seed++) {
        const at = `${family} ${form} ${seed}`;
        const r = generate({ seed, form, shapeP: 1 }, cats[family]);
        assert.deepEqual(clashes(r.parts), [], at);
        assert.deepEqual(floating(r.parts), [], at);
        for (const a of r.st.arms)
          a.braces.forEach((b, k) => {
            if (b.x || (b.sec.kind !== 'L' && b.sec.kind !== '2L')) return;
            // the long leg on the gusset
            const out = b.sec.kind === 'L' ? b.sec.bf : (b.sec.bf - ANGLE_GAP) / 2;
            assert.ok(b.sec.d >= out, `${at} ${a.id}: the short leg is on the gusset`);
            if (b.sec.d > out) unequal++;
            if (b.sec.kind !== 'L') return;
            assert.ok(!b.short, `${at} ${a.id}: one angle on a short brace`);
            single++;
            onPlate(r, `${a.id}-brace${k ? k + 1 : ''}`, at);
          });
      }
    assert.ok(single > 20, `${family}: only ${single} single angle braces`);
    assert.ok(unequal > 20, `${family}: only ${unequal} unequal angle braces`);
  }
});
