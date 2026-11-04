<!--
  A range slider: two thumbs on one track, for a band (from lo to hi). The
  thumbs never cross: one pushes the other.
-->
<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ id: string; label: string; min: number; max: number; step: number; out: string }>();
const lo = defineModel<number>('lo', { required: true });
const hi = defineModel<number>('hi', { required: true });

const setLo = (e: Event) => {
  const v = Number((e.target as HTMLInputElement).value);
  lo.value = v;
  if (v > hi.value) hi.value = v;
};
const setHi = (e: Event) => {
  const v = Number((e.target as HTMLInputElement).value);
  hi.value = v;
  if (v < lo.value) lo.value = v;
};
const at = (v: number) => ((v - props.min) / (props.max - props.min)) * 100;
const fill = computed(() => ({ left: `${at(lo.value)}%`, right: `${100 - at(hi.value)}%` }));
</script>

<template>
  <div class="slider" role="group" :aria-labelledby="`${id}-label`">
    <span :id="`${id}-label`" class="label">{{ label }}</span>
    <output>{{ out }}</output>
    <div class="range2">
      <div class="track"><div class="fill" :style="fill" /></div>
      <input :id="`${id}-lo`" type="range" :min="min" :max="max" :step="step" :value="lo" :aria-label="`${label}, from`" @input="setLo">
      <input :id="`${id}-hi`" type="range" :min="min" :max="max" :step="step" :value="hi" :aria-label="`${label}, to`" @input="setHi">
    </div>
  </div>
</template>
