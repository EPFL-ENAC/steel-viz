<!--
  A section of the rail: a details element with its title, how many of its
  settings differ from the default, and a Reset for them. The open state is
  kept in this browser (localStorage, when it works).
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { changed, reset, type Key } from './state.ts';

const props = defineProps<{ id: string; title: string; keys?: Key[]; open?: boolean }>();

const store = `steel-viz.open.${props.id}`;
function saved(): boolean | null {
  try {
    const v = localStorage.getItem(store);
    return v === null ? null : v === '1';
  } catch {
    return null;
  }
}
const isOpen = ref(saved() ?? !!props.open);
watch(isOpen, (v) => {
  try { localStorage.setItem(store, v ? '1' : '0'); } catch {}
});
const n = computed(() => (props.keys ? changed(props.keys) : 0));
</script>

<template>
  <details class="section" :open="isOpen" @toggle="isOpen = ($event.target as HTMLDetailsElement).open">
    <summary>
      <span class="title">{{ title }}</span>
      <span v-if="n" class="epfl-badge epfl-badge-primary">{{ n }} changed</span>
    </summary>
    <div class="body">
      <slot />
      <div v-if="n" class="reset">
        <button type="button" class="epfl-btn epfl-btn-secondary epfl-btn-sm" @click="reset(keys!)">Reset {{ title.toLowerCase() }}</button>
      </div>
    </div>
  </details>
</template>
