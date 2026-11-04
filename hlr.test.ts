// node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from './sections.ts';
import { generate, type Form } from './generate.ts';
import { readTables } from './tables.ts';
import { renderHLR } from './hlr.ts';
import { camera, VIEWS, type Part, type Face } from './steel.ts';
import { dot, type V } from './vec.ts';

// a box from corner (x0, y0, z0) to (x1, y1, z1), in mm
function box(id: string, step: number, [x0, y0, z0]: V, [x1, y1, z1]: V): Part {
  const p = (i: number): V => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0];
  const quads = [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]];
  const faces: Face[] = quads.map((q) => ({ pts: q.map(p), edges: [[0, 1], [1, 2], [2, 3], [3, 0]] }));
  return { id, step, faces, dots: [], supports: [] };
}

// the lines of the drawing (thin and thick, not the hidden ones), in drawing units
type Seg = [number, number, number, number];
function lines(svg: string): Seg[] {
  const out: Seg[] = [];
  for (const m of svg.matchAll(/<path([^>]*?) d="([^"]*)"/g)) {
    if (/class="[^"]*\b(h|b|r)\b/.test(m[1])) continue;
    for (const s of m[2].matchAll(/M([-\d.]+) ([-\d.]+)L([-\d.]+) ([-\d.]+)/g)) out.push([+s[1], +s[2], +s[3], +s[4]]);
  }
  return out;
}

// is (x, y) on a line of the drawing (closer than 0.1 unit, the rounding)?
const on = (segs: Seg[], x: number, y: number) =>
  segs.some(([ax, ay, bx, by]) => {
    const [dx, dy] = [bx - ax, by - ay];
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - ax - t * dx, y - ay - t * dy) < 0.1;
  });

test('a box in front of another one hides the right piece of its edge', () => {
  // seen from the south: screen x is world x, screen y is -z. Scale 0.1.
  const back = box('back', 0, [0, 0, 0], [1000, 100, 1000]);
  const front = box('front', 1, [500, -500, 200], [1500, -400, 800]);
  const segs = lines(renderHLR([back, front], { az: VIEWS.south[0], el: VIEWS.south[1], gap: false }).svg);
  // the right edge of the back box (x 1000) is behind the front box from z 200 to 800
  const shown = (z: number) => on(segs, 100, -z / 10);
  for (let z = 10; z < 1000; z += 10) {
    if (z > 200 && z < 800) assert.ok(!shown(z), `z ${z} must be hidden`);
    else if (z < 200 || z > 800) assert.ok(shown(z), `z ${z} must be visible`);
  }
  // the length of what is shown on that line: 2 pieces of 200 mm
  const length = segs
    .filter(([ax, , bx]) => Math.abs(ax - 100) < 0.01 && Math.abs(bx - 100) < 0.01)
    .map(([, ay, , by]) => [Math.min(ay, by), Math.max(ay, by)])
    .sort((a, b) => a[0] - b[0])
    .reduce((s, [a, b], i, l) => s + Math.max(0, b - Math.max(a, i ? l[i - 1][1] : -Infinity)), 0);
  assert.equal(Math.round(length * 10) / 10, 40);
});

test('a line on a face stays visible', () => {
  // a small box on top of a big one: its bottom edges lie on the top face
  const base = box('base', 0, [0, 0, 0], [1000, 1000, 1000]);
  const top = box('top', 1, [200, 0, 1000], [400, 100, 1200]);
  const o = { az: VIEWS.iso[0], el: VIEWS.iso[1], gap: false as const };
  const segs = lines(renderHLR([base, top], o).svg);
  const { r, up } = camera(o.az, o.el);
  // the bottom edge of the small box on the camera side: y 0, z 1000
  for (let x = 220; x <= 380; x += 20) {
    const p: V = [x, 0, 1000];
    assert.ok(on(segs, dot(p, r) / 10, -dot(p, up) / 10), `x ${x} must be visible`);
  }
});

// 60 of the 240 structures (all 240 take about 14 s)
test('no NaN in the drawing of 60 structures', () => {
  for (const fam of ['aisc', 'eu'] as const) {
    const cat = loadCatalog(fam, ...readTables(fam));
    for (const form of ['tree', 'portal', 'box'] as Form[])
      for (let seed = 1; seed <= 40; seed += 4) {
        const { svg } = renderHLR(generate({ seed, form }, cat).parts, { az: VIEWS.iso[0], el: VIEWS.iso[1], animate: true });
        assert.ok(!svg.includes('NaN') && !svg.includes('Infinity'), `${fam} ${form} ${seed}`);
      }
  }
});
