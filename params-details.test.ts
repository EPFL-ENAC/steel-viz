// node --test
// Bracing and the detail chances (trusses, rods, splices, braces,
// secondaries, posts, skewed arms): no clash, no floating part.
import { BRACING_KINDS, type Params } from './generate.ts';
import { noClash } from './params-check.ts';

noClash([
  ...BRACING_KINDS.map((b): [string, Partial<Params>] => [`bracing ${b}`, { bracing: b, form: 'portal', storeys: 2 }]),
  ['no truss, no rod, no splice', { trussK: 0, rodP: 0, colSpliceP: 0 }],
  ['many trusses and rods', { trussK: 2.5, rodP: 1, colSpliceP: 1 }],
  ['all braces, secondaries, posts, splices', { braceP: 1, secondaryP: 1, postP: 1, beamSpliceP: 1 }],
  ['skewed arms', { skewP: 1, form: 'tree' }],
]);
