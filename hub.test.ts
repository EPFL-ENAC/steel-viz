// Every row of the RESSLab Hub tables (HUB_TABLES in tables.ts): a row
// that reads draws with no clash and no floating part, a row that doesn't
// read throws one of the two known errors (errorKind). It needs a copy of
// resslab-hub-data next to the repo, so it is skipped in CI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadCatalog, parseCsv } from './sections.ts';
import { HUB_TABLES, findHubData, readTables } from './tables.ts';
import { countTable } from './hub-count.ts';
import { fromHubConnection } from './hub.ts';

const dir = findHubData();
const cat = loadCatalog('aisc', ...readTables('aisc'));
const skip = dir ? false : 'no resslab-hub-data folder next to the repo';

for (const table of Object.keys(HUB_TABLES))
  test(`hub ${table}: every row draws, or throws a known error`, { skip }, (t) => {
    const c = countTable(dir!, table, cat);
    t.diagnostic(`${c.drawn} / ${c.rows} drawn`);
    assert.ok(c.rows > 0 && c.drawn > 0, `${table}: nothing drawn`);
    assert.deepEqual(c.clash, [], `${table}: rows with a clash`);
    assert.deepEqual(c.floating, [], `${table}: rows with a floating part`);
    // errorKind gives "other: ..." for a message in neither of the two forms
    assert.deepEqual([...c.errors].filter(([k]) => k.startsWith('other: ')), [], `${table}: unknown errors`);
  });

// The four exterior tests with the whole span in l_b. Every other beam keeps
// its length from l_b, and no row stops reading. A frame test (frame.ts) has
// its own lengths: l_b is the bay, the cantilever is not in the row.
const WHOLE_SPAN = ['Kim_and_Lee_2017_PN500-C', 'Kim_and_Lee_2017_PN500C-HST', 'Kim_and_Lee_2017_PN500C-SH', 'Kim_and_Lee_2017_PN500C-TH'];
test('hub connections: only the four whole span beams end at l_o', { skip }, () => {
  const rows = parseCsv(readFileSync(join(dir!, HUB_TABLES.connections), 'utf8'));
  const [changed, unread]: string[][] = [[], []];
  for (const row of rows) {
    try {
      const { id, beams, frame } = fromHubConnection(row);
      if (frame) {
        assert.equal(beams[0].length, Number(row.l_b), id);
        continue;
      }
      const lb = Number(row.l_b) / beams.length;
      if (beams.some((b) => Math.abs(b.length - lb) > 0.01)) {
        changed.push(id);
        assert.ok(beams.every((b) => b.length === 3500), `${id}: ${beams[0].length}`);
      }
    } catch (e) {
      if (e instanceof assert.AssertionError) throw e;
      unread.push(row.id);
    }
  }
  assert.deepEqual(changed, WHOLE_SPAN);
  assert.deepEqual(unread, []);
});
