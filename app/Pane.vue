<!--
  One structure drawn with one engine (this checkout, or the base branch for
  "vs main"): the WebGL view, the exact SVG, or both. Drawing.vue shows one
  pane, or two side by side. With a note (a hub test it can't draw), the note
  shows and the drawing is hidden (the WebGL view keeps its size and context).
  one: compare in one 3D view (always 3D, hlr.ts has no colors). overlay: both
  structures with their marks, null while the base is not ready.
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Part, RenderOpts } from '../steel.ts';
import type { Frame, Viewer } from '../webgl.ts';
import type { Overlay } from './diff.ts';
import { anim, type Engine } from './engine.ts';
import { describe, type Tip } from './info.ts';
import { deformed } from './response.ts';
import { s, stats, turnTo, type Built } from './state.ts';

const props = defineProps<{
  engine: Engine;
  built: Built | null;
  replay: number;
  turning: boolean;
  main?: boolean; // its numbers go to the title block, Copy SVG takes its drawing
  label?: string; // in vs main: which code it is
  note?: string; // why there is no drawing
  one?: boolean;
  overlay?: Overlay | null;
}>();
const emit = defineEmits<{ frame: [f: Frame | null] }>();

const glEl = ref<HTMLElement>();
const svgEl = ref<HTMLElement>();

// never reactive: the viewer and big arrays
let viewer: Viewer | null = null;
let inViewer: Built['r'] | null = null; // the structure the viewer shows
let inParts: Part[] | null = null; // its parts, or both structures in one view
let fromViewer: [number, number] | null = null; // the angle the viewer just gave
let lastSvg = '';

const hasGL = ref(true);
const mode = computed(() => (hasGL.value ? (props.one ? '3d' : s.viewer) : 'svg'));
// the tooltip of the part under the mouse, in the 3D view. x, y: client px
const tip = ref<(Tip & { x: number; y: number }) | null>(null);
const tipStyle = computed(() => {
  const t = tip.value;
  if (!t) return {};
  // 14 px from the mouse, on the side with room
  const left = t.x < innerWidth - 300;
  const top = t.y < innerHeight - 220;
  return {
    left: `${t.x + (left ? 14 : -14)}px`,
    top: `${t.y + (top ? 14 : -14)}px`,
    transform: `translate(${left ? 0 : '-100%'}, ${top ? 0 : '-100%'})`,
  };
});
const labels = computed(() => {
  const k = props.label ? `${props.label}, ` : '';
  // the base structure in the viewer of this checkout: say so
  return { gl: `${k}3D${props.engine.ownViewer ? '' : ', viewer of this branch'}`, svg: `${k}SVG` };
});

// line weights: auto is one in WebGL, two in the SVG
const two = (gl: boolean) => (s.weights ? s.weights === 'two' : !gl);

const css = (k: string, d: string) => getComputedStyle(document.documentElement).getPropertyValue(k).trim() || d;
// in one view the hover is blue: red is for the gone parts
const paint = () => viewer?.setColors({
  bg: css('--bg', '#ffffff'), fg: css('--fg', '#212121'), accent: props.one ? css('--info', '#2563eb') : css('--primary', '#ff0000'), rig: css('--fg-muted', '#9e9e9e'),
  zones: [css('--zone-moment', '#d97706'), css('--zone-shear', '#2563eb')], added: css('--diff-new', '#5a9e1e'), gone: css('--diff-gone', '#d00000'),
});

// the deformed shape of the test, on the structure the viewer shows. Only the
// main pane: the base pane stays the undeformed drawing.
function bend() {
  if (!props.main || !viewer) return;
  const d = deformed.value;
  viewer.deform?.(d && d.r === inViewer ? d.state : null);
}

// fast: the painter's trick, while the angle moves
function draw(animate = false, fast = false) {
  const b = props.built;
  if (!b) return;
  const E = props.engine;
  const a = anim(E, b.r.parts);
  const t0 = performance.now();
  const m = mode.value;
  if (viewer && m !== 'svg') {
    const parts = props.overlay?.parts ?? b.r.parts;
    if (inParts !== parts) {
      viewer.show(parts, props.overlay?.marks);
      if (b.fit && inViewer !== b.r) viewer.setFrame?.(null); // a new hub test: forget the zoom of the last one
      inParts = parts;
      inViewer = b.r;
      bend();
    }
    viewer.setWeights(two(true));
    if (!fromViewer || fromViewer[0] !== s.az || fromViewer[1] !== s.el) viewer.view(s.az, s.el);
    if (animate) viewer.build(a.speed, a.duration, a.effects);
  }
  if (m === '3d') {
    lastSvg = ''; // made on copy
    if (props.main) {
      const v = viewer!.stats();
      stats.draw = `${v.faces} faces, ${v.bolts} bolts, ${v.lines} lines, WebGL`;
      stats.ms = `${b.ms.toFixed(0)} ms build, ${(performance.now() - t0).toFixed(0)} ms to load`;
    }
    return;
  }
  const opts: RenderOpts = { az: s.az, el: s.el, animate, speed: a.speed, duration: a.duration, effects: a.effects, stepMs: 70, weights: two(false), size: s.size || undefined };
  const out = (fast ? E.render : E.renderHLR)(b.r.parts, opts);
  lastSvg = out.svg;
  svgEl.value!.innerHTML = out.svg; // not v-html: the same string must play the build again
  if (props.main) {
    stats.draw = `${out.faces} faces, ${out.dots} bolts, ${(out.svg.length / 1024).toFixed(0)} kB`;
    stats.ms = `${b.ms.toFixed(0)} ms build, ${(performance.now() - t0).toFixed(0)} ms draw`;
  }
}

// ---- when to draw. flush post: the layout is up to date first.
watch(() => props.built, (b) => draw(b?.animate), { flush: 'post' });
watch(() => props.replay, () => draw(true), { flush: 'post' });
watch(() => props.overlay, () => draw(), { flush: 'post' });
watch(() => props.one, () => nextTick(paint));
watch(() => [s.weights, s.size, mode.value], () => draw(), { flush: 'post' });
watch(mode, () => (tip.value = null));
watch(deformed, bend, { flush: 'post' });
// a new angle: the fast drawing now, the exact one when it stops moving
let exact = 0;
watch(
  () => [s.az, s.el],
  () => {
    clearTimeout(exact);
    draw(false, mode.value !== '3d');
    if (mode.value !== '3d') exact = window.setTimeout(() => draw(), props.turning ? 400 : 150);
  },
  { flush: 'post' },
);
watch(() => s.theme, () => nextTick(paint), { flush: 'post' });
const media = matchMedia('(prefers-color-scheme: dark)');
media.addEventListener('change', paint);

// in one view: a part of the base is described with the base, under its own
// id, and a marked part says what changed
function describeIn(part: Part, r: Built['r']): Tip {
  const o = props.overlay;
  const old = o?.was.get(part.id);
  const t = old ? describe(old, o!.base) : describe(part, r);
  const how = o?.how[part.id];
  if (how) t.rows.unshift(['Compare', old ? `${how} (${t.id} in the base)` : how]);
  return t;
}

onMounted(() => {
  try {
    if (!props.engine.createViewer) throw new Error('no WebGL viewer in this code');
    viewer = props.engine.createViewer(
      glEl.value!,
      (az, el) => {
        turnTo(az, el);
        fromViewer = [s.az, s.el];
      },
      (part, x, y) => {
        const b = props.built;
        tip.value = part && b ? { ...describeIn(part, b.r), x, y } : null;
      },
      (f) => emit('frame', f),
    );
  } catch {
    hasGL.value = false; // no WebGL: only the SVG
  }
  // shot.ts calls seek() on it, to take a frame at one time of the build
  if (import.meta.env.DEV && props.main) (window as any).__steel = viewer;
  paint();
  nextTick(() => draw(props.built?.animate));
});
onBeforeUnmount(() => {
  clearTimeout(exact);
  media.removeEventListener('change', paint);
  glEl.value?.replaceChildren();
});

defineExpose({
  // the exact drawing, at full size, from the same view. Auto weights: two.
  svg: () => lastSvg || (props.built ? props.engine.renderHLR(props.built.r.parts, { az: s.az, el: s.el, weights: two(false) }).svg : ''),
  // the zoom and pan of the other pane (an old viewer has no setFrame)
  setFrame: (f: Frame | null) => viewer?.setFrame?.(f),
  hasGL,
  canFrame: () => !!viewer?.setFrame,
});
</script>

<template>
  <div class="pane" :class="[`v-${mode}`, { noted: note }]">
    <div ref="glEl" class="gl" :data-label="labels.gl" />
    <div ref="svgEl" class="svg" :data-label="labels.svg" />
    <p v-if="note" class="pane-note note" role="status">{{ note }}</p>
    <div v-if="tip" class="tip" :class="{ warn: tip.warn }" :style="tipStyle" aria-hidden="true">
      <div class="tip-head"><b>{{ tip.title }}</b> <span>{{ tip.id }}</span></div>
      <dl>
        <template v-for="[k, v] in tip.rows" :key="k">
          <dt>{{ k }}</dt>
          <dd>{{ v }}</dd>
        </template>
      </dl>
    </div>
  </div>
</template>
