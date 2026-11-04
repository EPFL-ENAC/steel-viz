// How many tests of each RESSLab Hub table we can draw. Node only: the core
// never imports it.
//
//   node hub-count.ts [path/to/resslab-hub-data]
//
// Without a path, it looks for a resslab-hub-data folder next to this repo
// (or next to one of its parent folders, for a worktree). For each table it
// reads the CSV, reads each row as a Specimen (hub.ts), runs generate(), and
// checks the clashes and the floating parts. The errors are grouped by field.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, loadCatalog, type Catalog } from './sections.ts';
import { floating, generate } from './generate.ts';
import { clashes } from './clash.ts';
import { readTables } from './tables.ts';
import { toSpecimen } from './hub.ts';

// the tables we read, and their CSV file in resslab-hub-data
export const HUB_TABLES: Record<string, string> = {
  connections: 'connections/connections.csv',
  braces: 'braces/steel_braces.csv',
};

export function findHubData(dir?: string): string | undefined {
  if (dir) return existsSync(dir) ? resolve(dir) : undefined;
  for (let d = dirname(fileURLToPath(import.meta.url)); ; d = dirname(d)) {
    const here = join(d, 'resslab-hub-data');
    if (existsSync(join(here, HUB_TABLES.connections))) return here;
    if (dirname(d) === d) return undefined;
  }
}

// One table. drawn: the rows that read and give parts. stuck: drawn, but the
// solver finds a mechanism. errors: the rows that don't read, by kind of error
// (the id taken out, so the same field groups).
export type Count = {
  table: string; rows: number; drawn: number; stuck: string[]; clash: string[]; floating: string[];
  errors: Map<string, string[]>;
};

export const errorKind = (msg: string) =>
  /: (\w+) is missing$/.exec(msg)?.[1].concat(' is missing') ??
  /: (\w+ ".*" is not supported yet)$/s.exec(msg)?.[1] ??
  `other: ${msg}`;

export function countTable(dir: string, table: string, cat: Catalog): Count {
  const rows = parseCsv(readFileSync(join(dir, HUB_TABLES[table]), 'utf8'));
  const c: Count = { table, rows: rows.length, drawn: 0, stuck: [], clash: [], floating: [], errors: new Map() };
  for (const row of rows) {
    let id = row.id || row.test_id || '?';
    try {
      const spec = toSpecimen(row);
      id = spec.id;
      const r = generate({ specimen: spec }, cat);
      c.drawn++;
      if (!r.ok) c.stuck.push(id);
      if (clashes(r.parts).length) c.clash.push(id);
      if (floating(r.parts).length) c.floating.push(id);
    } catch (e) {
      const k = errorKind((e as Error).message);
      c.errors.set(k, [...(c.errors.get(k) ?? []), id]);
    }
  }
  return c;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = findHubData(process.argv[2]);
  if (!dir) {
    console.error(`no resslab-hub-data folder${process.argv[2] ? ` at ${process.argv[2]}` : ' found'}`);
    process.exit(1);
  }
  const cat = loadCatalog('aisc', ...readTables('aisc'));
  const ids = (l: string[]) => (l.length ? ` (${l.slice(0, 5).join(', ')}${l.length > 5 ? ', ...' : ''})` : '');
  for (const table of Object.keys(HUB_TABLES)) {
    const c = countTable(dir, table, cat);
    console.log(`${table}: ${c.drawn} / ${c.rows} drawn, ${c.stuck.length} mechanism, ${c.clash.length} clash, ${c.floating.length} floating`);
    for (const [k, l] of [['mechanism', c.stuck], ['clash', c.clash], ['floating', c.floating]] as const) if (l.length) console.log(`  ${k}:${ids(l)}`);
    for (const [k, l] of [...c.errors].sort((a, b) => b[1].length - a[1].length)) console.log(`  ${k}: ${l.length}${ids(l)}`);
  }
}
