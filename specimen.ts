// A real test specimen, drawn from its sections instead of a seed. `test`
// says which kind of test:
// - connection (the default): a beam-to-column subassembly, one column and
//   one or two beams on it (the `connection` table of RESSLab Hub). It goes
//   to buildSpecimen in generate.ts.
// - brace: one brace, alone or in a test frame (the `braces` table). It goes
//   to buildBrace in bench.ts.
// - column: one column, standing on a floor block, pushed at its top, or
//   lying on two rollers and pushed at mid span (the `columns` and
//   `hss_columns` tables). It goes to buildColumn in bench.ts.
// - link: the link of an eccentrically braced frame, alone or in a test
//   frame (the `eccentric_braced_frames` table). It goes to buildLink in
//   bench.ts.
// hub.ts reads the records of the hub tables into these types.
//
// No three.js here: this file only needs the section formulas.
import { chsSection, doubleAngleOf, iSection, rhsSection, rodSection, teeSection, type Catalog, type Family, type Section } from './sections.ts';
import { BEAM_CONN_KINDS, type ConnType } from './steel.ts';

// A name from the section tables ('W14X82', 'HE 300 B', also written
// 'W14x82', 'HEB 300'), a built-up name ('H-700x300x13x24': d x bf x tw x tf),
// or the dimensions in mm:
// - I, RHS, T: depth d, width bf, flange tf, web tw (a tee: d is the full depth)
// - CHS (round tube): diameter d, wall t. ROD (round bar): diameter d.
// - 2L (two angles back to back): d the leg along the gap, b the outstanding
//   leg of one angle, t the thickness
export type SectionRef =
  | string
  | { id: string; shape?: 'I' | 'RHS' | 'T'; d: number; bf: number; tf: number; tw: number }
  | { id: string; shape: 'CHS'; d: number; t: number }
  | { id: string; shape: 'ROD'; d: number }
  | { id: string; shape: '2L'; d: number; b: number; t: number };

export type SpecimenBeam = {
  section: SectionRef;
  bearing: 0 | 90 | 180 | 270; // 0 and 180 on the column flanges, 90 and 270 on its web
  length: number; // mm, from the column axis to the beam tip
  at?: number; // mm, beam centre line above the column foot (default: half the column height)
  connection: ConnType; // one of BEAM_CONNS: shear_tab, end_plate, flange_plates, welded, ...
};

export type ConnSpecimen = {
  test?: 'connection';
  id: string; // the hub id, for example 'Chi_and_Uang_2002_DC2'
  family?: Family; // the section table for section names (default aisc)
  column: { section: SectionRef; height: number };
  beams: SpecimenBeam[]; // [] gives a column alone
  continuity?: boolean; // plates across the column at the beam flanges (default true)
  // what the actuators push (default beam): the beam tips, or the column top
  // (then the beam tips stand on links). See specimenRig in generate.ts.
  load?: 'beam' | 'column';
  notes?: string[]; // what we draw differently from the real test, copied into the log
};

// A brace test. The brace is in a vertical plane, `angle` above the
// horizontal, `length` between its two work points.
// - frame SB: the brace alone, its bottom end on a floor block, its top end
//   under a loading beam that an actuator pushes.
// - SBF: the brace in a one bay frame of the rig, from a foot corner to the
//   opposite top corner.
// - DBF: two braces in an X in the same frame (each one `length` long).
// - ends gusset: a gusset plate at each end, the tube on it from `clear / 2`
//   before the end. fixed: an end plate on a seat. pin: an end plate on a
//   pin joint (the work point is the pin).
export type BraceSpecimen = {
  test: 'brace';
  id: string;
  family?: Family;
  section: SectionRef;
  length: number; // mm, between the work points (l_b)
  clear?: number; // mm, between the two gussets (l_b_clear)
  angle: number; // degrees above the horizontal
  ends: 'gusset' | 'fixed' | 'pin';
  plates?: { top?: number; bottom?: number }; // mm, the thickness of the gussets or the end plates
  frame: 'SB' | 'SBF' | 'DBF';
  notes?: string[];
};

// A column test. The column stands on a floor block, an end plate at each
// end. A loading head on its top plate, pushed sideways by an actuator.
// Vertical actuators above the head bring the axial load.
// - ends fixed-free: the top is free to turn (one vertical actuator).
// - fixed-fixed: the top is held straight (two vertical actuators side by side).
// - fixed-flexible: the top turns against a spring (drawn like fixed-free).
// - 3pb (three-point bending): the column lies on two rollers `length`
//   apart, an actuator pushes it down at mid span. The axial load comes from
//   an actuator at one end, against a reaction block at the other end.
// angle: between the push and the web (0: strong axis bending, 90: weak axis).
// For a tube the web is the side along its depth d.
export type ColumnSpecimen = {
  test: 'column';
  id: string;
  family?: Family;
  section: SectionRef;
  length: number; // mm, between the end plates (l_c), or for 3pb between the rollers
  ends: 'fixed-free' | 'fixed-fixed' | 'fixed-flexible' | '3pb';
  angle: number; // degrees
  axial?: boolean; // false: no axial load, so no axial actuator (default true)
  plates?: { top?: number; bottom?: number }; // mm, the end plate thickness (3pb: bottom at the pin end, top at the actuator end)
  notes?: string[];
};

// An EBF link test. The link is the short piece of beam of an eccentrically
// braced frame that yields in shear, `e` long.
// - config TF1: the link alone, one end on a reaction block, the other end
//   pushed up and down by an actuator.
// - TF2, TF3 (and TF2c, TF3c with a slab): the link in the middle of the beam
//   of a one bay frame, a brace under each link end.
// - TF4, TF4c: the link at one end of the beam, against a column, a brace
//   under its other end.
// at: where the hub says the link is (middle or edge), the rig follows config.
// stiffeners: their positions along the link (mm from its first end), on the
// front and on the back of the web. The end stiffeners are always drawn.
export type LinkSpecimen = {
  test: 'link';
  id: string;
  family?: Family;
  section: SectionRef;
  e: number; // mm, the link length
  at: 'middle' | 'edge';
  config: 'TF1' | 'TF2' | 'TF3' | 'TF2c' | 'TF3c' | 'TF4' | 'TF4c';
  ends?: 'bolted' | 'welded'; // how the link ends hold on (default welded, TF1 always has end plates)
  endPlate?: number; // mm, the end plate thickness
  stiffeners: { t?: number; front: number[]; back: number[] };
  frame?: { span: number; height: number }; // mm, between the column axes, from the foot pins to the beam axis
  brace?: number; // degrees, the brace angle the hub gives (only checked against the drawing)
  notes?: string[];
};

export type Specimen = ConnSpecimen | BraceSpecimen | ColumnSpecimen | LinkSpecimen;

// the kinds a beam end of a specimen can have
export const BEAM_CONNS: ConnType[] = BEAM_CONN_KINDS;
export const LINK_CONFIGS: LinkSpecimen['config'][] = ['TF1', 'TF2', 'TF3', 'TF2c', 'TF3c', 'TF4', 'TF4c'];

// ------------------------------------------------------------- sections
// table ids and hub names written the same way: W14x82 -> W14X82, HEB 300 -> HE300B
const key = (s: string) => {
  const k = s.toUpperCase().replace(/\s+/g, '');
  const m = /^HE(AA|A|B|C|M)(\d+)$/.exec(k);
  return m ? `HE${m[2]}${m[1]}` : k;
};
// H-700x300x13x24, H500X200X10X16, BH 400x200x8x13: d x bf x tw x tf
const BUILT_UP = /^(?:BH|H|I)?[-\s]*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)$/i;

const positive = (id: string, xs: Record<string, number>) => {
  for (const [k, v] of Object.entries(xs))
    if (!(typeof v === 'number' && v > 0)) throw new Error(`section ${id}: ${k} must be a number above 0, not ${JSON.stringify(v)}`);
};

export function findSection(ref: SectionRef, cat: Catalog): Section {
  if (typeof ref !== 'string' && ref.shape === 'CHS') {
    const { id, d, t } = ref;
    positive(id, { d, t });
    if (2 * t >= d) throw new Error(`section ${id}: the wall is too thick for its size (d ${d}, t ${t})`);
    return chsSection(id, d, t);
  }
  if (typeof ref !== 'string' && ref.shape === 'ROD') {
    positive(ref.id, { d: ref.d });
    return rodSection(ref.id, ref.d);
  }
  if (typeof ref !== 'string' && ref.shape === '2L') {
    const { id, d, b, t } = ref;
    positive(id, { d, b, t });
    if (t >= Math.min(d, b)) throw new Error(`section ${id}: the angles are too thick for their legs (d ${d}, b ${b}, t ${t})`);
    return doubleAngleOf(id, d, b, t);
  }
  if (typeof ref !== 'string') {
    const { id, d, bf, tf, tw } = ref;
    positive(id, { d, bf, tf, tw });
    // a tee has one flange, an I two
    const thick = ref.shape === 'T' ? tf >= d : 2 * tf >= d;
    if (thick || (ref.shape !== 'RHS' && tw >= bf)) throw new Error(`section ${id}: the plates are too thick for its size (d ${d}, bf ${bf}, tf ${tf}, tw ${tw})`);
    if (ref.shape === 'T') return teeSection(id, d, bf, tf, tw);
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
