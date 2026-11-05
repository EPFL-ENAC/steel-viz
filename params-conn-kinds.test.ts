// node --test
// The newer connection kinds (connKindsP): each one shows, and with all of
// them on there is no clash and no floating part.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, type Params } from './generate.ts';
import { CONNS, type ConnType } from './steel.ts';
import { NEW, cat, kinds, noClash } from './params-check.ts';

test('each newer connection kind shows on some seeds', () => {
  const seen = new Set<ConnType>();
  for (const form of ['tree', 'portal', 'box', 'mix'] as const)
    for (let seed = 1; seed <= 40; seed++) for (const k of kinds(generate({ seed, form, connKindsP: 1 }, cat))) seen.add(k);
  for (const k of NEW) assert.ok(seen.has(k), `${CONNS[k].label} never shows`);
});

noClash((['tree', 'portal', 'box'] as const).map((form): [string, Partial<Params>] => [`more connection kinds, ${form}`, { connKindsP: 1, form, secondaryP: 1 }]));
