// node --test
// Bracing and the detail chances (trusses, rods, splices, braces, round
// tube braces, secondaries, posts): no clash, no floating part. The kinds of X
// are in params-x.test.ts, skewed arms in geometry-skew.test.ts.
import { BRACING_KINDS, type Params } from './generate.ts';
import { noClash } from './params-check.ts';

noClash([
  ...BRACING_KINDS.map((b): [string, Partial<Params>] => [`bracing ${b}`, { bracing: b, form: 'portal', storeys: 2 }]),
  ['no truss, no rod, no splice', { trussK: 0, rodP: 0, colSpliceP: 0 }],
  ['many trusses and rods', { trussK: 2.5, rodP: 1, colSpliceP: 1 }],
  ['all braces, secondaries, posts, splices', { braceP: 1, secondaryP: 1, postP: 1, beamSpliceP: 1 }],
  ['round tube braces', { roundP: 1, braceP: 1 }],
  ['short arm braces', { form: 'tree', braceP: 1, shortBraceP: 1 }],
]);
