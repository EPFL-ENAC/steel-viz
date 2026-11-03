// three-edge-projection ships no types. This types the part hlr.ts uses.
// If hlr.ts uses more of the library, add it here.
declare module 'three-edge-projection/src/ProjectionGenerator.js' {
  import type { Object3D } from 'three';

  export class EdgeSet {
    // one segment is [x0, y0, z0, x1, y1, z1]
    meshToSegments: Map<Object3D, Float32Array[]>;
  }

  export class ProjectionResult {
    visibleEdges: EdgeSet;
    hiddenEdges: EdgeSet;
  }

  export class ProjectionGenerator {
    iterationTime: number;
    includeIntersectionEdges: boolean;
    generate(scene: Object3D | Object3D[]): Generator<void, ProjectionResult, void>;
  }
}
