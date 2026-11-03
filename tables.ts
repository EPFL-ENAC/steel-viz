// The section tables in sections/ (see sections/README.md). Node only: the
// playground imports the same files with Vite `?raw` (app/state.ts).
import { readFileSync } from 'node:fs';
import type { Family } from './sections.ts';

// [I sections, tubes]: copies of the resslab-hub tables
export const TABLE_FILES: Record<Family, [string, string]> = {
  aisc: ['aisc-sections.csv', 'hss-aisc-sections.csv'],
  eu: ['european-sections.csv', 'hss-european-sections.csv'],
};

// [channels, angles]: our own tables. A separate map, so the "vs main" bundle
// of the playground (app/dev-plugin.ts) can read a base that has none.
export const SHAPE_FILES: Record<Family, [string, string]> = {
  aisc: ['channel-aisc-sections.csv', 'angle-aisc-sections.csv'],
  eu: ['channel-european-sections.csv', 'angle-european-sections.csv'],
};

export const readTable = (file: string) => readFileSync(new URL(`./sections/${file}`, import.meta.url), 'utf8');

// [I sections, tubes, channels, angles], the four texts loadCatalog() takes
export const readTables = (family: Family) =>
  [...TABLE_FILES[family], ...SHAPE_FILES[family]].map(readTable) as [string, string, string, string];
