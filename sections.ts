// Steel sections from the resslab-hub tables (copied in sections/, read by tables.ts).
// We only read the dimensions and compute A, I, J, Wpl ourselves: the AISC
// table's `a` and `iy` columns are not in mm, the EU one is fine, so the
// safe path is the same formulas for both.

export type Section = {
  id: string;
  kind: 'I' | 'RHS' | 'ROD';
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

// beams, columns, tubes, rods: what the random generator picks from.
// all: every I section and tube of the table, with no filter (a real
// specimen can use a W36 or a rectangular tube).
export type Family = 'aisc' | 'eu';
export type Catalog = { family: Family; beams: Section[]; columns: Section[]; tubes: Section[]; rods: Section[]; all: Section[] };

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

// a solid round bar of diameter D (a tension rod)
export function rodSection(id: string, D: number): Section {
  const A = (Math.PI * D * D) / 4;
  const I = (Math.PI * D ** 4) / 64;
  return { id, kind: 'ROD', d: D, bf: D, tf: D / 2, tw: D / 2, A, Is: I, Iw: I, J: 2 * I, Ws: D ** 3 / 6, Ww: D ** 3 / 6, rmin: D / 4 };
}

// rod diameters: inches for AISC, mm for EU (the tables have no rods)
const RODS: Record<Family, [string, number][]> = {
  aisc: [['3/4', 0.75], ['7/8', 0.875], ['1', 1], ['1-1/4', 1.25], ['1-1/2', 1.5], ['1-3/4', 1.75], ['2', 2]].map(([n, x]) => [`ROD ${n}"`, (x as number) * 25.4]),
  eu: [16, 20, 24, 27, 30, 36, 42, 48].map((x) => [`M${x} rod`, x]),
};

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
  const allShapes = parseCsv(i)
    .filter((r) => (family === 'aisc' ? /^W\d/.test(r.id) : /^(IPE|HE) /.test(r.id)))
    .map((r) => iSection(r.id, +r.d, +r.bf, +r.tf, +r.tw))
    .filter((s) => s.d > 0);
  const allTubes = parseCsv(hss).map((r) => rhsSection(r.id, +r.h, +r.b, +r.t)).filter((s) => s.d > 0);
  const shapes = allShapes.filter((s) => s.d <= 700);
  const tubes = allTubes.filter((s) => s.d === s.bf && s.d >= 60 && s.d <= 300); // square tubes only
  return {
    family,
    beams: shapes.filter((s) => (family === 'aisc' ? s.bf / s.d < 0.75 : s.id.startsWith('IPE'))).sort(byArea),
    columns: shapes.filter((s) => s.bf / s.d >= 0.8).sort(byArea),
    tubes: tubes.sort(byArea),
    rods: RODS[family].map(([id, D]) => rodSection(id, D)),
    all: [...allShapes, ...allTubes],
  };
}
