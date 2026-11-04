<!--
  The drawing sheet: the WebGL view (to turn and zoom), the exact SVG (for
  export), or both. In "vs main" (dev server only): this branch and the base
  branch side by side, as exact SVGs.
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { renderHLR } from '../hlr.ts';
import { buildEnd, render, timeline, type RenderOpts } from '../steel.ts';
import { createViewer } from '../webgl.ts';
import { dev, params, s, stats, turnTo, type Built } from './state.ts';
import { describe, type Tip } from './info.ts';

const props = defineProps<{ built: Built | null; replay: number }>();

const glEl = ref<HTMLElement>();
const svgEl = ref<HTMLElement>();
const baseEl = ref<HTMLElement>();
const turning = ref(false);

// never reactive: three.js objects and big arrays
let viewer: ReturnType<typeof createViewer> | null = null;
let inViewer: Built['r'] | null = null; // the structure the viewer shows
let fromViewer: [number, number] | null = null; // the angle the viewer just gave
let lastSvg = '';

const hasGL = ref(true);
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
const mode = computed(() => (hasGL.value || s.viewer === 'diff' ? s.viewer : 'svg'));
const hint = computed(() => ({
  '3d': 'Drag to turn, right drag to move, wheel to zoom, double click to see it all',
  svg: 'Drag to turn',
  both: 'Drag either one to turn. In 3D: right drag to move, wheel to zoom',
  diff: 'Drag to turn both',
})[mode.value]);

const css = (k: string, d: string) => getComputedStyle(document.documentElement).getPropertyValue(k).trim() || d;
const paint = () => viewer?.setColors({ bg: css('--bg', '#ffffff'), fg: css('--fg', '#212121'), accent: css('--primary', '#e30713') });

// the speed that makes the build last s.duration seconds
function speed() {
  const parts = props.built?.r.parts;
  const end = parts ? buildEnd(timeline(parts)) : 0;
  return s.duration > 0 && end > 0 ? end / (s.duration * 1000) : 1;
}

// fast: the painter's trick, while the angle moves
function draw(animate = false, fast = false) {
  const b = props.built;
  if (!b) return;
  animate &&= s.duration > 0; // 0 s: no animation
  const t0 = performance.now();
  const m = mode.value;
  if (viewer && (m === '3d' || m === 'both')) {
    if (inViewer !== b.r) {
      viewer.show(b.r.parts);
      inViewer = b.r;
    }
    viewer.setWeights(s.weights === 'two');
    if (!fromViewer || fromViewer[0] !== s.az || fromViewer[1] !== s.el) viewer.view(s.az, s.el);
    if (animate) viewer.build(speed());
  }
  if (m === '3d') {
    lastSvg = ''; // made on copy
    const v = viewer!.stats();
    stats.draw = `${v.faces} faces, ${v.bolts} bolts, ${v.lines} lines, WebGL`;
    stats.ms = `${b.ms.toFixed(0)} ms build, ${(performance.now() - t0).toFixed(0)} ms to load`;
    return;
  }
  const opts: RenderOpts = { az: s.az, el: s.el, animate, speed: speed(), stepMs: 70, weights: s.weights === 'two', size: s.size || undefined };
  const out = (fast ? render : renderHLR)(b.r.parts, opts);
  lastSvg = out.svg;
  svgEl.value!.innerHTML = out.svg; // not v-html: the same string must play the build again
  stats.draw = `${out.faces} faces, ${out.dots} bolts, ${(out.svg.length / 1024).toFixed(0)} kB`;
  stats.ms = `${b.ms.toFixed(0)} ms build, ${(performance.now() - t0).toFixed(0)} ms draw`;
  if (m === 'diff') drawBase(opts, out.svg, fast);
}

// ---- vs main: the same structure, drawn with the code of the base branch
type Base = { loadCatalog: any; generate: any; render: any; renderHLR: any; TABLES: any; cats?: any };
let baseLoad: Promise<Base> | null = null;
let baseCur: { key: string; r: any } | null = null;
const loadBase = () =>
  (baseLoad ??= new Promise<Base>((ok, ko) => {
    const el = Object.assign(document.createElement('script'), { src: '/__dev/base.js' });
    const g = globalThis as any;
    el.onload = () => (g.BASE_ERROR ? ko(new Error(g.BASE_ERROR)) : ok(g.BASE));
    el.onerror = () => ko(new Error('the dev server did not answer'));
    document.head.append(el);
  }));

// renderHLR can give the same lines in another order (and the animation the
// parts in another order), so compare the sorted list of all line segments
const lines = (svg: string) =>
  [...svg.matchAll(/<path([^>]*)>/g)]
    .flatMap(([, a]) => {
      const w = a.match(/class="([^"]*)"/)?.[1] ?? '';
      return (a.match(/ d="([^"]*)"/)?.[1] ?? '').split('M').filter(Boolean).map((seg) => `${w}|${seg}`);
    })
    .sort()
    .join('\n');

async function drawBase(opts: RenderOpts, svg: string, fast: boolean) {
  const say = (t: string) => {
    baseEl.value!.innerHTML = '';
    baseEl.value!.append(Object.assign(document.createElement('p'), { className: 'note', textContent: t }));
    stats.base = t;
  };
  const name = dev.value?.base.ref ?? 'main';
  let B: Base;
  try {
    if (!(globalThis as any).BASE) say(`Bundling ${name}…`);
    B = await loadBase();
  } catch (e: any) {
    return say(`${name} does not build: ${e.message}`);
  }
  if (mode.value !== 'diff' || !props.built) return;
  try {
    const key = JSON.stringify([params(), s.family, s.detail]);
    if (baseCur?.key !== key) {
      B.cats ??= {};
      B.cats[s.family] ??= B.loadCatalog(s.family, ...B.TABLES[s.family]);
      baseCur = { key, r: B.generate(params(), B.cats[s.family], s.detail) };
    }
    const out = (fast ? B.render : B.renderHLR)(baseCur.r.parts, opts);
    baseEl.value!.innerHTML = out.svg;
    const [a, b] = [baseCur.r, props.built.r];
    const diff = [];
    if (a.parts.length !== b.parts.length) diff.push(`${a.parts.length} → ${b.parts.length} parts`);
    if (a.st.col.id !== b.st.col.id) diff.push(`column ${a.st.col.id} → ${b.st.col.id}`);
    if (a.ok !== b.ok) diff.push(b.ok ? 'now stable' : 'now a mechanism');
    stats.base = fast ? '…' : out.svg === svg || lines(out.svg) === lines(svg) ? 'same drawing' : `differs${diff.length ? ': ' + diff.join(', ') : ''}`;
  } catch (e: any) {
    say(`${name} fails on these settings: ${e.message}`);
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
    if (mode.value !== '3d') exact = window.setTimeout(() => draw(), turning.value ? 400 : 150);
  },
  { flush: 'post' },
);
watch(() => s.theme, () => nextTick(paint), { flush: 'post' });
const media = matchMedia('(prefers-color-scheme: dark)');
media.addEventListener('change', paint);

onMounted(() => {
  try {
    viewer = createViewer(
      glEl.value!,
      (az, el) => {
        turnTo(az, el);
        fromViewer = [s.az, s.el];
      },
      (part, x, y) => {
        const b = props.built;
        tip.value = part && b ? { ...describe(part, b.r), x, y } : null;
      },
    );
  } catch {
    hasGL.value = false; // no WebGL: only the SVG
  }
  paint();
  nextTick(() => draw(props.built?.animate));
});
onBeforeUnmount(() => {
  media.removeEventListener('change', paint);
  glEl.value?.replaceChildren();
});

// ---- turn the SVG with the mouse or a finger (the 3D view turns itself)
let drag: { x: number; y: number; az: number; el: number; moved: boolean } | null = null;
function down(e: PointerEvent) {
  if (e.button !== 0 || glEl.value!.contains(e.target as Node)) return;
  fromViewer = null;
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
  e.preventDefault();
  fromViewer = null;
  turnTo(s.az + k[0], s.el + k[1]);
}

// the exact drawing, at full size, from the same view
defineExpose({
  svg: () => lastSvg || (props.built ? renderHLR(props.built.r.parts, { az: s.az, el: s.el, weights: s.weights === 'two' }).svg : ''),
});
</script>

<template>
  <div
    class="drawing"
    :class="[`v-${mode}`, { px: s.size && mode !== '3d', turning }]"
    :style="{ '--px': `${s.size}px` }"
    tabindex="0"
    role="img"
    aria-label="Generated steel structure. Drag, or use the arrow keys, to turn it."
    @pointerdown="down"
    @pointermove="move"
    @pointerup="up"
    @pointercancel="up"
    @keydown="key"
  >
    <div id="gl" ref="glEl" data-label="3D (WebGL)" />
    <div id="svg" ref="svgEl" :data-label="mode === 'diff' ? `This branch, ${dev?.branch}` : 'Exact SVG'" />
    <div id="svgBase" ref="baseEl" :data-label="`${dev?.base.ref}, at ${dev?.base.sha}`" />
  </div>
  <div class="hint" aria-hidden="true">{{ hint }}</div>
  <div v-if="tip" class="tip" :class="{ warn: tip.warn }" :style="tipStyle" aria-hidden="true">
    <div class="tip-head"><b>{{ tip.title }}</b> <span>{{ tip.id }}</span></div>
    <dl>
      <template v-for="[k, v] in tip.rows" :key="k">
        <dt>{{ k }}</dt>
        <dd>{{ v }}</dd>
      </template>
    </dl>
  </div>
</template>
