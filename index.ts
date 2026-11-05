// The light entry of the package (@epfl-enac/steel-viz): build a structure,
// draw it (the exact renderer hlr.ts, or the painter), time its build
// animation. It must never load three.js or a Node API: package.test.ts
// checks it. The 3D entry is 3d.ts.
// The section tables are not in the package: pass their CSV text to loadCatalog().
export { DEFAULTS, floating, generate, type Detail, type Form, type MemberCheck, type Params, type Result } from './generate.ts';
export { loadCatalog, type Catalog, type Family, type Section } from './sections.ts';
export { BOLT_MS, CRANES, DETAIL, VIEWS, buildEnd, camera, forSize, render, shortestBuild, timeline, type Part, type PartInfo, type RenderOpts, type Slot, type TimelineOpts } from './steel.ts';
export { renderHLR } from './hlr.ts';
export { findSection, type BraceSpecimen, type ColumnSpecimen, type ConnSpecimen, type LinkSpecimen, type SectionRef, type Specimen, type SpecimenBeam } from './specimen.ts';
export { deformParts, follow, movePoint, protocol, readResponse, thin, type Curve, type DeformState, type DeformTable, type Knot, type Move, type Protocol, type ResponseSpec, type Samples, type Zone } from './deform.ts';
export { DEFORMS } from './deforms.ts';
export { fromHubBrace, fromHubColumn, fromHubConnection, fromHubEbf, fromHubHssColumn, toSpecimen, type HubRecord } from './hub.ts';
