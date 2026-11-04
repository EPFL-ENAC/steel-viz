// The 3D entry of the package (@epfl-enac/steel-viz/3d): the exact drawing
// (hlr.ts) and the WebGL viewer (webgl.ts). It loads three.js for hlr.ts (the
// viewer is plain WebGL2), so import it only where it is needed, with a
// dynamic import().
export { renderHLR } from './hlr.ts';
export { createViewer, type Colors, type Frame, type Viewer } from './webgl.ts';
