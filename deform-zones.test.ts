// The zone boxes. ZONE_FS in webgl.ts tests <= on an interpolated point, so a
// flat face exactly on the edge of a box gets jagged bands: rounding decides,
// pixel by pixel. So no face that takes a color can be on an edge. The hub loop
// needs a copy of resslab-hub-data next to the repo (skipped in CI).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Samples, Zone } from './deform.ts';
import { DEFORMS } from './deforms.ts';
import { generate } from './generate.ts';
import { toSpecimen, type HubRecord } from './hub.ts';
import { loadCatalog, parseCsv } from './sections.ts';
import type { Part } from './steel.ts';
import { findHubData, HUB_TABLES, readTables } from './tables.ts';
import { dot, sub } from './vec.ts';

const cat = loadCatalog('aisc', ...readTables('aisc'));
const dir = findHubData();
const skip = dir ? false : 'no resslab-hub-data folder next to the repo';

const EDGE = 0.01; // mm, closer than this to an edge is on it
const OVERLAP = 0.5; // mm, a face that only touches the box is not in it
const NO_COLOR = new Set(['rig', 'bolts', 'slab']); // see fills() and veil() in webgl.ts

// the faces that are flat along an axis of the box, on its edge, and in the box
// on the two other axes
function onEdge(parts: Part[], z: Zone) {
  const hits: string[] = [];
  for (const p of parts) {
    if (NO_COLOR.has(p.kind ?? '')) continue;
    for (const f of p.faces) {
      const along = z.axes.map((a) => f.pts.map((q) => dot(sub(q, z.c), a)));
      const lo = along.map((v) => Math.min(...v));
      const hi = along.map((v) => Math.max(...v));
      for (const k of [0, 1, 2]) {
        const inside = [0, 1, 2].filter((j) => j !== k).every((j) => Math.min(hi[j], z.half[j]) - Math.max(lo[j], -z.half[j]) > OVERLAP);
        if (hi[k] - lo[k] <= 1e-6 && inside && Math.abs(Math.abs(lo[k]) - z.half[k]) < EDGE) hits.push(`${p.id} (axis ${k})`);
      }
    }
  }
  return hits;
}

// one sample for each response of the table, so that it has all its zones
function zones(table: string, rec: HubRecord) {
  const T = DEFORMS[table];
  const spec = toSpecimen(rec);
  const r = generate({ specimen: spec }, cat);
  const samples: Samples = {};
  for (const { folder } of T.responses) samples[folder] = { x: 0.01, y: 100, along: 0.01, lo: 0, hi: 0.01 };
  return { parts: r.parts, zones: T.shape(r, spec, rec, samples, 1).zones };
}
const record = (id: string): HubRecord => JSON.parse(readFileSync(new URL(`./specimens/${id}.json`, import.meta.url), 'utf8'));

const EXAMPLES: Record<string, string[]> = {
  connections: ['Chi_and_Uang_2002_DC2', 'Ricles_et_al_2004_SPEC-1', 'Lee_et_al_2002_CR1'],
  braces: ['Shaback_3A', 'Takeuchi_Matsui_528', 'Wakabayashi_DPC1-1'],
  eccentric_braced_frames: ['Malley_and_Popov_1983_24', 'Stratan_and_Dubina_2003_LL5-m', 'Roeder_and_Popov_1977_TF1-F1', 'Volynkin_and_Clifton_2016_AL-4C'],
  columns: ['MacRae_C3', 'Nakashima_et_al_S105604', 'Cheng_Chen_Niu_Nethercot_B-H4-0.2-15'],
  hss_columns: ['Tsuda_Matsui_1998__Matsui-943', 'Sugiyama_Igarashi_1986__Igarashi-14', 'Nakajima_et_al_2009__L-T16-45'],
};

for (const id of EXAMPLES.connections)
  test(`${id}: no face of the column is on the edge of the panel zone box`, () => {
    const b = zones('connections', record(id));
    const panel = b.zones.find((z) => z.label === 'Panel zone');
    assert.ok(panel, 'no panel zone');
    assert.ok(b.parts.some((p) => p.id === 'column'), 'no column');
    assert.deepEqual(onEdge(b.parts.filter((p) => p.id === 'column'), panel), []);
  });

for (const [table, ids] of Object.entries(EXAMPLES))
  for (const id of ids)
    test(`${table} ${id}: no colored face is on the edge of a zone box`, () => {
      const b = zones(table, record(id));
      assert.ok(b.zones.length, 'no zone');
      for (const z of b.zones) assert.deepEqual(onEdge(b.parts, z), [], z.label);
    });

for (const table of Object.keys(DEFORMS))
  test(`hub ${table}: no colored face is on the edge of a zone box`, { skip }, () => {
    const bad: string[] = [];
    let seen = 0;
    for (const rec of parseCsv(readFileSync(join(dir!, HUB_TABLES[table]), 'utf8'))) {
      let b;
      try {
        b = zones(table, rec);
      } catch {
        continue; // hub.test.ts looks at the rows we can't read
      }
      seen += b.zones.length;
      for (const z of b.zones) for (const hit of onEdge(b.parts, z)) bad.push(`${rec.id} ${z.label}: ${hit}`);
    }
    assert.ok(seen > 0, 'no zone');
    assert.deepEqual([...new Set(bad)].slice(0, 20), []);
  });
