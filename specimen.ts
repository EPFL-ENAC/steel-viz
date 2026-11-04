// A real test specimen, drawn from its sections instead of a seed.
//
// v1 draws a beam-to-column subassembly: one column, and one or two beams on
// it. That is what the `connection` table of RESSLab Hub describes (99 of its
// 100 tests). hub.ts reads the records of the hub tables into these types.
//
// No three.js here: this file only needs the section formulas.
import { iSection, rhsSection, type Catalog, type Family, type Section } from './sections.ts';
import { BEAM_CONN_KINDS, type ConnType } from './steel.ts';

// A name from the section tables ('W14X82', 'HE 300 B', also written
// 'W14x82', 'HEB 300'), a built-up name ('H-700x300x13x24': d x bf x tw x tf),
// or the dimensions in mm.
export type SectionRef = string | { id: string; shape?: 'I' | 'RHS'; d: number; bf: number; tf: number; tw: number };

export type SpecimenBeam = {
  section: SectionRef;
  bearing: 0 | 90 | 180 | 270; // 0 and 180 on the column flanges, 90 and 270 on its web
  length: number; // mm, from the column axis to the beam tip
  at?: number; // mm, beam centre line above the column foot (default: half the column height)
  connection: ConnType; // one of BEAM_CONNS: shear_tab, end_plate, flange_plates, welded, ...
};

export type Specimen = {
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

// the kinds a beam end of a specimen can have
export const BEAM_CONNS: ConnType[] = BEAM_CONN_KINDS;

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
