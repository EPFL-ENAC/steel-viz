// Every row of the RESSLab Hub tables (HUB_TABLES in tables.ts): a row
// that reads draws with no clash and no floating part, a row that doesn't
// read throws one of the two known errors (errorKind). It needs a copy of
// resslab-hub-data next to the repo, so it is skipped in CI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from './sections.ts';
import { HUB_TABLES, findHubData, readTables } from './tables.ts';
import { countTable } from './hub-count.ts';

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
