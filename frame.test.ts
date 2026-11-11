// The frame test of the hub (frame.ts): Del_Caprio_et_al_2014_RBS-A. CI has
// no copy of resslab-hub-data, so the fields of the row we read are here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clashes } from './clash.ts';
import { DEFORMS } from './deforms.ts';
import { floating, generate } from './generate.ts';
import { fromHubConnection, type HubRecord } from './hub.ts';
import { loadCatalog } from './sections.ts';
import { readTables } from './tables.ts';
import type { ConnSpecimen } from './specimen.ts';

const cat = loadCatalog('aisc', ...readTables('aisc'));
const ROW: HubRecord = {
  id: 'Del_Caprio_et_al_2014_RBS-A', specimen_type: 'Exterior - Frame',
  section_c: 'W12x30', d_c: '313.436', b_cf: '165.608', t_cf: '11.176', t_cw: '6.604',
  section_b: 'W14x26', d_b: '353.314', b_bf: '127', t_bf: '10.668', t_bw: '6.477',
  connection_type: 'RBS', b_bf_rbs: '60.96', rbs_cut: '0.52', n_dp: '0', t_dp: '0', wd: '0',
  slab: 'YES', deck_ribs_orientation: 'parallel', w_l: '609.6', w_r: '609.6', h_co: '44.45', h_p: '38.1', b_o: '53.975',
  t_cp: '10.668', l_b: '4572', l_o: '2129.282', l_fc: '4258.564', h_c: '2336.8',
};
const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) < tol;

test('fromHubConnection: a frame, the bay and the cantilever, both cut, with the slab', () => {
  const s = fromHubConnection(ROW);
  assert.ok(s.frame);
  assert.deepEqual(s.beams.map((b) => b.length), [4572, 2375]);
  assert.ok(s.beams.every((b) => b.rbs && near(b.rbs.c, (127 - 60.96) / 2)));
  assert.ok(s.slab);
  assert.equal(s.column.height, 3200);
  assert.ok(s.notes?.some((n) => /Del Carpio/.test(n)), 'a note names the report');
  assert.equal(s.doubler, undefined);
  assert.deepEqual(s.frame.doubler1, { n: 1, t: 7.94 });
});

test('an "Exterior - Frame" test we have no layout for is not supported yet', () => {
  assert.throws(() => fromHubConnection({ ...ROW, id: 'Someone_2020_F1' }), /^Error: Someone_2020_F1: specimen_type "Exterior - Frame" is not supported yet$/);
});

test('the frame: two columns, the rig, no clash, no floating part', () => {
  const spec: ConnSpecimen = fromHubConnection(ROW);
  const r = generate({ specimen: spec }, cat);
  const ids = new Set(r.parts.map((p) => p.id));
  assert.equal(r.st.cols.length, 2);
  for (const id of ['base', 'base2', 'column', 'column2', 'column-cap', 'column2-cap', 'column2-doublerw', 'beam1-slab', 'beam2-slab'])
    assert.ok(ids.has(id), id);
  for (const id of ['interface1', 'interface2', 'wall', 'loading-beam', 'top-actuator', 'bottom-actuator', 'vertical-actuator1', 'vertical-actuator2', 'link-beam', 'tip-link', 'reaction-beam'])
    assert.ok(ids.has(id), id);
  assert.equal(r.parts.filter((p) => /^frame-post\d$/.test(p.id)).length, 4);
  assert.equal(r.parts.filter((p) => /^roller\d$/.test(p.id)).length, 4);
  assert.equal(r.parts.filter((p) => /^joist\d+$/.test(p.id)).length, 10);
  assert.equal(r.parts.filter((p) => p.info?.type?.endsWith(', RBS')).length, 2);
  assert.deepEqual(clashes(r.parts), []);
  assert.deepEqual(floating(r.parts), []);
});

test('the bay beam is cut near both columns', () => {
  const spec: ConnSpecimen = fromHubConnection(ROW);
  const r = generate({ specimen: spec }, cat);
  const bay = r.parts.find((p) => p.id === 'beam1')!;
  const c = spec.beams[0].rbs!.c;
  const bf = 127;
  // the girder runs along +y from column 0, the flanges are across x
  const half = new Map<number, number>();
  for (const p of bay.faces.flatMap((f) => f.pts)) {
    const y = Math.round(p[1] * 1000) / 1000;
    half.set(y, Math.max(half.get(y) ?? 0, Math.abs(p[0])));
  }
  const narrow = (lo: number, hi: number) => Math.min(...[...half].filter(([y]) => y > lo && y < hi).map(([, h]) => h));
  const L = spec.beams[0].length;
  assert.ok(near(narrow(0, L / 2), bf / 2 - c), `near column 0: ${narrow(0, L / 2)}`);
  assert.ok(near(narrow(L / 2, L), bf / 2 - c), `near column 1: ${narrow(L / 2, L)}`);
  assert.ok(near(narrow(L / 2 - 1000, L / 2 + 1000), bf / 2), 'full width in the middle');
});

test('the deformed shape of a frame test is a clear error, not a page error', () => {
  const spec = fromHubConnection(ROW);
  const r = generate({ specimen: spec }, cat);
  assert.throws(() => DEFORMS.connections.shape(r, spec, ROW, {} as never, 1), /no deformed shape for a frame test yet/);
});
