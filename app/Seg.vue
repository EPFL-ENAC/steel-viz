<!-- A row of radio buttons that look like one segmented control. -->
<script setup lang="ts">
defineProps<{ label: string; options: [string | number, string][] }>();
const model = defineModel<string | number>();
</script>

<template>
  <div class="seg" role="radiogroup" :aria-label="label">
    <label v-for="[value, text] in options" :key="value">
      <input v-model="model" type="radio" :name="label" :value="value"><span>{{ text }}</span>
    </label>
  </div>
</template>
