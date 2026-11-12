// node --test welds.test.ts
// The site welds (Part.welds): only the build animation draws them. Each seam
// must lie on the part that gets it, the welded kinds must have them, and the
// bolted kinds must not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { generate, type Params } from './generate.ts';
import { fromHubConnection, toSpecimen } from './hub.ts';
import { loadCatalog } from './sections.ts';
import type { Box, Part } from './steel.ts';
import { readTables } from './tables.ts';
import { dot, sub, type V } from './vec.ts';

const cats = { aisc: loadCatalog('aisc', ...readTables('aisc')), eu: loadCatalog('eu', ...readTables('eu')) };
const ROOM = 2; // mm
const inBox = (p: V, b: Box) => b.ax.every((a, i) => Math.abs(dot(sub(p, b.c), a)) <= b.h[i] + ROOM);

// every end of every seam is in a box of its part, or on a corner of its
// faces (a skewed cut end: its boxes stay behind the cut, see cutBoxes)
const near = (p: V, q: V) => Math.hypot(...sub(p, q)) <= ROOM;
function onPart(parts: Part[], name: string) {
  for (const q of parts)
    for (const [i, s] of (q.welds ?? []).entries())
      for (const p of s)
        assert.ok(q.boxes?.some((b) => inBox(p, b)) || q.faces.some((f) => f.pts.some((c) => near(p, c))), `${name}: seam ${i} of ${q.id} is off the part, at ${p.map((x) => x.toFixed(1))}`);
}

const make = (p: Partial<Params>) => generate(p, cats.aisc).parts;
const record = (id: string) => JSON.parse(readFileSync(new URL(`./specimens/${id}.json`, import.meta.url), 'utf8'));
const DC2 = record('Chi_and_Uang_2002_DC2');
const hub = (extra: object) => generate({ specimen: fromHubConnection({ ...DC2, ...extra }) }, cats.aisc).parts;

test('the seams lie on their part: seeds, welded ends, skewed ends', () => {
  for (let seed = 0; seed < 60; seed++) onPart(make({ seed }), `seed ${seed}`);
  for (const seed of [1, 5, 12, 40]) onPart(make({ seed, conn: 'welded' }), `seed ${seed} welded`);
  for (const seed of [3, 8, 22, 35]) onPart(make({ seed, form: 'tree', skewP: 1, conn: 'welded' }), `seed ${seed} skewed`);
  for (const seed of [2, 7]) onPart(generate({ seed }, cats.eu).parts, `eu seed ${seed}`);
});

test('the seams lie on their part: the specimens and the welded hub kinds', () => {
  const dir = new URL('./specimens/', import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const spec = toSpecimen(JSON.parse(readFileSync(new URL(f, dir), 'utf8')));
    for (const cat of Object.values(cats)) {
      let r;
      try {
        r = generate({ specimen: spec }, cat);
      } catch {
        continue;
      }
      if (r.ok) onPart(r.parts, f);
    }
  }
  for (const [name, extra] of Object.entries(KINDS)) onPart(hub(extra), name);
});

const KINDS = {
  'WUF-W': { connection_type: 'WUF-W' },
  'WUF-B': { connection_type: 'WUF-B' },
  WFP: { connection_type: 'WFP', t_pl: 25 },
  'KBB triangle': { connection_type: 'KBB', d_h: 300, s_h: 700, comments: 'triangular hanch' },
  'KBB straight': { connection_type: 'KBB', d_h: 300, s_h: 700, comments: 'straight hanch' },
};

test('the welded kinds have seams, on the part that comes last', () => {
  const beam = (parts: Part[]) => parts.find((q) => q.kind === 'member')!;
  for (const [name, extra] of Object.entries(KINDS)) assert.ok(beam(hub(extra)).welds?.length, `${name}: the beam has no seam`);
  const wfp = hub(KINDS.WFP);
  assert.ok(wfp.find((q) => q.id.endsWith('-conn'))?.welds?.length, 'WFP: the flange plates have no seam');
  const kbb = hub(KINDS['KBB triangle']);
  assert.ok(kbb.find((q) => q.id.endsWith('-haunch'))?.welds?.length, 'KBB: the haunch has no seam');
  // the column: welded on its foot plate, and its cap plate on it
  assert.ok(wfp.find((q) => q.kind === 'column')?.welds?.length, 'the specimen column has no seam');
  assert.ok(wfp.find((q) => q.id.endsWith('-cap'))?.welds?.length, 'the specimen cap has no seam');
  // a frame: the cap plates and the continuity plates
  const parts = make({ seed: 5 });
  assert.ok(parts.some((q) => /-cap$/.test(q.id) && q.welds?.length), 'seed 5: no cap with a seam');
  assert.ok(parts.some((q) => /-stiffener\d+[we]$/.test(q.id) && q.welds?.length), 'seed 5: no continuity plate with a seam');
});

const WELDED = ['welded', 'welded_tab', 'welded_plates', 'welded_haunch'];
test('the bolted kinds have no seam, and the members have none with no plates', () => {
  for (const conn of ['shear_tab', 'end_plate', 'flange_plates', 'clip_angles', 'tee', 'seated'] as const)
    for (const seed of [1, 5, 12]) {
      const parts = make({ seed, conn });
      const bad = parts.filter((q) => q.kind === 'member' && q.welds?.length && !q.info?.conn?.some((c) => WELDED.includes(c)));
      assert.equal(bad.length, 0, `seed ${seed} ${conn}: ${bad.map((q) => q.id)}`);
      const plates = parts.filter((q) => q.id.endsWith('-conn') && q.welds?.length && !q.info?.conn?.includes('welded_plates'));
      assert.equal(plates.length, 0, `seed ${seed} ${conn}: ${plates.map((q) => q.id)}`);
    }
  for (const seed of [1, 5]) assert.ok(generate({ seed, conn: 'welded' }, cats.aisc, 'members').parts.every((q) => !q.welds), `seed ${seed}: a seam with no plates`);
});

test('a seam is a list of segments in mm, no point is NaN', () => {
  for (const parts of [make({ seed: 5 }), hub(KINDS['KBB straight']), hub(KINDS.WFP)])
    for (const q of parts) for (const s of q.welds ?? []) assert.ok(s.length === 2 && s.flat().every(Number.isFinite), q.id);
});
