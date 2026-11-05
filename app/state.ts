// The settings of the page, kept in the URL hash: a reload keeps them, and a
// link opens the same structure. Also the catalogs, and what the dev server
// says about this checkout.
import { reactive, ref, watch } from 'vue';
import { DEFAULTS as GEN, type Params, type Result } from '../generate.ts';
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
import aiscO from '../sections/chs-aisc-sections.csv?raw';
import euO from '../sections/chs-european-sections.csv?raw';

const DEFAULTS = {
  // a hub test instead of a seed (app/tests.ts): '<table>/<id>', '<table>'
  // (its first test) or 'paste' (the pasted record). '': the seed.
  specimen: '',
  seed: 5,
  // structure
  form: 'mix',
  arms: 8,
  height: 2500,
  load: 100,
  family: 'aisc' as Family,
  shapes: 'some', // channels, double angles and tees: none, some or all (see SHAPE_P)
  // layout (see Params in generate.ts)
  storeys: 0, // 0: the seed picks
  span: GEN.spanK,
  bracing: 'auto',
  xKind: 'auto', // flat bars, rods or angles in an X
  armLmin: GEN.armL[0],
  armLmax: GEN.armL[1],
  armZmin: GEN.armZ[0],
  armZmax: GEN.armZ[1],
  conn: 'auto',
  gable: GEN.gableP, // the chance of a pitched roof on a one storey portal
  // details: the chance of each one
  braces: GEN.braceP,
  secondaries: GEN.secondaryP,
  posts: GEN.postP,
  splices: GEN.beamSpliceP,
  trusses: GEN.trussK, // times the usual chance
  rods: GEN.rodP,
  xBraces: GEN.xP, // the chance that an auto diagonal is an X
  colSplice: GEN.colSpliceP,
  connKinds: GEN.connKindsP,
  skew: GEN.skewP,
  round: GEN.roundP, // round tube braces
  // view
  viewer: '3d', // 3d, svg or both
  compare: 0, // 1: this branch and the base branch side by side (dev server only)
  view: 'iso', // '' when the angle is free
  az: VIEWS.iso[0],
  el: Math.round(VIEWS.iso[1]),
  weights: '', // '' (auto): one in WebGL, two in the SVG
  detail: 'bolts',
  size: 0, // px, 0 for full size
  // animation
  duration: 0, // s, the whole build. 0: no animation, a change draws at once
  speed: 1, // how fast one part comes in (see timeline in steel.ts)
  theme: '', // '' follows the system
};
export type Settings = typeof DEFAULTS;
export type Key = keyof Settings;

// the keys of each section of the rail: what it counts as changed, and resets
export const GROUPS = {
  structure: ['form', 'arms', 'height', 'load', 'family', 'shapes'],
  layout: ['storeys', 'span', 'bracing', 'xKind', 'armLmin', 'armLmax', 'armZmin', 'armZmax', 'conn', 'gable'],
  details: ['braces', 'secondaries', 'posts', 'splices', 'trusses', 'rods', 'xBraces', 'colSplice', 'connKinds', 'skew', 'round'],
  view: ['viewer', 'compare', 'view', 'az', 'el', 'weights', 'detail', 'size'],
  animation: ['duration', 'speed'],
} satisfies Record<string, Key[]>;
// the keys that change the structure
export const BUILD_KEYS: Key[] = ['seed', ...GROUPS.structure, ...GROUPS.layout, ...GROUPS.details];


function fromHash(): Settings {
  const s = { ...DEFAULTS };
  for (const [k, v] of new URLSearchParams(location.hash.slice(1))) {
    if (!(k in s)) continue;
    const d = (DEFAULTS as any)[k];
    (s as any)[k] = typeof d === 'number' ? (v !== '' && Number.isFinite(Number(v)) ? Number(v) : d) : v;
  }
  // an old link: "vs main" was a viewer
  if ((s.viewer as string) === 'diff') Object.assign(s, { viewer: 'svg', compare: 1 });
  return s;
}

export const s = reactive(fromHash());

export const changed = (keys: Key[]) => keys.filter((k) => s[k] !== DEFAULTS[k]).length;
export const reset = (keys: Key[]) => {
  for (const k of keys) (s as any)[k] = DEFAULTS[k];
};

let timer = 0;
watch(s, () => {
  clearTimeout(timer);
  // replaceState is throttled by browsers, so not on each frame of a drag
  timer = window.setTimeout(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(s)) if (v !== (DEFAULTS as any)[k]) p.set(k, String(v));
    // keep the / of specimen=<table>/<id> readable, URLSearchParams reads it back
    history.replaceState(null, '', p.size ? '#' + String(p).replace(/%2F/gi, '/') : location.pathname);
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
export const params = (): Partial<Params> => ({
  seed: s.seed || 1, form: s.form as Params['form'], arms: s.arms, height: s.height, load: s.load,
  shapeP: SHAPE_P[s.shapes] ?? GEN.shapeP, fy: s.family === 'eu' ? 355 : 345,
  storeys: s.storeys as Params['storeys'], spanK: s.span, bracing: s.bracing as Params['bracing'],
  xKind: s.xKind as Params['xKind'], xP: s.xBraces,
  armL: [s.armLmin, s.armLmax], armZ: [s.armZmin, s.armZmax], conn: s.conn as Params['conn'], gableP: s.gable,
  braceP: s.braces, secondaryP: s.secondaries, postP: s.posts, beamSpliceP: s.splices,
  trussK: s.trusses, rodP: s.rods, colSpliceP: s.colSplice, connKindsP: s.connKinds, skewP: s.skew, roundP: s.round,
});

const TABLES: Record<Family, [string, string, string, string, string]> = { aisc: [aiscI, aiscHss, aiscC, aiscL, aiscO], eu: [euI, euHss, euC, euL, euO] };
const cats: Partial<Record<Family, Catalog>> = {};
export const catalog = (fam: Family) => (cats[fam] ??= loadCatalog(fam, ...TABLES[fam]));

// a structure and how it was made; animate: play the build when it shows;
// fit: a new hub test, the 3D view fits it
export type Built = { r: Result; ms: number; animate: boolean; fit?: boolean };

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
    if (!d) s.compare = 0;
  });
