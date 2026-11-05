// node --test
// Each kind of X on a box of two storeys: no clash, no floating part.
import { X_KINDS, type Params } from './generate.ts';
import { noClash } from './params-check.ts';

noClash(X_KINDS.map((k): [string, Partial<Params>] => [`x ${k}`, { bracing: 'x', xKind: k, form: 'box', storeys: 2 }]));
