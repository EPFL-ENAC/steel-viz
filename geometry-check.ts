// Shared by the geometry-*.test.ts files. Node runs the tests of one file one
// after the other, but the files at the same time, so these tests are split in
// a few files to run in parallel. generate() takes almost all the time, so
// tests that look at the same structures stay in one file and share them with
// make(). This is why the split of the default structures goes by family: each
// family is 120 structures, made once in its own file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog, type Family } from './sections.ts';
import { floating, generate, X_KINDS, type Form, type Params, type Result } from './generate.ts';
import { clashes } from './clash.ts';
import { readTables } from './tables.ts';
import { triangles } from './triangles.ts';
import { cross, len, sub, type V } from './vec.ts';

export const cats = {
  aisc: loadCatalog('aisc', ...readTables('aisc')),
  eu: loadCatalog('eu', ...readTables('eu')),
};
export const names = Object.keys(cats) as Family[];
export const forms: Form[] = ['tree', 'portal', 'box'];

// The structure of these params, made once in this file. Use it only for
// structures that another test of the file looks at too: keeping a structure
// costs memory and GC time, the others go straight to generate(). The key is
// the params as given (in any order), never merged with DEFAULTS: "the look
// settings at their default change nothing" must compare two real runs.
const made = new Map<string, Result>();
export function make(p: Partial<Params>, family: Family = 'aisc') {
  const key = `${family} ${JSON.stringify(Object.entries(p).sort(([a], [b]) => (a < b ? -1 : 1)))}`;
  if (!made.has(key)) made.set(key, generate(p, cats[family]));
  return made.get(key)!;
}

// which kind of section each brace, secondary and truss chord got (not the
// X diagonals: shapeP doesn't pick theirs)
export function shapes(st: ReturnType<typeof generate>['st']) {
  return [
    ...st.arms.flatMap((a) => [...a.braces.filter((b) => !b.x).map((b) => `brace ${b.sec.kind}`), ...(a.truss ? [`chord ${a.truss.chord.kind}`] : [])]),
    ...st.secs.map((s) => `secondary ${s.sec.kind}`),
  ];
}

// the triangles of a face cover it: the same area, at most n - 2 triangles for
// n corners (fewer when a corner sits on a straight side), and no flat one.
// The faces with 5 corners or more are the ends of I, C, L and T sections
// (concave) and the bolt heads.
export const area = (pts: V[]) => {
  const n: V = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const c = cross(pts[i], pts[(i + 1) % pts.length]);
    for (let k = 0; k < 3; k++) n[k] += c[k] / 2;
  }
  return len(n);
};

// The tests on the 120 default structures of one family (40 seeds, 3 forms),
// made once and shared.
export function defaultTests(name: Family) {
  test(`${name}: no part goes through another one`, () => {
    for (const form of forms)
      for (let seed = 1; seed <= 40; seed++) {
        const found = clashes(make({ seed, form }, name).parts);
        assert.deepEqual(found, [], `${name} ${form} seed ${seed}`);
      }
  });

  test(`${name}: every form stands up and every part has a support`, () => {
    for (const form of forms)
      for (let seed = 1; seed <= 40; seed++) {
        const r = make({ seed, form }, name);
        assert.ok(r.ok, `${name} ${form} seed ${seed}: mechanism`);
        assert.equal(r.st.form, form);
        assert.deepEqual(floating(r.parts), [], `${name} ${form} seed ${seed}`);
      }
  });

  // how many seeds of each form get a truss: trees need the low truss, and a
  // box (4 to 8 bay beams) must not get one on almost every seed
  test(`${name}: trusses on every form`, (t) => {
    const count: Record<string, number> = {};
    for (const form of forms) {
      count[form] = 0;
      for (let seed = 1; seed <= 40; seed++) if (make({ seed, form }, name).st.arms.some((a) => a.truss)) count[form]++;
    }
    t.diagnostic(`${name}, seeds with a truss of 40: ${forms.map((f) => `${f} ${count[f]}`).join(', ')}`);
    assert.ok(count.tree >= 3, `${name}: ${count.tree} trees with a truss`);
    assert.ok(count.box <= 16, `${name}: ${count.box} boxes with a truss`);
  });

  // the new details show up on some seeds, not on all of them
  test(`${name}: beam splices and posts on some seeds`, (t) => {
    const n = { splice: 0, post: 0, all: 0 };
    for (const form of forms)
      for (let seed = 1; seed <= 40; seed++) {
        const ids = make({ seed, form }, name).parts.map((p) => p.id);
        n.all++;
        if (ids.some((i) => /^arm\d+-splice$/.test(i))) n.splice++;
        if (ids.some((i) => /-post$/.test(i))) n.post++;
      }
    t.diagnostic(`${name}, structures of ${n.all}: beam splice ${n.splice}, post ${n.post}`);
    for (const k of ['splice', 'post'] as const) assert.ok(n[k] > 0 && n[k] < n.all, `${name}: ${k} on ${n[k]} of ${n.all}`);
  });

  // the default shapeP gives some double angle braces, channel secondaries and
  // tee chords in both families, next to the tubes and the I sections
  test(`${name}: channels, double angles and tees`, (t) => {
    const count: Record<string, number> = {};
    for (const form of forms)
      for (let seed = 1; seed <= 40; seed++) for (const k of shapes(make({ seed, form }, name).st)) count[k] = (count[k] ?? 0) + 1;
    t.diagnostic(`${name}: ${Object.entries(count).sort().map(([k, n]) => `${k} ${n}`).join(', ')}`);
    for (const k of ['brace 2L', 'brace RHS', 'brace CHS', 'secondary C', 'secondary I', 'chord T', 'chord I']) assert.ok(count[k] > 0, `${name}: no ${k}`);
  });

  // the tooltip of the playground: every part says what it is, and every
  // member has its forces and its ratio, the same max ratio as the log
  test(`${name}: every part has its info, every member its check`, () => {
    for (const form of forms)
      for (let seed = 1; seed <= 40; seed++) {
        const r = make({ seed, form }, name);
        const at = `${name} ${form} seed ${seed}`;
        assert.deepEqual(r.parts.filter((p) => !p.info?.type).map((p) => p.id), [], at);
        assert.deepEqual(r.parts.filter((p) => p.info?.member && !r.members[p.info.member]).map((p) => p.id), [], at);
        const max = Math.max(...Object.values(r.members).map((m) => m.ratio));
        assert.ok(Math.abs(max - r.ratio) < 1e-6, `${at}: max ratio ${max} in members, ${r.ratio} in the log`);
      }
  });

  test(`${name}: triangles cover every face`, () => {
    let big = 0;
    for (const form of forms)
      for (let seed = 1; seed <= 10; seed++)
        for (const p of make({ seed, form }, name).parts)
          for (const f of p.faces) {
            const out: number[] = [];
            triangles(f.pts, out);
            const at = `${name} ${form} seed ${seed} ${p.id}, ${f.pts.length} corners`;
            assert.ok(out.length > 0 && out.length <= 9 * (f.pts.length - 2), at);
            const want = area(f.pts);
            let sum = 0;
            for (let k = 0; k < out.length; k += 9) {
              const [a, b, c] = [0, 3, 6].map((o) => out.slice(k + o, k + o + 3) as V);
              const t = len(cross(sub(b, a), sub(c, a))) / 2;
              assert.ok(t > 1e-9 * want, `${at}: a flat triangle`);
              sum += t;
            }
            assert.ok(Math.abs(sum - want) <= 1e-6 * want + 1e-6, `${at}: area ${sum}, not ${want}`);
            if (f.pts.length > 4) big++;
          }
    assert.ok(big > 0, `${name}: no face with 5 corners or more`);
  });
}

export function xBracing(name: Family) {
  // X bracing: two diagonals that cross (or one plain diagonal when the second
  // one doesn't fit), tension only in the check, and the crossing details
  test(`X bracing, ${name}: every kind, no clash`, () => {
    const KIND = { flat: 'FB', rod: 'ROD', angle: 'L' } as const;
    for (const xKind of X_KINDS) {
      let xs = 0;
      for (const over of [{ form: 'portal', storeys: 2 }, { form: 'box' }] as const)
        for (let seed = 1; seed <= 15; seed++) {
          const r = generate({ seed, bracing: 'x', xKind, ...over }, cats[name]);
          const at = `${name} ${over.form} ${xKind} seed ${seed}`;
          assert.deepEqual(clashes(r.parts), [], at);
          assert.deepEqual(floating(r.parts), [], at);
          const ids = new Set(r.parts.map((q) => q.id));
          for (const a of r.st.arms) {
            const x = a.braces.flatMap((b, k) => (b.x ? [[b, k] as const] : []));
            assert.ok(x.length === 0 || x.length === 2, `${at} ${a.id}: ${x.length} X diagonals`);
            if (!x.length) continue;
            xs++;
            for (const [b, k] of x) {
              const id = `${a.id}-brace${k ? k + 1 : ''}`;
              assert.equal(b.sec.kind, KIND[xKind], `${at} ${id}`);
              if (xKind === 'rod') assert.ok(ids.has(`${id}-turnbuckle`), `${at} ${id}: no turnbuckle`);
              if (!r.ok) continue;
              const m = r.members[id];
              assert.ok(m, `${at} ${id}: no check`);
              assert.equal(m.Nc, 0, `${at} ${id}`);
              assert.ok(m.ratio <= 0.6, `${at} ${id}: ratio ${m.ratio.toFixed(2)}`);
            }
            if (xKind !== 'rod') assert.ok(ids.has(`${a.id}-x-filler`), `${at} ${a.id}: no filler`);
          }
        }
      assert.ok(xs > 10, `${name} ${xKind}: only ${xs} X`);
    }
  });
}
