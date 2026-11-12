// node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from './sections.ts';
import { generate } from './generate.ts';
import { BOLT_IN, BOLT_MS, buildEnd, COOL_MS, HEAD_TURN, land, LAND_CSS, NUT_TURN, POP_MS, SCREW_EXP, SCREW_GAP, SCREW_MS, SEAT_AT, seamTimes, shortestBuild, slotEnd, timeline, WELD_PAUSE, type Part } from './steel.ts';
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

// a sum of all the slots of the four structures, with no effects, as main gave it
const MAIN = [16165900, 22018525.629, 3585080, 4129360, 8492165.993, 1528160, 15181120, 19951162.841, 3349280, 11690770, 12968987.857, 1907480];
test('effects off: the slots of before, bolts pop in', () => {
  const sums = structures.flatMap((parts) =>
    [{}, { duration: 8000 }, { speed: 0.5, duration: 3000 }].map((o) => {
      let s = 0;
      for (const [step, x] of timeline(parts, { ...o, effects: false })) s += (step + 1) * (x.start + 2 * x.land);
      return s;
    }),
  );
  sums.forEach((s, i) => assert.ok(Math.abs(s - MAIN[i]) < 1e-3, `case ${i}: ${s}, ${MAIN[i]} on main`));
  for (const parts of welded) {
    const off = timeline(parts, { effects: false });
    const on = timeline(parts);
    for (const p of parts) {
      const [a, b] = [off.get(p.step)!, on.get(p.step)!];
      assert.equal(a.weld, undefined, `${p.id}: a weld with no effects`);
      assert.equal(a.nuts, undefined, `${p.id}: anchor nuts that screw with no effects`);
      if (p.kind === 'bolts') {
        const n = p.dots.length;
        assert.ok(Math.abs(a.dur - (POP_MS + BOLT_MS * (n - 1))) < 1e-9, `${p.id}: not the time of before`);
        assert.deepEqual(a.bolt, { gap: BOLT_MS, dur: POP_MS });
        assert.deepEqual(b.bolt, { gap: SCREW_GAP, dur: SCREW_MS });
      } else assert.ok(b.dur >= a.dur, `${p.id}: faster with the effects`);
    }
  }
});

// the longest time when nothing moves, in ms
function longestPause(slots: ReturnType<typeof timeline>) {
  const iv = [...slots.values()].map((s) => [s.start, slotEnd(s)]).sort((a, b) => a[0] - b[0]);
  let [end, pause] = [0, 0];
  for (const [a, b] of iv) {
    pause = Math.max(pause, a - end);
    end = Math.max(end, b);
  }
  return pause;
}

test('with the effects, there is never a pause: a long build slows down', () => {
  const more = [0, 2, 3, 7, 9, 20, 33, 40].map((seed) => generate({ seed }, cat).parts);
  for (const parts of [...structures, ...welded, ...more])
    for (const o of [{}, { duration: 3000 }, { duration: 8000 }, { duration: 30000 }, { speed: 4, duration: 8000 }, { speed: 0.25, duration: 60000 }]) {
      const slots = timeline(parts, o);
      assert.ok(longestPause(slots) < 1e-6, `${JSON.stringify(o)}: a pause of ${longestPause(slots)} ms`);
    }
  // longer than the build: all of it slower by the same factor, and it ends on time
  for (const parts of structures) {
    const own = timeline(parts);
    const long = timeline(parts, { duration: 3 * buildEnd(own) });
    const f = 3;
    assert.ok(Math.abs(buildEnd(long) - 3 * buildEnd(own)) < 1e-6);
    for (const [step, a] of own) {
      const b = long.get(step)!;
      assert.ok(Math.abs(b.start - f * a.start) < 1e-6 && Math.abs(b.dur - f * a.dur) < 1e-6);
      if (a.bolt) assert.ok(Math.abs(b.bolt!.dur - f * a.bolt.dur) < 1e-6 && Math.abs(b.bolt!.gap - f * a.bolt.gap) < 1e-6);
    }
  }
});

test('a bolt turns slow enough to see it, and for long enough', () => {
  // the turn of a piece is fastest when it starts to screw in: SCREW_EXP times its mean
  const peak = (turn: number, span: number) => {
    const ms = span * (1 - SEAT_AT) * SCREW_MS;
    return { perFrame: ((turn * SCREW_EXP) / ms) * (1000 / 60) * (180 / Math.PI), ms };
  };
  for (const [name, turn, span] of [['head', HEAD_TURN, BOLT_IN], ['nut', NUT_TURN, 1 - BOLT_IN], ['anchor nut', NUT_TURN, 1]] as const) {
    const { perFrame, ms } = peak(turn, span);
    assert.ok(perFrame < 12, `${name}: ${perFrame.toFixed(1)} degrees a frame at 60 fps`);
    assert.ok(ms >= 500, `${name}: it turns for ${ms} ms only`);
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
  // a plate with 8 bolts: far from 8 screws one after the other
  const eight = SCREW_MS + SCREW_GAP * 7;
  assert.ok(eight < (8 * SCREW_MS) / 3, 'far from 8 screws one after the other');
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
        if (p.welds === seam) assert.ok(Math.abs((t[0][1] - t[0][0]) / (t[1][1] - t[1][0]) - 200 / 300) < 1e-9);
      }
      if ('duration' in o) assert.ok(buildEnd(slots) <= Math.max(o.duration!, shortestBuild(parts, o.speed)) + 1e-6, 'the welds end in the build time');
    }
});

test('the anchor nuts: they screw down after their base plate lands, in the build time', () => {
  let bases = 0;
  for (const parts of structures)
    for (const o of [{}, { speed: 2 }, { speed: 1, duration: 3000 }, { speed: 0.5, duration: 400 }]) {
      const slots = timeline(parts, o);
      const k = 1 / (o.speed ?? 1);
      for (const p of parts) {
        const sl = slots.get(p.step)!;
        const n = p.kind === 'bolts' ? 0 : p.dots.filter((d) => d.anchor).length;
        if (!n) {
          assert.equal(sl.nuts, undefined, `${p.id}: nuts with no anchor rod`);
          continue;
        }
        bases++;
        const u = sl.nuts!;
        assert.ok(Math.abs(u.start - sl.land) < 1e-9, `${p.id}: the nuts don't start when the plate lands`);
        assert.ok(Math.abs(u.gap - SCREW_GAP * k) < 1e-9 && Math.abs(u.dur - SCREW_MS * k) < 1e-9);
        assert.ok(Math.abs(u.end - (u.start + (n - 1) * u.gap + u.dur)) < 1e-9, `${p.id}: the last nut is not on at end`);
        assert.ok(slotEnd(sl) >= u.end);
      }
      if ('duration' in o) assert.ok(buildEnd(slots) <= Math.max(o.duration!, shortestBuild(parts, o.speed)) + 1e-6, 'the nuts end in the build time');
    }
  assert.ok(bases > 0, 'no base plate with anchor rods in the test structures');
});

test('the landing curve: the SVG one stays close to land(), it never stops before the end', () => {
  const [x1, y1, x2, y2] = LAND_CSS.match(/[\d.]+/g)!.map(Number);
  const at = (m: number, a: number, b: number) => 3 * (1 - m) ** 2 * m * a + 3 * (1 - m) * m * m * b + m ** 3;
  for (let i = 0; i <= 100; i++) {
    const x = i / 100;
    let [lo, hi] = [0, 1];
    for (let j = 0; j < 40; j++) [lo, hi] = at((lo + hi) / 2, x1, x2) < x ? [(lo + hi) / 2, hi] : [lo, (lo + hi) / 2];
    assert.ok(Math.abs(at((lo + hi) / 2, y1, y2) - land(x)) < 0.02, `at ${x}: ${at((lo + hi) / 2, y1, y2)} in CSS, ${land(x)}`);
  }
  assert.equal(land(0), 0);
  assert.ok(Math.abs(land(1) - 1) < 1e-12);
  // the speed at the end: not 0 (no crawl), but small (a soft touch)
  const end = (land(1) - land(0.99)) / 0.01;
  assert.ok(end > 0.1 && end < 0.25, `speed at the end ${end}`);
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
