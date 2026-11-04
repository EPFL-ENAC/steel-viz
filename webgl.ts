// The 3D viewer of the playground, in WebGL through three.js.
//
// hlr.ts stays the exact drawing, for export: Copy SVG, the logo files, the
// small sizes. Here the screen only has to look right while you turn and
// zoom, so the depth buffer of the GPU hides the hidden lines, and the
// geometry is built once per structure, not once per frame.
//
// Faces are filled with the background colour. The edges each Face asks for
// are thin lines. The outlines come from a second pass, with the same rule
// as hlr.ts: the depth and the part of every pixel go to a texture, and a
// screen pass draws a thick line on the near side of a jump in depth bigger
// than DEEP, or of any jump to another part behind.
import {
  BufferAttribute, BufferGeometry, Color, DepthTexture, DoubleSide, Group, Mesh, MeshBasicMaterial, OrthographicCamera,
  PlaneGeometry, Scene, ShaderMaterial, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget,
} from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { add, cross, dot, mul, norm, type V } from './vec.ts';
import { BOLT_MS, buildEnd, camera, timeline, type Part } from './steel.ts';
import { triangles } from './hlr.ts';

const HEAD = 13; // bolt head height, mm, as in hlr.ts
const R = 17; // bolt head, corner to centre, mm
const DEEP = 50; // mm: a jump in depth bigger than this makes an outline
const THIN = 1; // px
const THICK = 2.25; // px

export type Colors = { bg: string; fg: string; accent: string };
// what the view shows, in world mm: the point in the middle, and half the
// height it shows. Two viewers with the same frame line up, even when their
// structures are a bit different (vs main).
export type Frame = { target: V; half: number };
export type Viewer = {
  show(parts: Part[]): void; // a new structure
  view(az: number, el: number): void;
  // play the build animation. speed: how fast one part comes in (2: twice as
  // fast). duration: the whole build lasts this long, ms (see timeline)
  build(speed?: number, duration?: number): void;
  setWeights(two: boolean): void;
  setColors(c: Colors): void;
  reset(): void; // zoom and pan back to the whole structure
  frame(): Frame | null; // null: no zoom or pan by hand, it fits the structure
  setFrame(f: Frame | null): void; // null: fit the structure. Never calls onFrame.
  stats(): { faces: number; bolts: number; lines: number };
  canvas: HTMLCanvasElement;
};

// one bolt head on point b, looking along nn: its triangles and its lines
function head(b: V, nn: V, tri: number[], seg: number[]) {
  const ref: V = Math.abs(nn[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  const a1 = norm(cross(nn, ref));
  const a2 = cross(nn, a1);
  const at = (h: number, r: number, t: number) => add(add(b, mul(nn, h)), add(mul(a1, r * Math.cos(t)), mul(a2, r * Math.sin(t))));
  const lo = [0, 1, 2, 3, 4, 5].map((k) => at(0, R, (k * Math.PI) / 3));
  const hi = [0, 1, 2, 3, 4, 5].map((k) => at(HEAD, R, (k * Math.PI) / 3));
  triangles(hi, tri);
  for (let i = 0; i < 6; i++) {
    const j = (i + 1) % 6;
    triangles([lo[i], lo[j], hi[j], hi[i]], tri);
    // the top ring and the corners only: the bottom ring is 13 mm below the
    // top one, on screen the two merge into a blob
    seg.push(...hi[i], ...hi[j], ...lo[i], ...hi[i]);
  }
}
// a head is always this many floats
const HEAD_TRI = 9 * (4 + 6 * 2);
const HEAD_SEG = 6 * 6 * 2;

// the outline pass: thick lines on the near side of a depth jump
const OUTLINE = {
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDepth, tId;
    uniform vec2 texel;
    uniform float deep, touch, width;
    uniform vec3 color;
    varying vec2 vUv;
    float D(vec2 o) { return texture2D(tDepth, vUv + o * texel).r; }
    vec3 I(vec2 o) { return texture2D(tId, vUv + o * texel).rgb; }
    void main() {
      float c = D(vec2(0.0));
      if (c >= 1.0) discard; // background
      vec3 id = I(vec2(0.0));
      bool bolt = id.b > 0.5; // a bolt head gets thin lines only
      float hit = 0.0;
      for (int k = 1; k <= 12; k++) {
        float r = float(k);
        if (r > width) break;
        for (int a = 0; a < 8; a++) {
          float t = float(a) * 0.785398;
          vec2 o = vec2(cos(t), sin(t)) * r;
          float n = D(o);
          // the second difference is 0 on any plane, however steep
          float s = n + D(-o) - 2.0 * c;
          if (s > deep || n >= 1.0) hit = 1.0;
          else if (!bolt && n - c > touch && distance(I(o).rg, id.rg) > 0.001) hit = 1.0;
        }
      }
      if (hit < 0.5) discard;
      gl_FragColor = vec4(1.0);
    }`,
};

// the outlines are found per pixel, so they come out all or nothing: they
// are found at SS times the screen size, then averaged down to the screen
const DOWN = {
  vertexShader: OUTLINE.vertexShader,
  fragmentShader: `
    uniform sampler2D tLine;
    uniform vec2 px; // one screen pixel, in uv
    uniform vec3 color;
    varying vec2 vUv;
    void main() {
      // 4 linear taps cover the footprint of the pixel on the big texture
      float a = 0.0;
      for (int i = 0; i < 2; i++)
        for (int j = 0; j < 2; j++)
          a += texture2D(tLine, vUv + (vec2(float(i), float(j)) - 0.5) * 0.5 * px).a;
      a *= 0.25;
      if (a <= 0.0) discard;
      gl_FragColor = vec4(color, a);
      #include <colorspace_fragment>
    }`,
};

const ID_MAT = {
  vertexShader: '#include <common>\nvoid main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform vec3 id; void main() { gl_FragColor = vec4(id, 1.0); }',
};

// base: the triangle and line floats before the bolt heads; per: heads per bolt
type Piece = { part: Part; group: Group; fill: Mesh; lines?: LineSegments2; base: [number, number]; per: number; mat: LineMaterial };

// onTurn: the user turned the view (done: the drag is over). onHover: the
// part under the mouse (null: none), and the mouse in client px. Only for a
// mouse with no button down, and not during the build animation. onFrame: the
// user zoomed or moved the view, or double clicked to fit it.
export function createViewer(
  host: HTMLElement,
  onTurn: (az: number, el: number, done: boolean) => void,
  onHover?: (part: Part | null, x: number, y: number) => void,
  onFrame?: (f: Frame | null) => void,
): Viewer {
  const renderer = new WebGLRenderer({ antialias: true });
  // sized by hand in device pixels (see resize), so pixel ratio 1 here
  const canvas = renderer.domElement;
  Object.assign(canvas.style, { display: 'block', width: '100%', height: '100%' });
  host.append(canvas);

  const scene = new Scene();
  const cam = new OrthographicCamera(-1, 1, 1, -1, 1, 10);
  let colors: Colors = { bg: '#ffffff', fg: '#212121', accent: '#e30713' };
  let two = true;
  let pieces: Piece[] = [];
  let shown: Part[] = []; // the parts of show(), in the order of their ids
  let [az, el] = [225, 35.264];
  let [radius, centre] = [1, new Vector3()];
  let [zoom, pan] = [1, new Vector3()];
  let fitted = true; // no zoom or pan by hand: a new size fits the structure again
  let [w, h] = [1, 1];

  // faces sit back a little so the lines on their own edges win. The push grows with
  // the slope of the face times the pixel size: with 1 instead of 0.5, a face
  // zoomed out moved back more than a flange is thick and hidden web edges
  // showed through as dots
  const fillMat = new MeshBasicMaterial({ side: DoubleSide, polygonOffset: true, polygonOffsetFactor: 0.5, polygonOffsetUnits: 2 });
  const rt = new WebGLRenderTarget(1, 1, { depthTexture: new DepthTexture(1, 1) });
  const outline = new ShaderMaterial({
    ...OUTLINE,
    uniforms: {
      tDepth: { value: rt.depthTexture }, tId: { value: rt.texture }, texel: { value: [1, 1] },
      deep: { value: 0 }, touch: { value: 0 }, width: { value: 2 },
    },
    depthTest: false, depthWrite: false,
  });
  // the outlines alone, at the size of rt, read back with linear filtering
  const lt = new WebGLRenderTarget(1, 1);
  const down = new ShaderMaterial({
    ...DOWN,
    uniforms: { tLine: { value: lt.texture }, px: { value: [1, 1] }, color: { value: new Color() } },
    depthTest: false, depthWrite: false, transparent: true,
  });
  const quad = new Mesh(new PlaneGeometry(2, 2), outline);
  quad.frustumCulled = false;
  const overlay = new Scene();
  overlay.add(quad);

  // ---- camera, from the same az and el as the SVG
  const place = () => {
    const { c, up } = camera(az, el);
    const half = (radius * 1.1) / zoom;
    const asp = w / h;
    [cam.left, cam.right, cam.top, cam.bottom] = asp > 1 ? [-half * asp, half * asp, half, -half] : [-half, half, half / asp, -half / asp];
    const target = centre.clone().add(pan);
    cam.position.copy(target).add(new Vector3(...c).multiplyScalar(3 * radius));
    cam.up.set(...up);
    cam.lookAt(target);
    [cam.near, cam.far] = [1.5 * radius, 4.5 * radius];
    cam.updateProjectionMatrix();
    const range = cam.far - cam.near;
    outline.uniforms.deep.value = DEEP / range;
    outline.uniforms.touch.value = 1 / range;
  };

  const lineMat = (accent: boolean) =>
    new LineMaterial({ color: new Color(accent ? colors.accent : colors.fg), linewidth: THIN, resolution: new Vector2(w, h) });

  // the faces drawn with their part id as colour, no lines (true), or back to normal
  const ids = (on: boolean) => {
    for (const p of pieces) {
      p.fill.material = on ? p.fill.userData.id : fillMat;
      if (p.lines) p.lines.visible = !on;
    }
  };

  // ---- render on demand
  let queued = 0;
  const frame = () => {
    queued = 0;
    const now = performance.now();
    const playing = animate(now);
    renderer.setClearColor(colors.bg);
    if (two) {
      // depth and part ids, faces only
      ids(true);
      renderer.setRenderTarget(rt);
      renderer.setClearColor('#000000');
      renderer.clear();
      renderer.render(scene, cam);
      // the outlines, at the same big size
      renderer.setRenderTarget(lt);
      renderer.setClearColor('#000000', 0);
      quad.material = outline;
      renderer.render(overlay, cam);
      renderer.setClearColor('#000000', 1);
      renderer.setRenderTarget(null);
      renderer.setClearColor(colors.bg);
      ids(false);
    }
    renderer.render(scene, cam);
    if (two) {
      renderer.autoClear = false;
      quad.material = down;
      renderer.render(overlay, cam);
      renderer.autoClear = true;
    }
    if (playing) redraw();
  };
  const redraw = () => {
    if (!queued) queued = requestAnimationFrame(frame);
  };

  // ---- size
  // the canvas gets the exact device pixel size of its box. With a screen
  // scale like 1.25, w * 1.25 is not a whole number, three.js rounds it
  // down and the browser stretches the canvas a little: lines go soft and
  // uneven.
  const resize = (entries?: ResizeObserverEntry[]) => {
    const b = host.getBoundingClientRect();
    [w, h] = [Math.max(1, b.width), Math.max(1, b.height)];
    const dpr = Math.min(2, devicePixelRatio);
    const dev = entries?.[0]?.devicePixelContentBoxSize?.[0];
    const [dw, dh] = dev && dpr === devicePixelRatio ? [dev.inlineSize, dev.blockSize] : [Math.round(w * dpr), Math.round(h * dpr)];
    renderer.setSize(Math.max(1, dw), Math.max(1, dh), false);
    const pr = Math.max(1, dw) / w;
    // about 3 samples per CSS px each way: 2x on a 1x screen, 1.5x on a 2x one
    const ss = Math.min(2, Math.max(1, 3 / pr));
    const [rw, rh] = [Math.round(w * pr * ss), Math.round(h * pr * ss)];
    rt.setSize(rw, rh);
    lt.setSize(rw, rh);
    outline.uniforms.texel.value = [1 / rw, 1 / rh];
    outline.uniforms.width.value = THICK * pr * ss;
    down.uniforms.px.value = [1 / (w * pr), 1 / (h * pr)];
    for (const p of pieces) p.mat.resolution.set(w, h);
    if (fitted && pieces.length) reset();
    else place();
    redraw();
  };
  new ResizeObserver((e) => resize(e)).observe(host);

  // ---- the build animation: same timeline as the SVG
  let anim: { t0: number; slots: ReturnType<typeof timeline>; dirs: V[]; end: number; bolt: number } | null = null;
  const ease = (t: number) => 1 - (1 - t) ** 3;
  const animate = (now: number): boolean => {
    if (!anim) return false;
    const t = now - anim.t0;
    pieces.forEach((p, i) => {
      const sl = anim!.slots.get(p.part.step)!;
      p.group.visible = t >= sl.start;
      if (p.part.kind === 'bolts') {
        // one bolt after the other
        const n = Math.min(p.part.dots.length, Math.max(0, Math.floor((t - sl.start) / anim!.bolt) + 1)) * p.per;
        p.fill.geometry.setDrawRange(0, (p.base[0] + n * HEAD_TRI) / 3);
        if (p.lines) (p.lines.geometry as LineSegmentsGeometry).instanceCount = (p.base[1] + n * HEAD_SEG) / 6;
        return;
      }
      const k = ease(Math.min(1, Math.max(0, (t - sl.start) / sl.dur)));
      const far = p.part.kind === 'plate' || p.part.kind === 'base' ? 0.12 * radius : 2.6 * radius;
      p.group.position.set(...mul(anim!.dirs[i], far * (1 - k)));
    });
    if (t < anim.end) return true;
    stopAnim();
    return false;
  };
  const stopAnim = () => {
    anim = null;
    for (const p of pieces) {
      p.group.visible = true;
      p.group.position.set(0, 0, 0);
      p.fill.geometry.setDrawRange(0, Infinity);
      if (p.lines) (p.lines.geometry as LineSegmentsGeometry).instanceCount = Infinity;
    }
  };

  // ---- the structure
  const show = (parts: Part[]) => {
    stopAnim();
    setHover(null);
    shown = parts;
    for (const p of pieces) {
      p.fill.geometry.dispose();
      p.lines?.geometry.dispose();
      p.mat.dispose();
      (p.fill.userData.id as ShaderMaterial).dispose();
      scene.remove(p.group);
    }
    pieces = [];
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    parts.forEach((part, pi) => {
      const tri: number[] = [];
      const seg: number[] = [];
      let heads = 0;
      for (const fc of part.faces) {
        triangles(fc.pts, tri);
        for (const [i, j] of fc.edges) seg.push(...fc.pts[i], ...fc.pts[j]);
        for (const p of fc.pts) for (let k = 0; k < 3; k++) [lo[k], hi[k]] = [Math.min(lo[k], p[k]), Math.max(hi[k], p[k])];
      }
      const base: [number, number] = [tri.length, seg.length];
      // a bolt through two plates gets a head on both ends
      for (const dt of part.dots) {
        if (dt.axis) {
          for (const s of [1, -1]) {
            const nn = mul(dt.axis, s);
            head(add(dt.p, mul(nn, dt.half ?? 0)), nn, tri, seg);
            heads++;
          }
        } else if (dt.n) {
          head(dt.p, dt.n, tri, seg);
          heads++;
        }
      }
      if (!tri.length) return;
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(tri), 3));
      // blue marks the bolts: a head (13 mm high) gets no outline
      const id = new ShaderMaterial({ ...ID_MAT, uniforms: { id: { value: [((pi + 1) & 255) / 255, ((pi + 1) >> 8) / 255, part.kind === 'bolts' ? 1 : 0] } }, side: DoubleSide });
      const fill = new Mesh(g, fillMat);
      fill.userData.id = id;
      const group = new Group();
      group.add(fill);
      const mat = lineMat(!!part.accent);
      let lines: LineSegments2 | undefined;
      if (seg.length) {
        const lg = new LineSegmentsGeometry();
        lg.setPositions(seg);
        lines = new LineSegments2(lg, mat);
        group.add(lines);
      }
      scene.add(group);
      pieces.push({ part, group, fill, lines, base, per: part.dots.length ? heads / part.dots.length : 0, mat });
    });
    centre = new Vector3((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2);
    radius = Math.max(500, 0.5 * Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]));
    box = [lo as V, hi as V];
    reset();
  };

  const build = (speed = 1, duration?: number) => {
    stopAnim();
    setHover(null);
    const slots = timeline(pieces.map((p) => p.part), { speed, duration });
    const { r, up } = camera(az, el);
    // the direction each part comes from, in the screen plane, as in hlr.ts
    const dirs = pieces.map((p) => {
      const v = p.part.from ?? [0, 0, 1];
      let [ux, uy] = [dot(v, r), dot(v, up)];
      const l = Math.hypot(ux, uy);
      if (l < 0.3) [ux, uy] = [0, 1];
      else [ux, uy] = [ux / l, uy / l];
      return add(mul(r, ux), mul(up, uy));
    });
    const end = buildEnd(slots) + 100;
    anim = { t0: performance.now(), slots, dirs, end, bolt: BOLT_MS / speed };
    redraw();
  };

  // ---- mouse and fingers: drag turns, right drag or shift drag pans,
  // the wheel or two fingers zoom, double click shows it all again
  const pointers = new Map<number, { x: number; y: number }>();
  let drag: { x: number; y: number; az: number; el: number; pan: boolean; turned?: boolean } | null = null;
  let pinch = 0;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    setHover(null);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
      drag = null;
      return;
    }
    drag = { x: e.clientX, y: e.clientY, az, el, pan: e.button === 2 || e.shiftKey };
    host.classList.add('turning');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const last = pointers.get(e.pointerId)!;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) zoomBy(d / pinch);
      pinch = d;
      onFrame?.(current());
      return;
    }
    if (!drag) return;
    if (drag.pan) {
      const { r, up } = camera(az, el);
      const mmPx = (cam.top - cam.bottom) / h;
      pan.add(new Vector3(...add(mul(r, -(e.clientX - last.x) * mmPx), mul(up, (e.clientY - last.y) * mmPx))));
      fitted = false;
      place();
      redraw();
      onFrame?.(current());
      return;
    }
    const [dx, dy] = [e.clientX - drag.x, e.clientY - drag.y];
    if (!drag.turned && Math.hypot(dx, dy) < 3) return;
    drag.turned = true;
    view((((drag.az + dx * 0.5) % 360) + 360) % 360, Math.min(90, Math.max(0, drag.el + dy * 0.35)));
    onTurn(az, el, false);
  });
  const end = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = 0;
    if (!pointers.size) {
      if (drag?.turned) onTurn(az, el, true);
      drag = null;
      host.classList.remove('turning');
    }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  const zoomBy = (k: number) => {
    zoom = Math.min(40, Math.max(0.5, zoom * k));
    fitted = false;
    place();
    redraw();
  };
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    // zoom toward the point under the mouse
    const b = canvas.getBoundingClientRect();
    const { r, up } = camera(az, el);
    const mmPx = (cam.top - cam.bottom) / h;
    const [mx, my] = [(e.clientX - b.left - w / 2) * mmPx, -(e.clientY - b.top - h / 2) * mmPx];
    const before = zoom;
    zoomBy(Math.exp(-e.deltaY * 0.0015));
    const f = 1 - before / zoom;
    pan.add(new Vector3(...add(mul(r, mx * f), mul(up, my * f))));
    place();
    redraw();
    hoverSoon(); // something else may be under the mouse now
    onFrame?.(current());
  }, { passive: false });
  canvas.addEventListener('dblclick', () => {
    reset();
    onFrame?.(null);
  });

  // ---- the part under the mouse: the id pass, rendered for one pixel only
  const pickRT = new WebGLRenderTarget(1, 1);
  const px = new Uint8Array(4);
  const pick = (x: number, y: number): Part | null => {
    if (!pieces.length || x < 0 || y < 0 || x >= w || y >= h) return null;
    cam.setViewOffset(w, h, x, y, 1, 1);
    ids(true);
    renderer.setRenderTarget(pickRT);
    renderer.setClearColor('#000000', 1);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.readRenderTargetPixels(pickRT, 0, 0, 1, 1, px);
    renderer.setRenderTarget(null);
    ids(false);
    cam.clearViewOffset();
    return shown[px[0] + px[1] * 256 - 1] ?? null;
  };
  // the hovered part: its lines in the accent colour, a bit thicker
  let hovered: Part | null = null;
  const lineStyle = (p: Piece) => {
    const on = p.part === hovered;
    p.mat.color.set(on || p.part.accent ? colors.accent : colors.fg);
    p.mat.linewidth = (two ? THIN : 1.6) * (on ? 2 : 1);
  };
  const setHover = (part: Part | null, x = 0, y = 0) => {
    if (part !== hovered) {
      hovered = part;
      for (const p of pieces) lineStyle(p);
      redraw();
    }
    onHover?.(part, x, y);
  };
  // the last mouse position, in client px; picked at most once a frame
  let mouse: { x: number; y: number } | null = null;
  let hoverQ = 0;
  const hoverSoon = () => {
    if (!hoverQ && mouse && onHover)
      hoverQ = requestAnimationFrame(() => {
        hoverQ = 0;
        if (!mouse || anim || pointers.size) return setHover(null);
        const b = canvas.getBoundingClientRect();
        setHover(pick(mouse.x - b.left, mouse.y - b.top), mouse.x, mouse.y);
      });
  };
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || e.buttons) return;
    mouse = { x: e.clientX, y: e.clientY };
    hoverSoon();
  });
  canvas.addEventListener('pointerleave', () => {
    mouse = null;
    setHover(null);
  });

  // fit the box of the structure, as seen from this view
  let box: [V, V] = [[0, 0, 0], [0, 0, 0]];
  const reset = () => {
    const { r, up } = camera(az, el);
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let m = 0; m < 8; m++) {
      const p = new Vector3(box[m & 1][0], box[(m >> 1) & 1][1], box[(m >> 2) & 1][2]).sub(centre);
      const [x, y] = [p.dot(new Vector3(...r)), p.dot(new Vector3(...up))];
      [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
    }
    const [ex, ey] = [(x1 - x0) / 2, (y1 - y0) / 2];
    const asp = w / h;
    zoom = (1.1 * radius * 0.9) / Math.max(1, asp > 1 ? Math.max(ey, ex / asp) : Math.max(ex, ey * asp));
    pan.copy(new Vector3(...add(mul(r, (x0 + x1) / 2), mul(up, (y0 + y1) / 2))));
    fitted = true;
    place();
    redraw();
  };
  const current = (): Frame | null => (fitted ? null : { target: centre.clone().add(pan).toArray() as V, half: (radius * 1.1) / zoom });
  const setFrame = (f: Frame | null) => {
    if (!f) return void (pieces.length ? reset() : (fitted = true));
    zoom = (radius * 1.1) / f.half;
    pan.copy(new Vector3(...f.target).sub(centre));
    fitted = false;
    place();
    redraw();
  };
  const view = (a: number, e: number) => {
    [az, el] = [a, e];
    place();
    redraw();
  };

  resize();
  return {
    canvas,
    show,
    view,
    build,
    reset,
    frame: current,
    setFrame,
    setWeights(t) {
      two = t;
      for (const p of pieces) lineStyle(p);
      redraw();
    },
    setColors(c) {
      colors = c;
      fillMat.color.set(c.bg);
      down.uniforms.color.value.set(c.fg);
      for (const p of pieces) lineStyle(p);
      redraw();
    },
    stats() {
      let [faces, bolts, lines] = [0, 0, 0];
      for (const p of pieces) {
        faces += p.part.faces.length;
        bolts += p.part.dots.length;
        lines += p.lines ? (p.lines.geometry as LineSegmentsGeometry).attributes.instanceStart.count : 0;
      }
      return { faces, bolts, lines };
    },
  };
}
