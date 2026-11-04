<!-- A slider row: the label and the value on one line, the slider under them. -->
<script setup lang="ts">
defineProps<{ id: string; label: string; min: number; max: number; step: number; out: string }>();
const model = defineModel<number>({ required: true });
</script>

<template>
  <div class="slider">
    <label :for="id">{{ label }}</label>
    <output :for="id">{{ out }}</output>
    <input :id="id" v-model.number="model" type="range" :min="min" :max="max" :step="step">
  </div>
</template>
