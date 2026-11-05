<!--
  Scan 200 seeds from the current one and keep the best 8 (score.ts): the ones
  that read best as a logo, that show the most kinds of detail, or a mix of
  both. A few seeds at a time, so the page stays alive. A new sort uses the
  last scan again, so it only draws the new 8.
-->
<script setup lang="ts">
import { ref, shallowRef, watch } from 'vue';
import { generate } from '../generate.ts';
import { renderHLR } from '../hlr.ts';
import { better, logoScore, variety, type By, type Score, type Variety } from '../score.ts';
import Seg from './Seg.vue';
import { catalog, params, s } from './state.ts';

type Found = Score & Variety & { seed: number; form: string };

const N = 200;
const KEEPS: Record<By, string> = {
  logo: 'that read best as a logo: they fill a square, sit on the columns, have few members and few crossings.',
  variety: 'that show the most kinds of detail.',
  mix: 'with the best mix: half the logo score, half the variety.',
};
const intro = () => `Scans 200 seeds from the current one, with this form, arms, height, load and view. Keeps the 8 ${KEEPS[by.value]}`;
const by = ref<By>('logo');
const note = ref(intro());
const picks = shallowRef<(Found & { img: string })[]>([]);
const chosen = ref(0);
let run = 0;
let scanning = false;
// the last full scan, with what it needs to draw its seeds
let last: { found: Found[]; base: ReturnType<typeof params>; fam: typeof s.family; az: number; el: number; from: number } | undefined;

function show() {
  const { found, base, fam, az, el, from } = last!;
  picks.value = [...found].sort(better(by.value)).slice(0, 8).map((b) => {
    const svg = renderHLR(generate({ ...base, seed: b.seed }, catalog(fam), 'bolts').parts, { az, el, size: 120 }).svg;
    return { ...b, img: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) };
  });
  note.value = `The best 8 of ${found.length} stable structures, seeds ${from} to ${from + N - 1}: the ones ${KEEPS[by.value]} Click one to open it.`;
}

function find() {
  const [base, fam, az, el, from] = [params(), s.family, s.az, s.el, s.seed || 1];
  const me = ++run;
  const found: Found[] = [];
  let seed = from;
  picks.value = [];
  scanning = true;
  const chunk = () => {
    if (me !== run) return;
    for (const end = Math.min(from + N, seed + 10); seed < end; seed++) {
      const r = generate({ ...base, seed }, catalog(fam), 'members');
      if (r.ok) found.push({ seed, form: r.st.form, ...logoScore(r.parts, az, el), ...variety(r.st) });
    }
    note.value = `Scanning, ${seed - from} of ${N} seeds…`;
    if (seed < from + N) return void setTimeout(chunk, 0);
    scanning = false;
    last = { found, base, fam, az, el, from };
    show();
  };
  chunk();
}

// during a scan there is nothing to do: its end reads the sort
watch(by, () => {
  if (scanning) return;
  if (last) show();
  else note.value = intro();
});

function open(seed: number) {
  chosen.value = seed;
  s.seed = seed;
}
</script>

<template>
  <div class="stack">
    <Seg v-model="by" label="Sort by" :options="[['logo', 'Logo'], ['variety', 'Variety'], ['mix', 'Both']]" />
    <div class="actions"><button type="button" class="epfl-btn epfl-btn-secondary epfl-btn-sm" @click="find">Find good seeds</button></div>
    <p class="note">{{ note }}</p>
    <div class="picks">
      <button
        v-for="b in picks"
        :key="b.seed"
        type="button"
        :aria-current="b.seed === chosen"
        :title="`fill ${b.fill.toFixed(2)}, aspect ${b.aspect.toFixed(2)}, balance ${b.balance.toFixed(2)}, ${b.members} members, ${b.crossings} crossings. Kinds: ${b.kinds.join(', ')}`"
        @click="open(b.seed)"
      >
        <!-- an img, so the styles of each small drawing stay apart from the big one -->
        <img :src="b.img" :alt="`Seed ${b.seed}`">
        <span>{{ b.form }} {{ b.seed }}<br>{{ b.score.toFixed(2) }}, {{ b.variety }} kinds</span>
      </button>
    </div>
  </div>
</template>
