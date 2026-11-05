<!--
  The drawing sheet. One pane (WebGL, SVG or both), or with "compare" (dev
  server only) this branch and the base branch side by side, in the same
  viewer. Both panes read the same angle. Zoom and pan go from one WebGL view
  to the other when the base viewer can take them.
  With a hub test, the base reads the same record with its own reader, so a
  change of hub.ts shows too. The arrow keys ← → then go to the previous and
  next test (HubTest.vue), Shift turns the drawing.
-->
<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import type { Part } from '../steel.ts';
import type { Frame } from '../webgl.ts';
import { here, loadBase, type Engine } from './engine.ts';
import Pane from './Pane.vue';
import { dev, params, s, stats, turnTo, type Built } from './state.ts';
import { current } from './tests.ts';

// note: why the main pane has no drawing (a hub test this branch can't draw)
const props = defineProps<{ built: Built | null; replay: number; note?: string }>();

const compare = computed(() => !!(s.compare && dev.value));
const turning = ref(false);
const mine = ref<InstanceType<typeof Pane>>();
const theirs = ref<InstanceType<typeof Pane>>();

const hint = computed(() => {
  const gl = s.viewer !== 'svg' && mine.value?.hasGL !== false;
  // an older base viewer has no setFrame(): only the angle follows
  const follows = theirs.value?.canFrame() ? ', both follow' : `, ${baseName.value} does not follow`;
  const keys = s.specimen ? '. ← →: the next test, Shift ← →: turn' : '';
  if (compare.value) return (gl ? `Drag to turn both. In 3D: right drag to move, wheel to zoom${follows}` : 'Drag to turn both') + keys;
  return { '3d': 'Drag to turn, right drag to move, wheel to zoom, double click to see it all', svg: 'Drag to turn', both: 'Drag either one to turn. In 3D: right drag to move, wheel to zoom' }[gl ? s.viewer : 'svg'] + keys;
});

// ---- the base branch: its engine, and the same settings built with it
const base = shallowRef<Engine | null>(null);
const baseBuilt = shallowRef<Built | null>(null);
const baseNote = ref('');
const baseName = computed(() => dev.value?.base.ref ?? 'main');
watch(compare, (on) => {
  if (!on || base.value) return;
  baseNote.value = `Bundling ${baseName.value}…`;
  loadBase().then(
    (E) => ((base.value = E), (baseNote.value = '')),
    (e) => (baseNote.value = `${baseName.value} does not build: ${e.message}`),
  );
}, { immediate: true });
// a hub test: what the base made of it last, so it builds once per test
let baseTest: { E: Engine; record: unknown; detail: string } | null = null;
watch([() => props.built, base, compare, current], () => {
  const [b, E] = [props.built, base.value];
  if (!E || !compare.value) return void ((baseBuilt.value = null), (baseTest = null));
  if (s.specimen) return buildTest(E, b);
  baseTest = null;
  if (!b) return void (baseBuilt.value = null);
  try {
    const t0 = performance.now();
    const r = E.generate(params(), E.catalog(s.family), s.detail);
    baseBuilt.value = { r, ms: performance.now() - t0, animate: b.animate };
    baseNote.value = '';
  } catch (e: any) {
    baseBuilt.value = null;
    baseNote.value = `${baseName.value} fails on these settings: ${e.message}`;
  }
});

// the base draws the hub test on show, with its own reader. A note says why not.
function buildTest(E: Engine, b: Built | null) {
  const c = current.value;
  if (!c?.record) {
    baseBuilt.value = null;
    baseNote.value = c?.error ?? 'Loading the test…';
    return;
  }
  if (baseTest?.E === E && baseTest.record === c.record && baseTest.detail === s.detail) return;
  const fit = baseTest?.record !== c.record;
  baseTest = { E, record: c.record, detail: s.detail };
  baseBuilt.value = null;
  if (!E.toSpecimen) return void (baseNote.value = `${baseName.value} has no specimen input`);
  let spec;
  try {
    spec = E.toSpecimen(c.record);
  } catch (e: any) {
    return void (baseNote.value = `${baseName.value} can't read this test: ${e.message}`);
  }
  try {
    const t0 = performance.now();
    const r = E.generate({ specimen: spec }, E.catalog(spec.family ?? 'aisc'), s.detail);
    if (r.st.form !== 'specimen') return void (baseNote.value = `${baseName.value} can't draw this kind of test`);
    baseBuilt.value = { r, ms: performance.now() - t0, animate: b?.animate ?? false, fit };
    baseNote.value = '';
  } catch (e: any) {
    baseNote.value = `${baseName.value} fails on this test: ${e.message}`;
  }
}

// ---- what differs: the parts by id, then their faces and bolts
const shape = (p: Part) => JSON.stringify([p.faces, p.dots]);
const diff = computed(() => {
  const [a, b] = [baseBuilt.value?.r, props.built?.r];
  if (!a || !b) return null;
  const was = new Map(a.parts.map((p) => [p.id, p]));
  const now = new Map(b.parts.map((p) => [p.id, p]));
  const added = b.parts.filter((p) => !was.has(p.id)).map((p) => p.id);
  const gone = a.parts.filter((p) => !now.has(p.id)).map((p) => p.id);
  const changed = b.parts.filter((p) => was.has(p.id) && shape(was.get(p.id)!) !== shape(p)).map((p) => p.id);
  const notes = [];
  if (a.st.col.id !== b.st.col.id) notes.push(`column ${a.st.col.id} → ${b.st.col.id}`);
  if (a.ok !== b.ok) notes.push(b.ok ? 'now stable' : 'now a mechanism');
  return { added, gone, changed, notes };
});
watch([diff, baseNote], () => {
  const d = diff.value;
  if (!d) return void (stats.base = baseNote.value);
  const n = [d.added.length && `${d.added.length} new`, d.gone.length && `${d.gone.length} gone`, d.changed.length && `${d.changed.length} changed`].filter(Boolean);
  stats.base = n.length || d.notes.length ? [...n, ...d.notes].join(', ') : 'same parts';
});

// zoom and pan: from one WebGL view to the other. Not in the template: there
// the refs are unwrapped, so to.value would be undefined.
const follow = (to: typeof mine, f: Frame | null) => to.value?.setFrame(f);
const toTheirs = (f: Frame | null) => follow(theirs, f);
const toMine = (f: Frame | null) => follow(mine, f);

// ---- turn the SVG with the mouse or a finger (the WebGL view turns itself)
let drag: { x: number; y: number; az: number; el: number; moved: boolean } | null = null;
function down(e: PointerEvent) {
  if (e.button !== 0 || (e.target as HTMLElement).closest('.gl')) return;
  drag = { x: e.clientX, y: e.clientY, az: s.az, el: s.el, moved: false };
  try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
  turning.value = true;
}
function move(e: PointerEvent) {
  if (!drag) return;
  const [dx, dy] = [e.clientX - drag.x, e.clientY - drag.y];
  if (!drag.moved && Math.hypot(dx, dy) < 3) return;
  drag.moved = true;
  turnTo(drag.az + dx * 0.5, drag.el + dy * 0.35);
}
function up() {
  drag = null;
  turning.value = false;
}
const KEYS: Record<string, [number, number]> = { ArrowLeft: [-15, 0], ArrowRight: [15, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] };
function key(e: KeyboardEvent) {
  const k = KEYS[e.key];
  if (!k) return;
  // a hub test: ← → go to the window, for the next test (HubTest.vue)
  if (s.specimen && k[0] && !e.shiftKey) return;
  e.preventDefault();
  turnTo(s.az + k[0], s.el + k[1]);
}

defineExpose({ svg: () => mine.value?.svg() ?? '', diff });
</script>

<template>
  <div
    class="drawing"
    :class="[`v-${s.viewer}`, { px: s.size && s.viewer !== '3d', turning, compare }]"
    :style="{ '--px': `${s.size}px` }"
    tabindex="0"
    role="img"
    :aria-label="s.specimen ? 'A hub test in its rig. Drag, or use Shift and the arrow keys, to turn it.' : 'Generated steel structure. Drag, or use the arrow keys, to turn it.'"
    @pointerdown="down"
    @pointermove="move"
    @pointerup="up"
    @pointercancel="up"
    @keydown="key"
  >
    <Pane
      ref="mine"
      main
      :engine="here"
      :built="built"
      :replay="replay"
      :turning="turning"
      :label="compare ? dev?.branch : undefined"
      :note="note"
      @frame="toTheirs"
    />
    <template v-if="compare">
      <Pane
        v-if="base"
        v-show="!baseNote"
        ref="theirs"
        :engine="base"
        :built="baseBuilt"
        :replay="replay"
        :turning="turning"
        :label="`${baseName}, at ${dev?.base.sha}`"
        @frame="toMine"
      />
      <div v-if="baseNote" class="pane note-pane"><p class="note">{{ baseNote }}</p></div>
    </template>
  </div>
  <div class="hint" aria-hidden="true">{{ hint }}</div>
</template>
