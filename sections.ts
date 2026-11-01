// Steel sections from the hub's own tables (frontend/src/assets).
// We only read the dimensions and compute A, I, J, Wpl ourselves: the AISC
// table's `a` and `iy` columns are not in mm, the EU one is fine, so the
// safe path is the same formulas for both.

export type Section = {
  id: string;
  kind: 'I' | 'RHS';
  d: number; // depth
  bf: number; // flange width (RHS: width)
  tf: number; // flange thickness (RHS: wall)
  tw: number; // web thickness (RHS: wall)
  A: number;
  Is: number; // strong axis inertia (bending in the depth direction)
  Iw: number; // weak axis inertia
  J: number;
  Ws: number; // plastic modulus, strong axis
  Ww: number; // plastic modulus, weak axis
  rmin: number;
};

export type Catalog = { beams: Section[]; columns: Section[]; tubes: Section[] };
export type Family = 'aisc' | 'eu';

export function iSection(id: string, d: number, bf: number, tf: number, tw: number): Section {
  const hw = d - 2 * tf;
  const A = 2 * bf * tf + hw * tw;
  const Is = (bf * d ** 3 - (bf - tw) * hw ** 3) / 12;
  const Iw = (2 * tf * bf ** 3 + hw * tw ** 3) / 12;
  const J = (2 * bf * tf ** 3 + (d - tf) * tw ** 3) / 3;
  const Ws = bf * tf * (d - tf) + (tw * hw ** 2) / 4;
  const Ww = (tf * bf ** 2) / 2 + (hw * tw ** 2) / 4;
  return { id, kind: 'I', d, bf, tf, tw, A, Is, Iw, J, Ws, Ww, rmin: Math.sqrt(Iw / A) };
}

export function rhsSection(id: string, h: number, b: number, t: number): Section {
  const A = 2 * t * (h + b) - 4 * t * t;
  const Is = (b * h ** 3 - (b - 2 * t) * (h - 2 * t) ** 3) / 12;
  const Iw = (h * b ** 3 - (h - 2 * t) * (b - 2 * t) ** 3) / 12;
  const Am = (b - t) * (h - t);
  const J = (4 * Am * Am * t) / (2 * (b - t + h - t));
  const Ws = (b * h * h - (b - 2 * t) * (h - 2 * t) ** 2) / 4;
  const Ww = (h * b * b - (h - 2 * t) * (b - 2 * t) ** 2) / 4;
  return { id, kind: 'RHS', d: h, bf: b, tf: t, tw: t, A, Is, Iw, J, Ws, Ww, rmin: Math.sqrt(Math.min(Is, Iw) / A) };
}

export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0].split(',');
  return lines.slice(1).map((l) => {
    const cells = l.split(',');
    const row: Record<string, string> = {};
    head.forEach((h, i) => (row[h] = (cells[i] ?? '').replace(/"/g, '').trim()));
    return row;
  });
}

const byArea = (a: Section, b: Section) => a.A - b.A;

// i: the I-section table, hss: the tube table, both raw CSV text
export function loadCatalog(family: Family, i: string, hss: string): Catalog {
  const shapes = parseCsv(i)
    .filter((r) => (family === 'aisc' ? /^W\d/.test(r.id) : /^(IPE|HE) /.test(r.id)))
    .map((r) => iSection(r.id, +r.d, +r.bf, +r.tf, +r.tw))
    .filter((s) => s.d > 0 && s.d <= 700);
  const tubes = parseCsv(hss)
    .map((r) => rhsSection(r.id, +r.h, +r.b, +r.t))
    .filter((s) => s.d === s.bf && s.d >= 60 && s.d <= 300); // square tubes only
  return {
    beams: shapes.filter((s) => (family === 'aisc' ? s.bf / s.d < 0.75 : s.id.startsWith('IPE'))).sort(byArea),
    columns: shapes.filter((s) => s.bf / s.d >= 0.8).sort(byArea),
    tubes: tubes.sort(byArea),
  };
}
