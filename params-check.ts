// Shared by the params*.test.ts files (the look settings of Params). Node runs
// the tests of one file one after the other, but the files at the same time,
// so these tests are split in a few files to run in parallel. Two noClash()
// cases are in geometry-gable.test.ts and geometry-skew.test.ts, to use the
// structures of the tests there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BEAM_CONN_KINDS, floating, generate, type Params, type Result } from './generate.ts';
import { clashes } from './clash.ts';
import { CONNS, type ConnType } from './steel.ts';
import { cats } from './geometry-check.ts';

export const cat = cats.aisc;
const SEEDS = 25;

// the kinds of before the connKindsP stream, and the ones it draws (they
// take the place of an old kind). welded_tab is in neither: no draw picks it.
// welded_plates and welded_haunch are for specimens only (specimenOnly).
export const OLD: ConnType[] = ['shear_tab', 'end_plate', 'flange_plates', 'welded', 'gusset', 'gusset_small', 'gusset_lap', 'clevis'];
export const NEW: ConnType[] = BEAM_CONN_KINDS.filter((k) => CONNS[k].replaces);
export const kinds = (r: ReturnType<typeof generate>) => r.parts.flatMap((q) => q.info?.conn ?? []) as ConnType[];

// one test for each case: SEEDS seeds, no clash, no floating part. get makes
// the structure: pass make() when another test of the file looks at the same ones.
export function noClash(cases: [string, Partial<Params>][], get: (p: Partial<Params>) => Result = (p) => generate(p, cat)) {
  for (const [name, over] of cases)
    test(`${name}: no clash, no floating part`, () => {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const r = get({ seed, ...over });
        assert.deepEqual(clashes(r.parts), [], `seed ${seed}`);
        assert.deepEqual(floating(r.parts), [], `seed ${seed}`);
      }
    });
}
