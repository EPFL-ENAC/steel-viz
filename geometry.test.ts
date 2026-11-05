// node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from './sections.ts';
import { floating, generate, X_KINDS, type Form } from './generate.ts';
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

// which kind of section each brace, secondary and truss chord got (not the
// X diagonals: shapeP doesn't pick theirs)
function shapes(st: ReturnType<typeof generate>['st']) {
  return [
    ...st.arms.flatMap((a) => [...a.braces.filter((b) => !b.x).map((b) => `brace ${b.sec.kind}`), ...(a.truss ? [`chord ${a.truss.chord.kind}`] : [])]),
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
    for (const k of ['brace 2L', 'brace RHS', 'brace CHS', 'secondary C', 'secondary I', 'chord T', 'chord I']) assert.ok(count[k] > 0, `${name}: no ${k}`);
  }
});

// roundP 1: every brace is a round tube, with a slotted end or an end cap
// plate, and the structure still stands, with no clash
test('round tube braces', () => {
  for (const [name, cat] of Object.entries(cats)) {
    const ends = new Set<string>();
    for (const form of forms)
      for (let seed = 1; seed <= 12; seed++) {
        const r = generate({ seed, form, roundP: 1, shapeP: 0, braceP: 1 }, cat);
        const at = `${name} ${form} seed ${seed}`;
        assert.ok(r.ok, `${at}: mechanism`);
        assert.deepEqual(clashes(r.parts), [], at);
        assert.deepEqual(floating(r.parts), [], at);
        assert.deepEqual(shapes(r.st).filter((k) => k.startsWith('brace') && k !== 'brace CHS'), [], at);
        for (const q of r.parts) if (q.info?.type === 'Brace') for (const c of q.info.conn ?? []) ends.add(c);
      }
    for (const k of ['gusset', 'gusset_cap']) assert.ok(ends.has(k), `${name}: no ${k} end`);
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

// gableP 1: every one storey portal gets a pitched roof. It stands, with no
// clash, its parts are all there, the ridge is up, the columns take the
// thrust, and the tooltip knows every part.
test('gable portals', () => {
  for (const [name, cat] of Object.entries(cats))
    for (let seed = 1; seed <= 40; seed++) {
      const r = generate({ seed, form: 'portal', storeys: 1, gableP: 1 }, cat);
      const at = `${name} seed ${seed}`;
      assert.ok(r.ok, `${at}: mechanism`);
      assert.deepEqual(clashes(r.parts), [], at);
      assert.deepEqual(floating(r.parts), [], at);
      const gables = r.st.arms.filter((a) => a.gable);
      assert.equal(gables.length, 1, at);
      const a = gables[0];
      const ids = new Set(r.parts.map((p) => p.id));
      for (const id of ['', '-rafter2', '-haunch', '-rafter2-haunch', '-from-conn', '-rafter2-from-conn', '-to-conn', '-rafter2-to-conn'])
        assert.ok(ids.has(a.id + id), `${at}: no ${a.id + id}`);
      // the top of the ridge plate is 25 mm over the top of steel at the ridge.
      // The column face and the end plates take a bit of the half span.
      const plate = r.parts.find((p) => p.id === `${a.id}-to-conn`)!;
      const ridge = Math.max(...plate.faces.flatMap((f) => f.pts.map((q) => q[2]))) - 25;
      const half = len(sub(r.st.cols[a.to!].x, r.st.cols[a.col].x)) / 2;
      const rise = (ridge - a.z) / (Math.tan((a.gable!.slope * Math.PI) / 180) * half);
      assert.ok(rise > 0.7 && rise < 1, `${at}: rise ${rise.toFixed(2)} of tan · span / 2`);
      const thrust = r.log.join('\n').match(/thrust at the eaves (-?[\d.]+) kN/);
      assert.ok(thrust && Number.isFinite(+thrust[1]), `${at}: no thrust in the log`);
      assert.ok(r.members.column.ratio < 1, `${at}: column ratio ${r.members.column.ratio}`);
      assert.deepEqual(r.parts.filter((p) => !p.info?.type).map((p) => p.id), [], at);
      assert.deepEqual(r.parts.filter((p) => p.info?.member && !r.members[p.info.member]).map((p) => p.id), [], at);
    }
});

// a gable only on a one storey portal
test('no gable on other forms or on two storeys', () => {
  for (const [form, storeys] of [['tree', 1], ['box', 1], ['mix', 1], ['portal', 2]] as const)
    for (let seed = 1; seed <= 10; seed++)
      assert.ok(!generate({ seed, form, storeys, gableP: 1 }, cats.aisc).st.arms.some((a) => a.gable), `${form} ${storeys} seed ${seed}`);
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
const area = (pts: V[]) => {
  const n: V = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const c = cross(pts[i], pts[(i + 1) % pts.length]);
    for (let k = 0; k < 3; k++) n[k] += c[k] / 2;
  }
  return len(n);
};
test('triangles cover every face', () => {
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

// Skewed arms on trees: they stand, nothing clashes, and they keep only what
// a skewed end can carry. The triangles cover the cut end of each one.
test('skewed arms', () => {
  let n = 0;
  for (const name of names)
    for (let seed = 1; seed <= 40; seed++) {
      const r = generate({ seed, form: 'tree', skewP: 1 }, cats[name]);
      const at = `${name} tree seed ${seed}`;
      assert.ok(r.ok, `${at}: mechanism`);
      assert.deepEqual(clashes(r.parts), [], at);
      assert.deepEqual(floating(r.parts), [], at);
      r.st.arms.forEach((a, i) => {
        if (!a.skew) return;
        n++;
        const arm = `${at} ${a.id}`;
        assert.ok(a.face === 0 || a.face === 180, `${arm}: face ${a.face}`);
        assert.ok([30, 45].includes(Math.abs(a.skew)), `${arm}: skew ${a.skew}`);
        assert.equal(a.bearing, (a.face + a.skew + 360) % 360, arm);
        assert.ok(a.conn === 'end_plate' || a.conn === 'welded', `${arm}: ${a.conn}`);
        assert.ok(!a.braces.length && !a.truss && !a.rod, `${arm}: a brace, truss or rod`);
        assert.ok(!r.st.secs.some((q) => q.arm === i), `${arm}: a secondary`);
        const ids = r.parts.map((q) => q.id).filter((id) => id.startsWith(`${a.id}-`));
        assert.deepEqual(ids.filter((id) => /-(brace|rod|chord|web)/.test(id)), [], arm);
        for (const f of r.parts.find((q) => q.id === a.id)!.faces) {
          const out: number[] = [];
          triangles(f.pts, out);
          let sum = 0;
          for (let k = 0; k < out.length; k += 9) {
            const [p, q, c] = [0, 3, 6].map((o) => out.slice(k + o, k + o + 3) as V);
            sum += len(cross(sub(q, p), sub(c, p))) / 2;
          }
          const want = area(f.pts);
          assert.ok(Math.abs(sum - want) <= 1e-6 * want + 1e-6, `${arm}: area ${sum}, not ${want}`);
        }
      });
    }
  assert.ok(n > 40, `only ${n} skewed arms`);
});

// X bracing: two diagonals that cross (or one plain diagonal when the second
// one doesn't fit), tension only in the check, and the crossing details
test('X bracing: every kind, both families, no clash', () => {
  const KIND = { flat: 'FB', rod: 'ROD', angle: 'L' } as const;
  for (const name of names)
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
