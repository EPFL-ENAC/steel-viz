// The light entry of the package (@epfl-enac/steel-viz): build a structure,
// draw it with the painter renderer, time its build animation. It must never
// load three.js or a Node API: package.test.ts checks it. The 3D entry is 3d.ts.
// The section tables are not in the package: pass their CSV text to loadCatalog().
export { DEFAULTS, floating, generate, type Detail, type Form, type Params, type Result } from './generate.ts';
export { loadCatalog, type Catalog, type Family, type Section } from './sections.ts';
export { BOLT_MS, CRANES, DETAIL, VIEWS, camera, forSize, render, timeline, type Part, type RenderOpts, type Slot } from './steel.ts';
export { findSection, fromHubConnection, toSpecimen, type SectionRef, type Specimen, type SpecimenBeam } from './specimen.ts';
