// A real test specimen, drawn from its sections instead of a seed.
//
// v1 draws a beam-to-column subassembly: one column, and one or two beams on
// it. That is what the `connection` table of RESSLab Hub describes (99 of its
// 100 tests). fromHubConnection() reads one record of that table, as the hub
// API gives it (numbers, null) or as a row of connections.csv (strings, NA).
//
// No three.js here: this file only needs the section formulas.
import { iSection, rhsSection, type Catalog, type Family, type Section } from './sections.ts';
import type { ConnType } from './steel.ts';

// A name from the section tables ('W14X82', 'HE 300 B', also written
// 'W14x82', 'HEB 300'), a built-up name ('H-700x300x13x24': d x bf x tw x tf),
// or the dimensions in mm.
export type SectionRef = string | { id: string; shape?: 'I' | 'RHS'; d: number; bf: number; tf: number; tw: number };

export type SpecimenBeam = {
  section: SectionRef;
  bearing: 0 | 90 | 180 | 270; // 0 and 180 on the column flanges, 90 and 270 on its web
  length: number; // mm, from the column axis to the beam tip
  at?: number; // mm, beam centre line above the column foot (default: half the column height)
  connection: ConnType; // shear_tab, end_plate, flange_plates or welded
};

export type Specimen = {
  id: string; // the hub id, for example 'Chi_and_Uang_2002_DC2'
  family?: Family; // the section table for section names (default aisc)
  column: { section: SectionRef; height: number };
  beams: SpecimenBeam[]; // [] gives a column alone
  continuity?: boolean; // plates across the column at the beam flanges (default true)
  notes?: string[]; // what we draw differently from the real test, copied into the log
};

export const BEAM_CONNS: ConnType[] = ['shear_tab', 'end_plate', 'flange_plates', 'welded'];

// ------------------------------------------------------------- sections
// table ids and hub names written the same way: W14x82 -> W14X82, HEB 300 -> HE300B
const key = (s: string) => {
  const k = s.toUpperCase().replace(/\s+/g, '');
  const m = /^HE(AA|A|B|C|M)(\d+)$/.exec(k);
  return m ? `HE${m[2]}${m[1]}` : k;
};
// H-700x300x13x24, H500X200X10X16, BH 400x200x8x13: d x bf x tw x tf
const BUILT_UP = /^(?:BH|H|I)?[-\s]*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)$/i;

export function findSection(ref: SectionRef, cat: Catalog): Section {
  if (typeof ref !== 'string') {
    const { id, d, bf, tf, tw } = ref;
    for (const [k, v] of Object.entries({ d, bf, tf, tw }))
      if (!(typeof v === 'number' && v > 0)) throw new Error(`section ${id}: ${k} must be a number above 0, not ${JSON.stringify(v)}`);
    if (2 * tf >= d || (ref.shape !== 'RHS' && tw >= bf)) throw new Error(`section ${id}: the plates are too thick for its size (d ${d}, bf ${bf}, tf ${tf}, tw ${tw})`);
    return ref.shape === 'RHS' ? rhsSection(id, d, bf, tf) : iSection(id, d, bf, tf, tw);
  }
  const k = key(ref);
  const s = cat.all.find((x) => key(x.id) === k);
  if (s) return s;
  const m = BUILT_UP.exec(ref.trim());
  if (m) {
    const [d, bf, tw, tf] = m.slice(1).map(Number);
    return findSection({ id: ref.trim(), d, bf, tf, tw }, cat);
  }
  const other = cat.family === 'aisc' ? 'eu' : 'aisc';
  throw new Error(`section "${ref}" is not in the ${cat.family} table (try the ${other} family, or give its dimensions: { id, d, bf, tf, tw })`);
}

// ------------------------------------------------------------- hub records
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

const MISSING = new Set(['', 'NA', 'NR', 'N/A', 'NULL']);
// the hub turns inches into mm with some float noise (359.9999996): keep 3 decimals
const mm = (x: number) => Math.round(x * 1000) / 1000;

// one record of the hub `connection` table: an API object or a CSV row
export function fromHubConnection(rec: Record<string, unknown>): Specimen {
  const id = String(rec.id ?? rec.specimen_designation ?? 'specimen').trim();
  const value = (f: string) => {
    const v = rec[f];
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && !MISSING.has(v.trim().toUpperCase())) return Number(v);
    return NaN;
  };
  const num = (f: string) => {
    const x = value(f);
    if (!Number.isFinite(x)) throw new Error(`${id}: ${f} is missing (${JSON.stringify(rec[f] ?? null)})`);
    return mm(x);
  };
  const type = String(rec.specimen_type ?? '').trim();
  const sub = /^(Exterior|Interior)\b.*\bSubassembly$/i.exec(type);
  if (!sub) throw new Error(`${id}: specimen type "${type}" is not supported yet (only beam-to-column subassemblies)`);
  const interior = sub[1].toLowerCase() === 'interior';

  // the name when it looks like a section name, else the dimensions
  const section = (name: unknown, d: number, bf: number, tf: number, tw: number): SectionRef => {
    const n = typeof name === 'string' ? name.trim() : '';
    const named = /^[A-Za-z]{1,4}[\s-]?\d/.test(n);
    return { id: named ? n : `H ${d}x${bf}x${tw}x${tf}`, d, bf, tf, tw };
  };
  const column = section(rec.section_c, num('d_c'), num('b_cf'), num('t_cf'), num('t_cw'));
  const beam = section(rec.section_b, num('d_b'), num('b_bf'), num('t_bf'), num('t_bw'));
  const height = num('h_c');
  // l_b: from the column axis to the beam tip for an exterior test, the whole span for an interior one
  const lb = num('l_b');

  const notes: string[] = [];
  const ct = String(rec.connection_type ?? '').trim();
  const [connection, note] = HUB_CONN[ct] ?? ['welded', `connection type "${ct}" is not known, drawn welded`];
  if (note) notes.push(note);
  const ndp = value('n_dp');
  if (ndp > 0) notes.push(`${ndp} doubler plate${ndp > 1 ? 's' : ''} on the column web, not drawn yet`);
  const slab = rec.slab;
  if (slab === true || (typeof slab === 'string' && /^(YES|TRUE)$/i.test(slab.trim()))) notes.push('the concrete slab is not drawn yet');
  const tcp = value('t_cp');

  const beams: SpecimenBeam[] = (interior ? [0, 180] as const : [0] as const).map((bearing) => ({
    section: beam, bearing, length: interior ? lb / 2 : lb, connection,
  }));
  return { id, column: { section: column, height }, beams, continuity: tcp > 0, notes };
}

// a JSON file: our own Specimen, or a hub connection record (it has a specimen_type)
export function toSpecimen(json: unknown): Specimen {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('a specimen must be a JSON object');
  const o = json as Record<string, unknown>;
  if ('specimen_type' in o) return fromHubConnection(o);
  if ('column' in o) return { beams: [], ...(o as Partial<Specimen>) } as Specimen;
  throw new Error('not a specimen: no "column" (a Specimen) and no "specimen_type" (a hub connection record)');
}
