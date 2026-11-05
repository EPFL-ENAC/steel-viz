// The section tables in sections/ (see sections/README.md), and the test
// tables of resslab-hub-data. Node only: the playground imports the section
// files with Vite `?raw` (app/state.ts), and gets the hub tables from the dev
// server (app/dev-plugin.ts).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

// The hub tables we read, and their CSV file in resslab-hub-data. The keys are
// the table names of READERS (hub.ts).
export const HUB_TABLES: Record<string, string> = {
  connections: 'connections/connections.csv',
  braces: 'braces/steel_braces.csv',
  columns: 'columns/steel_columns.csv',
  hss_columns: 'hss_columns/hss_columns.csv',
  eccentric_braced_frames: 'eccentric_braced_frames/eccentric_braced_frames.csv',
};

// The resslab-hub-data folder: the given one, or the first one found next to
// this repo or next to one of its parent folders (for a worktree).
export function findHubData(dir?: string): string | undefined {
  if (dir) return existsSync(dir) ? resolve(dir) : undefined;
  for (let d = dirname(fileURLToPath(import.meta.url)); ; d = dirname(d)) {
    const here = join(d, 'resslab-hub-data');
    if (existsSync(join(here, HUB_TABLES.connections))) return here;
    if (dirname(d) === d) return undefined;
  }
}
