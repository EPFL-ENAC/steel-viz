// node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from './sections.ts';
import { generate } from './generate.ts';
import { BOLT_MS, buildEnd, COOL_MS, POP_MS, SCREW_MS, seamTimes, shortestBuild, slotEnd, timeline, WELD_PAUSE, type Part } from './steel.ts';
import type { V } from './vec.ts';
import { readTables } from './tables.ts';

const cat = loadCatalog('aisc', ...readTables('aisc'));
const structures = [1, 5, 12, 143].map((seed) => generate({ seed }, cat).parts);
// the same, with a weld on every other member: the timeline must fit them
// too (generate.ts gives welds only to some joints)
const seam: [V, V][] = [[[0, 0, 0], [200, 0, 0]], [[200, 0, 0], [200, 0, 300]]];
const welded = structures.map((parts) => parts.map((p, i): Part => (p.kind === 'member' && i % 2 ? { ...p, welds: seam } : p)));

test('without a duration, the same slots as with a speed alone', () => {
  for (const parts of structures) {
    assert.deepEqual(timeline(parts, { speed: 2 }), timeline(parts, 2));
    assert.deepEqual(timeline(parts, {}), timeline(parts));
  }
});

test('with a duration, the last part lands at the end of it, or as soon as it can', () => {
  for (const parts of [...structures, ...welded])
    for (const speed of [0.25, 0.5, 1, 4])
      for (const duration of [500, 2000, 6000, 20000]) {
        const end = buildEnd(timeline(parts, { speed, duration }));
        const want = Math.max(duration, shortestBuild(parts, speed));
        assert.ok(Math.abs(end - want) < 1e-6, `speed ${speed}, ${duration} ms: ends at ${end}, not ${want}`);
      }
});

test('with a duration, the order stays and each part keeps its own time', () => {
  for (const parts of [...structures, ...welded]) {
    const free = timeline(parts, 0.25);
    const fit = timeline(parts, { speed: 0.25, duration: 2000 });
    const byId = new Map(parts.map((p) => [p.id, p]));
    for (const p of parts) {
      const [a, b] = [free.get(p.step)!, fit.get(p.step)!];
      assert.ok(Math.abs(a.dur - b.dur) < 1e-9, `${p.id}: its time changed`);
      if (a.weld) assert.ok(Math.abs(a.weld.start - a.land - (b.weld!.start - b.land)) < 1e-9, `${p.id}: its weld did not move with it`);
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

test('effects off: the slots of before, bolts pop in', () => {
  for (const parts of welded) {
    const off = timeline(parts, { effects: false });
    const on = timeline(parts);
    for (const p of parts) {
      const [a, b] = [off.get(p.step)!, on.get(p.step)!];
      assert.equal(a.weld, undefined, `${p.id}: a weld with no effects`);
      if (p.kind === 'bolts') {
        const n = p.dots.length;
        assert.ok(Math.abs(a.dur - (POP_MS + BOLT_MS * (n - 1))) < 1e-9, `${p.id}: not the time of before`);
        assert.deepEqual(a.bolt, { gap: BOLT_MS, dur: POP_MS });
        assert.deepEqual(b.bolt, { gap: BOLT_MS, dur: SCREW_MS });
      } else assert.deepEqual([a.start, a.dur, a.land], [b.start, b.dur, b.land], `${p.id}: the effects moved a part`);
    }
  }
});

test('the bolts: after their member lands, one after the other, and fast', () => {
  for (const parts of structures)
    for (const o of [{}, { speed: 2 }, { speed: 0.5, duration: 3000 }]) {
      const slots = timeline(parts, o);
      const byId = new Map(parts.map((p) => [p.id, p]));
      for (const p of parts) {
        if (p.kind !== 'bolts') continue;
        const sl = slots.get(p.step)!;
        const m = slots.get(byId.get(p.supports[0])!.step)!;
        const { gap, dur } = sl.bolt!;
        assert.ok(gap > 0, 'bolt k after bolt k - 1');
        // the first bolt starts when the member lands, the last one ends with the slot
        assert.ok(Math.abs(sl.start - m.land) < 1e-9, `${p.id}: before its member lands`);
        assert.ok(Math.abs(sl.start + (p.dots.length - 1) * gap + dur - sl.land) < 1e-9, `${p.id}: the last bolt ends after its slot`);
      }
    }
  // a plate with 8 bolts: a bit longer than a pop of 8, far from 8 screws one after the other
  const eight = (one: number) => one + BOLT_MS * 7;
  assert.ok(eight(SCREW_MS) < 1.25 * eight(POP_MS), `${eight(SCREW_MS)} ms for 8 bolts, ${eight(POP_MS)} before`);
  assert.ok(eight(SCREW_MS) < (8 * SCREW_MS) / 3, 'far from 8 screws one after the other');
});

test('the welds: after their part lands, and in the build time', () => {
  for (const parts of welded)
    for (const o of [{}, { speed: 4 }, { speed: 1, duration: 2500 }, { speed: 0.25, duration: 500 }]) {
      const slots = timeline(parts, o);
      const k = 1 / (o.speed ?? 1);
      for (const p of parts) {
        const sl = slots.get(p.step)!;
        if (!p.welds) {
          assert.equal(sl.weld, undefined);
          continue;
        }
        const w = sl.weld!;
        assert.ok(Math.abs(w.start - sl.land - WELD_PAUSE * k) < 1e-9, `${p.id}: the weld is not made just after it lands`);
        assert.ok(Math.abs(w.cool - COOL_MS * k) < 1e-9);
        assert.equal(slotEnd(sl), w.start + w.dur + w.cool);
        // the welder goes along the seam, one segment after the other, by length
        const t = seamTimes(p.welds, w);
        assert.deepEqual(t[0][0], w.start);
        assert.ok(Math.abs(t.at(-1)![1] - (w.start + w.dur)) < 1e-9);
        assert.ok(Math.abs((t[0][1] - t[0][0]) / (t[1][1] - t[1][0]) - 200 / 300) < 1e-9);
      }
      if ('duration' in o) assert.ok(buildEnd(slots) <= Math.max(o.duration!, shortestBuild(parts, o.speed)) + 1e-6, 'the welds end in the build time');
    }
});

test('no part starts before the parts it stands on land (no duration)', () => {
  for (const parts of [...structures, ...welded]) {
    const slots = timeline(parts);
    const byId = new Map(parts.map((p) => [p.id, p]));
    for (const p of parts)
      for (const s of p.supports) {
        const q = byId.get(s);
        if (q && q.step !== p.step) assert.ok(slots.get(p.step)!.start >= slots.get(q.step)!.land - 1e-9, `${p.id} starts before ${s} lands`);
      }
  }
});
