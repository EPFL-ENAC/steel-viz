// The text of the tooltip on a part of the 3D view: what the part is, and for
// a member its section, its length, its connections and its check.
import type { Result } from '../generate.ts';
import { ANGLE_GAP, type Section } from '../sections.ts';
import { CONNS, type ConnType, type Part } from '../steel.ts';

export type Tip = { title: string; id: string; rows: [string, string][]; warn?: boolean };

const SHAPE: Record<Section['kind'], string> = { I: 'I', C: 'channel', T: 'tee', '2L': 'double angle', RHS: 'tube', ROD: 'round bar', CHS: 'round tube', L: 'angle', FB: 'flat bar', '2C': 'double channel' };
// the beam end kinds have their label in the catalog, these say more
const CONN: Record<string, string> = {
  gusset: 'gusset, knife plate', gusset_small: 'small gusset', gusset_lap: 'lapped gusset plate', gusset_cap: 'end cap plate, tab on the gusset', clevis: 'clevis and pin',
  bearing: 'bearing', flange: 'flange plates',
};

const mm = (x: number) => `${Math.round(x).toLocaleString('en')} mm`;
const n1 = (x: number) => (Math.round(x * 10) / 10).toString();
// the sizes of a section, the way a table gives them
function dims(s: Section): string {
  switch (s.kind) {
    case 'ROD': return `Ø ${n1(s.d)} mm`;
    case 'CHS': return `Ø ${n1(s.d)}, t ${n1(s.tf)} mm`;
    case 'RHS': return `${n1(s.d)} × ${n1(s.bf)}, t ${n1(s.tf)} mm`;
    case '2L': return `2 L ${n1(s.d)} × ${n1(s.d)}, t ${n1(s.tf)} mm`;
    case '2C': return `2 C, d ${n1(s.d)}, b ${n1((s.bf - ANGLE_GAP) / 2)}, tw ${n1(s.tw)}, tf ${n1(s.tf)} mm`;
    case 'L': return `L ${n1(s.d)} × ${n1(s.bf)}, t ${n1(s.tf)} mm`;
    case 'FB': return `${n1(s.d)} × ${n1(s.bf)} mm`;
    default: return `d ${n1(s.d)}, bf ${n1(s.bf)}, tw ${n1(s.tw)}, tf ${n1(s.tf)} mm`;
  }
}
const conns = (cs: string[]) => [...new Set(cs)].map((c) => CONN[c] ?? CONNS[c as ConnType]?.label ?? c).join(', ');

export function describe(part: Part, r: Result): Tip {
  const info = part.info ?? { type: part.kind ?? 'part' };
  const tip: Tip = { title: part.kind === 'rig' ? `${info.type} (test rig)` : info.type, id: part.id, rows: [] };
  const row = (k: string, v: string) => tip.rows.push([k, v]);
  // the part this one belongs to, by its type and id
  if (info.of) {
    const of = r.parts.find((p) => p.id === info.of);
    row('On', of?.info ? `${of.info.type.toLowerCase()} ${of.id}` : info.of);
  }
  if (part.kind === 'bolts') row('Bolts', String(part.dots.length));
  const s = info.sec;
  if (s) {
    row('Section', `${s.id}, ${SHAPE[s.kind]}`);
    row('Size', dims(s));
    row('Area', `${Math.round(s.A).toLocaleString('en')} mm²`);
  }
  if (info.L) row('Length', mm(info.L));
  if (info.conn?.length) row(info.conn.length > 1 && new Set(info.conn).size > 1 ? 'Ends' : 'Connection', conns(info.conn));
  const m = info.member ? r.members[info.member] : undefined;
  if (m) {
    tip.warn = m.ratio > 0.6;
    row('Ratio', `${m.ratio.toFixed(2)} (limit 0.60)`);
    const kN = (x: number) => `${(x / 1000).toFixed(1)} kN`;
    const kNm = (x: number) => `${(x / 1e6).toFixed(1)} kN·m`;
    row('Axial', m.Nc > 1 ? `${kN(m.N)}, compression ${kN(m.Nc)}` : kN(m.N));
    if (s?.kind !== 'ROD') row('Moment', `My ${kNm(m.My)}, Mz ${kNm(m.Mz)}`);
    if (info.member === 'column' && r.st.cols.length > 1) row('Note', 'all columns are sized together, worst one');
  } else if (info.member && !r.ok) row('Check', 'none, the structure is a mechanism');
  return tip;
}
