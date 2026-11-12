// node --test
// Purlins on a gable (purlinP, gable.ts): none with purlinP 0, they only add
// parts (the frame stays the same with or without them, so the purlins are
// not in the solver model), and each one sits on its rafter, square to the
// roof. Then no clash and no floating part, with all the details around.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, type Result } from './generate.ts';
import type { Part } from './steel.ts';
import { cats, names } from './geometry-check.ts';
import { noClash } from './params-check.ts';
import { add, dot, mul, norm, sub, type V } from './vec.ts';

const SEEDS = 20;
const isPurlin = (id: string) => /-purlin\d+(-cleat|-bolts)?$/.test(id);
const key = (q: Part) => JSON.stringify([q.id, q.kind, q.supports, q.faces, q.dots]);
const pts = (q: Part) => q.faces.flatMap((f) => f.pts);

test('purlinP 0: no purlin', () => {
  for (const storeys of [1, 2] as const)
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = generate({ seed, form: 'portal', storeys, gableP: 1, purlinP: 0 }, cats.aisc);
      assert.deepEqual(r.parts.filter((q) => isPurlin(q.id)).map((q) => q.id), [], `seed ${seed}`);
    }
});

// The same structure, with purlinP 0 and 1: the same parts, plus the purlins.
// It also catches a detail (a cap plate) left out because a purlin is in its way.
const pairs = new Map<string, [Result, Result]>();
function pair(family: 'aisc' | 'eu', storeys: 1 | 2, seed: number) {
  const k = `${family} ${storeys} ${seed}`;
  if (!pairs.has(k)) pairs.set(k, [0, 1].map((purlinP) => generate({ seed, form: 'portal', storeys, gableP: 1, purlinP }, cats[family])) as [Result, Result]);
  return pairs.get(k)!;
}

test('purlins only add parts', () => {
  for (const family of names)
    for (const storeys of [1, 2] as const)
      for (let seed = 1; seed <= SEEDS; seed++) {
        const at = `${family} ${storeys} storeys seed ${seed}`;
        const [bare, roof] = pair(family, storeys, seed);
        assert.ok(roof.parts.some((q) => isPurlin(q.id)), `${at}: no purlin`);
        assert.deepEqual(roof.parts.filter((q) => !isPurlin(q.id)).map(key), bare.parts.map(key), at);
        assert.deepEqual(roof.st.arms.map((a) => a.sec.id), bare.st.arms.map((a) => a.sec.id), at);
      }
});

test('each purlin is a channel on its rafter, square to the roof', () => {
  for (const family of names)
    for (const storeys of [1, 2] as const)
      for (let seed = 1; seed <= SEEDS; seed++) {
        const at = `${family} ${storeys} storeys seed ${seed}`;
        const r = pair(family, storeys, seed)[1];
        const a = r.st.arms.find((x) => x.gable)!;
        const hs = norm(sub(r.st.cols[a.to!].x, r.st.cols[a.col].x));
        const t = (a.gable!.slope * Math.PI) / 180;
        [a.id, `${a.id}-rafter2`].forEach((rid, side) => {
          const h: V = side ? mul(hs, -1) : hs;
          const n = add(mul(h, -Math.sin(t)), [0, 0, Math.cos(t)]); // the roof normal
          const rafter = r.parts.find((q) => q.id === rid)!;
          const top = Math.max(...pts(rafter).map((p) => dot(p, n)));
          const purlins = r.parts.filter((q) => q.info?.type === 'Purlin' && q.id.startsWith(`${rid}-purlin`));
          assert.ok(purlins.length >= 1, `${at}: no purlin on ${rid}`);
          for (const q of purlins) {
            assert.equal(q.info!.sec!.kind, 'C', `${at}: ${q.id}`);
            for (const b of q.boxes!) assert.ok(Math.abs(Math.abs(dot(b.ax[1], n)) - 1) < 1e-9, `${at}: ${q.id} is not square to the roof`);
            const bottom = Math.min(...pts(q).map((p) => dot(p, n)));
            assert.ok(Math.abs(bottom - top) < 1, `${at}: ${q.id} is ${(bottom - top).toFixed(1)} mm off the rafter top`);
            assert.ok(q.supports.every((s) => s === `${q.id}-cleat`), `${at}: ${q.id} supports`);
          }
        });
      }
});

noClash([
  ['gable portals with purlins, all details', { form: 'portal', storeys: 1, gableP: 1, purlinP: 1, braceP: 1, secondaryP: 1, colSpliceP: 1 }],
  ['gable portals with purlins, long spans', { form: 'portal', storeys: 1, gableP: 1, purlinP: 1, spanK: 1.6 }],
  ['gable portals with purlins, short spans', { form: 'portal', storeys: 1, gableP: 1, purlinP: 1, spanK: 0.6 }],
  ['gable portals with purlins, two storeys, all details', { form: 'portal', storeys: 2, gableP: 1, purlinP: 1, braceP: 1, secondaryP: 1, colSpliceP: 1 }],
  ['gable portals with purlins, two storeys, X bracing', { form: 'portal', storeys: 2, gableP: 1, purlinP: 1, bracing: 'x' }],
  ['gable portals with purlins, two storeys, chevron', { form: 'portal', storeys: 2, gableP: 1, purlinP: 1, bracing: 'chevron' }],
]);
noClash([['gable portals with purlins, EU, all details', { form: 'portal', gableP: 1, purlinP: 1, braceP: 1, secondaryP: 1, colSpliceP: 1 }]], (p) => generate(p, cats.eu));
