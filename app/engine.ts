// An engine: the generator and the renderers of one version of the code.
// `here` is this checkout. loadBase() is the base branch, for "vs main" (dev
// server only): app/dev-plugin.ts bundles it and sets globalThis.BASE.
// The base can be older than this code: its viewer may have no setFrame(),
// its timeline() no duration. Each use checks first.
import { generate, type Result } from '../generate.ts';
import { renderHLR } from '../hlr.ts';
import type { Catalog, Family } from '../sections.ts';
import * as steel from '../steel.ts';
import { createViewer } from '../webgl.ts';
import { catalog, s } from './state.ts';

export type Engine = {
  generate: (p: any, cat: Catalog, detail?: any) => Result;
  render: typeof steel.render;
  renderHLR: typeof renderHLR;
  createViewer?: typeof createViewer;
  steel: Partial<typeof steel> & Pick<typeof steel, 'timeline' | 'buildEnd'>;
  catalog: (fam: Family) => Catalog;
};

export const here: Engine = { generate, render: steel.render, renderHLR, createViewer, steel, catalog };

let baseLoad: Promise<Engine> | null = null;
export const loadBase = () =>
  (baseLoad ??= new Promise<any>((ok, ko) => {
    const g = globalThis as any;
    if (g.BASE) return ok(g.BASE);
    const el = Object.assign(document.createElement('script'), { src: '/__dev/base.js' });
    el.onload = () => (g.BASE_ERROR ? ko(new Error(g.BASE_ERROR)) : ok(g.BASE));
    el.onerror = () => ko(new Error('the dev server did not answer'));
    document.head.append(el);
  }).then((B): Engine => {
    const cats: Partial<Record<Family, Catalog>> = {};
    return { generate: B.generate, render: B.steel.render, renderHLR: B.renderHLR, createViewer: B.createViewer, steel: B.steel, catalog: (fam) => (cats[fam] ??= B.loadCatalog(fam, ...B.TABLES[fam])) };
  }));

// the build time and the part speed, as this engine takes them. An old
// timeline() has no duration: one speed for all, that makes it last as long.
export function anim(E: Engine, parts: steel.Part[]): { speed: number; duration?: number } {
  const duration = s.duration * 1000;
  if (E.steel.shortestBuild) return { speed: s.speed, duration };
  const end = E.steel.buildEnd(E.steel.timeline(parts));
  return { speed: end > 0 && duration > 0 ? end / duration : 1 };
}
