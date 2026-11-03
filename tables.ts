// The section tables, copied from resslab-hub (frontend/src/assets/connection
// and frontend/src/assets/hss). Copy them again when the hub changes them.
// Node only: the playground gets them inlined by build-playground.ts.
import { readFileSync } from 'node:fs';
import type { Family } from './sections.ts';

export const TABLE_FILES: Record<Family, [string, string]> = {
  aisc: ['aisc-sections.csv', 'hss-aisc-sections.csv'],
  eu: ['european-sections.csv', 'hss-european-sections.csv'],
};

export const readTable = (file: string) => readFileSync(new URL(`./sections/${file}`, import.meta.url), 'utf8');

// [I sections, tubes], the two texts loadCatalog() takes
export const readTables = (family: Family) => TABLE_FILES[family].map(readTable) as [string, string];
