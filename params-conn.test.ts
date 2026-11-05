// node --test
// Each beam connection kind set for the whole structure: no clash, no
// floating part.
import { BEAM_CONN_KINDS, type Params } from './generate.ts';
import { noClash } from './params-check.ts';

noClash(BEAM_CONN_KINDS.map((c): [string, Partial<Params>] => [`connections ${c}`, { conn: c }]));
