// node --test
// Storeys, spans and arm bands: no clash, no floating part.
import { noClash } from './params-check.ts';

noClash([
  ['one storey', { storeys: 1, form: 'portal' }],
  ['two storeys', { storeys: 2, form: 'box' }],
  ['short spans', { spanK: 0.6, form: 'portal' }],
  ['long spans', { spanK: 1.6, form: 'box' }],
  ['short low arms', { armL: [0.2, 0.3], armZ: [0.3, 0.5], form: 'tree' }],
  ['long high arms', { armL: [0.6, 0.9], armZ: [0.8, 1], form: 'tree' }],
]);
