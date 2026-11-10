// The section tables in sections/ (see sections/README.md), and the test
// tables of resslab-hub-data with their response files. Node only: the
// playground imports the section files with Vite `?raw` (app/state.ts), and
// gets the hub tables from the dev server (app/dev-plugin.ts). cli.ts and
// shot.ts read a test here, from the same source as the page.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { protocol, readResponse, responseFile, type Curve, type Protocol } from './deform.ts';
import { DEFORMS } from './deforms.ts';
import { hubTable, type HubRecord } from './hub.ts';
import { parseCsv, type Family } from './sections.ts';

const ROOT = dirname(fileURLToPath(import.meta.url));

// [I sections, tubes]: copies of the resslab-hub tables
export const TABLE_FILES: Record<Family, [string, string]> = {
  aisc: ['aisc-sections.csv', 'hss-aisc-sections.csv'],
  eu: ['european-sections.csv', 'hss-european-sections.csv'],
};

// [channels, angles, round tubes]: our own tables. A separate map, so the
// "vs main" bundle of the playground (app/dev-plugin.ts) can read a base that
// has none. A new table goes last: a base without it just drops it.
export const SHAPE_FILES: Record<Family, [string, string, string]> = {
  aisc: ['channel-aisc-sections.csv', 'angle-aisc-sections.csv', 'chs-aisc-sections.csv'],
  eu: ['channel-european-sections.csv', 'angle-european-sections.csv', 'chs-european-sections.csv'],
};

export const readTable = (file: string) => readFileSync(new URL(`./sections/${file}`, import.meta.url), 'utf8');

// [I sections, tubes, channels, angles, round tubes], the five texts loadCatalog() takes
export const readTables = (family: Family) =>
  [...TABLE_FILES[family], ...SHAPE_FILES[family]].map(readTable) as [string, string, string, string, string];

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
  for (let d = ROOT; ; d = dirname(d)) {
    const here = join(d, 'resslab-hub-data');
    if (existsSync(join(here, HUB_TABLES.connections))) return here;
    if (dirname(d) === d) return undefined;
  }
}

// ---- one test, read from the same source as the page: the hub data, or with
// none, the examples of specimens/ and specimens/responses/
export const rowId = (r: HubRecord) => String(r.id || r.test_id || '?');

export function loadRows(table: string, hubData: string | undefined): HubRecord[] {
  if (hubData) {
    const file = join(hubData, HUB_TABLES[table]);
    if (!existsSync(file)) throw new Error(`no table ${table} in ${hubData}`);
    return parseCsv(readFileSync(file, 'utf8')) as HubRecord[];
  }
  const dir = join(ROOT, 'specimens');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as HubRecord)
    .filter((r) => hubTable(r) === table);
}

// The record of a test. The page gives the first row for an unknown id
// (fetchRecord in app/tests.ts), so a script must look at the id itself.
export function findRecord(table: string, id: string, hubData: string | undefined): HubRecord {
  if (!Object.hasOwn(HUB_TABLES, table)) throw new Error(`no table "${table}": ${Object.keys(HUB_TABLES).join(', ')}`);
  const record = loadRows(table, hubData).find((r) => rowId(r) === id);
  if (!record) throw new Error(`no test "${id}" in the table ${table} (read from ${hubData ?? 'the examples of specimens/'})`);
  return record;
}

// the response files of a test: { folder: curve }, only the ones it has
export function loadCurves(table: string, id: string, hubData: string | undefined): Record<string, Curve> {
  const out: Record<string, Curve> = {};
  for (const s of DEFORMS[table]?.responses ?? []) {
    const file = join(responseDir(table, hubData), s.folder, responseFile(s, id));
    if (existsSync(file)) out[s.folder] = readResponse(readFileSync(file, 'utf8'), s.cols);
  }
  return out;
}

// where loadCurves() looks: one folder for each response file under it
export const responseDir = (table: string, hubData: string | undefined) =>
  hubData ? join(hubData, dirname(HUB_TABLES[table])) : join(ROOT, 'specimens', 'responses', table);

// the steps of a test, or an error that says it has none
export function stepsOf(curves: Record<string, Curve>, what = 'this test'): Protocol {
  try {
    return protocol(curves);
  } catch {
    throw new Error(`no measured response for ${what}, so it has no steps`);
  }
}
