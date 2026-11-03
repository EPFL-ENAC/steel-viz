<!--
  The playground: a narrow control rail beside one large drawing sheet, like
  a drawing with its title block.
-->
<script setup lang="ts">
import { computed, ref, shallowRef, watch, watchEffect } from 'vue';
import { floating, generate } from '../generate.ts';
import Drawing from './Drawing.vue';
import GoodSeeds from './GoodSeeds.vue';
import Seg from './Seg.vue';
import Slider from './Slider.vue';
import { catalog, dev, params, s, setView, stats, turnTo, type Built } from './state.ts';

const CONN: Record<string, string> = { shear_tab: 'shear tab', end_plate: 'end plate', flange_plates: 'flange plates', welded: 'welded', gusset: 'gusset' };

// ---- the structure
const built = shallowRef<Built | null>(null);
const error = ref('');
function build(animate: boolean) {
  try {
    const t0 = performance.now();
    const r = generate(params(), catalog(s.family), s.detail as any);
    built.value = { r, ms: performance.now() - t0, animate };
    error.value = '';
  } catch (e: any) {
    error.value = String(e.stack ?? e);
  }
}
build(true);
watch(() => [s.seed, s.form, s.arms, s.height, s.load, s.family], () => build(true));
watch(() => s.detail, () => build(false));

const replay = ref(0);
const status = computed(() => {
  const r = built.value?.r;
  if (!r) return { ok: false, text: '' };
  return { ok: r.ok && !floating(r.parts).length, text: r.ok ? `Stable, max ratio ${r.ratio.toFixed(2)}` : 'Mechanism left' };
});
const members = computed(() => {
  const st = built.value?.r.st;
  if (!st) return [];
  return [
    ...st.arms.map((a) => [a.id, `${a.sec.id}, ${CONN[a.conn]}${a.braces.map((b) => ', brace ' + b.sec.id).join('')}`]),
    ...st.secs.map((x) => [x.id, `${x.sec.id}, ${CONN[x.conn]}`]),
  ];
});
const column = computed(() => {
  const st = built.value?.r.st;
  return st ? `${st.form}, ${st.cols.length > 1 ? st.cols.length + ' × ' : ''}${st.col.id}${st.splice ? ' / ' + st.splice.sec.id : ''}, ${(st.H / 1000).toFixed(2)} m` : '';
});

// ---- the view
const viewName = computed({ get: () => s.view, set: setView });
const az = computed({ get: () => s.az, set: (v) => turnTo(v, s.el) });
const el = computed({ get: () => s.el, set: (v) => turnTo(s.az, v) });
const viewers = computed<[string, string][]>(() => [['3d', '3D'], ['svg', 'SVG'], ['both', 'Both'], ...(dev.value ? [['diff', `vs ${dev.value.base.ref}`] as [string, string]] : [])]);

// ---- theme
const media = matchMedia('(prefers-color-scheme: dark)');
const systemDark = ref(media.matches);
media.addEventListener('change', () => (systemDark.value = media.matches));
const dark = computed(() => (s.theme ? s.theme === 'dark' : systemDark.value));
watchEffect(() => {
  if (s.theme) document.documentElement.dataset.theme = s.theme;
  else delete document.documentElement.dataset.theme;
});

// ---- dev server: which checkout this is
watchEffect(() => {
  if (dev.value) document.title = `${dev.value.branch}, steel`;
});

// ---- copy
const drawing = ref<InstanceType<typeof Drawing>>();
const copyNote = ref('');
async function copy() {
  try {
    await navigator.clipboard.writeText(drawing.value!.svg());
    copyNote.value = 'SVG copied.';
  } catch {
    copyNote.value = 'The browser refused the clipboard. Save the drawing from the page source instead.';
  }
}
</script>

<template>
  <div class="app">
    <aside class="rail">
      <div>
        <h1>Steel structure generator</h1>
        <p class="lede">One column with arms, a portal or a box. The frame solver checks it stands, fixes it when it does not, and sizes every member from the real section tables.</p>
        <p v-if="dev" class="branch">
          <b>{{ dev.branch }}</b> at {{ dev.sha }}{{ dev.dirty ? ', with changes not committed' : '' }}. Live: it reloads on each save.
        </p>
      </div>

      <fieldset>
        <legend>Structure</legend>
        <div class="row">
          <label for="seed">Seed</label>
          <input id="seed" v-model.number="s.seed" type="number" min="1" step="1">
          <button type="button" title="Next seed" @click="s.seed = (s.seed || 0) + 1">Next</button>
        </div>
        <Seg v-model="s.form" label="Form" :options="[['mix', 'Any'], ['tree', 'Tree'], ['portal', 'Portal'], ['box', 'Box']]" />
        <Slider id="arms" v-model="s.arms" label="Arms" :min="1" :max="12" :step="1" :out="String(s.arms)" />
        <Slider id="height" v-model="s.height" label="Height" :min="1500" :max="6000" :step="250" :out="`${(s.height / 1000).toFixed(2)} m`" />
        <Slider id="load" v-model="s.load" label="Load" :min="10" :max="200" :step="10" :out="`${s.load} kN/m`" />
        <Seg v-model="s.family" label="Section tables" :options="[['aisc', 'AISC (W, HSS)'], ['eu', 'EU (IPE, HE)']]" />
      </fieldset>

      <fieldset>
        <legend>Drawing</legend>
        <Seg v-model="s.detail" label="Detail" :options="[['members', 'Members'], ['plates', 'Plates'], ['bolts', 'Bolts']]" />
        <Seg v-model="viewName" label="View" :options="[['iso', 'Iso'], ['south', 'S'], ['west', 'W'], ['north', 'N'], ['east', 'E'], ['plan', 'Plan']]" />
        <Seg v-model="s.weights" label="Line weights" :options="[['two', 'Two weights'], ['one', 'One weight']]" />
        <Seg v-model="s.viewer" label="Viewer" :options="viewers" />
        <Seg v-model="s.size" label="SVG size" :options="[[0, 'Full size'], [256, '256 px'], [96, '96 px'], [48, '48 px']]" />
        <Slider id="az" v-model="az" label="Azimuth" :min="0" :max="359" :step="1" :out="`${s.az}°`" />
        <Slider id="el" v-model="el" label="Elevation" :min="0" :max="90" :step="1" :out="`${s.el}°`" />
      </fieldset>

      <div class="actions">
        <button class="primary" type="button" @click="replay++">Build again</button>
        <button type="button" @click="copy">Copy SVG</button>
        <button type="button" @click="s.theme = dark ? 'light' : 'dark'">{{ dark ? 'Light' : 'Dark' }}</button>
      </div>
      <p v-if="copyNote" class="note">{{ copyNote }}</p>

      <GoodSeeds />

      <fieldset>
        <legend>Analysis</legend>
        <div><span class="status" :class="status.ok ? 'ok' : 'bad'">{{ status.text }}</span></div>
        <ul class="members">
          <li v-for="[k, v] in members" :key="k"><span>{{ k }}</span><span>{{ v }}</span></li>
        </ul>
        <ol class="log">
          <li v-for="(t, i) in built?.r.log" :key="i">{{ t }}</li>
        </ol>
      </fieldset>
    </aside>

    <main class="sheet">
      <Drawing ref="drawing" :built="built" :replay="replay" />
      <dl class="titleblock">
        <div><dt>Column</dt><dd>{{ column }}</dd></div>
        <div><dt>Solver</dt><dd>{{ built ? `${built.r.nodes} nodes, ${built.r.solves} solves` : '' }}</dd></div>
        <div><dt>Drawing</dt><dd>{{ stats.draw }}</dd></div>
        <div><dt>Time</dt><dd>{{ stats.ms }}</dd></div>
        <div v-if="s.viewer === 'diff'"><dt>vs {{ dev?.base.ref }}</dt><dd>{{ stats.base }}</dd></div>
      </dl>
    </main>
  </div>
  <pre v-if="error" class="error" @click="error = ''">{{ error }}</pre>
</template>
