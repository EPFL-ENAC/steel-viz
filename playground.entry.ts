// What the playground page needs, as globals. build-playground.ts bundles
// this file (with three.js) into the page.
import { loadCatalog } from './sections.ts';
import { floating, generate } from './generate.ts';
import { render, VIEWS } from './steel.ts';
import { renderHLR } from './hlr.ts';
import { logoScore } from './score.ts';

Object.assign(globalThis, { loadCatalog, floating, generate, render, renderHLR, logoScore, VIEWS });
