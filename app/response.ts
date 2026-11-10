// The measured response of the hub test on show: its steps, the step on show,
// and the deformed shape at this step. Response.vue is its control, Pane.vue
// gives the shape to the viewer. All of it reads DEFORMS: a new table needs no
// change here.
import { computed, reactive, shallowRef, watch } from 'vue';
import { protocol, type DeformState, type DeformTable, type Protocol } from '../deform.ts';
import { DEFORMS, shapeAt } from '../deforms.ts';
import type { Result } from '../generate.ts';
import type { HubRecord } from '../hub.ts';
import { current, type Current } from './tests.ts';

const PLAY_MS = 20000; // the whole protocol

// the CSS color of each Zone.slot. Pane.vue gives the same list to the viewer.
export const ZONE_COLORS = ['var(--zone-moment)', 'var(--zone-shear)'];

export const resp = reactive({ step: 0, playing: false, scale: 'auto' as 'auto' | number });

// the structure on the sheet and the test it was built from (App.vue sets it)
export const shownTest = shallowRef<{ r: Result; c: Current } | null>(null);

export const table = computed<DeformTable | null>(() => {
  const t = current.value?.table;
  return t && Object.hasOwn(DEFORMS, t) ? DEFORMS[t] : null;
});
export const steps = computed<Protocol | null>(() => {
  const r = current.value?.responses;
  if (!table.value || !r) return null;
  try {
    return protocol(r);
  } catch {
    return null; // no file with data
  }
});
export const scale = computed(() => (resp.scale !== 'auto' ? resp.scale : (steps.value && table.value?.autoScale(steps.value)) ?? 1));

// the shape at the step, and the structure it is for. A shape that can't be
// made gives a message, the view stays undeformed.
const frame = computed<{ r: Result; state: DeformState } | { error: string } | null>(() => {
  const [T, p, t] = [table.value, steps.value, shownTest.value];
  if (!T || !p || !t || t.c !== current.value || !t.c.spec) return null;
  try {
    return { r: t.r, state: shapeAt(t.c.table, t.r, t.c.spec, t.c.record as HubRecord, p, resp.step, scale.value) };
  } catch (e) {
    return { error: (e as Error).message };
  }
});
export const deformed = computed(() => (frame.value && 'state' in frame.value ? frame.value : null));
export const shapeError = computed(() => (frame.value && 'error' in frame.value ? frame.value.error : ''));

// ---- play
let raf = 0;
function stop() {
  cancelAnimationFrame(raf);
  resp.playing = false;
}
export function togglePlay() {
  const p = steps.value;
  if (!p || p.n < 2) return;
  if (resp.playing) return stop();
  if (resp.step >= p.n - 1) resp.step = 0;
  resp.playing = true;
  let [t0, at] = [performance.now(), resp.step];
  const tick = (t: number) => {
    at += (Math.max(0, t - t0) * (p.n - 1)) / PLAY_MS; // the first frame can start before t0
    t0 = t;
    resp.step = Math.min(p.n - 1, Math.floor(at));
    if (resp.step >= p.n - 1) return stop();
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

// a new test starts at its first step
watch(() => current.value?.key, () => {
  stop();
  resp.step = 0;
});
