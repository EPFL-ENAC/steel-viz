// The hub tests: where they come from, and the test on show. The one place
// that fetches a test (fetchRecord), with its response files.
//
// - In the dev server, app/dev-plugin.ts serves the tables of resslab-hub-data
//   (/__dev/hub). We read every row with toSpecimen() (hub.ts) at load, so the
//   rail can say how many rows read.
// - With no hub data (a static build, or no resslab-hub-data folder), only the
//   example records of specimens/, grouped by their table, and their response
//   files in specimens/responses/.
//
// The URL key `specimen` (app/state.ts) says which test: '<table>/<id>',
// '<table>' (its first test), or 'paste' (the record pasted in the rail, kept
// in this browser). '' is the seed.
import { reactive, ref, shallowRef, watch } from 'vue';
import { readResponse, responseFile, type Curve } from '../deform.ts';
import { DEFORMS } from '../deforms.ts';
import { READERS, hubTable, toSpecimen, type HubRecord } from '../hub.ts';
import { parseCsv } from '../sections.ts';
import type { SectionRef, Specimen } from '../specimen.ts';
import { CONNS } from '../steel.ts';
import { s } from './state.ts';

export const TABLES = READERS.map(([t]) => t);
export const LABELS: Record<string, string> = {
  connections: 'Connections',
  braces: 'Braces',
  columns: 'Columns',
  hss_columns: 'HSS columns',
  eccentric_braced_frames: 'EBF links',
};

// one row of a table: the record, and what the reader makes of it
export type Row = { id: string; name: string; record: HubRecord; spec?: Specimen; error?: string };

function readRow(record: HubRecord): Row {
  const id = String(record.id || record.test_id || '?');
  // EBF ids are numbers: also the investigator, the year and the specimen name
  const name = record.investigator && record.spec_id ? `${record.investigator} ${record.year ?? ''}, ${record.spec_id}`.replace(' ,', ',') : '';
  try {
    return { id, name, record, spec: toSpecimen(record) };
  } catch (e) {
    return { id, name, record, error: (e as Error).message };
  }
}

// ---- where the tests come from
export type Source = { kind: 'hub' | 'examples'; tables: string[]; note: string };

const EXAMPLES = import.meta.glob('../specimens/*.json', { eager: true, import: 'default' }) as Record<string, HubRecord>;
const examples = (table: string) => Object.values(EXAMPLES).filter((r) => hubTable(r) === table);

let sourceLoad: Promise<Source> | null = null;
export const source = () =>
  (sourceLoad ??= fetch('/__dev/hub')
    .then((r) => (r.ok && r.headers.get('content-type')?.includes('json') ? r.json() : null))
    .catch(() => null)
    .then((d: { tables: string[] } | null): Source => {
      if (d?.tables.length) return { kind: 'hub', tables: TABLES.filter((t) => d.tables.includes(t)), note: '' };
      const n = Object.keys(EXAMPLES).length;
      return {
        kind: 'examples',
        tables: TABLES.filter((t) => examples(t).length),
        note: d
          ? `No resslab-hub-data folder next to this repo or its parent folders: only the ${n} examples of specimens/.`
          : `This build has no hub data, only the ${n} examples of specimens/. Run pnpm dev next to a resslab-hub-data folder to walk all the tests.`,
      };
    }));

// ---- the tables, read once
// rows and read: for the table select of the rail
export const counts = reactive<Record<string, { rows: number; read: number }>>({});
const tables = new Map<string, Promise<Row[]>>();
const loaded = new Map<string, Row[]>();

export function loadTable(table: string): Promise<Row[]> {
  if (!tables.has(table)) {
    const p = source()
      .then(async (src) => {
        if (!src.tables.includes(table)) throw new Error(`no hub table "${table}"${src.kind === 'examples' ? ' in the examples' : ''}`);
        if (src.kind === 'examples') return examples(table);
        const r = await fetch(`/__dev/hub/${table}`);
        if (!r.ok) throw new Error(`the dev server gave ${r.status} for the table ${table}`);
        return parseCsv(await r.text());
      })
      .then((records) => {
        const rows = records.map(readRow); // in the order of the CSV, as the hub lists them
        loaded.set(table, rows);
        counts[table] = { rows: rows.length, read: rows.filter((r) => r.spec).length };
        return rows;
      });
    p.catch(() => tables.delete(table)); // try again next time
    tables.set(table, p);
  }
  return tables.get(table)!;
}
// ---- the response files of a test: { folder: curve }, only the ones it has
const RESPONSES = import.meta.glob('../specimens/responses/**/*.csv', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>;
async function responseTexts(table: string, id: string): Promise<Record<string, string>> {
  if ((await source()).kind === 'hub') {
    const r = await fetch(`/__dev/hub/${table}/responses/${encodeURIComponent(id)}`);
    return r.ok ? r.json() : {};
  }
  const out: Record<string, string> = {};
  for (const spec of DEFORMS[table].responses) {
    const load = RESPONSES[`../specimens/responses/${table}/${spec.folder}/${responseFile(spec, id)}`];
    if (load) out[spec.folder] = await load();
  }
  return out;
}
async function fetchResponses(table: string, id: string): Promise<Record<string, Curve>> {
  if (!Object.hasOwn(DEFORMS, table)) return {};
  try {
    const texts = await responseTexts(table, id);
    const cols = (folder: string) => DEFORMS[table].responses.find((s) => s.folder === folder)?.cols;
    return Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, readResponse(v, cols(k))]));
  } catch {
    return {}; // a test with no response draws as before
  }
}

// The one place that fetches a test: its row, where it is in its table, and
// its response files. An unknown id gives the first row.
export async function fetchRecord(table: string, id: string): Promise<{ row: Row; index: number; rows: Row[]; responses: Record<string, Curve> }> {
  const rows = await loadTable(table);
  if (!rows.length) throw new Error(`the table ${table} is empty`);
  const index = Math.max(0, rows.findIndex((r) => r.id === id));
  return { row: rows[index], index, rows, responses: await fetchResponses(table, rows[index].id) };
}

// ---- the pasted record, kept in this browser
const PASTE = 'steel-viz.paste';
function savedPaste() {
  try {
    return localStorage.getItem(PASTE) ?? '';
  } catch {
    return '';
  }
}
export const pasted = ref(savedPaste());
watch(pasted, (v) => {
  try { localStorage.setItem(PASTE, v); } catch {}
});

// ---- the test on show
export type Current = {
  key: string; // the value of s.specimen it comes from
  table: string; // a table name, or 'paste'
  id: string;
  name: string;
  index: number; // in rows
  rows: Row[]; // the table ([] for paste)
  record?: unknown; // what the reader takes
  spec?: Specimen; // what it gives
  error?: string; // why there is no spec
  responses?: Record<string, Curve>; // its measured response files
};
export const current = shallowRef<Current | null>(null);

function readPaste(text: string): Current {
  const c: Current = { key: 'paste', table: 'paste', id: '', name: '', index: 0, rows: [] };
  if (!text.trim()) return { ...c, error: 'Paste a record to draw it.' };
  let record: unknown;
  try {
    record = JSON.parse(text);
  } catch (e) {
    return { ...c, error: `not JSON: ${(e as Error).message}` };
  }
  try {
    const spec = toSpecimen(record);
    return { ...c, id: spec.id, record, spec };
  } catch (e) {
    return { ...c, record, error: (e as Error).message };
  }
}

async function resolveKey(key: string): Promise<Current> {
  if (key === 'paste') return readPaste(pasted.value);
  const [table, ...rest] = key.split('/');
  const id = rest.join('/');
  try {
    const { row, index, rows, responses } = await fetchRecord(table, id);
    return { key: `${table}/${row.id}`, table, id: row.id, name: row.name, index, rows, record: row.record, spec: row.spec, error: row.error, responses };
  } catch (e) {
    return { key, table, id, name: '', index: 0, rows: [], error: (e as Error).message };
  }
}

let token = 0;
watch(
  () => [s.specimen, s.specimen === 'paste' ? pasted.value : ''] as const,
  async ([key]) => {
    const t = ++token;
    if (!key) return void (current.value = null);
    if (key === current.value?.key && key !== 'paste') return; // the hash fix below
    const c = await resolveKey(key);
    if (t !== token) return; // a newer test was asked meanwhile
    current.value = c;
    // '<table>' alone, or an unknown id: say in the hash which test it is
    if (c.key !== key) s.specimen = c.key;
  },
  { immediate: true },
);

// the previous or the next test of the table; stops at the ends
export function step(d: number) {
  const c = current.value;
  const row = c?.rows[c.index + d];
  if (row) s.specimen = `${c!.table}/${row.id}`;
}

// Seed or hub test. Back to the hub test: the last one of this visit.
let last = '';
watch(() => s.specimen, (v) => v && (last = v), { immediate: true });
export function setMode(hub: boolean) {
  s.specimen = hub ? last || TABLES[0] : '';
}

// ---- what the reader made of a test, for the rail
const sec = (x: SectionRef) => (typeof x === 'string' ? x : x.id);
const mm = (x: number) => `${Math.round(x)} mm`;
const FRAMES = { SB: 'the brace alone (SB)', SBF: 'one bay frame (SBF)', DBF: 'two braces in an X (DBF)' };

export function keyFields(spec: Specimen): [string, string][] {
  const tables: [string, string] = ['Sections', (spec.family ?? 'aisc').toUpperCase()];
  if (spec.test === 'brace') {
    const p = spec.plates;
    return [
      ['Test', 'brace'],
      ['Section', sec(spec.section)],
      ['Frame', FRAMES[spec.frame] ?? spec.frame],
      ['Ends', spec.ends + (p?.top || p?.bottom ? `, plates ${[p.top, p.bottom].filter(Boolean).map((t) => mm(t!)).join(' / ')}` : '')],
      ['Length', mm(spec.length) + (spec.clear ? `, ${mm(spec.clear)} clear` : '')],
      ['Angle', `${spec.angle}°`],
      tables,
    ];
  }
  if (spec.test === 'column')
    return [
      ['Test', 'column'],
      ['Section', sec(spec.section)],
      ['Ends', spec.ends],
      ['Length', mm(spec.length)],
      ['Angle', `${spec.angle}° from the web`],
      ['Axial load', spec.axial === false ? 'no' : 'yes'],
      tables,
    ];
  if (spec.test === 'link') {
    const st = spec.stiffeners;
    return [
      ['Test', 'EBF link'],
      ['Section', sec(spec.section)],
      ['Config', `${spec.config}, link at the ${spec.at}`],
      ['Ends', (spec.ends ?? 'welded') + (spec.endPlate ? `, end plate ${mm(spec.endPlate)}` : '')],
      ['e', mm(spec.e)],
      ['Stiffeners', `${st.front.length} front, ${st.back.length} back${st.t ? `, ${mm(st.t)}` : ''}`],
      ...(spec.frame ? [['Frame', `${mm(spec.frame.span)} × ${mm(spec.frame.height)}`] as [string, string]] : []),
      tables,
    ];
  }
  const beams = spec.beams.map((b) => `${sec(b.section)}, ${mm(b.length)}`);
  const conns = [...new Set(spec.beams.map((b) => CONNS[b.connection]?.label ?? b.connection))];
  return [
    ['Test', 'beam-to-column'],
    ['Column', `${sec(spec.column.section)}, ${mm(spec.column.height)} high`],
    ['Beams', beams.length ? (new Set(beams).size === 1 ? `${beams.length} × ${beams[0]}` : beams.join(' + ')) : 'none, a column alone'],
    ...(conns.length ? [['Connection', conns.join(', ')] as [string, string]] : []),
    ['Loaded at', spec.load === 'column' ? 'the column top' : 'the beam tips'],
    ['Continuity plates', spec.continuity === false ? 'no' : 'yes'],
    tables,
  ];
}
