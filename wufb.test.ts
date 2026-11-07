// node --test wufb.test.ts
// WUF-B (welded flanges, bolted web): the hub tests get the kind welded_tab,
// the flanges welded like `welded` and a shear tab bolted to the beam web.
// No random draw ever picks this kind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadCatalog, parseCsv } from './sections.ts';
import { floating, generate } from './generate.ts';
import { clashes } from './clash.ts';
import { HUB_TABLES, findHubData, readTables } from './tables.ts';
import { fromHubConnection, toSpecimen } from './hub.ts';
import { follow, type Move } from './deform.ts';
import { CONNS, type Part } from './steel.ts';
import type { ConnSpecimen } from './specimen.ts';

const cat = loadCatalog('aisc', ...readTables('aisc'));
const base = JSON.parse(readFileSync(new URL('./specimens/Chi_and_Uang_2002_DC2.json', import.meta.url), 'utf8'));
const asType = (ct: string) => fromHubConnection({ ...base, connection_type: ct });
const draw = (ct: string) => generate({ specimen: asType(ct) }, cat);
const byId = (parts: Part[], id: string) => parts.find((p) => p.id === id);
// the bounding box of a part, from its faces
const bbox = (p: Part) =>
  [0, 1, 2].flatMap((k) => {
    const xs = p.faces.flatMap((f) => f.pts.map((q) => q[k]));
    return [Math.min(...xs), Math.max(...xs)].map((x) => Math.round(x * 1000) / 1000);
  });

test('a WUF-B record gives welded_tab, with no note', () => {
  const s = asType('WUF-B');
  assert.equal(s.beams[0].connection, 'welded_tab');
  assert.deepEqual(s.notes, []);
});

test('a WUF-B test: the WUF-W parts, plus the tab and its bolts', () => {
  const [b, w] = [draw('WUF-B'), draw('WUF-W')];
  assert.ok(b.ok, b.log.join('\n'));
  const tab = byId(b.parts, 'beam1-from-conn');
  assert.ok(tab, 'no tab part');
  assert.equal(tab.kind, 'plate');
  assert.deepEqual(tab.supports, ['column']);
  assert.deepEqual(tab.info?.conn, ['welded_tab']);
  assert.ok(byId(b.parts, 'beam1-bolts')?.dots.length, 'no bolts');
  assert.deepEqual(clashes(b.parts), []);
  assert.deepEqual(floating(b.parts), []);
  const ids = (r: typeof b) => r.parts.map((p) => p.id).sort();
  assert.deepEqual(ids(b), [...ids(w), 'beam1-bolts', 'beam1-from-conn'].sort());
  // the beam is where it is with welded: same outline, only one more cut at the tab edge
  assert.deepEqual(bbox(byId(b.parts, 'beam1')!), bbox(byId(w.parts, 'beam1')!));
});

test('the tab grows with the beam depth', () => {
  const bolts = (section: string) => {
    const s: ConnSpecimen = { id: section, column: { section: 'W14X257', height: 3000 }, beams: [{ section, bearing: 0, length: 2000, connection: 'welded_tab' }] };
    const r = generate({ specimen: s }, cat);
    assert.deepEqual(clashes(r.parts), [], section);
    return byId(r.parts, 'beam1-bolts')!.dots.length;
  };
  assert.equal(bolts('W14X22'), 4);
  assert.equal(bolts('W30X99'), 8);
});

test('deformed view: the tab moves with the column, the bolts with the beam', () => {
  const r = draw('WUF-B');
  const [col, beam] = [{ name: 'column' }, { name: 'beam' }] as unknown as Move[];
  const out = follow(r.parts, { column: col, beam1: beam });
  assert.equal(out['beam1-from-conn'], col);
  assert.equal(out['beam1-bolts'], beam);
});

test('no random draw picks welded_tab', () => {
  assert.equal(CONNS.welded_tab.replaces, undefined);
  for (const form of ['tree', 'portal', 'box', 'mix'] as const)
    for (let seed = 1; seed <= 5; seed++) {
      const r = generate({ seed, form, connKindsP: 1, secondaryP: 1 }, cat);
      assert.ok(!r.parts.some((p) => p.info?.conn?.includes('welded_tab')), `${form} seed ${seed}`);
    }
});

const dir = findHubData();
test('hub: every WUF-B test has a tab and bolts on each beam, and no WUF-B note', { skip: dir ? false : 'no resslab-hub-data folder next to the repo' }, () => {
  const rows = parseCsv(readFileSync(join(dir!, HUB_TABLES.connections), 'utf8')).filter((r) => r.connection_type === 'WUF-B');
  assert.equal(rows.length, 31);
  for (const row of rows) {
    const s = toSpecimen(row) as ConnSpecimen;
    assert.ok(!s.notes?.some((n) => n.includes('WUF-B')), row.id);
    const r = generate({ specimen: s }, cat);
    s.beams.forEach((_, i) => {
      assert.deepEqual(byId(r.parts, `beam${i + 1}-from-conn`)?.info?.conn, ['welded_tab'], row.id);
      assert.ok(byId(r.parts, `beam${i + 1}-bolts`)?.dots.length, row.id);
    });
  }
});
