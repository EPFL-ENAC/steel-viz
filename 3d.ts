// The 3D entry of the package (@epfl-enac/steel-viz/3d): the WebGL viewer
// (webgl.ts). It loads no package, but it is a separate entry so the light
// one stays small: import it only where it is needed, with a dynamic import().
export { createViewer, type Colors, type Frame, type Viewer } from './webgl.ts';
