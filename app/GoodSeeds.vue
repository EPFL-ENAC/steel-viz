<!--
  Scan 200 seeds from the current one and keep the 8 that read best as a
  logo (score.ts). A few seeds at a time, so the page stays alive.
-->
<script setup lang="ts">
import { ref, shallowRef } from 'vue';
import { generate } from '../generate.ts';
import { renderHLR } from '../hlr.ts';
import { logoScore, type Score } from '../score.ts';
import { catalog, params, s } from './state.ts';

const N = 200;
const note = ref('Scans 200 seeds from the current one, with this form, arms, height, load and view. Keeps the 8 that read best as a logo: they fill a square, sit on the columns, have few members and few crossings.');
const picks = shallowRef<(Score & { seed: number; form: string; img: string })[]>([]);
const chosen = ref(0);
let run = 0;

function find() {
  const [base, fam, az, el, from] = [params(), s.family, s.az, s.el, s.seed || 1];
  const me = ++run;
  const found: (Score & { seed: number; form: string })[] = [];
  let seed = from;
  picks.value = [];
  const chunk = () => {
    if (me !== run) return;
    for (const end = Math.min(from + N, seed + 10); seed < end; seed++) {
      const r = generate({ ...base, seed }, catalog(fam), 'members');
      if (r.ok) found.push({ seed, form: r.st.form, ...logoScore(r.parts, az, el) });
    }
    note.value = `Scanning, ${seed - from} of ${N} seeds…`;
    if (seed < from + N) return void setTimeout(chunk, 0);
    found.sort((a, b) => b.score - a.score);
    picks.value = found.slice(0, 8).map((b) => {
      const svg = renderHLR(generate({ ...base, seed: b.seed }, catalog(fam), 'bolts').parts, { az, el, size: 120 }).svg;
      return { ...b, img: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) };
    });
    note.value = `The best 8 of ${found.length} stable structures, seeds ${from} to ${from + N - 1}. Click one to open it.`;
  };
  chunk();
}

function open(seed: number) {
  chosen.value = seed;
  s.seed = seed;
}
</script>

<template>
  <fieldset>
    <legend>Good seeds</legend>
    <div class="actions"><button type="button" @click="find">Find good seeds</button></div>
    <p class="note">{{ note }}</p>
    <div class="picks">
      <button
        v-for="b in picks"
        :key="b.seed"
        type="button"
        :aria-current="b.seed === chosen"
        :title="`fill ${b.fill.toFixed(2)}, aspect ${b.aspect.toFixed(2)}, balance ${b.balance.toFixed(2)}, ${b.members} members, ${b.crossings} crossings`"
        @click="open(b.seed)"
      >
        <!-- an img, so the styles of each small drawing stay apart from the big one -->
        <img :src="b.img" :alt="`Seed ${b.seed}`">
        <span>{{ b.form }} {{ b.seed }}, {{ b.score.toFixed(2) }}</span>
      </button>
    </div>
  </fieldset>
</template>
