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
import type { BraceSpecimen, ColumnSpecimen, ConnSpecimen, SectionRef, Specimen, SpecimenBeam } from './specimen.ts';

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
const sectionOf = (name: unknown, d: number, bf: number, tf: number, tw: number): SectionRef => {
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
export function fromHubConnection(rec: HubRecord): ConnSpecimen {
  const id = String(rec.id ?? rec.specimen_designation ?? 'specimen').trim();
  const { text, value, num, unsupported } = fields(rec, id);
  const type = text('specimen_type');
  if (!type) throw new Error(`${id}: specimen_type is missing`);
  // "Interior - Column Loaded - Subassembly": the column top is pushed, the beam tips held
  const sub = /^(Exterior|Interior)\b.*\b(Beam|Column) Loaded\b.*\bSubassembly$/i.exec(type);
  if (!sub) throw unsupported('specimen_type');
  const interior = sub[1].toLowerCase() === 'interior';
  const load = sub[2].toLowerCase() as 'beam' | 'column';

  const column = sectionOf(rec.section_c, num('d_c'), num('b_cf'), num('t_cf'), num('t_cw'));
  const beam = sectionOf(rec.section_b, num('d_b'), num('b_bf'), num('t_bf'), num('t_bw'));
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

// ------------------------------------------------------------- braces
const BRACE_ENDS: Record<string, BraceSpecimen['ends']> = { 'Gusset plate': 'gusset', 'Fixed-fixed end': 'fixed', 'Pin-Pin end': 'pin' };
// a double angle name: L152x89x9.5 or 2 L89x64x6.4 (long x short x t), 49.7x3.88 (leg x t)
const ANGLES = /^(?:2\s*)?L?\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)(?:\s*[x×]\s*(\d+(?:\.\d+)?))?$/i;

// one record of the hub `braces` table (steel_braces.csv): one brace, alone
// (SB) or in a frame (SBF, DBF). The section comes from the numbers, except
// for double angles (from the name, the numbers don't mean the same thing in
// every row). In the data t_br is the flange of an I and w_br its web (the
// data dictionary says the other way round).
export function fromHubBrace(rec: HubRecord): BraceSpecimen {
  const id = String(rec.id ?? rec.specimen_ID ?? 'brace').trim();
  const { text, value, num, unsupported } = fields(rec, id);
  const notes: string[] = [];
  const name = text('cross_section_size');
  const shape = text('cross_section_shape');
  let section: SectionRef;
  if (!shape) throw new Error(`${id}: cross_section_shape is missing`);
  else if (shape === 'Rectangular HSS') {
    const [d, bf, t] = [num('d_br'), num('b_br'), num('t_br')];
    section = { id: name || `HSS ${d}x${bf}x${t}`, shape: 'RHS', d, bf, tf: t, tw: t };
  } else if (shape === 'Circular HSS') {
    const [d, t] = [num('d_br'), num('t_br')];
    section = { id: name || `CHS ${d}x${t}`, shape: 'CHS', d, t };
  } else if (shape === 'Round Bar') {
    const d = num('d_br');
    section = { id: name || `RB ${d}`, shape: 'ROD', d };
  } else if (shape === 'I-shaped') {
    const [d, bf, tf, tw] = [num('d_br'), num('b_br'), num('t_br'), num('w_br')];
    const tee = /^WT/i.test(name);
    if (tee) notes.push(`${name} is a tee, drawn as a tee (cross_section_shape says I-shaped)`);
    section = { id: name || `H ${d}x${bf}x${tw}x${tf}`, shape: tee ? 'T' : 'I', d, bf, tf, tw };
  } else if (shape === 'Double Angle') {
    const m = ANGLES.exec(name);
    let [long, short, t] = m ? (m[3] ? [m[1], m[2], m[3]] : [m[1], m[1], m[2]]).map(Number) : [NaN, NaN, NaN];
    if (!m) {
      // no name to read: the long leg in d_br, both short legs in b_br
      [long, short, t] = [num('d_br'), num('b_br') / 2, num('t_br')];
      notes.push(`double angle sizes from d_br and b_br (the name "${name}" does not read)`);
    } else if (Number.isFinite(value('t_br')) && Math.abs(value('t_br') - t) > 0.05)
      notes.push(`t_br ${value('t_br')} does not match the name ${name}, drawn ${t} thick`);
    section = { id: m ? `2L${name.replace(/^(?:2\s*)?L?\s*/i, '')}` : `2L ${long}x${short}x${t}`, shape: '2L', d: long, b: short, t };
  } else throw unsupported('cross_section_shape');

  const length = num('l_b');
  const c = value('l_b_clear');
  let angle = value('brace_angle');
  if (!Number.isFinite(angle)) {
    angle = 45;
    notes.push('brace_angle is not given, drawn at 45°');
  } else if (!(angle > 0 && angle < 90)) throw unsupported('brace_angle');
  let frame = text('configuration').toUpperCase();
  if (!frame) {
    frame = 'SB';
    notes.push('configuration is not given, drawn as a single brace (SB)');
  } else if (frame !== 'SB' && frame !== 'SBF' && frame !== 'DBF') throw unsupported('configuration');
  const bc = text('boundary_condition');
  if (!bc) throw new Error(`${id}: boundary_condition is missing`);
  const ends = BRACE_ENDS[bc];
  if (!ends) throw unsupported('boundary_condition');
  // the plate thickness. Some rows have the end type there instead.
  const plate = (f: string) => {
    const x = value(f);
    if (x > 0) return mm(x);
    if (text(f) && !Number.isFinite(x)) notes.push(`${f} says "${text(f)}", not a thickness (the ends follow boundary_condition "${bc}")`);
    return undefined;
  };
  const [top, bottom] = [plate('t_t'), plate('t_b')];
  if (ends === 'gusset') notes.push('the gussets have a generic outline: l_1t to l_8b are not used');
  return {
    test: 'brace', id, section, length, ...(Number.isFinite(c) ? { clear: mm(c) } : {}), angle, ends,
    plates: { top, bottom }, frame: frame as BraceSpecimen['frame'], notes,
  };
}

// ------------------------------------------------------------- columns
const COLUMN_ENDS: Record<string, ColumnSpecimen['ends']> = { 'Fixed-Free': 'fixed-free', 'Fixed-Fixed': 'fixed-fixed', 'Fixed-Flexible': 'fixed-flexible' };
const BENDING: Record<string, number> = { Strong: 0, Weak: 90, 'Bi-axial': 45 };

// one record of the hub `columns` table (steel_columns.csv): one I column.
// The section comes from the numbers (the name is often "Built Up S10").
// Careful: h_c is the web height here, l_c the column length.
export function fromHubColumn(rec: HubRecord): ColumnSpecimen {
  const id = String(rec.id ?? rec.specimen_designation ?? 'column').trim();
  const { text, value, num, unsupported } = fields(rec, id);
  const notes: string[] = [];
  const section = sectionOf(rec.section_c, num('d_c'), num('b_cf'), num('t_cf'), num('t_cw'));
  const length = num('l_c');
  const bc = text('boundary_condition');
  if (!bc) throw new Error(`${id}: boundary_condition is missing`);
  const ends = COLUMN_ENDS[bc];
  if (!ends) throw unsupported('boundary_condition');
  if (ends === 'fixed-flexible') notes.push('Fixed-Flexible: the spring that holds the top is not drawn, the top is drawn like Fixed-Free');
  const ax = text('axis_of_bending');
  if (!ax) throw new Error(`${id}: axis_of_bending is missing`);
  const angle = BENDING[ax];
  if (angle === undefined) throw unsupported('axis_of_bending');
  if (ax === 'Bi-axial') notes.push('Bi-axial: the table has no loading angle, drawn at 45°');
  if (/horizontal configuration/i.test(text('test_procedure'))) notes.push('tested lying down, drawn standing');
  const plate = (f: string) => (value(f) > 0 ? mm(value(f)) : undefined);
  return { test: 'column', id, section, length, ends, angle, plates: { top: plate('t_top_plate'), bottom: plate('t_bottom_plate') }, notes };
}

// ------------------------------------------------------------- any record
// a JSON object: our own Specimen, or a hub record (the reader is picked from
// a field only its table has)
export function toSpecimen(json: unknown): Specimen {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('a specimen must be a JSON object');
  const o = json as HubRecord;
  if ('specimen_type' in o) return fromHubConnection(o);
  if ('brace_angle' in o) return fromHubBrace(o);
  if ('axis_of_bending' in o) return fromHubColumn(o);
  if (o.test === 'brace') return o as BraceSpecimen;
  if (o.test === 'column') return o as ColumnSpecimen;
  if (o.test !== undefined && o.test !== 'connection') throw new Error(`test "${String(o.test)}" is not known (connection, brace or column)`);
  if ('column' in o) return { beams: [], ...(o as Partial<ConnSpecimen>) } as ConnSpecimen;
  throw new Error('not a specimen: no "column" or "test" (a Specimen), no "specimen_type", "brace_angle" or "axis_of_bending" (a hub record)');
}
