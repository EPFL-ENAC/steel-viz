<!-- A segmented control: a row of radio buttons that look like one control, with its label. -->
<script setup lang="ts">
defineProps<{ label: string; options: [string | number, string][] }>();
const model = defineModel<string | number>();
</script>

<template>
  <div class="field">
    <span class="epfl-label" aria-hidden="true">{{ label }}</span>
    <div class="seg" role="radiogroup" :aria-label="label">
      <label v-for="[value, text] in options" :key="value">
        <input v-model="model" type="radio" :name="label" :value="value"><span>{{ text }}</span>
      </label>
    </div>
  </div>
</template>
