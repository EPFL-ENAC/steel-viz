// Steel sections from the tables in sections/ (read by tables.ts, see
// sections/README.md). We only read the dimensions and compute A, I, J, Wpl
// ourselves: the AISC table's `a` and `iy` columns are not in mm, the EU one
// is fine, so the safe path is the same formulas for both.

// I: W, IPE, HE. RHS: square tube. ROD: round bar. CHS: round tube (round
// HSS and pipes in aisc). C: channel. 2L: two angles back to back,
// ANGLE_GAP apart (equal legs in the tables). T: a tee, half an I.
// L: one angle, FB: a flat bar. Both sit where the +v angle of a 2L
// is, their back on v = ANGLE_GAP / 2: a plate in the middle (gusset_lap)
// fits them like a 2L (an X brace or an arm brace, see generate.ts). The leg
// along the gap (d) is the one bolted on the plate.
// 2C: two channels back to back, ANGLE_GAP apart, the flanges outward (a brace test only).
export type Kind = 'I' | 'RHS' | 'ROD' | 'CHS' | 'C' | '2L' | 'T' | 'L' | 'FB' | '2C';

export type Section = {
  id: string;
  kind: Kind;
  d: number; // depth (2L and L: the leg along the gap, the one on the gusset, FB: the width)
  bf: number; // flange width (RHS: width, ROD and CHS: the diameter, 2L: both outstanding legs and the gap, 2C: both channels and the gap, L: the outstanding leg, FB: the thickness)
  tf: number; // flange thickness (RHS and CHS: wall, 2L and L: angle thickness, FB: the thickness)
  tw: number; // web thickness (RHS and CHS: wall, 2L and L: angle thickness, FB: the thickness)
  A: number;
  Is: number; // strong axis inertia (bending in the depth direction)
  Iw: number; // weak axis inertia
  J: number;
  Ws: number; // plastic modulus, strong axis
  Ww: number; // plastic modulus, weak axis
  rmin: number;
};

// The gap between the two angles of a 2L: the gusset plate goes in it.
export const ANGLE_GAP = 12;

// beams, columns, tubes, rods: what the random generator picks from.
// channels, angles (double angles), tees: the shapes some braces,
// secondaries and truss chords get (see shapeP in generate.ts).
// flats, singles (one angle), rods: the X braces.
// braceAngles (one angle): the shaped braces of an arm that get one angle.
// pipes: the round tubes of some braces (see roundP in generate.ts).
// all: every I section and tube of the table, with no filter (a real
// specimen can use a W36 or a rectangular tube).
export type Family = 'aisc' | 'eu';
export type Catalog = {
  family: Family; beams: Section[]; columns: Section[]; tubes: Section[]; rods: Section[];
  channels: Section[]; angles: Section[]; tees: Section[]; flats: Section[]; singles: Section[]; braceAngles: Section[]; pipes: Section[]; all: Section[];
};

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

// a round tube: outside diameter D, wall t
export function chsSection(id: string, D: number, t: number): Section {
  const Di = D - 2 * t;
  const A = (Math.PI * (D ** 2 - Di ** 2)) / 4;
  const I = (Math.PI * (D ** 4 - Di ** 4)) / 64;
  const W = (D ** 3 - Di ** 3) / 6;
  return { id, kind: 'CHS', d: D, bf: D, tf: t, tw: t, A, Is: I, Iw: I, J: 2 * I, Ws: W, Ww: W, rmin: Math.sqrt(I / A) };
}

// A rectangle of a section, [v0, v1, w0, w1], in the member frame: v across,
// w down, the origin in the middle of the depth. The I and the T are centred
// on v = 0, the C has its web on v = 0 and its flanges toward +v, the 2L has
// its gap on v = 0 and the outstanding legs on top.
export type Rect = [number, number, number, number];

// how deep the centroid is, from the top of the section (the flange face of
// a tee)
export function centroidDepth(s: Section): number {
  const rs = rects(s);
  const A = rs.reduce((m, [a0, a1, b0, b1]) => m + (a1 - a0) * (b1 - b0), 0);
  return rs.reduce((m, [a0, a1, b0, b1]) => m + (a1 - a0) * (b1 - b0) * (b0 + b1) / 2, 0) / A + s.d / 2;
}

export function rects(s: Section): Rect[] {
  const [h, w, tf, tw] = [s.d / 2, s.bf / 2, s.tf, s.tw];
  switch (s.kind) {
    case 'I':
      return [[-w, w, -h, -h + tf], [-w, w, h - tf, h], [-tw / 2, tw / 2, -h + tf, h - tf]];
    case 'C': {
      const [l, r] = [-tw / 2, s.bf - tw / 2];
      return [[l, r, -h, -h + tf], [l, r, h - tf, h], [l, l + tw, -h + tf, h - tf]];
    }
    case 'T':
      return [[-w, w, -h, -h + tf], [-tw / 2, tw / 2, -h + tf, h]];
    case '2L': {
      const g = ANGLE_GAP / 2;
      return [[-w, -g, -h, -h + tf], [g, w, -h, -h + tf], [-g - tw, -g, -h + tf, h], [g, g + tw, -h + tf, h]];
    }
    case '2C': {
      const g = ANGLE_GAP / 2;
      return [
        [-w, -g, -h, -h + tf], [g, w, -h, -h + tf], [-w, -g, h - tf, h], [g, w, h - tf, h],
        [-g - tw, -g, -h + tf, h - tf], [g, g + tw, -h + tf, h - tf],
      ];
    }
    case 'L': {
      const g = ANGLE_GAP / 2;
      return [[g, g + s.bf, -h, -h + tf], [g, g + tw, -h + tf, h]];
    }
    case 'FB': {
      const g = ANGLE_GAP / 2;
      return [[g, g + s.bf, -h, h]];
    }
    default:
      return [[-w, w, -h, h]];
  }
}

// The plastic modulus along one axis: find the line that cuts the area in
// two, then sum the first moments of both halves about it. `span` gives the
// extent of a rectangle along the axis and its width across.
function plastic(rs: Rect[], span: (r: Rect) => [number, number, number]): number {
  const parts = rs.map(span);
  const A = parts.reduce((s, [a, b, t]) => s + (b - a) * t, 0);
  const below = (p: number) => parts.reduce((s, [a, b, t]) => s + Math.min(Math.max(p - a, 0), b - a) * t, 0);
  let [lo, hi] = [Math.min(...parts.map((x) => x[0])), Math.max(...parts.map((x) => x[1]))];
  for (let k = 0; k < 100; k++) {
    const m = (lo + hi) / 2;
    if (below(m) < A / 2) lo = m;
    else hi = m;
  }
  const p = (lo + hi) / 2;
  return parts.reduce((s, [a, b, t]) => {
    if (p <= a) return s + (t * ((b - p) ** 2 - (a - p) ** 2)) / 2;
    if (p >= b) return s + (t * ((p - a) ** 2 - (p - b) ** 2)) / 2;
    return s + (t * ((p - a) ** 2 + (b - p) ** 2)) / 2;
  }, 0);
}

// A, I, J and Wpl of a section made of rectangles. Thin walled for J. The
// shapes here are symmetric about v or w, so v and w are the principal axes.
export function rectProps(rs: Rect[]) {
  const box = rs.map(([v0, v1, w0, w1]) => ({ b: v1 - v0, h: w1 - w0, v: (v0 + v1) / 2, w: (w0 + w1) / 2 }));
  const A = box.reduce((s, r) => s + r.b * r.h, 0);
  const cv = box.reduce((s, r) => s + r.b * r.h * r.v, 0) / A;
  const cw = box.reduce((s, r) => s + r.b * r.h * r.w, 0) / A;
  const Is = box.reduce((s, r) => s + (r.b * r.h ** 3) / 12 + r.b * r.h * (r.w - cw) ** 2, 0);
  const Iw = box.reduce((s, r) => s + (r.h * r.b ** 3) / 12 + r.b * r.h * (r.v - cv) ** 2, 0);
  const J = box.reduce((s, r) => s + (Math.max(r.b, r.h) * Math.min(r.b, r.h) ** 3) / 3, 0);
  const Ws = plastic(rs, ([v0, v1, w0, w1]) => [w0, w1, v1 - v0]);
  const Ww = plastic(rs, ([v0, v1, w0, w1]) => [v0, v1, w1 - w0]);
  return { A, Is, Iw, J, Ws, Ww, rmin: Math.sqrt(Math.min(Is, Iw) / A) };
}

function shaped(id: string, kind: Kind, d: number, bf: number, tf: number, tw: number): Section {
  const s: Section = { id, kind, d, bf, tf, tw, A: 0, Is: 0, Iw: 0, J: 0, Ws: 0, Ww: 0, rmin: 0 };
  const r = { ...s, ...rectProps(rects(s)) };
  return kind === 'L' ? { ...r, rmin: angleRmin(rects(s), r) } : r;
}

// One angle is not symmetric: its weakest axis is at 45 degrees (r_z, or iv
// in the EN tables), below the radius about v or w. The smallest principal
// inertia, from the product of inertia of the rects about the centroid.
function angleRmin(rs: Rect[], p: { A: number; Is: number; Iw: number }): number {
  const box = rs.map(([v0, v1, w0, w1]) => ({ a: (v1 - v0) * (w1 - w0), v: (v0 + v1) / 2, w: (w0 + w1) / 2 }));
  const cv = box.reduce((s, r) => s + r.a * r.v, 0) / p.A;
  const cw = box.reduce((s, r) => s + r.a * r.w, 0) / p.A;
  const Ivw = box.reduce((s, r) => s + r.a * (r.v - cv) * (r.w - cw), 0);
  const Imin = (p.Is + p.Iw) / 2 - Math.hypot((p.Is - p.Iw) / 2, Ivw);
  return Math.sqrt(Imin / p.A);
}

// one angle: `long` is the leg along the gap (on the gusset), `short` the
// outstanding leg (an arm brace, L4X3X1/2)
export const singleAngleOf = (id: string, long: number, short: number, t: number) => shaped(id, 'L', long, short, t, t);

// one equal angle (leg x leg x t): L4X4X1/2, L 100x100x10 (an X brace)
export const singleAngle = (id: string, leg: number, t: number) => singleAngleOf(id, leg, leg, t);

// a flat bar, b wide and t thick (an X brace, a specimen brace FB 35.3x3.3)
export const flatBar = (id: string, b: number, t: number) => shaped(id, 'FB', b, t, t, t);

// a channel: C, MC, UPN, UPE (parallel flanges of the mean thickness)
export const channelSection = (id: string, d: number, bf: number, tf: number, tw: number) => shaped(id, 'C', d, bf, tf, tw);

// two angles back to back, ANGLE_GAP apart: `long` is the leg along the gap,
// `short` the outstanding leg of one angle (a specimen brace, 2 L89x64x6.4)
export const doubleAngleOf = (id: string, long: number, short: number, t: number) => shaped(id, '2L', long, 2 * short + ANGLE_GAP, t, t);

// two channels back to back, ANGLE_GAP apart: b is the flange of one channel.
// The gusset goes in the gap, like a double angle (a specimen brace, 2 C100X8)
export const doubleChannelOf = (id: string, d: number, b: number, tf: number, tw: number) => shaped(id, '2C', d, 2 * b + ANGLE_GAP, tf, tw);

// two equal angles (leg x leg x t) back to back: 2L4X4X1/2, 2L 100x100x10
export const doubleAngle = (id: string, leg: number, t: number) => doubleAngleOf(`2${id}`, leg, leg, t);

// a tee from its dimensions: d the full depth, flange bf x tf, stem tw (a specimen brace, WT125x33.5)
export const teeSection = (id: string, d: number, bf: number, tf: number, tw: number) => shaped(id, 'T', d, bf, tf, tw);

// half an I: W16X50 gives WT8X25, IPE 300 gives 1/2 IPE 300
export function teeOf(s: Section): Section {
  const w = /^W([\d.]+)X([\d.]+)$/.exec(s.id);
  const id = w ? `WT${+w[1] / 2}X${+w[2] / 2}` : `1/2 ${s.id}`;
  return shaped(id, 'T', s.d / 2, s.bf, s.tf, s.tw);
}

// rod diameters: inches for AISC, mm for EU (the tables have no rods)
const RODS: Record<Family, [string, number][]> = {
  aisc: [['3/4', 0.75], ['7/8', 0.875], ['1', 1], ['1-1/4', 1.25], ['1-1/2', 1.5], ['1-3/4', 1.75], ['2', 2]].map(([n, x]) => [`ROD ${n}"`, (x as number) * 25.4]),
  eu: [16, 20, 24, 27, 30, 36, 42, 48].map((x) => [`M${x} rod`, x]),
};

// flat bars, the tables have none: inches for AISC, mm for EU, t at most b / 4
const FLATS: Record<Family, [string, number, number][]> = {
  aisc: [2, 3, 4, 5, 6].flatMap((b) => ([['1/4', 0.25], ['3/8', 0.375], ['1/2', 0.5], ['5/8', 0.625], ['3/4', 0.75]] as const).filter(([, t]) => t <= b / 4).map(([n, t]): [string, number, number] => [`FB ${b}x${n}`, b * 25.4, t * 25.4])),
  eu: [50, 60, 80, 100, 120, 150].flatMap((b) => [6, 8, 10, 12, 15, 20].filter((t) => t <= b / 4).map((t): [string, number, number] => [`FL ${b}x${t}`, b, t])),
};

// A CSV text (RFC 4180) as one object per row, keyed by the header. A quoted
// cell can hold commas, new lines and "" for a quote: the hub tables have them
// (a reference on many lines). Cells are trimmed, empty lines skipped, the
// line ends can be \n or \r\n, a BOM at the start is dropped.
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let [row, cell, quoted] = [[] as string[], '', false];
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (s[i + 1] === '"') [cell, i] = [cell + '"', i + 1];
      else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') [row, cell] = [[...row, cell], ''];
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      rows.push([...row, cell]);
      [row, cell] = [[], ''];
    } else cell += ch;
  }
  rows.push([...row, cell]);
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  if (!head) return [];
  const keys = head.map((h) => h.trim());
  return body.map((cells) => Object.fromEntries(keys.map((k, i) => [k, (cells[i] ?? '').trim()])));
}

const byArea = (a: Section, b: Section) => a.A - b.A;

// i: the I-section table, hss: the tube table, channels, angles and pipes:
// the shape tables, all raw CSV text. Without the shape tables (an older
// caller, the hub), the channels, angles and pipes lists are empty.
export function loadCatalog(family: Family, i: string, hss: string, channels = '', angles = '', pipes = ''): Catalog {
  const angleRows = angles ? parseCsv(angles) : [];
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
    // C3, UPN 80 and up: a shear tab fits on the web
    channels: (channels ? parseCsv(channels) : []).map((r) => channelSection(r.id, +r.d, +r.bf, +r.tf, +r.tw)).filter((s) => s.d >= 75).sort(byArea),
    // equal angles, L3 to L8 and L 75 to L 200: one bolt line fits in the leg
    angles: angleRows.filter((r) => r.d === r.b && +r.d >= 75 && +r.d <= 210).map((r) => doubleAngle(r.id, +r.d, +r.t)).sort(byArea),
    tees: shapes.map(teeOf).sort(byArea),
    flats: FLATS[family].map(([id, b, t]) => flatBar(id, b, t)).sort(byArea),
    // equal angles, L2 to L6 and L 50 to L 150: a single X brace
    singles: angleRows.filter((r) => r.d === r.b && +r.d >= 50 && +r.d <= 155).map((r) => singleAngle(r.id, +r.d, +r.t)).sort(byArea),
    // one angle for an arm brace, legs from 50 to 155 mm: one bolt line fits
    // in the leg on the gusset. Not `singles`: the X braces keep their list.
    braceAngles: angleRows.filter((r) => r.d === r.b && +r.d >= 50 && +r.d <= 155).map((r) => singleAngle(r.id, +r.d, +r.t)).sort(byArea),
    // round tubes from 60 to 300 mm, like the square ones. Not in `all`: a
    // specimen finds its round tube by its sizes, not in a table.
    pipes: (pipes ? parseCsv(pipes) : []).map((r) => chsSection(r.id, +r.d, +r.t)).filter((s) => s.d >= 60 && s.d <= 300).sort(byArea),
    all: [...allShapes, ...allTubes],
  };
}
