// The round flag (Part.round): with one line weight, the 3D view outlines only
// these parts (webgl.ts), because a round bar has no line along its sides.
// Every part with a round bar must have it, and only those. The test finds
// the round bars from the faces alone, not from the flag or from info.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { loadCatalog } from './sections.ts';
import { generate, type Form, type Params } from './generate.ts';
import { readTables } from './tables.ts';
import { toSpecimen } from './hub.ts';
import type { Part } from './steel.ts';
import { cross, dot, len, norm, sub, type V } from './vec.ts';

const cats = { aisc: loadCatalog('aisc', ...readTables('aisc')), eu: loadCatalog('eu', ...readTables('eu')) };

// A part with a round bar, from its faces: side faces with no line along them
// (smooth() in steel.ts) in 3 or more directions. A coped web split in two has
// such faces too, but in one plane. Only faces longer than wide: not the 12 mm
// round cap plate of a tube end (a plate, not a bar).
function roundBar(p: Part): boolean {
  const dirs: V[] = [];
  for (const f of p.faces) {
    if (f.pts.length !== 4) continue;
    if (f.edges.some(([i, j]) => (i === 1 && j === 2) || (i === 3 && j === 0))) continue;
    const [a, b, , d] = f.pts;
    if (len(sub(d, a)) < len(sub(b, a))) continue;
    const n = norm(cross(sub(b, a), sub(d, a)));
    if (!dirs.some((m) => Math.abs(dot(m, n)) > 0.999)) dirs.push(n);
  }
  return dirs.length >= 3;
}

// the example specimens, and a few seeds with rods and round tubes
function cases(): [string, Part[]][] {
  const out: [string, Part[]][] = [];
  const dir = new URL('./specimens/', import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const spec = toSpecimen(JSON.parse(readFileSync(new URL(f, dir), 'utf8')));
    out.push([f, generate({ specimen: spec }, cats[spec.family ?? 'aisc']).parts]);
  }
  const sets: [string, Partial<Params>, Form[]][] = [
    ['round tubes', { roundP: 1 }, ['tree', 'portal', 'box']],
    ['rod X', { bracing: 'x', xKind: 'rod' }, ['portal', 'box']],
    ['tension rods', { rodP: 1 }, ['tree']],
  ];
  for (const [name, over, forms] of sets)
    for (const form of forms)
      for (let seed = 1; seed <= 4; seed++) out.push([`${name} ${form} seed ${seed}`, generate({ seed, form, ...over }, cats.aisc).parts]);
  return out;
}

test('every part with a round bar has the round flag, and only those', () => {
  const seen = new Set<string>();
  for (const [at, parts] of cases())
    for (const p of parts) {
      assert.equal(!!p.round, roundBar(p), `${at} ${p.id}: round is ${p.round}`);
      if (p.round) seen.add(p.info?.sec?.kind ?? p.info?.type ?? '');
    }
  for (const k of ['Actuator', 'Link', 'Roller', 'Pin', 'Turnbuckle', 'ROD', 'CHS']) assert.ok(seen.has(k), `no round ${k} in the cases (${[...seen].join(', ')})`);
});
