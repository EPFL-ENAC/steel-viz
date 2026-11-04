// The 3D viewer of the playground, in plain WebGL2 (no three.js).
//
// hlr.ts stays the exact drawing, for export: Copy SVG, the logo files, the
// small sizes. Here the screen only has to look right while you turn and
// zoom, so the depth buffer of the GPU hides the hidden lines, and the
// geometry is built once per structure, not once per frame.
//
// Faces are filled with the background colour. The edges each Face asks for
// are thin lines: one quad per segment (instancing), made wide in the vertex
// shader, with round ends, as LineSegments2 of three.js did. The outlines
// come from a second pass, with the same rule as hlr.ts: the depth and the
// part of every pixel go to a texture, and a screen pass draws a thick line
// on the near side of a jump in depth bigger than DEEP, or of any jump to
// another part behind.
import { add, cross, dot, mul, norm, sub, type V } from './vec.ts';
import { BOLT_MS, buildEnd, camera, timeline, type Part } from './steel.ts';
import { triangles } from './triangles.ts';

const HEAD = 13; // bolt head height, mm, as in hlr.ts
const R = 17; // bolt head, corner to centre, mm
const DEEP = 50; // mm: a jump in depth bigger than this makes an outline
const THIN = 1; // px
const THICK = 2.25; // px

// rig: the lines of the test rig (default: half way between fg and bg)
export type Colors = { bg: string; fg: string; accent: string; rig?: string };
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

// ---- shaders (GLSL ES 3.00). The colours are sRGB from end to end.
// highp for the samplers too: their default is lowp, too coarse for a depth
const TOP = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\n';

// the faces: the background colour, or the part id (the outline and pick passes)
const FILL_VS = `${TOP}
uniform mat4 M;
uniform vec3 off;
layout(location = 0) in vec3 pos;
void main() { gl_Position = M * vec4(pos + off, 1.0); }`;
const COLOR_FS = `${TOP}
uniform vec4 color;
out vec4 o;
void main() { o = color; }`;

// a line of width px (device px, as LineSegments2 did: it took the size of
// the viewport): a quad around the segment, plus a half disc
// on each end. corner.xy: x is the side (-1, 1); y is 2 or 1 at the end, 0 or
// -1 at the start, past 1 or under 0 for the round ends. corner.zw: where we
// are in the quad, for the round ends.
const LINE_VS = `${TOP}
uniform mat4 M;
uniform vec3 off;
uniform vec2 res;
uniform float width;
layout(location = 0) in vec4 corner;
layout(location = 1) in vec3 start;
layout(location = 2) in vec3 end;
out vec2 uv;
void main() {
  vec4 a = M * vec4(start + off, 1.0);
  vec4 b = M * vec4(end + off, 1.0);
  float aspect = res.x / res.y;
  vec2 dir = b.xy - a.xy;
  dir.x *= aspect;
  dir = length(dir) > 0.0 ? normalize(dir) : vec2(1.0, 0.0);
  vec2 side = vec2(dir.y, -dir.x);
  dir.x /= aspect;
  side.x /= aspect;
  if (corner.x < 0.0) side = -side;
  if (corner.y < 0.0) side -= dir;
  else if (corner.y > 1.0) side += dir;
  vec4 p = corner.y < 0.5 ? a : b;
  p.xy += side * width / res.y;
  gl_Position = p;
  uv = corner.zw;
}`;
const LINE_FS = `${TOP}
uniform vec4 color;
in vec2 uv;
out vec4 o;
void main() {
  if (abs(uv.y) > 1.0) {
    float e = uv.y > 0.0 ? uv.y - 1.0 : uv.y + 1.0;
    if (uv.x * uv.x + e * e > 1.0) discard;
  }
  o = color;
}`;
// the quad of a line: 8 corners (x, y, then uv) and 6 triangles
const QUAD = [-1, 2, -1, 2, 1, 2, 1, 2, -1, 1, -1, 1, 1, 1, 1, 1, -1, 0, -1, -1, 1, 0, 1, -1, -1, -1, -1, -2, 1, -1, 1, -2];
const QUAD_IDX = [0, 2, 1, 2, 3, 1, 2, 4, 3, 4, 5, 3, 4, 6, 5, 6, 7, 5];

// one triangle over the whole screen, from gl_VertexID, no buffer
const SCREEN_VS = `${TOP}
out vec2 vUv;
void main() {
  vUv = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(vUv * 2.0 - 1.0, 0.0, 1.0);
}`;

// the outline pass: thick lines on the near side of a depth jump
const OUTLINE_FS = `${TOP}
uniform sampler2D tDepth, tId;
uniform vec2 texel;
uniform float deep, touch, width;
in vec2 vUv;
out vec4 o;
float D(vec2 d) { return texture(tDepth, vUv + d * texel).r; }
vec3 I(vec2 d) { return texture(tId, vUv + d * texel).rgb; }
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
      vec2 d = vec2(cos(t), sin(t)) * r;
      float n = D(d);
      // the second difference is 0 on any plane, however steep
      float s = n + D(-d) - 2.0 * c;
      if (s > deep || n >= 1.0) hit = 1.0;
      else if (!bolt && n - c > touch && distance(I(d).rg, id.rg) > 0.001) hit = 1.0;
    }
  }
  if (hit < 0.5) discard;
  o = vec4(1.0);
}`;

// the outlines are found per pixel, so they come out all or nothing: they
// are found at SS times the screen size, then averaged down to the screen
const DOWN_FS = `${TOP}
uniform sampler2D tLine;
uniform vec2 px; // one screen pixel, in uv
uniform vec3 color;
in vec2 vUv;
out vec4 o;
void main() {
  // 4 linear taps cover the footprint of the pixel on the big texture
  float a = 0.0;
  for (int i = 0; i < 2; i++)
    for (int j = 0; j < 2; j++)
      a += texture(tLine, vUv + (vec2(float(i), float(j)) - 0.5) * 0.5 * px).a;
  a *= 0.25;
  if (a <= 0.0) discard;
  o = vec4(color, a);
}`;

type RGB = [number, number, number];
// a CSS colour as sRGB, 0 to 1
let probe: CanvasRenderingContext2D | null = null;
function rgb(css: string): RGB {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(css.trim());
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB;
  }
  probe ??= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
  if (!probe) return [0, 0, 0];
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = css;
  probe.fillRect(0, 0, 1, 1);
  const d = probe.getImageData(0, 0, 1, 1).data;
  return [d[0] / 255, d[1] / 255, d[2] / 255];
}

type Program = { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };
// a render target: a colour texture, and a depth texture or buffer
type Target = { fb: WebGLFramebuffer; color: WebGLTexture; depth?: WebGLTexture; rb?: WebGLRenderbuffer; w: number; h: number };
type Buf = { vao: WebGLVertexArrayObject; buf: WebGLBuffer; n: number; draw: number };
// base: the triangle and line floats before the bolt heads; per: heads per
// bolt. fill.n counts vertices, lines.n counts segments; draw: how many of
// them the build animation shows now. off: where the animation moves it, mm.
type Piece = {
  part: Part; fill: Buf; lines?: Buf; base: [number, number]; per: number;
  id: RGB; off: V; visible: boolean; color: RGB; width: number;
};

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
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, depth: true, stencil: false });
  if (!gl) throw new Error('no WebGL2');
  // sized by hand in device pixels (see resize)
  Object.assign(canvas.style, { display: 'block', width: '100%', height: '100%' });
  host.append(canvas);

  let colors: Colors = { bg: '#ffffff', fg: '#212121', accent: '#e30713' };
  let [bg, fg, accent] = [rgb(colors.bg), rgb(colors.fg), rgb(colors.accent)];
  // the lines of the test rig: colors.rig, or half way between fg and bg
  const rigOf = (c: Colors): RGB => (c.rig ? rgb(c.rig) : [0, 1, 2].map((i) => (rgb(c.fg)[i] + rgb(c.bg)[i]) / 2) as RGB);
  let rig = rigOf(colors);
  let two = true;
  let pieces: Piece[] = [];
  let shown: Part[] = []; // the parts of show(), in the order of their ids
  let [az, el] = [225, 35.264];
  let radius = 1;
  let centre: V = [0, 0, 0];
  let zoom = 1;
  let pan: V = [0, 0, 0];
  let fitted = true; // no zoom or pan by hand: a new size fits the structure again
  let [w, h] = [1, 1];
  let box: [V, V] = [[0, 0, 0], [0, 0, 0]];
  // the camera: the box it sees (mm, around its axis), and how it looks.
  // X, Y, Z: right, up and toward the eye, as three.js lookAt() made them.
  const cam = { left: -1, right: 1, top: 1, bottom: -1, near: 1, far: 10, eye: [0, 0, 0] as V, X: [1, 0, 0] as V, Y: [0, 1, 0] as V, Z: [0, 0, 1] as V };
  // what the outline and down passes need
  let [deep, touch, outWidth] = [0, 0, 2];
  let texel: [number, number] = [1, 1];
  let px: [number, number] = [1, 1];

  // ---- GL objects
  const compile = (vs: string, fs: string): Program => {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(`shader: ${gl.getShaderInfoLog(s)}`);
      gl.attachShader(p, s);
      gl.deleteShader(s); // freed with the program
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(`program: ${gl.getProgramInfoLog(p)}`);
    const u: Program['u'] = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) ?? 0;
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(p, i)!.name;
      u[name] = gl.getUniformLocation(p, name);
    }
    return { p, u };
  };
  const texture = (filter: number) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const setSize = (t: Target, tw: number, th: number) => {
    gl.bindTexture(gl.TEXTURE_2D, t.color);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, tw, th, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    if (t.depth) {
      gl.bindTexture(gl.TEXTURE_2D, t.depth);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, tw, th, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    }
    if (t.rb) {
      gl.bindRenderbuffer(gl.RENDERBUFFER, t.rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, tw, th);
    }
    [t.w, t.h] = [tw, th];
  };
  // the colour texture is LINEAR, as the targets of three.js were: the
  // outline pass reads the part ids between pixels, and DOWN averages
  const target = (depth: 'texture' | 'buffer' | 'none'): Target => {
    const t: Target = { fb: gl.createFramebuffer(), color: texture(gl.LINEAR), w: 1, h: 1 };
    if (depth === 'texture') t.depth = texture(gl.NEAREST);
    if (depth === 'buffer') t.rb = gl.createRenderbuffer();
    setSize(t, 1, 1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.color, 0);
    if (t.depth) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, t.depth, 0);
    if (t.rb) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, t.rb);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return t;
  };

  // made again when the GPU comes back after a context loss
  let fillP: Program, lineP: Program, outlineP: Program, downP: Program;
  let rt: Target, lt: Target, pickRT: Target; // depth and ids, the outlines alone, the pick
  let quadBuf: WebGLBuffer, quadIdx: WebGLBuffer;
  const init = () => {
    fillP = compile(FILL_VS, COLOR_FS);
    lineP = compile(LINE_VS, LINE_FS);
    outlineP = compile(SCREEN_VS, OUTLINE_FS);
    downP = compile(SCREEN_VS, DOWN_FS);
    rt = target('texture');
    lt = target('none');
    pickRT = target('buffer');
    quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(QUAD), gl.STATIC_DRAW);
    quadIdx = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, quadIdx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(QUAD_IDX), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    gl.depthFunc(gl.LEQUAL);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.polygonOffset(0.5, 2);
  };
  init();

  const fillBuf = (tri: number[]): Buf => {
    const vao = gl.createVertexArray();
    const buf = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(tri), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return { vao, buf, n: tri.length / 3, draw: tri.length / 3 };
  };
  const lineBuf = (seg: number[]): Buf => {
    const vao = gl.createVertexArray();
    const buf = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, quadIdx);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(seg), gl.STATIC_DRAW);
    for (const k of [1, 2]) {
      gl.enableVertexAttribArray(k);
      gl.vertexAttribPointer(k, 3, gl.FLOAT, false, 24, (k - 1) * 12);
      gl.vertexAttribDivisor(k, 1);
    }
    gl.bindVertexArray(null);
    return { vao, buf, n: seg.length / 6, draw: seg.length / 6 };
  };
  const free = (b?: Buf) => {
    if (!b) return;
    gl.deleteVertexArray(b.vao);
    gl.deleteBuffer(b.buf);
  };

  // ---- camera, from the same az and el as the SVG
  const place = () => {
    const { c, r, up } = camera(az, el);
    const half = (radius * 1.1) / zoom;
    const asp = w / h;
    [cam.left, cam.right, cam.top, cam.bottom] = asp > 1 ? [-half * asp, half * asp, half, -half] : [-half, half, half / asp, -half / asp];
    cam.eye = add(add(centre, pan), mul(c, 3 * radius));
    // camera() gives right and up square to c already: lookAt() would make the same axes
    [cam.X, cam.Y, cam.Z] = [r, up, c];
    [cam.near, cam.far] = [1.5 * radius, 4.5 * radius];
    const range = cam.far - cam.near;
    deep = DEEP / range;
    touch = 1 / range;
  };
  // world mm to clip space: the orthographic projection times the view, by
  // column. at: only the CSS pixel (x, y) of the view, for the pick (as
  // setViewOffset(w, h, x, y, 1, 1) of three.js).
  const matrix = (at?: [number, number]) => {
    let { left: l, right: r, top: t, bottom: b } = cam;
    if (at) {
      const [sw, sh] = [(r - l) / w, (t - b) / h];
      l += sw * at[0];
      r = l + sw;
      t -= sh * at[1];
      b = t - sh;
    }
    const { near: n, far: f, eye } = cam;
    const m = new Float32Array(16);
    const rows: [V, number, number][] = [
      [cam.X, 2 / (r - l), -(r + l) / (r - l)],
      [cam.Y, 2 / (t - b), -(t + b) / (t - b)],
      [cam.Z, -2 / (f - n), -(f + n) / (f - n)],
    ];
    rows.forEach(([a, s, t0], i) => {
      [m[i], m[4 + i], m[8 + i]] = [s * a[0], s * a[1], s * a[2]];
      m[12 + i] = t0 - s * dot(a, eye);
    });
    m[15] = 1;
    return m;
  };

  // ---- drawing
  const bind = (t: Target | null) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fb : null);
    gl.viewport(0, 0, t ? t.w : canvas.width, t ? t.h : canvas.height);
  };
  // the faces, with their part id as colour (ids) or the background
  const fills = (M: Float32Array, ids: boolean) => {
    gl.useProgram(fillP.p);
    gl.uniformMatrix4fv(fillP.u.M, false, M);
    for (const p of pieces) {
      if (!p.visible || !p.fill.draw) continue;
      gl.uniform3fv(fillP.u.off, p.off);
      gl.uniform4f(fillP.u.color, ...(ids ? p.id : bg), 1);
      gl.bindVertexArray(p.fill.vao);
      gl.drawArrays(gl.TRIANGLES, 0, p.fill.draw);
    }
  };
  const lines = (M: Float32Array) => {
    gl.useProgram(lineP.p);
    gl.uniformMatrix4fv(lineP.u.M, false, M);
    gl.uniform2f(lineP.u.res, canvas.width, canvas.height);
    for (const p of pieces) {
      if (!p.visible || !p.lines?.draw) continue;
      gl.uniform3fv(lineP.u.off, p.off);
      gl.uniform4f(lineP.u.color, ...p.color, 1);
      gl.uniform1f(lineP.u.width, p.width);
      gl.bindVertexArray(p.lines.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, QUAD_IDX.length, gl.UNSIGNED_SHORT, 0, p.lines.draw);
    }
  };
  const tex = (unit: number, t: WebGLTexture, loc: WebGLUniformLocation | null) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.uniform1i(loc, unit);
  };

  // ---- render on demand
  let queued = 0;
  const frame = () => {
    queued = 0;
    const playing = animate(performance.now());
    if (gl.isContextLost()) return;
    const M = matrix();
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    if (two) {
      // depth and part ids, faces only
      bind(rt);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      fills(M, true);
      // the outlines, at the same big size
      bind(lt);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(outlineP.p);
      tex(0, rt.depth!, outlineP.u.tDepth);
      tex(1, rt.color, outlineP.u.tId);
      gl.uniform2f(outlineP.u.texel, ...texel);
      gl.uniform1f(outlineP.u.deep, deep);
      gl.uniform1f(outlineP.u.touch, touch);
      gl.uniform1f(outlineP.u.width, outWidth);
      gl.bindVertexArray(null);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.enable(gl.DEPTH_TEST);
    }
    bind(null);
    gl.clearColor(...bg, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // faces sit back a little so the lines on their own edges win. The push
    // grows with the slope of the face times the pixel size: with 1 instead
    // of 0.5, a face zoomed out moved back more than a flange is thick and
    // hidden web edges showed through as dots
    gl.enable(gl.POLYGON_OFFSET_FILL);
    fills(M, false);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    lines(M);
    if (two) {
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.useProgram(downP.p);
      tex(0, lt.color, downP.u.tLine);
      gl.uniform2f(downP.u.px, ...px);
      gl.uniform3f(downP.u.color, ...fg);
      gl.bindVertexArray(null);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.BLEND);
    }
    if (playing) redraw();
  };
  const redraw = () => {
    if (!queued) queued = requestAnimationFrame(frame);
  };

  // ---- size
  // the canvas gets the exact device pixel size of its box. With a screen
  // scale like 1.25, w * 1.25 is not a whole number: rounded down, the
  // browser stretches the canvas a little and lines go soft and uneven.
  const resize = (entries?: ResizeObserverEntry[]) => {
    const b = host.getBoundingClientRect();
    [w, h] = [Math.max(1, b.width), Math.max(1, b.height)];
    const dpr = Math.min(2, devicePixelRatio);
    const dev = entries?.[0]?.devicePixelContentBoxSize?.[0];
    const [dw, dh] = dev && dpr === devicePixelRatio ? [dev.inlineSize, dev.blockSize] : [Math.round(w * dpr), Math.round(h * dpr)];
    [canvas.width, canvas.height] = [Math.max(1, dw), Math.max(1, dh)];
    const pr = canvas.width / w;
    // about 3 samples per CSS px each way: 2x on a 1x screen, 1.5x on a 2x one
    const ss = Math.min(2, Math.max(1, 3 / pr));
    const [rw, rh] = [Math.round(w * pr * ss), Math.round(h * pr * ss)];
    setSize(rt, rw, rh);
    setSize(lt, rw, rh);
    texel = [1 / rw, 1 / rh];
    outWidth = THICK * pr * ss;
    px = [1 / (w * pr), 1 / (h * pr)];
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
      p.visible = t >= sl.start;
      if (p.part.kind === 'bolts') {
        // one bolt after the other
        const n = Math.min(p.part.dots.length, Math.max(0, Math.floor((t - sl.start) / anim!.bolt) + 1)) * p.per;
        p.fill.draw = Math.min(p.fill.n, (p.base[0] + n * HEAD_TRI) / 3);
        if (p.lines) p.lines.draw = Math.min(p.lines.n, (p.base[1] + n * HEAD_SEG) / 6);
        return;
      }
      const k = ease(Math.min(1, Math.max(0, (t - sl.start) / sl.dur)));
      const far = p.part.kind === 'plate' || p.part.kind === 'base' ? 0.12 * radius : 2.6 * radius;
      p.off = mul(anim!.dirs[i], far * (1 - k));
    });
    if (t < anim.end) return true;
    stopAnim();
    return false;
  };
  const stopAnim = () => {
    anim = null;
    for (const p of pieces) {
      p.visible = true;
      p.off = [0, 0, 0];
      p.fill.draw = p.fill.n;
      if (p.lines) p.lines.draw = p.lines.n;
    }
  };

  // ---- the structure
  const show = (parts: Part[]) => {
    stopAnim();
    setHover(null);
    shown = parts;
    for (const p of pieces) {
      free(p.fill);
      free(p.lines);
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
      const p: Piece = {
        part, base, per: part.dots.length ? heads / part.dots.length : 0,
        fill: fillBuf(tri), lines: seg.length ? lineBuf(seg) : undefined,
        // blue marks the bolts: a head (13 mm high) gets no outline
        id: [((pi + 1) & 255) / 255, ((pi + 1) >> 8) / 255, part.kind === 'bolts' ? 1 : 0],
        off: [0, 0, 0], visible: true, color: fg, width: THIN,
      };
      lineStyle(p);
      pieces.push(p);
    });
    centre = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
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
      pan = add(pan, add(mul(r, -(e.clientX - last.x) * mmPx), mul(up, (e.clientY - last.y) * mmPx)));
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
    pan = add(pan, add(mul(r, mx * f), mul(up, my * f)));
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
  const pixel = new Uint8Array(4);
  const pick = (x: number, y: number): Part | null => {
    if (!pieces.length || x < 0 || y < 0 || x >= w || y >= h || gl.isContextLost()) return null;
    bind(pickRT);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    fills(matrix([x, y]), true);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    bind(null);
    return shown[pixel[0] + pixel[1] * 256 - 1] ?? null;
  };
  // the hovered part: its lines in the accent colour, a bit thicker
  let hovered: Part | null = null;
  function lineStyle(p: Piece) {
    const on = p.part === hovered;
    p.color = on || p.part.accent ? accent : p.part.kind === 'rig' ? rig : fg;
    p.width = (two ? THIN : 1.6) * (on ? 2 : 1);
  }
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

  // the GPU can drop the context (driver reset, too many tabs). When it
  // comes back, make the GL objects again and show the same structure.
  canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
  canvas.addEventListener('webglcontextrestored', () => {
    const f = current();
    pieces = []; // their buffers died with the old context
    init();
    resize();
    if (shown.length) show(shown);
    setFrame(f);
  });

  // fit the box of the structure, as seen from this view
  const reset = () => {
    const { r, up } = camera(az, el);
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let m = 0; m < 8; m++) {
      const p = sub([box[m & 1][0], box[(m >> 1) & 1][1], box[(m >> 2) & 1][2]], centre);
      const [x, y] = [dot(p, r), dot(p, up)];
      [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
    }
    const [ex, ey] = [(x1 - x0) / 2, (y1 - y0) / 2];
    const asp = w / h;
    zoom = (1.1 * radius * 0.9) / Math.max(1, asp > 1 ? Math.max(ey, ex / asp) : Math.max(ex, ey * asp));
    pan = add(mul(r, (x0 + x1) / 2), mul(up, (y0 + y1) / 2));
    fitted = true;
    place();
    redraw();
  };
  const current = (): Frame | null => (fitted ? null : { target: add(centre, pan), half: (radius * 1.1) / zoom });
  const setFrame = (f: Frame | null) => {
    if (!f) return void (pieces.length ? reset() : (fitted = true));
    zoom = (radius * 1.1) / f.half;
    pan = sub(f.target, centre);
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
      [bg, fg, accent] = [rgb(c.bg), rgb(c.fg), rgb(c.accent)];
      rig = rigOf(c);
      for (const p of pieces) lineStyle(p);
      redraw();
    },
    stats() {
      let [faces, bolts, lines] = [0, 0, 0];
      for (const p of pieces) {
        faces += p.part.faces.length;
        bolts += p.part.dots.length;
        lines += p.lines?.n ?? 0;
      }
      return { faces, bolts, lines };
    },
  };
}
