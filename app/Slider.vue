<!-- A label, a range input and its value. -->
<script setup lang="ts">
defineProps<{ id: string; label: string; min: number; max: number; step: number; out: string }>();
const model = defineModel<number>({ required: true });
</script>

<template>
  <div class="row">
    <label :for="id">{{ label }}</label>
    <input :id="id" v-model.number="model" type="range" :min="min" :max="max" :step="step">
    <output :for="id">{{ out }}</output>
  </div>
</template>
