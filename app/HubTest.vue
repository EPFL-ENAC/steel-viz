<!--
  The hub test of the rail: pick a table and a test, walk them with Prev and
  Next (or ← and → anywhere but in a form control), see what the reader made
  of the record, or paste a record. The tests come from app/tests.ts.
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import Response from './Response.vue';
import { s } from './state.ts';
import { LABELS, counts, current, keyFields, loadTable, pasted, source, step, type Row, type Source } from './tests.ts';

const src = shallowRef<Source | null>(null);
source().then((x) => {
  src.value = x;
  for (const t of x.tables) loadTable(t).catch(() => {}); // the counts of the select
});

// '<table>' opens its first test, 'paste' the pasted record
const table = computed({
  get: () => (s.specimen === 'paste' ? 'paste' : s.specimen.split('/')[0]),
  set: (t: string) => (s.specimen = t),
});
const isPaste = computed(() => table.value === 'paste');
const c = computed(() => current.value);
const count = computed(() => counts[table.value]);

// ---- search: an option of the list, or part of one and Enter
const query = ref('');
const label = (r: Row) => (r.name ? `${r.id} ${r.name}` : r.id);
const options = computed(() => c.value?.rows.map(label) ?? []);
function open(r: Row | undefined) {
  if (!r) return false;
  s.specimen = `${c.value!.table}/${r.id}`;
  query.value = '';
  return true;
}
const found = ref(true);
// a pick in the list opens the test at once. Not a typed letter: an id can
// start like another one (C1, C10).
function typed(e: Event) {
  found.value = true;
  if (!(e instanceof InputEvent) || e.inputType === 'insertReplacementText') open(c.value?.rows.find((r) => label(r) === query.value));
}
function search() {
  const q = query.value.trim().toLowerCase();
  if (!q) return;
  const rows = c.value?.rows ?? [];
  found.value = open(rows.find((r) => r.id.toLowerCase() === q) ?? rows.find((r) => label(r).toLowerCase().includes(q)));
}

// ---- the record: its fields that are not empty
const EMPTY = new Set(['', 'NA', 'NR', 'N/A', 'NULL']);
const fields = computed(() => {
  const r = c.value?.record;
  if (!r || typeof r !== 'object') return [];
  return Object.entries(r)
    .filter(([, v]) => v !== null && v !== undefined && !EMPTY.has(String(v).trim().toUpperCase()))
    .map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)]);
});

// ---- ← and → anywhere, but not in a form control (sliders and radios use
// the arrows) and not with a modifier (Alt+← is the browser back)
function key(e: KeyboardEvent) {
  if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.defaultPrevented) return;
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  if ((e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable]')) return;
  e.preventDefault();
  step(e.key === 'ArrowLeft' ? -1 : 1);
}
onMounted(() => window.addEventListener('keydown', key));
onBeforeUnmount(() => window.removeEventListener('keydown', key));
</script>

<template>
  <p v-if="src?.note" class="note source-note">{{ src.note }}</p>
  <div class="field">
    <label class="epfl-label" for="hub-table">Table</label>
    <select id="hub-table" v-model="table" class="epfl-select">
      <option v-for="t in src?.tables" :key="t" :value="t">{{ LABELS[t] ?? t }}{{ counts[t] ? ` (${counts[t].rows})` : '' }}</option>
      <option value="paste">Paste a record</option>
    </select>
  </div>

  <template v-if="!isPaste">
    <div class="field">
      <label class="epfl-label" for="hub-search">Test</label>
      <input
        id="hub-search" v-model="query" class="epfl-input" type="search" list="hub-ids" autocomplete="off"
        :placeholder="c?.id ? `${c.id}, type to search` : 'Type an id or a name'"
        :aria-invalid="!found" @input="typed" @keydown.enter.prevent="search"
      >
      <datalist id="hub-ids">
        <option v-for="o in options" :key="o" :value="o" />
      </datalist>
      <p v-if="!found" class="note" role="status">No test matches "{{ query }}".</p>
    </div>
    <div class="walk">
      <button type="button" class="epfl-btn epfl-btn-secondary epfl-btn-sm" title="Previous test (←)" :disabled="!c || c.index <= 0" @click="step(-1)">Prev</button>
      <span class="num">{{ c?.rows.length ? `${c.index + 1} / ${c.rows.length}` : '' }}</span>
      <button type="button" class="epfl-btn epfl-btn-secondary epfl-btn-sm" title="Next test (→)" :disabled="!c || c.index >= c.rows.length - 1" @click="step(1)">Next</button>
    </div>
    <p v-if="count" class="note">
      {{ count.read === count.rows ? `All ${count.rows} read.` : `${count.read} of ${count.rows} read, the other ${count.rows - count.read} show their error.` }}
      ← and → walk the tests.
    </p>
  </template>

  <div v-else class="field">
    <label class="epfl-label" for="hub-paste">Record</label>
    <textarea
      id="hub-paste" v-model="pasted" class="epfl-input paste" rows="8" spellcheck="false"
      placeholder="A hub record as JSON (a row of a table, from the hub API or a file of specimens/), or our own Specimen (see specimen.ts)"
    />
  </div>

  <div v-if="c" class="test" aria-live="polite">
    <p class="test-id"><b>{{ c.id || (isPaste ? 'Pasted record' : '') }}</b> <span v-if="c.name">{{ c.name }}</span></p>
    <p v-if="c.error" class="test-error" role="alert">{{ c.error }}</p>
    <template v-if="c.spec">
      <dl class="drawn">
        <template v-for="[k, v] in keyFields(c.spec)" :key="k">
          <dt>{{ k }}</dt>
          <dd>{{ v }}</dd>
        </template>
      </dl>
      <div v-if="c.spec.notes?.length">
        <span class="epfl-label">Notes, what we draw differently</span>
        <ul class="test-notes">
          <li v-for="(n, i) in c.spec.notes" :key="i">{{ n }}</li>
        </ul>
      </div>
    </template>
    <Response v-if="c.spec" />
    <details v-if="fields.length" class="record">
      <summary>Record, {{ fields.length }} fields</summary>
      <dl>
        <template v-for="[k, v] in fields" :key="k">
          <dt>{{ k }}</dt>
          <dd>{{ v }}</dd>
        </template>
      </dl>
    </details>
  </div>
</template>
