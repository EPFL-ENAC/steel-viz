// The Angle and Double Channel rows of the hub `braces` table: how the columns
// are read, how the section sits on its plates, and the deformed shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clashes } from './clash.ts';
import { BRACE_DEFORM, geometry, bendDirection } from './deform-braces.ts';
import { movePoint, protocol, readResponse } from './deform.ts';
import { floating, generate, type Result } from './generate.ts';
import { fromHubBrace, type HubRecord } from './hub.ts';
import { doubleChannelOf, loadCatalog, rects, ANGLE_GAP } from './sections.ts';
import { findSection, type BraceSpecimen, type SectionRef } from './specimen.ts';
import type { Part } from './steel.ts';
import { readTables } from './tables.ts';
import { add, dot, mul, sub, type V } from './vec.ts';

const cat = loadCatalog('aisc', ...readTables('aisc'));
const record = (id: string): HubRecord => JSON.parse(readFileSync(new URL(`./specimens/${id}.json`, import.meta.url), 'utf8'));
const read = (rec: HubRecord): BraceSpecimen => fromHubBrace(rec);
const draw = (spec: BraceSpecimen): Result => generate({ specimen: spec }, cat, 'bolts');
const channels = (spec: BraceSpecimen) => spec.section as Extract<SectionRef, { shape: '2C' }>;
const part = (r: Result, id: string): Part => {
  const p = r.parts.find((q) => q.id === id);
  assert.ok(p, `no part ${id} in ${r.parts.map((q) => q.id).join(', ')}`);
  return p;
};
const xs = (p: Part) => p.faces.flatMap((f) => f.pts).map((v) => v[0]);
const near = (a: number, b: number, msg: string, tol = 0.01) => assert.ok(Math.abs(a - b) < tol, `${msg}: ${a} is not ${b}`);
const sound = (r: Result) => {
  assert.ok(r.ok, r.log.join('\n'));
  assert.deepEqual(clashes(r.parts), []);
  assert.deepEqual(floating(r.parts), []);
};

// ---- reading the double channels
const READ = [
  { id: 'Black_Strut-11', tf: 9.9, tw: 5.68, b: 57, note: /t_br 19\.8 read as two flanges, b_br 114 as the pair, the web 5\.68/ },
  { id: 'Lehman_Roeder_HSS29', tf: 9.5, tw: 7.9, b: 63 },
  { id: 'Aslani_C1', tf: 8.1, tw: 4.8, b: 44, note: /t_br 4\.8 read as the web and w_br 8\.1 as the flange/ },
  { id: 'Aslani_C2', tf: 7.5, tw: 4.7, b: 40, note: /b_br 80 read as the width of the pair/ },
  { id: 'Aslani_C3', tf: 7.5, tw: 4.7, b: 40, note: /b_br 80 read as the width of the pair/ },
];

test('double channels: the columns of the 5 rows', () => {
  for (const { id, tf, tw, b, note } of READ) {
    const spec = read(record(id));
    const s = channels(spec);
    assert.equal(s.shape, '2C', id);
    near(s.tf, tf, `${id} flange`);
    near(s.tw, tw, `${id} web`);
    near(s.b, b, `${id} width`);
    assert.ok(s.tf >= s.tw, `${id}: the flange is the thicker one`);
    const area = Number(record(id).area);
    const A = findSection(s, cat).A;
    assert.ok(Math.abs(A - area) < 0.015 * area, `${id}: area ${A}, the row says ${area}`);
    if (note) assert.ok(spec.notes?.some((n) => note.test(n)), `${id}: ${spec.notes?.join(' | ')}`);
    else assert.deepEqual(spec.notes?.filter((n) => /read as/.test(n)), [], id);
  }
});

test('double channels: the closest area is not what picks the flange (Lehman_Roeder_HSS29)', () => {
  // t_br as the web would give 4579 against 4560, but then the flange is thinner than the web
  const s = channels(read(record('Lehman_Roeder_HSS29')));
  assert.deepEqual([s.tf, s.tw], [9.5, 7.9]);
});

test('double channels: the stitches get a note, and only when the row has a spacing', () => {
  const stitches = (id: string) => read(record(id)).notes?.filter((n) => n.includes('stitches')) ?? [];
  assert.match(stitches('Aslani_C1')[0], /stick_space 533\.4 mm/);
  assert.match(stitches('Aslani_C3')[0], /stick_space 254 mm/);
  assert.deepEqual(stitches('Aslani_C2'), []);
  assert.deepEqual(stitches('Black_Strut-11'), []);
});

test('double channels: a web from area that makes no sense, and no area, give the known errors', () => {
  const black = record('Black_Strut-11');
  assert.throws(() => read({ ...black, area: 100 }), /^Error: Black_Strut-11: area "100" is not supported yet$/);
  assert.throws(() => read({ ...black, area: 'nr' }), /^Error: Black_Strut-11: area is missing$/);
});

test('double channels: the section is symmetric, its area is the sum of its plates', () => {
  const s = doubleChannelOf('x', 200, 60, 10, 6);
  assert.equal(s.bf, 2 * 60 + ANGLE_GAP);
  const rs = rects(s);
  assert.equal(rs.reduce((m, [a]) => Math.min(m, a), 0), -s.bf / 2);
  assert.equal(rs.reduce((m, [, b]) => Math.max(m, b), 0), s.bf / 2);
  near(rs.reduce((sum, [a, b, c, e]) => sum + (b - a) * (e - c), 0), 2 * (2 * 60 * 10 + 180 * 6), 'area');
  near(s.A, 2 * (2 * 60 * 10 + 180 * 6), 'A');
  assert.ok(rs.every(([a, b]) => a >= ANGLE_GAP / 2 || b <= -ANGLE_GAP / 2), 'nothing in the gap');
  assert.throws(() => findSection({ id: 'x', shape: '2C', d: 10, b: 60, tf: 6, tw: 6 }, cat), /too thick/);
  assert.throws(() => findSection({ id: 'x', shape: 'L', d: 6, t: 6 }, cat), /too thick/);
});

test('double channels: the gusset goes in the gap, drawn at each end', () => {
  for (const { id } of READ.slice(1)) {
    const r = draw(read(record(id)));
    sound(r);
    const brace = part(r, 'brace');
    const axis = (Math.min(...xs(brace)) + Math.max(...xs(brace))) / 2;
    const gussets = r.parts.filter((p) => p.id.startsWith('brace-') && p.id.endsWith('-conn'));
    assert.ok(gussets.length >= 2, `${id}: ${r.parts.map((p) => p.id).join(', ')}`);
    for (const g of gussets) {
      assert.ok(Math.min(...xs(g)) >= axis - ANGLE_GAP / 2 - 1e-6, `${id} ${g.id}: into the web`);
      assert.ok(Math.max(...xs(g)) <= axis + ANGLE_GAP / 2 + 1e-6, `${id} ${g.id}: into the web`);
    }
  }
  sound(draw(read(record('Black_Strut-11'))));
});

// ---- the angle
const JAIN = record('Jain_2L');

test('angle: the section of a row, the errors, and the note on the area', () => {
  const spec = read(JAIN);
  assert.deepEqual(spec.section, { id: 'L25.4x25.4x6.4', shape: 'L', d: 25.4, t: 6.4 });
  assert.ok(!spec.notes?.some((n) => n.includes('does not match')), spec.notes?.join(' | '));
  assert.throws(() => read({ ...JAIN, b_br: 30 }), /^Error: Jain_2L: cross_section_size "L25\.4x25\.4x6\.4" is not supported yet$/);
  assert.throws(() => read({ ...JAIN, t_br: 'nr' }), /^Error: Jain_2L: t_br is missing$/);
  // Jain_3L and Jain_7L: the area fits a leg of 44 mm, the name and d_br say 37.7
  const off = read({ ...JAIN, cross_section_size: 'L37.7x37.7x3.18', d_br: 37.7, b_br: 37.7, t_br: 3.18, area: 273 });
  assert.ok(off.notes?.some((n) => /area 273 does not match the legs d_br and b_br \(230\), drawn from the legs/.test(n)), off.notes?.join(' | '));
});

test('angle: the connected leg is flat on the gusset, the other one points away', () => {
  const spec = read(JAIN);
  const r = draw(spec);
  sound(r);
  const brace = part(r, 'brace');
  const gussets = r.parts.filter((p) => p.id.startsWith('brace-') && p.id.endsWith('-conn'));
  assert.ok(gussets.length >= 2, r.parts.map((p) => p.id).join(', '));
  const back = Math.min(...xs(brace));
  near(Math.max(...xs(brace)) - back, 25.4, 'the outstanding leg');
  for (const g of gussets) {
    const [lo, hi] = [Math.min(...xs(g)), Math.max(...xs(g))];
    near(hi, back, `${g.id}: the back is on its face`, 1e-6);
    near(hi - lo, 10, `${g.id}: thickness`);
  }
});

test('angle: with end plates it goes to their middle', () => {
  const spec: BraceSpecimen = { ...read(JAIN), ends: 'fixed' };
  const r = draw(spec);
  assert.ok(r.ok, r.log.join('\n'));
  const brace = xs(part(r, 'brace'));
  const middle = (Math.min(...brace) + Math.max(...brace)) / 2;
  const plates = ['brace-from-plate', 'brace-to-plate'].flatMap((id) => xs(part(r, id)));
  near(middle, (Math.min(...plates) + Math.max(...plates)) / 2, 'the middle of the plates', 0.5);
});

// ---- the deformed shape
// the shape at each step of the file
function play(id: string) {
  const rec = record(id);
  const spec = read(rec);
  const r = draw(spec);
  const csv = readFileSync(new URL(`./specimens/responses/braces/force_displacement/${id}.csv`, import.meta.url), 'utf8');
  const proto = protocol({ force_displacement: readResponse(csv) });
  const shapes = Array.from({ length: proto.n }, (_, i) => BRACE_DEFORM.shape(r, spec, rec, proto.at(i), 1));
  return { r, rec, proto, shapes };
}

test('angle and double channel: the levels are finite on the whole file', () => {
  for (const id of ['Jain_2L', 'Black_Strut-11']) {
    const { shapes } = play(id);
    for (const d of shapes) for (const z of d.zones) assert.ok(Number.isFinite(z.level), `${id} ${z.label}`);
    assert.ok(shapes.some((d) => d.zones.some((z) => z.level > 0.5)), id);
  }
});

test('angle: it bows out of plane, toward its outstanding leg', () => {
  const { r, rec, shapes } = play('Jain_2L');
  const [l] = geometry(r, rec).lines;
  assert.deepEqual(bendDirection('gusset', r.st.col, l.u), [1, 0, 0]);
  assert.deepEqual(l.n, [1, 0, 0]);
  const brace = xs(part(r, 'brace'));
  assert.ok(Math.max(...brace) - l.o[0] > l.o[0] - Math.min(...brace), 'the leg is on +x');
  // the middle of the brace, at each step
  const middle = add(l.o, mul(l.u, (l.bend[0] + l.bend[1]) / 2));
  const moves = shapes.map((d) => sub(movePoint(middle, d.moves.brace!), middle)[0]);
  assert.ok(Math.max(...moves) > 50, `the bow reaches ${Math.max(...moves)} mm`);
  assert.ok(Math.min(...moves) > -1e-6, `the bow goes back to ${Math.min(...moves)} mm`);
});

test('angle: the bow has no big kink, the short brace is cut in small pieces', () => {
  const { r, rec } = play('Jain_2L');
  const [l] = geometry(r, rec).lines;
  const along = part(r, 'brace').faces.flatMap((f) => f.pts).map((p) => Math.round(dot(sub(p, l.o), l.u)));
  const marks = [...new Set(along)].sort((a, b) => a - b);
  assert.ok(marks.length >= 8, `${marks.length} cuts`);
  assert.ok(marks.slice(1).every((m, i) => m - marks[i] <= 1194 / 12 + 1), marks.join(', '));
});

test('angle: the zones cover the whole section, on its own side of the axis', () => {
  const { r, shapes } = play('Jain_2L');
  const zones = shapes.flatMap((d) => d.zones).slice(0, 4);
  assert.ok(zones.length);
  const pts = part(r, 'brace').faces.flatMap((f) => f.pts);
  for (const z of zones) {
    const across = pts.map((p: V) => dot(sub(p, z.c), z.axes[1]));
    assert.ok(Math.max(...across.map(Math.abs)) <= z.half[1], `${z.label}: ${Math.min(...across)} to ${Math.max(...across)}, half ${z.half[1]}`);
  }
});

test('angle: at the peak, the gusset stays flat and the angle stays on its face', () => {
  const { r, rec, shapes } = play('Jain_2L');
  const [l] = geometry(r, rec).lines;
  const biggest = shapes.reduce((a, b) => (b.moves.brace!.knots[3].w > a.moves.brace!.knots[3].w ? b : a));
  const m = biggest.moves.brace!;
  assert.ok(m.knots[3].w > 50, `bow ${m.knots[3].w}`);
  const out = (p: V) => dot(p, l.n);
  for (const end of ['from', 'to']) {
    const plate = part(r, `brace-${end}-conn`);
    const pts = plate.faces.flatMap((f) => f.pts);
    const back = Math.min(...pts.map(out));
    const moved = pts.map((p) => out(movePoint(p, biggest.moves[plate.id]!)) - out(movePoint(p, { ...biggest.moves[plate.id]!, knots: [] })));
    assert.ok(Math.max(...moved.map(Math.abs)) < 0.01, `${end} plate moves ${Math.max(...moved.map(Math.abs))} mm`);
    const [a, b] = [Math.min(...pts.map((p) => dot(sub(p, l.o), l.u))), Math.max(...pts.map((p) => dot(sub(p, l.o), l.u)))];
    const lap = part(r, 'brace').faces.flatMap((f) => f.pts).filter((p) => { const s = dot(sub(p, l.o), l.u); return s >= a && s <= b; });
    assert.ok(lap.length);
    for (const p of lap) assert.ok(out(movePoint(p, m)) - out(movePoint(p, { ...m, knots: [] })) > back - out(p), 'the angle comes through the plate');
  }
});

test('double channel: Black_Strut-11 bows on its weak axis, with pins at its ends', () => {
  const { r, rec, shapes } = play('Black_Strut-11');
  const [l] = geometry(r, rec).lines;
  near(Math.abs(l.n[0]), 1, 'out of plane');
  assert.ok(shapes[0].notes?.some((n) => n.includes('the pin is drawn the wrong way')), shapes[0].notes?.join(' | '));
});
