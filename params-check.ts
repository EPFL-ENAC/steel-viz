// Shared by the params*.test.ts files (the look settings of Params). Node runs
// the tests of one file one after the other, but the files at the same time,
// so these tests are split in a few files to run in parallel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from './sections.ts';
import { BEAM_CONN_KINDS, floating, generate, type Params } from './generate.ts';
import { clashes } from './clash.ts';
import type { ConnType } from './steel.ts';
import { readTables } from './tables.ts';

export const cat = loadCatalog('aisc', ...readTables('aisc'));
const SEEDS = 25;

// the kinds of before the connKindsP stream, and the newer ones
export const OLD: ConnType[] = ['shear_tab', 'end_plate', 'flange_plates', 'welded', 'gusset', 'gusset_small', 'gusset_lap', 'clevis'];
export const NEW: ConnType[] = BEAM_CONN_KINDS.filter((k) => !OLD.includes(k));
export const kinds = (r: ReturnType<typeof generate>) => r.parts.flatMap((q) => q.info?.conn ?? []) as ConnType[];

// one test for each case: SEEDS seeds, no clash, no floating part
export function noClash(cases: [string, Partial<Params>][]) {
  for (const [name, over] of cases)
    test(`${name}: no clash, no floating part`, () => {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const r = generate({ seed, ...over }, cat);
        assert.deepEqual(clashes(r.parts), [], `seed ${seed}`);
        assert.deepEqual(floating(r.parts), [], `seed ${seed}`);
      }
    });
}
