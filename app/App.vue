<!--
  The playground: a narrow control rail beside one large drawing sheet, like
  a drawing with its title block.
-->
<script setup lang="ts">
import { computed, ref, shallowRef, watch, watchEffect } from 'vue';
import { BEAM_CONN_KINDS, BRACING_KINDS, floating, generate } from '../generate.ts';
import { CONNS, timeline, type ConnType } from '../steel.ts';
import Drawing from './Drawing.vue';
import { anim, here } from './engine.ts';
import GoodSeeds from './GoodSeeds.vue';
import HubTest from './HubTest.vue';
import RangeSlider from './RangeSlider.vue';
import Section from './Section.vue';
import Seg from './Seg.vue';
import Slider from './Slider.vue';
import { variety } from '../score.ts';
import { BUILD_KEYS, GROUPS, catalog, dev, params, s, setView, stats, turnTo, type Built } from './state.ts';
import { shownTest } from './response.ts';
import { current, setMode } from './tests.ts';

const CONN = (c: ConnType) => CONNS[c].label;

// ---- the structure: a seed, or a hub test (s.specimen, app/tests.ts)
const built = shallowRef<Built | null>(null);
const error = ref('');
const note = ref(''); // why the sheet has no drawing: a hub test we can't draw
function build(animate: boolean) {
  if (s.specimen) return buildTest(animate);
  shownRecord = null;
  shownTest.value = null;
  note.value = '';
  try {
    const t0 = performance.now();
    const r = generate(params(), catalog(s.family), s.detail as any);
    built.value = { r, ms: performance.now() - t0, animate };
    error.value = '';
  } catch (e: any) {
    error.value = String(e.stack ?? e);
  }
}
// a hub test: no solve to fix it, no sizing. A row the reader can't read, or
// a throw of generate(), gives no drawing and a note on the sheet.
let shownRecord: unknown = null;
function buildTest(animate: boolean) {
  const c = current.value;
  const fit = c?.record !== shownRecord; // a new test: the 3D view fits it
  shownRecord = c?.record ?? null;
  error.value = ''; // an error of the seed
  const none = (why: string) => {
    shownTest.value = null;
    built.value = null;
    note.value = why;
    stats.draw = stats.ms = '';
  };
  if (!c) return none('Loading the test…');
  if (!c.spec) return none(c.error ?? '');
  try {
    const t0 = performance.now();
    const r = generate({ specimen: c.spec }, catalog(c.spec.family ?? 'aisc'), s.detail as any);
    shownTest.value = { r, c };
    built.value = { r, ms: performance.now() - t0, animate, fit };
    note.value = '';
  } catch (e: any) {
    none(`${c.id}: ${e.message}`);
  }
}
// build time 0 (the default): a change shows the new structure at once.
// Over 0: each change plays the build, in that time.
const plays = computed(() => s.duration > 0);
build(plays.value);
watch(() => BUILD_KEYS.map((k) => s[k]), () => build(plays.value));
watch(() => s.detail, () => build(false));
watch(current, () => build(plays.value)); // a new test, or back to the seed

// ---- seed or hub test
const hub = computed(() => !!s.specimen);
const mode = computed({ get: () => (hub.value ? 'hub' : 'seed'), set: (v) => setMode(v === 'hub') });

const replay = ref(0);
// play again when the build time or the speed stops moving (not when it goes to 0)
let again = 0;
watch(() => [s.duration, s.speed], () => {
  clearTimeout(again);
  if (plays.value) again = window.setTimeout(() => replay.value++, 300);
});

// ---- seed
const nextSeed = (d: number) => (s.seed = Math.max(1, (s.seed || 1) + d));
const randomSeed = () => (s.seed = 1 + Math.floor(Math.random() * 9999));

// ---- the animation: the part speed on a log scale, and how many parts fly at once
const speedLog = computed({ get: () => Math.log2(s.speed), set: (v) => (s.speed = Number((2 ** v).toFixed(3))) });
const inAir = computed(() => {
  const parts = built.value?.r.parts;
  if (!plays.value || !parts?.length) return 0;
  const ev: [number, number][] = [];
  for (const t of timeline(parts, anim(here, parts)).values()) ev.push([t.start, 1], [t.land, -1]);
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let [n, top] = [0, 0];
  for (const [, d] of ev) top = Math.max(top, (n += d));
  return top;
});
const pct = (x: number) => `${Math.round(x * 100)} %`;
const band = (lo: number, hi: number) => `${lo.toFixed(2)} to ${hi.toFixed(2)} H`;
// how many kinds of detail this seed shows (score.ts)
const kinds = computed(() => (!hub.value && built.value ? variety(built.value.r.st) : undefined));
const status = computed(() => {
  const r = built.value?.r;
  if (!r) return { ok: false, text: '' };
  return { ok: r.ok && !floating(r.parts).length, text: r.ok ? `Stable, max ratio ${r.ratio.toFixed(2)}, αcr ${r.alpha === Infinity ? '∞' : r.alpha.toFixed(1)}` : 'Mechanism left' };
});
const members = computed(() => {
  const st = built.value?.r.st;
  if (!st) return [];
  return [
    ...st.arms.map((a) => [a.id, `${a.sec.id}, ${CONN(a.conn)}${a.braces.map((b) => ', brace ' + b.sec.id).join('')}${a.truss ? ', chord ' + a.truss.chord.id : ''}${a.post ? ', post ' + a.post.sec.id : ''}${a.splice !== undefined ? ', splice' : ''}`]),
    ...st.secs.map((x) => [x.id, `${x.sec.id}, ${CONN(x.conn)}`]),
  ];
});
const column = computed(() => {
  const st = built.value?.r.st;
  if (hub.value) {
    const c = current.value;
    return [c?.id, c?.name, st?.col.id].filter(Boolean).join(', ');
  }
  return st ? `${st.form}, ${st.cols.length > 1 ? st.cols.length + ' × ' : ''}${st.col.id}${st.splice ? ' / ' + st.splice.sec.id : ''}, ${(st.H / 1000).toFixed(2)} m` : '';
});

// ---- the view
const viewName = computed({ get: () => s.view, set: setView });
const az = computed({ get: () => s.az, set: (v) => turnTo(v, s.el) });
const el = computed({ get: () => s.el, set: (v) => turnTo(s.az, v) });

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
const diff = computed(() => drawing.value?.diff);
const copyNote = ref('');
async function copy(what: 'svg' | 'link') {
  try {
    await navigator.clipboard.writeText(what === 'svg' ? drawing.value!.svg() : location.href);
    copyNote.value = what === 'svg' ? 'SVG copied.' : 'Link copied.';
  } catch {
    copyNote.value = 'The browser refused the clipboard.';
  }
}
</script>

<template>
  <div class="app">
    <aside class="rail">
      <header class="head">
        <h1>Steel structure generator</h1>
        <p v-if="hub" class="lede">A real test of the RESSLab Hub, drawn in its test rig, from the record as the hub gives it. The seed settings are off.</p>
        <p v-else class="lede">One column with arms, a portal or a box. The frame solver checks it stands, fixes it when it does not, and sizes every member from the real section tables.</p>
        <div class="tags">
          <span v-if="dev" class="epfl-tag" :title="`${dev.branch} at ${dev.sha}${dev.dirty ? ', with changes not committed' : ''}. Live: it reloads on each save.`">
            {{ dev.branch }} <span class="num">{{ dev.sha }}{{ dev.dirty ? '*' : '' }}</span>
          </span>
          <span v-if="status.text" class="status" :class="status.ok ? 'ok' : 'bad'">{{ status.ok ? 'Stable' : 'Mechanism' }}</span>
        </div>
      </header>

      <div class="mode">
        <Seg v-model="mode" label="Draw" :options="[['seed', 'Seed'], ['hub', 'Hub test']]" />
      </div>

      <div class="sections">
        <Section v-if="hub" id="test" title="Test" open>
          <HubTest />
        </Section>

        <Section v-if="!hub" id="structure" title="Structure" :keys="GROUPS.structure" open>
          <div class="seed">
            <label for="seed">Seed</label>
            <button type="button" class="epfl-btn epfl-btn-secondary epfl-btn-sm" title="Previous seed" aria-label="Previous seed" @click="nextSeed(-1)">Prev</button>
            <input id="seed" v-model.number="s.seed" class="epfl-input" type="number" min="1" step="1">
            <button type="button" class="epfl-btn epfl-btn-secondary epfl-btn-sm" title="Next seed" aria-label="Next seed" @click="nextSeed(1)">Next</button>
            <button type="button" class="epfl-btn epfl-btn-secondary epfl-btn-sm" title="A random seed" @click="randomSeed">Random</button>
          </div>
          <Seg v-model="s.form" label="Form" :options="[['mix', 'Any'], ['tree', 'Tree'], ['portal', 'Portal'], ['box', 'Box']]" />
          <Slider id="arms" v-model="s.arms" label="Arms" :min="1" :max="12" :step="1" :out="String(s.arms)" />
          <Slider id="height" v-model="s.height" label="Height" :min="1500" :max="6000" :step="250" :out="`${(s.height / 1000).toFixed(2)} m`" />
          <Slider id="load" v-model="s.load" label="Load" :min="10" :max="200" :step="10" :out="`${s.load} kN/m`" />
          <Seg v-model="s.family" label="Section tables" :options="[['aisc', 'AISC (W, HSS, C, L)'], ['eu', 'EU (IPE, HE, UPN, L)']]" />
          <Seg v-model="s.shapes" label="Channels, angles, tees" :options="[['none', 'None'], ['some', 'Some'], ['all', 'All']]" />
        </Section>

        <Section v-if="!hub" id="layout" title="Layout" :keys="GROUPS.layout">
          <p class="note">Storeys, span and bracing change a portal or a box. Arm length is for a tree (the side arms of a portal take 3/4 of the band). Gable roof is for a portal, on its top bay beam. Purlins are for a gable roof.</p>
          <Seg v-model="s.storeys" label="Storeys" :options="[[0, 'Auto'], [1, 'One'], [2, 'Two']]" />
          <Slider id="span" v-model="s.span" label="Span" :min="0.6" :max="1.6" :step="0.05" :out="`× ${s.span.toFixed(2)}`" />
          <Seg v-model="s.bracing" label="Bracing" :options="[['auto', 'Auto'], ...BRACING_KINDS.map((b) => [b, b[0].toUpperCase() + b.slice(1)] as [string, string])]" />
          <Seg v-model="s.xKind" label="X kind" :options="[['auto', 'Auto'], ['flat', 'Flat bars'], ['rod', 'Rods'], ['angle', 'Angles']]" />
          <RangeSlider id="armL" v-model:lo="s.armLmin" v-model:hi="s.armLmax" label="Arm length" :min="0.1" :max="1" :step="0.05" :out="band(s.armLmin, s.armLmax)" />
          <RangeSlider id="armZ" v-model:lo="s.armZmin" v-model:hi="s.armZmax" label="Arm height on the column" :min="0.2" :max="1" :step="0.05" :out="band(s.armZmin, s.armZmax)" />
          <div class="field">
            <label class="epfl-label" for="conn">Beam connections</label>
            <select id="conn" v-model="s.conn" class="epfl-select">
              <option value="auto">The seed picks</option>
              <option v-for="c in BEAM_CONN_KINDS" :key="c" :value="c">All {{ CONN(c) }}</option>
            </select>
          </div>
          <Slider id="gable" v-model="s.gable" label="Gable roof" :min="0" :max="1" :step="0.05" :out="pct(s.gable)" />
          <Slider id="purlins" v-model="s.purlins" label="Purlins" :min="0" :max="1" :step="0.05" :out="pct(s.purlins)" />
        </Section>

        <Section v-if="!hub" id="details" title="Details" :keys="GROUPS.details">
          <p class="note">The chance of each detail, where it fits.</p>
          <Slider id="braces" v-model="s.braces" label="Braces" :min="0" :max="1" :step="0.05" :out="pct(s.braces)" />
          <Slider id="secondaries" v-model="s.secondaries" label="Secondary beams" :min="0" :max="1" :step="0.05" :out="pct(s.secondaries)" />
          <Slider id="posts" v-model="s.posts" label="Posts" :min="0" :max="1" :step="0.05" :out="pct(s.posts)" />
          <Slider id="splices" v-model="s.splices" label="Beam splices" :min="0" :max="1" :step="0.05" :out="pct(s.splices)" />
          <Slider id="trusses" v-model="s.trusses" label="Trusses" :min="0" :max="2.5" :step="0.1" :out="`× ${s.trusses.toFixed(1)}`" />
          <Slider id="rods" v-model="s.rods" label="Tension rods" :min="0" :max="1" :step="0.05" :out="pct(s.rods)" />
          <Slider id="xBraces" v-model="s.xBraces" label="X braces" :min="0" :max="1" :step="0.05" :out="pct(s.xBraces)" />
          <Slider id="colSplice" v-model="s.colSplice" label="Column splice" :min="0" :max="1" :step="0.05" :out="pct(s.colSplice)" />
          <Slider id="connKinds" v-model="s.connKinds" label="More connection kinds" :min="0" :max="1" :step="0.05" :out="pct(s.connKinds)" />
          <Slider id="skew" v-model="s.skew" label="Skewed arms" :min="0" :max="1" :step="0.05" :out="pct(s.skew)" />
          <Slider id="round" v-model="s.round" label="Round tube braces" :min="0" :max="1" :step="0.05" :out="pct(s.round)" />
          <Slider id="shortBraces" v-model="s.shortBraces" label="Short arm braces" :min="0" :max="1" :step="0.05" :out="pct(s.shortBraces)" />
        </Section>

        <Section id="view" title="View" :keys="GROUPS.view" open>
          <Seg v-model="s.viewer" label="Viewer" :options="[['3d', '3D'], ['svg', 'SVG'], ['both', 'Both']]" />
          <Seg v-if="dev" v-model="s.compare" :label="`Compare with ${dev.base.ref}`" :options="[[0, 'Off'], [1, 'Side by side'], [2, 'One view']]" />
          <Seg v-model="viewName" label="View" :options="[['iso', 'Iso'], ['south', 'S'], ['west', 'W'], ['north', 'N'], ['east', 'E'], ['plan', 'Plan']]" />
          <Slider id="az" v-model="az" label="Azimuth" :min="0" :max="359" :step="1" :out="`${s.az}°`" />
          <Slider id="el" v-model="el" label="Elevation" :min="0" :max="90" :step="1" :out="`${s.el}°`" />
          <Seg v-model="s.weights" label="Line weights" :options="[['', 'Auto'], ['one', 'One'], ['two', 'Two']]" />
          <Seg v-model="s.detail" label="Detail" :options="[['members', 'Members'], ['plates', 'Plates'], ['bolts', 'Bolts']]" />
          <Seg v-model="s.size" label="SVG size" :options="[[0, 'Full size'], [256, '256 px'], [96, '96 px'], [48, '48 px']]" />
        </Section>

        <Section id="animation" title="Animation" :keys="GROUPS.animation" open>
          <Slider id="duration" v-model="s.duration" label="Build time" :min="0" :max="30" :step="0.5" :out="plays ? `${s.duration} s` : 'Off'" />
          <p v-if="!plays" class="note">Off: a change draws the structure at once. Set a build time to see it built on each change.</p>
          <template v-else>
            <Slider id="speed" v-model="speedLog" label="Part speed" :min="-2" :max="2" :step="0.25" :out="`× ${s.speed.toFixed(2)}`" />
            <p class="note">About {{ inAir }} {{ inAir === 1 ? 'part' : 'parts' }} in the air at once. A short build with slow parts brings many parts at the same time.</p>
            <div class="actions">
              <button type="button" class="epfl-btn epfl-btn-primary epfl-btn-sm" @click="replay++">Play again</button>
            </div>
          </template>
        </Section>

        <Section v-if="!hub" id="seeds" title="Good seeds">
          <GoodSeeds />
        </Section>

        <Section id="analysis" title="Analysis">
          <div><span class="status" :class="status.ok ? 'ok' : 'bad'">{{ status.text }}</span></div>
          <p v-if="kinds" class="note">Variety: {{ kinds.variety }} kinds of detail<br>{{ kinds.kinds.join(', ') }}</p>
          <ul class="members">
            <li v-for="[k, v] in members" :key="k"><span>{{ k }}</span><span>{{ v }}</span></li>
          </ul>
          <ol class="log">
            <li v-for="(t, i) in built?.r.log" :key="i">{{ t }}</li>
          </ol>
        </Section>
      </div>

      <footer class="foot">
        <div class="actions">
          <button type="button" class="epfl-btn epfl-btn-secondary epfl-btn-sm" @click="copy('svg')">Copy SVG</button>
          <button type="button" class="epfl-btn epfl-btn-secondary epfl-btn-sm" @click="copy('link')">Copy link</button>
          <button type="button" class="epfl-btn epfl-btn-secondary epfl-btn-sm" @click="s.theme = dark ? 'light' : 'dark'">{{ dark ? 'Light' : 'Dark' }}</button>
        </div>
        <p v-if="copyNote" class="note" role="status">{{ copyNote }}</p>
      </footer>
    </aside>

    <main class="sheet">
      <Drawing ref="drawing" :built="built" :replay="replay" :note="note" />
      <dl class="titleblock">
        <div><dt>{{ hub ? 'Test' : 'Column' }}</dt><dd>{{ column }}</dd></div>
        <div><dt>Solver</dt><dd>{{ built ? `${built.r.nodes} nodes, ${built.r.solves} solves` : '' }}</dd></div>
        <div><dt>Drawing</dt><dd>{{ stats.draw }}</dd></div>
        <div><dt>Time</dt><dd>{{ stats.ms }}</dd></div>
        <div v-if="s.compare && dev">
          <dt>vs {{ dev.base.ref }}</dt>
          <dd>{{ stats.base }}</dd>
          <p v-if="s.compare === 2" class="legend"><span class="diff-new">■ new</span> <span class="diff-gone">■ gone</span></p>
          <details v-if="diff && diff.added.length + diff.gone.length + diff.changed.length" class="ids">
            <summary>Part ids</summary>
            <p v-if="diff.added.length"><b :class="{ 'diff-new': s.compare === 2 }">New</b> {{ diff.added.join(', ') }}</p>
            <p v-if="diff.gone.length"><b :class="{ 'diff-gone': s.compare === 2 }">Gone</b> {{ diff.gone.join(', ') }}</p>
            <p v-if="diff.changed.length"><b>Changed</b> {{ diff.changed.join(', ') }}</p>
          </details>
        </div>
      </dl>
    </main>
  </div>
  <pre v-if="error" class="error" @click="error = ''">{{ error }}</pre>
</template>
