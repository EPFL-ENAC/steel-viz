<!--
  One structure drawn with one engine (this checkout, or the base branch for
  "vs main"): the WebGL view, the exact SVG, or both. Drawing.vue shows one
  pane, or two side by side.
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { RenderOpts } from '../steel.ts';
import type { Frame, Viewer } from '../webgl.ts';
import { anim, type Engine } from './engine.ts';
import { describe, type Tip } from './info.ts';
import { s, stats, turnTo, type Built } from './state.ts';

const props = defineProps<{
  engine: Engine;
  built: Built | null;
  replay: number;
  turning: boolean;
  main?: boolean; // its numbers go to the title block, Copy SVG takes its drawing
  label?: string; // in vs main: which code it is
}>();
const emit = defineEmits<{ frame: [f: Frame | null] }>();

const glEl = ref<HTMLElement>();
const svgEl = ref<HTMLElement>();

// never reactive: three.js objects and big arrays
let viewer: Viewer | null = null;
let inViewer: Built['r'] | null = null; // the structure the viewer shows
let fromViewer: [number, number] | null = null; // the angle the viewer just gave
let lastSvg = '';

const hasGL = ref(true);
const mode = computed(() => (hasGL.value ? s.viewer : 'svg'));
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
  return { gl: `${k}3D`, svg: `${k}SVG` };
});

// line weights: auto is one in WebGL, two in the SVG
const two = (gl: boolean) => (s.weights ? s.weights === 'two' : !gl);

const css = (k: string, d: string) => getComputedStyle(document.documentElement).getPropertyValue(k).trim() || d;
const paint = () => viewer?.setColors({ bg: css('--bg', '#ffffff'), fg: css('--fg', '#212121'), accent: css('--primary', '#ff0000') });

// fast: the painter's trick, while the angle moves
function draw(animate = false, fast = false) {
  const b = props.built;
  if (!b) return;
  const E = props.engine;
  const a = anim(E, b.r.parts);
  const t0 = performance.now();
  const m = mode.value;
  if (viewer && m !== 'svg') {
    if (inViewer !== b.r) {
      viewer.show(b.r.parts);
      inViewer = b.r;
    }
    viewer.setWeights(two(true));
    if (!fromViewer || fromViewer[0] !== s.az || fromViewer[1] !== s.el) viewer.view(s.az, s.el);
    if (animate) viewer.build(a.speed, a.duration);
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
  const opts: RenderOpts = { az: s.az, el: s.el, animate, speed: a.speed, duration: a.duration, stepMs: 70, weights: two(false), size: s.size || undefined };
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
watch(() => [s.weights, s.size, mode.value], () => draw(), { flush: 'post' });
watch(mode, () => (tip.value = null));
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
        tip.value = part && b ? { ...describe(part, b.r), x, y } : null;
      },
      (f) => emit('frame', f),
    );
  } catch {
    hasGL.value = false; // no WebGL: only the SVG
  }
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
  <div class="pane" :class="`v-${mode}`">
    <div ref="glEl" class="gl" :data-label="labels.gl" />
    <div ref="svgEl" class="svg" :data-label="labels.svg" />
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
