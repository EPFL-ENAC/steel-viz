// Read the records of the RESSLab Hub test tables (resslab-hub-data) as a
// Specimen. A record is an object of the hub API (numbers, null) or a row of
// the CSV file (strings, NA): both read the same.
//
// An error always names the field, in one of two forms, so hub-count.ts can
// group them:
//   `${id}: ${field} is missing`
//   `${id}: ${field} "${value}" is not supported yet`
//
// No three.js and no Node API here: index.ts exports it.
import type { ConnType } from './steel.ts';
import type { SectionRef, Specimen, SpecimenBeam } from './specimen.ts';

export type HubRecord = Record<string, unknown>;

const MISSING = new Set(['', 'NA', 'NR', 'N/A', 'NULL']);
// the hub turns inches into mm with some float noise (359.9999996): keep 3 decimals
const mm = (x: number) => Math.round(x * 1000) / 1000;

// The fields of one record. value: a number, NaN when missing. num: a number
// in mm, or an error. text: a trimmed string, '' when missing.
function fields(rec: HubRecord, id: string) {
  const text = (f: string) => {
    const v = rec[f];
    if (typeof v === 'number') return String(v);
    return typeof v === 'string' && !MISSING.has(v.trim().toUpperCase()) ? v.trim() : '';
  };
  const value = (f: string) => {
    const v = rec[f];
    if (typeof v === 'number') return v;
    const t = text(f);
    return t ? Number(t) : NaN;
  };
  const num = (f: string) => {
    const x = value(f);
    if (!Number.isFinite(x)) throw new Error(`${id}: ${f} is missing`);
    return mm(x);
  };
  const unsupported = (f: string) => new Error(`${id}: ${f} "${text(f)}" is not supported yet`);
  return { text, value, num, unsupported };
}

// the name when it looks like a section name, else the dimensions
const section = (name: unknown, d: number, bf: number, tf: number, tw: number): SectionRef => {
  const n = typeof name === 'string' ? name.trim() : '';
  const named = /^[A-Za-z]{1,4}[\s-]?\d/.test(n);
  return { id: named ? n : `H ${d}x${bf}x${tw}x${tf}`, d, bf, tf, tw };
};

// ------------------------------------------------------------- connections
// connection_type in the hub: what we draw for it, and what it leaves out
const HUB_CONN: Record<string, [ConnType, string?]> = {
  'WUF-W': ['welded'],
  'WUF-B': ['welded', 'WUF-B: the bolted shear tab on the beam web is not drawn yet'],
  RBS: ['welded', 'RBS: the cut in the beam flanges is not drawn yet'],
  BFP: ['flange_plates'],
  WFP: ['flange_plates', 'WFP: the flange plates are welded, drawn bolted'],
  BEEP: ['end_plate'],
  KBB: ['flange_plates', 'KBB: the Kaiser bracket is drawn as bolted flange plates'],
};

// one record of the hub `connection` table (connections.csv): one column and
// one or two beams
export function fromHubConnection(rec: HubRecord): Specimen {
  const id = String(rec.id ?? rec.specimen_designation ?? 'specimen').trim();
  const { text, value, num, unsupported } = fields(rec, id);
  const type = text('specimen_type');
  if (!type) throw new Error(`${id}: specimen_type is missing`);
  // "Interior - Column Loaded - Subassembly": the column top is pushed, the beam tips held
  const sub = /^(Exterior|Interior)\b.*\b(Beam|Column) Loaded\b.*\bSubassembly$/i.exec(type);
  if (!sub) throw unsupported('specimen_type');
  const interior = sub[1].toLowerCase() === 'interior';
  const load = sub[2].toLowerCase() as 'beam' | 'column';

  const column = section(rec.section_c, num('d_c'), num('b_cf'), num('t_cf'), num('t_cw'));
  const beam = section(rec.section_b, num('d_b'), num('b_bf'), num('t_bf'), num('t_bw'));
  const height = num('h_c');
  // l_b: from the column axis to the beam tip for an exterior test, the whole span for an interior one
  const lb = num('l_b');

  const notes: string[] = [];
  const ct = text('connection_type');
  const [connection, note] = HUB_CONN[ct] ?? ['welded', `connection type "${ct}" is not known, drawn welded`];
  if (note) notes.push(note);
  const ndp = value('n_dp');
  if (ndp > 0) notes.push(`${ndp} doubler plate${ndp > 1 ? 's' : ''} on the column web, not drawn yet`);
  const slab = rec.slab;
  if (slab === true || /^(YES|TRUE)$/i.test(text('slab'))) notes.push('the concrete slab is not drawn yet');
  const tcp = value('t_cp');

  const beams: SpecimenBeam[] = (interior ? [0, 180] as const : [0] as const).map((bearing) => ({
    section: beam, bearing, length: interior ? lb / 2 : lb, connection,
  }));
  return { id, column: { section: column, height }, beams, continuity: tcp > 0, load, notes };
}

// ------------------------------------------------------------- any record
// a JSON object: our own Specimen, or a hub record (the reader is picked from
// a field only its table has)
export function toSpecimen(json: unknown): Specimen {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('a specimen must be a JSON object');
  const o = json as HubRecord;
  if ('specimen_type' in o) return fromHubConnection(o);
  if ('column' in o) return { beams: [], ...(o as Partial<Specimen>) } as Specimen;
  throw new Error('not a specimen: no "column" (a Specimen) and no "specimen_type" (a hub connection record)');
}
