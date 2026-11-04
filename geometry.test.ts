// node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from './sections.ts';
import { floating, generate, type Form } from './generate.ts';
import { clashes } from './clash.ts';
import { readTables } from './tables.ts';
import { triangles } from './triangles.ts';
import { cross, len, sub, type V } from './vec.ts';

const cats = {
  aisc: loadCatalog('aisc', ...readTables('aisc')),
  eu: loadCatalog('eu', ...readTables('eu')),
};

const forms: Form[] = ['tree', 'portal', 'box'];

// the 240 structures most tests look at (40 seeds, 3 forms, 2 families),
// made once and shared
const made = new Map<string, ReturnType<typeof generate>>();
function make(name: keyof typeof cats, form: Form, seed: number) {
  const key = `${name} ${form} ${seed}`;
  if (!made.has(key)) made.set(key, generate({ seed, form }, cats[name]));
  return made.get(key)!;
}
const names = Object.keys(cats) as (keyof typeof cats)[];

test('no part goes through another one', () => {
  for (const name of names)
    for (const form of forms)
      for (let seed = 1; seed <= 40; seed++) {
        const found = clashes(make(name, form, seed).parts);
        assert.deepEqual(found, [], `${name} ${form} seed ${seed}`);
      }
});

test('every form stands up and every part has a support', () => {
  for (const name of names)
    for (const form of forms)
      for (let seed = 1; seed <= 40; seed++) {
        const r = make(name, form, seed);
        assert.ok(r.ok, `${name} ${form} seed ${seed}: mechanism`);
        assert.equal(r.st.form, form);
        assert.deepEqual(floating(r.parts), [], `${name} ${form} seed ${seed}`);
      }
});

// how many seeds of each form get a truss: trees need the low truss, and a
// box (4 to 8 bay beams) must not get one on almost every seed
test('trusses on every form', (t) => {
  for (const name of names) {
    const count: Record<string, number> = {};
    for (const form of forms) {
      count[form] = 0;
      for (let seed = 1; seed <= 40; seed++) if (make(name, form, seed).st.arms.some((a) => a.truss)) count[form]++;
    }
    t.diagnostic(`${name}, seeds with a truss of 40: ${forms.map((f) => `${f} ${count[f]}`).join(', ')}`);
    assert.ok(count.tree >= 3, `${name}: ${count.tree} trees with a truss`);
    assert.ok(count.box <= 16, `${name}: ${count.box} boxes with a truss`);
  }
});

// the new details show up on some seeds, not on all of them
test('beam splices and posts on some seeds', (t) => {
  for (const name of names) {
    const n = { splice: 0, post: 0, all: 0 };
    for (const form of forms)
      for (let seed = 1; seed <= 40; seed++) {
        const ids = make(name, form, seed).parts.map((p) => p.id);
        n.all++;
        if (ids.some((i) => /^arm\d+-splice$/.test(i))) n.splice++;
        if (ids.some((i) => /-post$/.test(i))) n.post++;
      }
    t.diagnostic(`${name}, structures of ${n.all}: beam splice ${n.splice}, post ${n.post}`);
    for (const k of ['splice', 'post'] as const) assert.ok(n[k] > 0 && n[k] < n.all, `${name}: ${k} on ${n[k]} of ${n.all}`);
  }
});

// with their chances at 0, none of them comes in
test('no beam splice or post when their chances are 0', () => {
  for (const [name, cat] of Object.entries(cats))
    for (const form of forms)
      for (let seed = 1; seed <= 20; seed++) {
        const ids = generate({ seed, form, postP: 0, beamSpliceP: 0 }, cat).parts.map((p) => p.id);
        assert.deepEqual(ids.filter((i) => /-post|-far|^arm\d+-splice/.test(i)), [], `${name} ${form} seed ${seed}`);
      }
});

// which kind of section each brace, secondary and truss chord got
function shapes(st: ReturnType<typeof generate>['st']) {
  return [
    ...st.arms.flatMap((a) => [...a.braces.map((b) => `brace ${b.sec.kind}`), ...(a.truss ? [`chord ${a.truss.chord.kind}`] : [])]),
    ...st.secs.map((s) => `secondary ${s.sec.kind}`),
  ];
}

// the default shapeP gives some double angle braces, channel secondaries and
// tee chords in both families, next to the tubes and the I sections
test('channels, double angles and tees in both families', (t) => {
  for (const name of names) {
    const count: Record<string, number> = {};
    for (const form of forms)
      for (let seed = 1; seed <= 40; seed++) for (const k of shapes(make(name, form, seed).st)) count[k] = (count[k] ?? 0) + 1;
    t.diagnostic(`${name}: ${Object.entries(count).sort().map(([k, n]) => `${k} ${n}`).join(', ')}`);
    for (const k of ['brace 2L', 'brace RHS', 'secondary C', 'secondary I', 'chord T', 'chord I']) assert.ok(count[k] > 0, `${name}: no ${k}`);
  }
});

// shapeP 1: every brace, secondary and chord gets its other shape, and the
// structure still stands, with no clash. shapeP 0: none of them.
test('shapeP 1 and shapeP 0', () => {
  for (const [name, cat] of Object.entries(cats))
    for (const form of forms)
      for (let seed = 1; seed <= 12; seed++) {
        const all = generate({ seed, form, shapeP: 1 }, cat);
        const at = `${name} ${form} seed ${seed}`;
        assert.ok(all.ok, `${at}: mechanism`);
        assert.deepEqual(clashes(all.parts), [], at);
        assert.deepEqual(floating(all.parts), [], at);
        assert.deepEqual(shapes(all.st).filter((k) => !/ (2L|C|T)$/.test(k)), [], at);
        assert.deepEqual(shapes(generate({ seed, form, shapeP: 0 }, cat).st).filter((k) => / (2L|C|T)$/.test(k)), [], at);
      }
});

// the tooltip of the playground: every part says what it is, and every
// member has its forces and its ratio, the same max ratio as the log
test('every part has its info, every member its check', () => {
  for (const name of names)
    for (const form of forms)
      for (let seed = 1; seed <= 40; seed++) {
        const r = make(name, form, seed);
        const at = `${name} ${form} seed ${seed}`;
        assert.deepEqual(r.parts.filter((p) => !p.info?.type).map((p) => p.id), [], at);
        assert.deepEqual(r.parts.filter((p) => p.info?.member && !r.members[p.info.member]).map((p) => p.id), [], at);
        const max = Math.max(...Object.values(r.members).map((m) => m.ratio));
        assert.ok(Math.abs(max - r.ratio) < 1e-6, `${at}: max ratio ${max} in members, ${r.ratio} in the log`);
      }
});

// the triangles of a face cover it: the same area, at most n - 2 triangles for
// n corners (fewer when a corner sits on a straight side), and no flat one.
// The faces with 5 corners or more are the ends of I, C, L and T sections
// (concave) and the bolt heads.
test('triangles cover every face', () => {
  const area = (pts: V[]) => {
    const n: V = [0, 0, 0];
    for (let i = 0; i < pts.length; i++) {
      const c = cross(pts[i], pts[(i + 1) % pts.length]);
      for (let k = 0; k < 3; k++) n[k] += c[k] / 2;
    }
    return len(n);
  };
  let big = 0;
  for (const name of names)
    for (const form of forms)
      for (let seed = 1; seed <= 10; seed++)
        for (const p of make(name, form, seed).parts)
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
  assert.ok(big > 0, 'no face with 5 corners or more');
});
