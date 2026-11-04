// node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from './sections.ts';
import { generate } from './generate.ts';
import { buildEnd, shortestBuild, timeline } from './steel.ts';
import { readTables } from './tables.ts';

const cat = loadCatalog('aisc', ...readTables('aisc'));
const structures = [1, 5, 12, 143].map((seed) => generate({ seed }, cat).parts);

test('without a duration, the same slots as with a speed alone', () => {
  for (const parts of structures) {
    assert.deepEqual(timeline(parts, { speed: 2 }), timeline(parts, 2));
    assert.deepEqual(timeline(parts, {}), timeline(parts));
  }
});

test('with a duration, the last part lands at the end of it, or as soon as it can', () => {
  for (const parts of structures)
    for (const speed of [0.25, 0.5, 1, 4])
      for (const duration of [500, 2000, 6000, 20000]) {
        const end = buildEnd(timeline(parts, { speed, duration }));
        const want = Math.max(duration, shortestBuild(parts, speed));
        assert.ok(Math.abs(end - want) < 1e-6, `speed ${speed}, ${duration} ms: ends at ${end}, not ${want}`);
      }
});

test('with a duration, the order stays and each part keeps its own time', () => {
  for (const parts of structures) {
    const free = timeline(parts, 0.25);
    const fit = timeline(parts, { speed: 0.25, duration: 2000 });
    const byId = new Map(parts.map((p) => [p.id, p]));
    for (const p of parts) {
      const [a, b] = [free.get(p.step)!, fit.get(p.step)!];
      assert.ok(Math.abs(a.dur - b.dur) < 1e-9, `${p.id}: its time changed`);
      // never before the part it stands on starts
      for (const s of p.supports) {
        const q = byId.get(s);
        if (q) assert.ok(b.start >= fit.get(q.step)!.start - 1e-9, `${p.id} starts before ${s}`);
      }
      // bolts start when their member lands
      if (p.kind === 'bolts') {
        const m = byId.get(p.supports[0])!;
        assert.ok(Math.abs(b.start - fit.get(m.step)!.land) < 1e-9, `${p.id} does not start when ${m.id} lands`);
      }
    }
  }
});

test('a short build with slow parts has many parts in the air at once', () => {
  const parts = structures[0];
  const inAir = (slots: ReturnType<typeof timeline>) => {
    const s = [...slots.values()];
    return Math.max(...s.map((a) => s.filter((b) => b.start <= a.start && b.land > a.start).length));
  };
  assert.ok(inAir(timeline(parts, { speed: 0.25, duration: 2000 })) > inAir(timeline(parts, { speed: 4, duration: 20000 })));
});
