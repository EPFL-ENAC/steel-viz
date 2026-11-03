// The settings of the page, kept in the URL hash: a reload keeps them, and a
// link opens the same structure. Also the catalogs, and what the dev server
// says about this checkout.
import { reactive, ref, watch } from 'vue';
import { DEFAULTS as GEN, type Result } from '../generate.ts';
import { loadCatalog, type Catalog, type Family } from '../sections.ts';
import { VIEWS } from '../steel.ts';
import aiscI from '../sections/aisc-sections.csv?raw';
import aiscHss from '../sections/hss-aisc-sections.csv?raw';
import euI from '../sections/european-sections.csv?raw';
import euHss from '../sections/hss-european-sections.csv?raw';
import aiscC from '../sections/channel-aisc-sections.csv?raw';
import aiscL from '../sections/angle-aisc-sections.csv?raw';
import euC from '../sections/channel-european-sections.csv?raw';
import euL from '../sections/angle-european-sections.csv?raw';

const DEFAULTS = {
  seed: 5,
  form: 'mix',
  arms: 8,
  height: 2500,
  load: 100,
  family: 'aisc' as Family,
  shapes: 'some', // channels, double angles and tees: none, some or all (see SHAPE_P)
  detail: 'bolts',
  view: 'iso', // '' when the angle is free
  az: VIEWS.iso[0],
  el: Math.round(VIEWS.iso[1]),
  weights: 'two',
  viewer: '3d', // 3d, svg, both, or diff (vs main, dev server only)
  size: 0, // px, 0 for full size
  duration: 6, // s, the length of the build animation, 0 for none
  theme: '', // '' follows the system
};
export type Settings = typeof DEFAULTS;

function fromHash(): Settings {
  const s = { ...DEFAULTS };
  for (const [k, v] of new URLSearchParams(location.hash.slice(1))) {
    if (!(k in s)) continue;
    const d = (DEFAULTS as any)[k];
    (s as any)[k] = typeof d === 'number' ? (v !== '' && Number.isFinite(Number(v)) ? Number(v) : d) : v;
  }
  return s;
}

export const s = reactive(fromHash());

let timer = 0;
watch(s, () => {
  clearTimeout(timer);
  // replaceState is throttled by browsers, so not on each frame of a drag
  timer = window.setTimeout(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(s)) if (v !== (DEFAULTS as any)[k]) p.set(k, String(v));
    history.replaceState(null, '', p.size ? '#' + p : location.pathname);
  }, 200);
});

// set the angle, and say it is no named view anymore
export function turnTo(az: number, el: number) {
  s.view = '';
  s.az = Math.round(((az % 360) + 360) % 360);
  s.el = Math.round(Math.min(90, Math.max(0, el)));
}
export function setView(name: string) {
  s.view = name;
  s.az = VIEWS[name][0];
  s.el = Math.round(VIEWS[name][1]);
}

// the shapes setting (none, some, all in the hash) as shapeP
const SHAPE_P: Record<string, number> = { none: 0, some: GEN.shapeP, all: 1 };
export const params = () => ({ seed: s.seed || 1, form: s.form, arms: s.arms, height: s.height, load: s.load, shapeP: SHAPE_P[s.shapes] ?? GEN.shapeP, fy: s.family === 'eu' ? 355 : 345 });

const TABLES: Record<Family, [string, string, string, string]> = { aisc: [aiscI, aiscHss, aiscC, aiscL], eu: [euI, euHss, euC, euL] };
const cats: Partial<Record<Family, Catalog>> = {};
export const catalog = (fam: Family) => (cats[fam] ??= loadCatalog(fam, ...TABLES[fam]));

// a structure and how it was made; animate: play the build when it shows
export type Built = { r: Result; ms: number; animate: boolean };

// what the drawing says in the title block
export const stats = reactive({ draw: '', ms: '', base: '' });

// the dev server: branch, commit, base for "vs main". null in a static build.
export type DevInfo = { branch: string; sha: string; dirty: boolean; base: { ref: string; sha: string } };
export const dev = ref<DevInfo | null>(null);
fetch('/__dev/info')
  .then((r) => (r.ok && r.headers.get('content-type')?.includes('json') ? r.json() : null))
  .catch(() => null)
  .then((d) => {
    dev.value = d;
    if (!d && s.viewer === 'diff') s.viewer = '3d';
  });
