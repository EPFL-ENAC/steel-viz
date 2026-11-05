<!--
  The measured response of the hub test: the steps of its loading protocol, a
  chart with a dot on the step, and the working zones at this step. The state
  is in app/response.ts. The chart shows one file at a time: x against y of a
  response is one loop, and two files have two different y axes.
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { SCALES, biggest, deformParts } from '../deform.ts';
import { renderHLR } from '../hlr.ts';
import Seg from './Seg.vue';
import { ZONE_COLORS, deformed, resp, scale, shapeError, shownTest, steps, table, togglePlay } from './response.ts';
import { s } from './state.ts';
import { current } from './tests.ts';

// ---- which file the chart shows
const files = computed(() => (table.value?.responses ?? []).filter((r) => steps.value?.series[r.folder]));
const folder = ref('');
watch(files, (f) => {
  if (!f.some((r) => r.folder === folder.value)) folder.value = steps.value?.driver ?? f[0]?.folder ?? '';
}, { immediate: true });
const spec = computed(() => files.value.find((r) => r.folder === folder.value));
const curve = computed(() => steps.value?.series[folder.value]);
const tabs = computed(() => files.value.map((r): [string, string] => [r.folder, r.label]));

// ---- the chart, in the units of the viewBox
const [W, H, L, T, R, B] = [288, 176, 40, 8, 8, 24];
const scales = computed(() => {
  const c = curve.value;
  if (!c) return null;
  const [mx, my] = [biggest(c.x) || 1, biggest(c.y) || 1]; // same room on both sides: 0 is in the middle
  return { mx, my, X: (x: number) => L + ((x + mx) / (2 * mx)) * (W - L - R), Y: (y: number) => T + ((my - y) / (2 * my)) * (H - T - B) };
});
const points = computed(() => {
  const [c, k] = [curve.value, scales.value];
  return c && k ? c.x.map((x, i) => `${k.X(x).toFixed(1)} ${k.Y(c.y[i]).toFixed(1)}`) : [];
});
const all = computed(() => `M${points.value.join('L')}`);
const played = computed(() => `M${points.value.slice(0, resp.step + 1).join('L')}`);
const dot = (i: number) => {
  const [c, k] = [curve.value, scales.value];
  return c && k && i < c.x.length ? { cx: k.X(c.x[i]), cy: k.Y(c.y[i]) } : null;
};
const num = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(1) : v.toFixed(3));
const read = (i: number) => {
  const [c, r] = [curve.value, spec.value];
  return c && r && i < c.x.length ? `${num(c.x[i])} ${r.xUnit}, ${num(c.y[i])} ${r.yUnit}` : '';
};
const color = computed(() => ({ '--series': ZONE_COLORS[spec.value?.slot ?? -1] ?? 'var(--fg)' }));

// hover: the step nearest to the mouse, a click goes there
const near = ref<number | null>(null);
function hover(e: PointerEvent) {
  const [c, k] = [curve.value, scales.value];
  if (!c || !k) return;
  const box = (e.currentTarget as SVGElement).getBoundingClientRect();
  const [mx, my] = [((e.clientX - box.left) / box.width) * W, ((e.clientY - box.top) / box.height) * H];
  let [best, d] = [0, Infinity];
  c.x.forEach((x, i) => {
    const q = (k.X(x) - mx) ** 2 + (k.Y(c.y[i]) - my) ** 2;
    if (q < d) [best, d] = [i, q];
  });
  near.value = best;
}
function go() {
  if (near.value !== null) resp.step = near.value;
}

// ---- one deformed frame as SVG, from the view of the sheet
const copyNote = ref('');
async function copyFrame() {
  const [t, d] = [shownTest.value, deformed.value];
  if (!t || !d) return;
  try {
    const { svg } = renderHLR(deformParts(t.r.parts, d.state), { az: s.az, el: s.el, weights: s.weights ? s.weights === 'two' : true });
    await navigator.clipboard.writeText(svg);
    copyNote.value = `SVG of step ${resp.step + 1} copied.`;
  } catch {
    copyNote.value = 'The browser refused the clipboard.';
  }
}
watch(() => resp.step, () => (copyNote.value = ''));
</script>

<template>
  <div class="response">
    <span class="epfl-label">Deformed shape</span>
    <p v-if="!steps" class="note">{{ table || current?.table === 'paste' ? 'No measured response for this test.' : 'No deformed shape for this table yet.' }}</p>
    <template v-else-if="table">
      <p class="note">Schematic shape, ×{{ scale }}. A model that matches the measured numbers, not a measured field.</p>
      <p v-if="s.viewer !== '3d'" class="note">The SVG stays the undeformed drawing.</p>
      <p v-if="shapeError" class="test-error" role="alert">{{ shapeError }}</p>

      <Seg v-if="tabs.length > 1" v-model="folder" label="Response" :options="tabs" />
      <div v-if="spec && scales" class="chart" :style="color">
        <svg
          :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="`${spec.y} against ${spec.x}, step ${resp.step + 1}: ${read(resp.step)}`"
          @pointermove="hover" @pointerleave="near = null" @click="go"
        >
          <line class="axis" :x1="L" :x2="W - R" :y1="scales.Y(0)" :y2="scales.Y(0)" />
          <line class="axis" :x1="scales.X(0)" :x2="scales.X(0)" :y1="T" :y2="H - B" />
          <text :x="L - 4" :y="T + 8" text-anchor="end">{{ num(scales.my) }}</text>
          <text :x="L - 4" :y="H - B" text-anchor="end">{{ num(-scales.my) }}</text>
          <text :x="L" :y="H - B + 11">{{ num(-scales.mx) }}</text>
          <text :x="W - R" :y="H - B + 11" text-anchor="end">{{ num(scales.mx) }}</text>
          <text :x="(L + W - R) / 2" :y="H - 2" text-anchor="middle">{{ spec.x }} ({{ spec.xUnit }})</text>
          <text :transform="`translate(9 ${(T + H - B) / 2}) rotate(-90)`" text-anchor="middle">{{ spec.y }} ({{ spec.yUnit }})</text>
          <path class="all" :d="all" />
          <path class="played" :d="played" />
          <circle v-if="near !== null" class="near" v-bind="dot(near)" r="5" />
          <circle class="now" v-bind="dot(resp.step)" r="5" />
        </svg>
        <span v-if="near !== null" class="chart-tip">step {{ near + 1 }}: {{ read(near) }}</span>
      </div>
      <p class="readout">{{ read(resp.step) }}</p>

      <div class="player">
        <button type="button" class="epfl-btn epfl-btn-secondary epfl-btn-sm" @click="togglePlay">{{ resp.playing ? 'Pause' : 'Play' }}</button>
        <input v-model.number="resp.step" type="range" min="0" :max="steps.n - 1" step="1" aria-label="Step of the loading protocol">
        <span class="num">{{ resp.step + 1 }} / {{ steps.n }}</span>
      </div>
      <div class="field">
        <label class="epfl-label" for="response-scale">Scale of the displacements</label>
        <select id="response-scale" v-model="resp.scale" class="epfl-select">
          <option value="auto">Auto (×{{ table.autoScale(steps) }})</option>
          <option v-for="k in SCALES" :key="k" :value="k">×{{ k }}</option>
        </select>
      </div>

      <dl v-if="deformed?.state.zones.length" class="zones">
        <template v-for="z in deformed.state.zones" :key="z.label">
          <dt>{{ z.label }}, {{ z.ratio }}</dt>
          <dd class="bar" aria-hidden="true"><i :style="{ width: `${Math.min(1, z.level) * 100}%`, background: ZONE_COLORS[z.slot] }" /></dd>
          <dd>{{ z.level.toFixed(2) }}</dd>
        </template>
      </dl>
      <ul v-if="deformed?.state.notes?.length" class="test-notes">
        <li v-for="n in deformed.state.notes" :key="n">{{ n }}</li>
      </ul>

      <div class="actions">
        <button type="button" class="epfl-btn epfl-btn-secondary epfl-btn-sm" @click="copyFrame">Copy SVG at this step</button>
        <span v-if="copyNote" class="note" role="status">{{ copyNote }}</span>
      </div>
    </template>
  </div>
</template>
