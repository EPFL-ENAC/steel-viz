// Doubler plates on the column web of a beam-to-column test: the hub reader,
// the plates next to the continuity plates, and the panel zone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clashes } from './clash.ts';
import { DEFORMS } from './deforms.ts';
import { floating, generate } from './generate.ts';
import { fromHubConnection, type HubRecord } from './hub.ts';
import { loadCatalog } from './sections.ts';
import type { Part } from './steel.ts';
import { readTables } from './tables.ts';

const cat = loadCatalog('aisc', ...readTables('aisc'));
// Lee CR1: interior, beam loaded, W14 column, no continuity plates, no doubler
const base: HubRecord = JSON.parse(readFileSync(new URL('./specimens/Lee_et_al_2002_CR1.json', import.meta.url), 'utf8'));
const withDp = (extra: HubRecord) => ({ ...base, n_dp: 2, t_dp: 12.7, wd: 317.5, t_cp: 12.7, ...extra });
const build = (rec: HubRecord) => {
  const spec = fromHubConnection(rec);
  return { spec, r: generate({ specimen: spec }, cat) };
};
const doublers = (ps: Part[]) => ps.filter((p) => /^column-doubler/.test(p.id));
// the extent of a part along axis k
const span = (p: Part, k: number) => {
  const xs = p.faces.flatMap((f) => f.pts.map((q) => q[k]));
  return [Math.min(...xs), Math.max(...xs)];
};
const near = (a: number, b: number, msg: string) => assert.ok(Math.abs(a - b) < 0.01, `${msg}: ${a} is not ${b}`);

test('hub: n_dp, t_dp and wd give the doubler, with no note', () => {
  const s = fromHubConnection(withDp({}));
  assert.deepEqual(s.doubler, { n: 2, t: 12.7, w: 317.5 });
  assert.ok(!s.notes!.some((n) => /doubler/.test(n)));
  assert.equal(fromHubConnection(withDp({ wd: 'NA' })).doubler!.w, undefined);
  assert.equal(fromHubConnection(withDp({ n_dp: 0 })).doubler, undefined);
  assert.equal(fromHubConnection(withDp({ n_dp: 'NA' })).doubler, undefined);
  assert.throws(() => fromHubConnection(withDp({ n_dp: 3 })), /: n_dp "3" is not supported yet$/);
  assert.throws(() => fromHubConnection(withDp({ t_dp: 'NA' })), /: t_dp is missing$/);
});

test('two plates between the continuity plates, on the web faces', () => {
  const { r } = build(withDp({}));
  assert.ok(r.ok, r.log.join('\n'));
  assert.deepEqual(clashes(r.parts), []);
  assert.deepEqual(floating(r.parts), []);
  const [w, e] = doublers(r.parts);
  assert.deepEqual([w.id, e.id], ['column-doublerw', 'column-doublere']);
  const { tw, tf } = r.st.col;
  for (const [p, s] of [[w, -1], [e, 1]] as const) {
    assert.deepEqual(p.supports, ['column']);
    assert.equal(p.info!.type, 'Doubler plate');
    const [x0, x1] = span(p, 0).map((x) => x * s).sort((a, b) => a - b);
    near(x0, tw / 2, `${p.id} on the web face`);
    near(x1, tw / 2 + 12.7, `${p.id} thickness`);
    near(span(p, 1)[1] - span(p, 1)[0], 317.5, `${p.id} width`);
    // it touches the continuity plates of its side, above and below
    const cps = r.parts.filter((q) => q.id.startsWith('column-stiffener') && q.id.endsWith(p.id.at(-1)!));
    assert.equal(cps.length, 2);
    const [lo, hi] = cps.map((q) => span(q, 2)).sort((a, b) => a[0] - b[0]);
    const z = span(p, 2);
    near(z[0], lo[1], `${p.id} bottom`);
    near(z[1], hi[0], `${p.id} top`);
    // the continuity plates are the same as with no doubler (thickness of the column flange)
    near(lo[1] - lo[0], Math.max(10, Math.round(tf)), 'continuity plate');
  }
  // the panel zone is between the plates (the clear depth dz, less the continuity plates)
  const a = r.st.arms[0];
  assert.ok(span(w, 2)[1] - span(w, 2)[0] < a.sec.d - 2 * a.sec.tf);
});

test('one plate on the -x side, and the width is at most the clear web', () => {
  const { r } = build(withDp({ n_dp: 1, wd: 999 }));
  const ds = doublers(r.parts);
  assert.deepEqual(ds.map((p) => p.id), ['column-doublerw']);
  assert.ok(span(ds[0], 0)[1] < 0);
  near(span(ds[0], 1)[1] - span(ds[0], 1)[0], r.st.col.d - 2 * r.st.col.tf, 'width');
  assert.deepEqual(clashes(r.parts), []);
});

test('no continuity plates: the plate goes 150 mm past the beam flanges', () => {
  const { r } = build(withDp({ t_cp: 0 }));
  assert.equal(r.parts.filter((q) => q.id.startsWith('column-stiffener')).length, 0);
  const a = r.st.arms[0];
  for (const p of doublers(r.parts)) {
    const z = span(p, 2);
    near(z[0], a.z - a.sec.d - 150, 'bottom');
    near(z[1], a.z + 150, 'top');
  }
  assert.deepEqual(clashes(r.parts), []);
  assert.deepEqual(floating(r.parts), []);
});

test('deformed: the plates move with the column, the web and the plates take the shear', () => {
  const T = DEFORMS.connections;
  const at = { Global: { x: 0.02, y: 100, along: 0.02 } };
  // γ at the panel zone knot of the column: t - r
  const gamma = (rec: HubRecord) => {
    const { spec, r } = build(rec);
    const d = T.shape(r, spec, rec, at, 1);
    for (const p of doublers(r.parts)) assert.equal(d.moves[p.id], d.moves.column, p.id);
    const k = d.moves.column.knots[2];
    return k.t - k.r;
  };
  const tw = base.t_cw as number;
  const [none, two] = [gamma({ ...withDp({}), n_dp: 0 }), gamma(withDp({}))];
  assert.ok(Math.abs(none) > 0 && Math.abs(none) < 0.01, `elastic, not capped: ${none}`);
  assert.ok(Math.abs(two / none - tw / (tw + 2 * 12.7)) < 1e-6, `${two} / ${none}`);
});

test('a seed has no doubler', () => {
  for (const seed of [1, 5, 9]) assert.deepEqual(doublers(generate({ seed }, cat).parts), []);
});
