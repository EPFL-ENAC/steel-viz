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
import { HAUNCH_NOTE, hubHaunch } from './haunch.ts';
import { FRAME_TESTS } from './frame.ts';
import { hubRbs } from './rbs.ts';
import { SLAB_NOTE } from './slab.ts';
import { LINK_CONFIGS, type BraceSpecimen, type ColumnSpecimen, type ConnSpecimen, type LinkSpecimen, type SectionRef, type Specimen, type SpecimenBeam } from './specimen.ts';

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
  'WUF-B': ['welded_tab'],
  RBS: ['welded'],
  BFP: ['flange_plates'],
  WFP: ['welded_plates'],
  BEEP: ['end_plate'],
  KBB: ['welded_haunch', HAUNCH_NOTE],
};

// one record of the hub `connection` table (connections.csv): one column and
// one or two beams
export function fromHubConnection(rec: HubRecord): ConnSpecimen {
  const id = String(rec.id ?? rec.specimen_designation ?? 'specimen').trim();
  const { text, value, num, unsupported } = fields(rec, id);
  const type = text('specimen_type');
  if (!type) throw new Error(`${id}: specimen_type is missing`);
  if (/^(Exterior|Interior) - Frame$/i.test(type)) return fromHubFrame(rec, id);
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
  // Some exterior tests give the whole span in l_b. Then l_o (the shear span from
  // the column face) is about half of l_fc, and the beam ends at l_o from the face.
  // A missing l_o or l_fc gives NaN: the test is false and l_b stays.
  const [lo, lfc] = [value('l_o'), value('l_fc')];
  const exterior = lo < 0.7 * lfc ? mm(num('d_c') / 2 + lo) : lb;

  const notes: string[] = [];
  const ct = text('connection_type');
  const [connection, note] = HUB_CONN[ct] ?? ['welded', `connection type "${ct}" is not known, drawn welded`];
  if (note) notes.push(note);
  const cut = ct === 'RBS' ? hubRbs(num('b_bf'), num('d_b'), value('b_bf_rbs'), value('rbs_cut')) : undefined;
  if (cut) notes.push(cut.note);
  const plates = ct === 'WFP' ? { tPlate: num('t_pl') } : {};
  const haunch = ct === 'KBB' ? { haunch: hubHaunch(mm(num('d_h')), mm(num('s_h')), text('comments')) } : {};
  // doubler plates: t_dp is one plate, wd its width
  const ndp = value('n_dp');
  if (ndp > 0 && ndp !== 1 && ndp !== 2) throw unsupported('n_dp');
  const doubler = ndp > 0 ? { n: ndp as 1 | 2, t: num('t_dp'), ...(Number.isFinite(value('wd')) ? { w: num('wd') } : {}) } : undefined;
  const slab = hubSlab(rec, id, notes);
  // t_cp 0: no continuity plates. NA: plates as thick as the column flange (generate.ts)
  const tcp = value('t_cp');
  if (!Number.isFinite(tcp)) notes.push('t_cp is not reported, the continuity plates are as thick as the column flange');
  const continuity = tcp > 0 ? { continuity: true, tContinuity: mm(tcp) } : { continuity: !(tcp <= 0) };

  const beams: SpecimenBeam[] = (interior ? [0, 180] as const : [0] as const).map((bearing) => ({
    section: beam, bearing, length: interior ? lb / 2 : exterior, connection, ...(cut?.rbs ? { rbs: cut.rbs } : {}), ...plates, ...haunch,
  }));
  return { id, column: { section: column, height }, beams, ...continuity, load, notes, ...(doubler ? { doubler } : {}), ...(slab ? { slab } : {}) };
}

// A frame test: the row gives the joint at the first column, FRAME_TESTS
// (frame.ts) the rest, from the report of the test. l_b is the bay, between
// the column axes.
function fromHubFrame(rec: HubRecord, id: string): ConnSpecimen {
  const { text, value, num, unsupported } = fields(rec, id);
  const ft = FRAME_TESTS[id];
  if (!ft) throw unsupported('specimen_type');
  const notes: string[] = [];
  const column = sectionOf(rec.section_c, num('d_c'), num('b_cf'), num('t_cf'), num('t_cw'));
  const beam = sectionOf(rec.section_b, num('d_b'), num('b_bf'), num('t_bf'), num('t_bw'));
  const ct = text('connection_type');
  const [connection, note] = HUB_CONN[ct] ?? ['welded', `connection type "${ct}" is not known, drawn welded`];
  if (note) notes.push(note);
  const cut = ct === 'RBS' ? hubRbs(num('b_bf'), num('d_b'), value('b_bf_rbs'), value('rbs_cut')) : undefined;
  if (cut) notes.push(cut.note);
  if (ct === 'WFP' || ct === 'KBB') throw unsupported('connection_type');
  const ndp = value('n_dp');
  if (ndp > 0 && ndp !== 1 && ndp !== 2) throw unsupported('n_dp');
  const doubler = ndp > 0 ? { n: ndp as 1 | 2, t: num('t_dp'), ...(Number.isFinite(value('wd')) ? { w: num('wd') } : {}) } : undefined;
  const slab = hubSlab(rec, id, notes);
  const tcp = value('t_cp');
  if (!Number.isFinite(tcp)) notes.push('t_cp is not reported, the continuity plates are as thick as the column flange');
  const continuity = tcp > 0 ? { continuity: true, tContinuity: mm(tcp) } : { continuity: !(tcp <= 0) };
  // the girder top of steel is under the slab, the beam axis under it
  const at = mm(ft.top - (slab ? slab.concrete + slab.rib : 0) - num('d_b') / 2);
  const one = { section: beam, bearing: 0 as const, at, connection, ...(cut?.rbs ? { rbs: cut.rbs } : {}) };
  const beams: SpecimenBeam[] = [{ ...one, length: num('l_b') }, ...(ft.overhang > 0 ? [{ ...one, length: ft.overhang }] : [])];
  return {
    id, column: { section: column, height: ft.height }, beams, ...continuity, notes: [...notes, ...ft.notes],
    ...(doubler ? { doubler } : {}), ...(slab ? { slab } : {}), frame: ft.frame,
  };
}

// The concrete slab of a connection record. The data writes "perpenticular".
// With a size missing, the test keeps its steel and gets a note.
function hubSlab(rec: HubRecord, id: string, notes: string[]): ConnSpecimen['slab'] {
  const { text, value, num, unsupported } = fields(rec, id);
  if (rec.slab !== true && !/^(YES|TRUE)$/i.test(text('slab'))) return undefined;
  const orientation = text('deck_ribs_orientation').toLowerCase();
  if (orientation && !/^(parallel|perpendicular|perpenticular)$/.test(orientation)) throw unsupported('deck_ribs_orientation');
  if (!orientation || !['w_l', 'w_r', 'h_co', 'h_p', 'b_o'].every((f) => value(f) > 0)) {
    notes.push('the slab sizes are missing, the slab is not drawn');
    return undefined;
  }
  notes.push(SLAB_NOTE);
  return { left: num('w_l'), right: num('w_r'), concrete: num('h_co'), rib: num('h_p'), ribWidth: num('b_o'), ribs: orientation === 'parallel' ? 'parallel' : 'perpendicular' };
}

// ------------------------------------------------------------- braces
const BRACE_ENDS: Record<string, BraceSpecimen['ends']> = { 'Gusset plate': 'gusset', 'Fixed-fixed end': 'fixed', 'Pin-Pin end': 'pin' };
// a double angle name: L152x89x9.5 or 2 L89x64x6.4 (long x short x t), 49.7x3.88 (leg x t)
const ANGLES = /^(?:2\s*)?L?\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)(?:\s*[x×]\s*(\d+(?:\.\d+)?))?$/i;

// A double channel. The columns don't mean the same thing in every row. The
// reading closest to `area` is not always right: on Lehman_Roeder_HSS29 it
// swaps the flange and the web. So, in this order:
// - no w_br: t_br is the two flanges, b_br the pair, the web comes from area
// - else the flange is the thicker of t_br and w_br (always, for a channel),
//   and area only says if b_br is one channel or the pair
function doubleChannel(rec: HubRecord, id: string, notes: string[]): SectionRef {
  const { text, value, num, unsupported } = fields(rec, id);
  const [d, width, t, area] = [num('d_br'), num('b_br'), num('t_br'), num('area')];
  const w = value('w_br');
  let [b, tf, tw] = [width / 2, t / 2, 0];
  if (!Number.isFinite(w)) {
    tw = mm((area / 2 - 2 * b * tf) / (d - 2 * tf));
    if (!(tw > 0)) throw unsupported('area');
    notes.push(`no w_br: t_br ${t} read as two flanges, b_br ${width} as the pair, the web ${tw} mm from area`);
  } else {
    [tf, tw] = t >= w ? [t, mm(w)] : [mm(w), t];
    if (t < w) notes.push(`t_br ${t} read as the web and w_br ${w} as the flange (a flange is the thicker one)`);
    const areaOf = (x: number) => 2 * (2 * x * tf + (d - 2 * tf) * tw);
    if (Math.abs(areaOf(width) - area) <= Math.abs(areaOf(b) - area)) b = width;
    else notes.push(`b_br ${width} read as the width of the pair (from area)`);
  }
  if (value('stick_space') > 0) notes.push(`stick_space ${value('stick_space')} mm: the stitches are not drawn`);
  return { id: text('cross_section_size') || `2C ${d}x${b}x${tf}x${tw}`, shape: '2C', d, b, tf, tw };
}

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
  } else if (shape === 'Flat Bar') {
    // b_br the width, t_br the thickness (d_br is the thickness again)
    const [b, t] = [num('b_br'), num('t_br')];
    section = { id: `FB ${name || `${b}x${t}`}`, shape: 'FB', b, t };
  } else if (shape === 'Angle') {
    const [d, b, t] = [num('d_br'), num('b_br'), num('t_br')];
    if (d !== b) throw unsupported('cross_section_size');
    const [area, drawn] = [value('area'), t * (2 * d - t)];
    if (Math.abs(drawn - area) > 0.05 * area) notes.push(`area ${area} does not match the legs d_br and b_br (${Math.round(drawn)}), drawn from the legs`);
    section = { id: name || `L ${d}x${b}x${t}`, shape: 'L', d, t };
  } else if (shape === 'Double Channel') {
    section = doubleChannel(rec, id, notes);
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

// ------------------------------------------------------------- hss columns
const HSS_ENDS: Record<string, ColumnSpecimen['ends']> = { CF: 'fixed-free', DC: 'fixed-fixed', '3PB': '3pb' };

// one record of the hub `hss_columns` table: one square or rectangular tube.
// CF: a cantilever. DC: both ends fixed. 3PB: lying on two rollers.
// length__mm depends on stiffness_coefficient (k, the end moment over the
// chord rotation is k EI / length). k 3: length__mm is from the point of zero
// moment to the end, so a DC column or a 3PB span is twice as long. k 6: it
// is the whole DC column (or 3PB span).
export function fromHubHssColumn(rec: HubRecord): ColumnSpecimen {
  const id = String(rec.id ?? rec.test_id ?? 'hss').trim();
  const { text, value, num, unsupported } = fields(rec, id);
  const notes: string[] = [];
  const [d, bf, tf, tw] = [num('depth__mm'), num('width__mm'), num('flange_thickness__mm'), num('web_thickness__mm')];
  const name = String(rec.tube_section ?? '').trim();
  const section: SectionRef = { id: /^[A-Za-z]{1,4}[\s-]?\d/.test(name) ? name : `HSS ${d}x${bf}x${tf}`, shape: 'RHS', d, bf, tf, tw };
  const cfg = text('test_configuration');
  if (!cfg) throw new Error(`${id}: test_configuration is missing`);
  const ends = HSS_ENDS[cfg];
  if (!ends) throw unsupported('test_configuration');
  const k = value('stiffness_coefficient');
  if (!Number.isFinite(k)) throw new Error(`${id}: stiffness_coefficient is missing`);
  if (cfg === 'CF' ? k !== 3 : k !== 3 && k !== 6) throw unsupported('stiffness_coefficient');
  const L = num('length__mm');
  const length = cfg !== 'CF' && k === 3 ? 2 * L : L;
  if (length !== L) notes.push(`stiffness_coefficient 3: length__mm ${L} is half the ${cfg === 'DC' ? 'column' : 'span'}, drawn ${length} mm`);
  if (!Number.isFinite(value('loading_angle'))) throw new Error(`${id}: loading_angle is missing`);
  const angle = value('loading_angle');
  // no axial load only when the ratio is 0 all along
  const axial = !(value('axial_load_ratio') === 0 && text('axial_load_sequence') !== 'Varying');
  return { test: 'column', id, section, length, ends, angle, axial, notes };
}

// ------------------------------------------------------------- ebf links

// The stiffeners of a link, from a record of the hub `eccentric_braced_frames`
// table: their positions from the link end, on the front of the web (f) and,
// for a double sided link, on the back (b). l_s_no_x: how many. l_s_d_pnl_1_x:
// the end panels (from the link end to the first one), l_s_d_pnl_2_x: the
// inner panels (empty when they are all the same). When the panels don't add
// up to e (more than 3 % off), they are drawn at equal spacing, with a note.
// l_s_side NA: no stiffener. NR: not reported. The end stiffeners are not in
// these lists (buildLink always draws them).
export function linkStiffeners(rec: HubRecord, e: number): { front: number[]; back: number[]; notes: string[] } {
  const { text, value } = fields(rec, 'row');
  const notes: string[] = [];
  const side = text('l_s_side').toLowerCase();
  const raw = typeof rec.l_s_side === 'string' ? rec.l_s_side.trim().toUpperCase() : '';
  if (raw === 'NR') return { front: [], back: [], notes: ['stiffeners not reported: only the end stiffeners are drawn'] };
  const face = (x: 'f' | 'b', name: string): number[] => {
    const n = value(`l_s_no_${x}`);
    if (!side || !(n > 0)) return [];
    const [p1, p2] = [value(`l_s_d_pnl_1_${x}`), value(`l_s_d_pnl_2_${x}`)];
    if (!(p1 > 0)) {
      notes.push(`${name} stiffener spacing not reported: only the end stiffeners are drawn`);
      return [];
    }
    const even = [...Array(n).keys()].map((k) => mm(((k + 1) * e) / (n + 1)));
    const off = (x: number) => Math.abs(x - e) > 0.03 * e;
    if (!(p2 > 0)) {
      if (off(p1 * (n + 1))) notes.push(`${name} stiffeners: ${n} at ${p1} mm does not fill e ${e} mm, drawn at equal spacing`);
      return even;
    }
    if (off(2 * p1 + (n - 1) * p2)) {
      notes.push(`${name} stiffeners: ${n} with panels ${p1} and ${p2} mm do not fill e ${e} mm, drawn at equal spacing`);
      return even;
    }
    return [...Array(n).keys()].map((k) => mm(p1 + k * p2));
  };
  const front = face('f', 'front');
  const back = side === 'double' ? face('b', 'back') : [];
  return { front, back, notes: [...new Set(notes)] };
}

// one record of the hub `eccentric_braced_frames` table: one link of an EBF,
// alone (TF1) or in a frame (TF2, TF3, TF4, c: with a slab). The sizes are
// the nominal ones (_n), the measured ones (_m) are the same link.
export function fromHubEbf(rec: HubRecord): LinkSpecimen {
  const id = `ebf${String(rec.id ?? '').trim() ? `-${String(rec.id).trim()}` : ''}`;
  const { text, value, num, unsupported } = fields(rec, id);
  const notes: string[] = [];
  const section = sectionOf(rec.profile, num('h_n'), num('bf_n'), num('tf_n'), num('tw_n'));
  const e = num('e');
  const cf = text('l_confi');
  if (!cf) throw new Error(`${id}: l_confi is missing`);
  const config = LINK_CONFIGS.find((c) => c.toLowerCase() === cf.toLowerCase());
  if (!config) throw unsupported('l_confi');
  const loc = text('link_loc').toLowerCase();
  if (!loc) throw new Error(`${id}: link_loc is missing`);
  if (loc !== 'middle' && loc !== 'edge') throw unsupported('link_loc');
  const at = loc as LinkSpecimen['at'];
  if (config === 'TF1' && at === 'edge') notes.push('l_confi TF1 is an isolated link, link_loc says edge: drawn as TF1');
  if (config === 'TF3c') notes.push('link in a system: drawn as TF2');
  if (/c$/.test(config)) notes.push('the concrete slab is not drawn yet');
  if (/^C\s/i.test(String(rec.profile ?? '').trim())) notes.push('built up from channels, drawn as an I');
  if (value('tf_add_n') > 0) notes.push(`extra flange plates (tf_add_n ${value('tf_add_n')} mm) not drawn`);
  const [span, height] = [value('l_st'), value('h_st')];
  const bolted = /bolted/i.test(text('l_con_typ'));
  const st = linkStiffeners(rec, e);
  notes.push(...st.notes);
  return {
    test: 'link', id, section, e, at, config,
    ends: bolted ? 'bolted' : 'welded',
    ...(bolted && value('t_e_s') > 0 ? { endPlate: mm(value('t_e_s')) } : {}),
    stiffeners: { ...(value('t_s') > 0 ? { t: mm(value('t_s')) } : {}), front: st.front, back: st.back },
    ...(span > 0 && height > 0 ? { frame: { span: mm(span), height: mm(height) } } : {}),
    ...(value('a_b_b') > 0 ? { brace: mm(value('a_b_b')) } : {}),
    notes,
  };
}

// ------------------------------------------------------------- any record
// The hub tables we read: [table, a field only this table has, its reader].
// The table names are the keys of HUB_TABLES (tables.ts).
export const READERS: [string, string, (rec: HubRecord) => Specimen][] = [
  ['connections', 'specimen_type', fromHubConnection],
  ['braces', 'brace_angle', fromHubBrace],
  ['columns', 'axis_of_bending', fromHubColumn],
  ['hss_columns', 'test_configuration', fromHubHssColumn],
  ['eccentric_braced_frames', 'link_loc', fromHubEbf],
];

// The hub table of a record, '' for our own Specimen (or not an object).
export function hubTable(json: unknown): string {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return '';
  return READERS.find(([, field]) => field in json)?.[0] ?? '';
}

// a JSON object: our own Specimen, or a hub record (the reader is picked from
// a field only its table has)
export function toSpecimen(json: unknown): Specimen {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('a specimen must be a JSON object');
  const o = json as HubRecord;
  const reader = READERS.find(([, field]) => field in o);
  if (reader) return reader[2](o);
  if (o.test === 'brace') return o as BraceSpecimen;
  if (o.test === 'column') return o as ColumnSpecimen;
  if (o.test === 'link') return o as LinkSpecimen;
  if (o.test !== undefined && o.test !== 'connection') throw new Error(`test "${String(o.test)}" is not known (connection, brace, column or link)`);
  if ('column' in o) return { beams: [], ...(o as Partial<ConnSpecimen>) } as ConnSpecimen;
  throw new Error('not a specimen: no "column" or "test" (a Specimen), no "specimen_type", "brace_angle", "axis_of_bending", "test_configuration" or "link_loc" (a hub record)');
}
