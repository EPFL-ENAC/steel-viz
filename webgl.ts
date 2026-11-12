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
// another part behind. With one weight, only the round parts (Part.round:
// rods, round tubes, the round bars of the test rig) get it, as thin lines:
// their faces have no long edges, so without it only their ends show.
//
// Compare with main, in one view: show() takes a mark per part id. A 'new'
// part draws its lines in Colors.added, a 'gone' part (the base parts, under
// another id) in Colors.gone, and the parts with no mark go lighter, their
// outlines too. Where a gone part and a new one are on top of each other (the
// two shapes of a changed part), the faces of the gone one sit further back
// and its lines draw first, so the new one wins.
//
// deform() moves the vertices in the vertex shader (the MOVE chunk, one Move
// per part from deform.ts), so a new step of a test uploads no geometry. The
// fill pass also colors the working zones. The boxes of the zones are in the
// undeformed frame, so they follow the parts.
//
// The build animation (build()) reads its times from timeline(), as the SVG
// does. With the effects on, the bolts screw in and the site welds are made,
// all in the shaders: no new geometry and no draw call per bolt. Each vertex of
// a head or a nut knows its bolt (SCREW chunk), so one uniform per part says
// where every bolt of it is. All the seams of the structure are one buffer and
// one draw call (WELD_VS), made at build().
import { add, cross, dot, mul, norm, sub, type V } from './vec.ts';
import { BOLT_IN, buildEnd, camera, COOL_MS, HEAD_TURN, land, NUT_TURN, SCREW_EXP, SEAT_AT, seamTimes, timeline, type Part } from './steel.ts';
import { triangles } from './triangles.ts';
import { I4, MAX_KNOTS, MAX_ZONES, movePoint, type DeformState, type Move } from './deform.ts';

// an M20 bolt, mm
const HEAD = 13; // head height, as in hlr.ts
const R = 17; // head and nut, corner to centre
const NUT = 18; // nut height
const SHANK = 10; // the radius of the bolt end past the nut
// how far it goes past the nut. Short on purpose: its sides have no line,
// so a long end shows as a ring in the air.
const TIP = 8;
const DEEP = 50; // mm: a jump in depth bigger than this makes an outline
const THIN = 1; // px
const THICK = 2.25; // px
const ONE = 1.6; // px, the lines with one weight
const VEIL = 0.3; // how far the slab goes toward the rig color
const FADE = 0.55; // with marks: how far the parts with no mark go toward bg
const MARKED = 1.5; // with marks: the lines of a marked part are this much wider
// the build effects
const TRAVEL = 55; // mm: how far out a head or a nut starts
const SEAT = 14; // mm: how far out it starts to screw in (the turns are in steel.ts)
const SPARK = 4; // CSS px: the radius of the welding spark
const BEAD = 0.35; // the hot bead, in spark radii
const LIFT = 8; // mm: a seam sits in the corner of two faces, it draws this much toward the eye
const REST: [number, number, number] = [1e9, 1, 1]; // the bolt uniform of a part with no screw going on

// rig: the lines of the test rig (default: half way between fg and bg).
// zones: the color of the working zones, by Zone.slot (default: accent)
// added, gone: the lines of the parts marked 'new' and 'gone' (see show())
export type Colors = { bg: string; fg: string; accent: string; rig?: string; zones?: string[]; added?: string; gone?: string };
// a part of this branch that main doesn't have (or not with this shape), or
// a part of main that this branch doesn't have (or not with this shape)
export type Mark = 'new' | 'gone';
// what the view shows, in world mm: the point in the middle, and half the
// height it shows. Two viewers with the same frame line up, even when their
// structures are a bit different (vs main).
export type Frame = { target: V; half: number };
export type Viewer = {
  // a new structure. marks: compare with main in one view, a mark per part
  // id. Given (even empty), the parts with no mark draw lighter.
  show(parts: Part[], marks?: Record<string, Mark>): void;
  view(az: number, el: number): void;
  // play the build animation. speed: how fast one part comes in (2: twice as
  // fast). duration: the whole build lasts this long, ms (see timeline).
  // effects: the bolts screw in and the site welds are made (default). false:
  // the bolts come in one after the other, as before.
  build(speed?: number, duration?: number, effects?: boolean): void;
  // stop the clock of the build at this time, ms from its start (null: let it
  // play on). For shot.ts, which takes a frame at one time of the build.
  seek(ms: number | null): void;
  setWeights(two: boolean): void;
  setColors(c: Colors): void;
  // the deformed shape of a test (null: undeformed). The parts keep it until
  // the next show() of other parts.
  deform(d: DeformState | null): void;
  reset(): void; // zoom and pan back to the whole structure
  frame(): Frame | null; // null: no zoom or pan by hand, it fits the structure
  setFrame(f: Frame | null): void; // null: fit the structure. Never calls onFrame.
  stats(): { faces: number; bolts: number; lines: number };
  canvas: HTMLCanvasElement;
};

// The ends of the bolts. A head or a nut is a hex prism on point b, looking
// along nn: its sides, its top, and its lines (both rings and the corners).
// The bottom ring is where it sits on the plate. The bolt end past a nut is
// a short round bar (12 faces) with a ring at each end, and the corners on
// its outline. While the bolt goes in, its shank shows too: the same bar from
// the head to the end, with its thread (a helix). At rest the shank is in the
// steel and in the nut, and it is hidden, so the drawing stays the same.
// rad: 3 numbers per line of seg. 0, 0, 0 for a plain line. For a corner of
// a round bar, the direction from its axis to the corner: the line shader
// draws the corner only where one of its two faces looks toward the eye and
// the other one away, so the bar shows its two sides from any view. The
// bolts get no outline (see id in show()), so these are their only side lines.
// ta, sa: 8 numbers per vertex of tri and per line of seg, for the SCREW chunk:
// where the piece sits and its bolt (bb), its axis out of the plate and its
// role (bn).
type Geo = { tri: number[]; seg: number[]; rad: number[]; ta: number[]; sa: number[] };
// the roles: a head moves in, then the nut (after a head, or alone on an anchor
// rod). The shank and the bolt end past the nut move with the head. The shank
// hides when the bolt is done, a stub (a bolt with no grip: we don't know
// where its end is) when the head is in. 0: not a bolt.
const ROLE = { head: 1, nut: 2, alone: 3, end: 4, shank: 5, stub: 6 };
const PITCH = 6; // mm: the thread, much coarser than a real one so it shows
const NECK = 5; // mm: no thread just under the head
const STUB = 30; // mm: the shank of a bolt with no grip
const BAR = 12; // the faces of a round bar. LINE_VS needs tan(pi / BAR)
function frame(nn: V) {
  const ref: V = Math.abs(nn[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  const a1 = norm(cross(nn, ref));
  return [a1, cross(nn, a1)];
}
// axis: the way it moves out (SCREW), nn by default
function prism(b: V, nn: V, h: number, r: number, k: number, { tri, seg, rad, ta, sa }: Geo, bolt: number, role: number, axis = nn) {
  const t0 = tri.length;
  const [a1, a2] = frame(nn);
  // from the axis to corner i
  const out = Array.from({ length: k }, (_, i) => add(mul(a1, Math.cos((2 * i * Math.PI) / k)), mul(a2, Math.sin((2 * i * Math.PI) / k))));
  const lo = out.map((u) => add(b, mul(u, r)));
  const hi = out.map((u) => add(add(b, mul(nn, h)), mul(u, r)));
  triangles(hi, tri);
  for (let i = 0; i < k; i++) {
    const j = (i + 1) % k;
    triangles([lo[i], lo[j], hi[j], hi[i]], tri);
    seg.push(...lo[i], ...lo[j], ...hi[i], ...hi[j], ...lo[i], ...hi[i]);
    // a hex shows all its corners
    rad.push(0, 0, 0, 0, 0, 0, ...(k === 6 ? [0, 0, 0] : out[i]));
  }
  const at = [...b, bolt, ...axis, role];
  for (let i = t0; i < tri.length; i += 3) ta.push(...at);
  for (let i = 0; i < 3 * k; i++) sa.push(...at);
}
// i: the index of the bolt in its part
function head(b: V, nn: V, g: Geo, i: number) {
  prism(b, nn, HEAD, R, 6, g, i, ROLE.head);
}
function nut(b: V, nn: V, g: Geo, i: number, alone = false) {
  prism(b, nn, NUT, R, 6, g, i, alone ? ROLE.alone : ROLE.nut);
  // the end of an anchor rod is there before its nut. The end of a bolt comes
  // with its head, so it moves out along -nn
  prism(add(b, mul(nn, NUT)), nn, TIP, SHANK, BAR, g, i, alone ? 0 : ROLE.end, mul(nn, -1));
}
// The shank under a head on b (nn out of the plate), l long, and its thread:
// a right hand helix on its outline, PITCH a turn. Only while it moves.
function shank(b: V, nn: V, l: number, g: Geo, i: number, role: number) {
  prism(sub(b, mul(nn, l)), nn, l, SHANK, BAR, g, i, role);
  const [a1, a2] = frame(nn);
  const STEPS = 12; // a turn
  const n = Math.floor(((l - NECK) / PITCH) * STEPS);
  const at = (k: number) => {
    const t = (2 * Math.PI * k) / STEPS;
    return add(sub(b, mul(nn, NECK + (PITCH * k) / STEPS)), add(mul(a1, SHANK * Math.cos(t)), mul(a2, -SHANK * Math.sin(t))));
  };
  for (let k = 0; k < n; k++) {
    g.seg.push(...at(k), ...at(k + 1));
    g.rad.push(0, 0, 0);
    g.sa.push(...b, i, ...nn, role);
  }
}

// ---- shaders (GLSL ES 3.00). The colours are sRGB from end to end.
// highp for the samplers too: their default is lowp, too coarse for a depth
const TOP = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\n';

// Where a vertex goes: the same math as movePoint() of deform.ts. Change both,
// or the view and the tests stop matching. mk: s, w, t, r of each knot. A part
// with no move has no knot and A = B = identity.
const MOVE = `
uniform vec3 mo, mu, mn;
uniform vec4 mk[${MAX_KNOTS}];
uniform int mnk;
uniform mat4 mA, mB;
uniform vec2 msplit;
vec3 move(vec3 p) {
  vec3 d = p - mo;
  float s = dot(d, mu);
  vec3 q = p;
  if (mnk > 0) {
    vec4 a = mk[0];
    vec4 z = mk[mnk - 1];
    float w;
    float r;
    if (s <= a.x) {
      w = a.y + a.z * (s - a.x);
      r = a.w;
    } else if (s >= z.x) {
      w = z.y + z.z * (s - z.x);
      r = z.w;
    } else {
      int i = 0;
      while (i < mnk - 2 && s > mk[i + 1].x) i++;
      vec4 P = mk[i];
      vec4 Q = mk[i + 1];
      float h = Q.x - P.x;
      float x = (s - P.x) / h;
      float x2 = x * x;
      float x3 = x2 * x;
      w = (2.0 * x3 - 3.0 * x2 + 1.0) * P.y + (x3 - 2.0 * x2 + x) * h * P.z + (3.0 * x2 - 2.0 * x3) * Q.y + (x3 - x2) * h * Q.z;
      r = P.w + (Q.w - P.w) * x;
    }
    q = p + mn * w - mu * (dot(d, mn) * r);
  }
  float f = msplit.y > msplit.x ? clamp((s - msplit.x) / (msplit.y - msplit.x), 0.0, 1.0) : (s >= msplit.x ? 1.0 : 0.0);
  return mix((mA * vec4(q, 1.0)).xyz, (mB * vec4(q, 1.0)).xyz, f);
}`;

// A bolt screws in: its head comes in along its axis and screws in, then its
// nut comes on from the other side and is turned tight. bolt: the ms since the
// bolts of this part started, the ms between two bolts, the ms of one (REST:
// all of them are in). Bolt i starts at i times the gap. Its head moves from 0
// to BOLT_IN of its time, its nut from BOLT_IN to 1 (a nut alone, from 0 to 1).
// Before that it is hidden (sHide). A piece
// first comes from TRAVEL to SEAT with no turn (k^3 of its way left), up to
// SEAT_AT of its time. Then it turns, and moves in with the turn, like on a
// thread: what is left of both is (1 - u)^SCREW_EXP. The pieces that are not a
// bolt (role 0) never move.
const SCREW = `
uniform vec3 bolt;
layout(location = 4) in vec4 bb;
layout(location = 5) in vec4 bn;
float sTurn;
vec3 sOff;
bool sHide;
void screwAt() {
  sTurn = 0.0;
  sOff = vec3(0.0);
  sHide = false;
  float role = bn.w;
  if (role < 0.5) return;
  float s = (bolt.x - bb.w * bolt.y) / bolt.z;
  float a = ${BOLT_IN.toFixed(3)};
  // the head, the bolt end, the shank and the stub move together
  bool head = role < 1.5 || role > 3.5;
  vec2 span = head ? vec2(0.0, a) : role < 2.5 ? vec2(a, 1.0) : vec2(0.0, 1.0);
  // when it hides: the shank when the bolt is done, the stub when the head is in
  float gone = role > 5.5 ? a : role > 4.5 ? 1.0 : 1e30;
  if (s < span.x || s >= gone) {
    sHide = true;
    return;
  }
  float u = clamp((s - span.x) / (span.y - span.x), 0.0, 1.0);
  float turn = head ? ${HEAD_TURN.toFixed(5)} : ${NUT_TURN.toFixed(5)};
  float seat = ${SEAT_AT.toFixed(3)};
  if (u < seat) {
    float k = 1.0 - u / seat;
    sOff = bn.xyz * (${SEAT.toFixed(1)} + ${(TRAVEL - SEAT).toFixed(1)} * k * k * k);
    sTurn = turn;
    return;
  }
  // done: exactly in place. pow() of a number under 0 is NaN, and on a GPU
  // the division is not exact, so 1 - (u - seat) / (1 - seat) can be -1e-7
  if (u >= 1.0) return;
  float r = pow(max(0.0, 1.0 - (u - seat) / (1.0 - seat)), ${SCREW_EXP.toFixed(3)}); // what is left of the turn
  sOff = bn.xyz * (${SEAT.toFixed(1)} * r);
  sTurn = turn * r;
}
// v turned about the axis of the bolt
vec3 spin(vec3 v) {
  if (sTurn == 0.0) return v;
  float c = cos(sTurn);
  return v * c + cross(bn.xyz, v) * sin(sTurn) + bn.xyz * dot(bn.xyz, v) * (1.0 - c);
}
vec3 screw(vec3 p) { return bb.xyz + spin(p - bb.xyz) + sOff; }`;
// a vertex out of the screen: a triangle or a line with all its corners there draws nothing
const AWAY = 'gl_Position = vec4(2.0, 2.0, 2.0, 1.0)';

// the faces: the background colour, or the part id (the outline and pick passes)
const FILL_VS = `${TOP}
uniform mat4 M;
uniform vec3 off;
layout(location = 0) in vec3 pos;
out vec3 vPos;
${MOVE}
${SCREW}
void main() {
  vPos = pos;
  screwAt();
  if (sHide) {
    ${AWAY};
    return;
  }
  gl_Position = M * vec4(move(screw(pos)) + off, 1.0);
}`;
const COLOR_FS = `${TOP}
uniform vec4 color;
out vec4 o;
void main() { o = color; }`;
// the faces in the view: the background, toward the color of the zone they are in.
// vPos is the undeformed point. zk: rgb, and how far toward it.
const ZONE_FS = `${TOP}
uniform vec4 color;
uniform int nz;
uniform vec3 zc[${MAX_ZONES}], zx[${MAX_ZONES}], zy[${MAX_ZONES}], zz[${MAX_ZONES}], zh[${MAX_ZONES}];
uniform vec4 zk[${MAX_ZONES}];
in vec3 vPos;
out vec4 o;
void main() {
  vec3 c = color.rgb;
  for (int i = 0; i < nz; i++) {
    vec3 d = vPos - zc[i];
    if (abs(dot(d, zx[i])) <= zh[i].x && abs(dot(d, zy[i])) <= zh[i].y && abs(dot(d, zz[i])) <= zh[i].z) c = mix(c, zk[i].rgb, zk[i].a);
  }
  o = vec4(c, 1.0);
}`;

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
uniform vec3 view; // toward the eye
layout(location = 0) in vec4 corner;
layout(location = 1) in vec3 start;
layout(location = 2) in vec3 end;
layout(location = 3) in vec3 rad; // see Geo: 0, or a corner of a round bar
out vec2 uv;
${MOVE}
${SCREW}
void main() {
  uv = vec2(0.0);
  screwAt();
  if (sHide) {
    ${AWAY};
    return;
  }
  vec3 s = move(screw(start));
  vec3 e = move(screw(end));
  vec3 r = spin(rad);
  if (r != vec3(0.0)) {
    // the normals of its two faces are r +- t (times a scale), t square
    // to r and to the axis, and |t| = tan(pi / BAR)
    vec3 t = ${Math.tan(Math.PI / BAR).toFixed(5)} * normalize(cross(e - s, r));
    if (dot(r + t, view) * dot(r - t, view) > 0.0) {
      ${AWAY}; // not on the outline
      uv = vec2(0.0);
      return;
    }
  }
  vec4 a = M * vec4(s + off, 1.0);
  vec4 b = M * vec4(e + off, 1.0);
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
// The welds: the seams of the parts (Part.welds), one instance per segment of
// a seam, with the times the welder is at its start and at its end (when).
// The same quad as a line, SPARK wide. The spark is a round dot where the
// welder is now, the bead behind it is hot, then cools and fades in cool ms.
// Nothing is left at the end: the drawing is the one with no animation.
const WELD_VS = `${TOP}
uniform mat4 M;
uniform vec2 res;
uniform float width;
uniform vec3 view;
layout(location = 0) in vec4 corner;
layout(location = 1) in vec3 start;
layout(location = 2) in vec3 end;
layout(location = 3) in vec2 when;
out vec2 uv;
out vec3 seg; // its length on screen in spark radii, then when
void main() {
  vec4 a = M * vec4(start + view * ${LIFT.toFixed(1)}, 1.0);
  vec4 b = M * vec4(end + view * ${LIFT.toFixed(1)}, 1.0);
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
  seg = vec3(length((b.xy - a.xy) * res) / width, when);
}`;
const WELD_FS = `${TOP}
uniform float now, cool;
uniform vec3 core, hot, warm;
in vec2 uv;
in vec3 seg;
out vec4 o;
void main() {
  float L = max(seg.x, 0.001);
  float f = (now - seg.y) / max(seg.z - seg.y, 0.001); // how far the welder is on it
  if (f <= 0.0) discard;
  // along the segment, in spark radii from its start (the round ends are one radius long)
  float a = uv.y < -1.0 ? uv.y + 1.0 : uv.y > 1.0 ? L + uv.y - 1.0 : (uv.y + 1.0) * 0.5 * L;
  float tip = min(f, 1.0) * L;
  float d = length(vec2(a - tip, uv.x));
  if (f < 1.0 && d <= 1.0) {
    o = vec4(mix(core, hot, smoothstep(0.35, 1.0, d)), 1.0);
    return;
  }
  float e = a < 0.0 ? -a : max(0.0, a - tip);
  if (e * e + uv.x * uv.x > ${(BEAD * BEAD).toFixed(4)}) discard;
  float k = (now - mix(seg.y, seg.z, clamp(a / L, 0.0, 1.0))) / cool;
  if (k >= 1.0) discard;
  o = vec4(mix(hot, warm, smoothstep(0.0, 0.5, k)), 1.0 - k * k);
}`;
const WELD_COLORS = { core: '#fff7d6', hot: '#ffa21a', warm: '#c8460a' };

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
uniform float deep, touch, width, only;
in vec2 vUv;
out vec4 o;
float D(vec2 d) { return texture(tDepth, vUv + d * texel).r; }
vec3 I(vec2 d) { return texture(tId, vUv + d * texel).rgb; }
void main() {
  float c = D(vec2(0.0));
  if (c >= 1.0) discard; // background
  vec3 id = I(vec2(0.0));
  bool bolt = id.b > 0.75; // a bolt head gets thin lines only
  // with one weight (only = 1), the round parts (blue at 0.5) alone
  if (only > 0.5 && abs(id.b - 0.5) > 0.25) discard;
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

// a Move, as the uniforms of the MOVE chunk want it
type Packed = { o: V; u: V; n: V; k: Float32Array; nk: number; A: Float32Array; B: Float32Array; split: [number, number] };
function pack(m: Move): Packed {
  const k = new Float32Array(4 * MAX_KNOTS);
  m.knots.forEach((c, i) => k.set([c.s, c.w, c.t, c.r], 4 * i));
  const A = new Float32Array(m.A);
  return { o: m.o, u: m.u, n: m.n, k, nk: m.knots.length, A, B: m.B ? new Float32Array(m.B) : A, split: m.split ?? [0, 0] };
}
const STILL = pack({ o: [0, 0, 0], u: [1, 0, 0], n: [0, 0, 1], knots: [], A: I4() });

type Program = { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };
// a render target: a colour texture, and a depth texture or buffer
type Target = { fb: WebGLFramebuffer; color: WebGLTexture; depth?: WebGLTexture; rb?: WebGLRenderbuffer; w: number; h: number };
type Buf = { vao: WebGLVertexArrayObject; bufs: WebGLBuffer[]; n: number; draw: number };
// ends: the triangle and line floats before the first bolt, then after each
// bolt. fill.n counts vertices, lines.n counts segments; draw: how many of
// them the build animation shows now. off: where the animation moves it, mm.
// screw: the bolt uniform of SCREW.
type Piece = {
  part: Part; fill: Buf; lines?: Buf; ends: [number, number][];
  id: RGB; off: V; visible: boolean; color: RGB; width: number; move: Packed; screw: [number, number, number];
  fade: number; // the slab while it is poured (effects): 0 not there yet, 1 all there
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
  let zoneColors = (colors.zones ?? []).map(rgb);
  const mix = (a: RGB, b: RGB, k: number) => a.map((x, i) => x + (b[i] - x) * k) as RGB;
  let [added, gone] = [rgb('#5a9e1e'), rgb('#d00000')];
  let marks: Record<string, Mark> | null = null;
  let deformed: DeformState | null = null;
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
  let [deep, touch, outWidth, thinWidth] = [0, 0, 2, 1];
  let texel: [number, number] = [1, 1];
  let px: [number, number] = [1, 1];
  let dpx = 1; // device px per CSS px

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
  let fillP: Program, zoneP: Program, lineP: Program, outlineP: Program, downP: Program, weldP: Program;
  let rt: Target, lt: Target, pickRT: Target; // depth and ids, the outlines alone, the pick
  let quadBuf: WebGLBuffer, quadIdx: WebGLBuffer;
  const init = () => {
    fillP = compile(FILL_VS, COLOR_FS);
    zoneP = compile(FILL_VS, ZONE_FS);
    lineP = compile(LINE_VS, LINE_FS);
    outlineP = compile(SCREEN_VS, OUTLINE_FS);
    downP = compile(SCREEN_VS, DOWN_FS);
    weldP = compile(WELD_VS, WELD_FS);
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
    gl.vertexAttrib3f(3, 0, 0, 0); // rad, for the lines that have none
    gl.vertexAttrib4f(5, 0, 0, 0, 0); // bn: not a bolt
  };
  init();

  // a buffer of floats, read by the bound VAO as attributes: [location, size]
  // one after the other, divisor 1 for one per instance
  const attribs = (data: number[], layout: [number, number][], divisor = 0) => {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    const stride = 4 * layout.reduce((a, [, n]) => a + n, 0);
    let at = 0;
    for (const [k, n] of layout) {
      gl.enableVertexAttribArray(k);
      gl.vertexAttribPointer(k, n, gl.FLOAT, false, stride, at);
      gl.vertexAttribDivisor(k, divisor);
      at += 4 * n;
    }
    return buf;
  };
  const BOLT: [number, number][] = [[4, 4], [5, 4]]; // bb, bn
  // ta: see Geo, only when the part has bolts
  const fillBuf = (tri: number[], ta?: number[]): Buf => {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const bufs = [attribs(tri, [[0, 3]])];
    if (ta) bufs.push(attribs(ta, BOLT));
    gl.bindVertexArray(null);
    return { vao, bufs, n: tri.length / 3, draw: tri.length / 3 };
  };
  // the quad of a line, for the instances of the buffers that follow
  const quadVao = () => {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, quadIdx);
    return vao;
  };
  // rad, sa: see Geo, only when some line has one, when the part has bolts
  const lineBuf = (seg: number[], rad?: number[], sa?: number[]): Buf => {
    const vao = quadVao();
    const bufs = [attribs(seg, [[1, 3], [2, 3]], 1)];
    if (rad) bufs.push(attribs(rad, [[3, 3]], 1));
    if (sa) bufs.push(attribs(sa, BOLT, 1));
    gl.bindVertexArray(null);
    return { vao, bufs, n: seg.length / 6, draw: seg.length / 6 };
  };
  // the seams: start, end, then when (see WELD_VS), 8 numbers each
  const weldBuf = (inst: number[]): Buf => {
    const vao = quadVao();
    const bufs = [attribs(inst, [[1, 3], [2, 3], [3, 2]], 1)];
    gl.bindVertexArray(null);
    return { vao, bufs, n: inst.length / 8, draw: inst.length / 8 };
  };
  const free = (b?: Buf) => {
    if (!b) return;
    gl.deleteVertexArray(b.vao);
    for (const x of b.bufs) gl.deleteBuffer(x);
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
  const moveBy = ({ u }: Program, m: Packed) => {
    gl.uniform3fv(u.mo, m.o);
    gl.uniform3fv(u.mu, m.u);
    gl.uniform3fv(u.mn, m.n);
    gl.uniform4fv(u['mk[0]'], m.k);
    gl.uniform1i(u.mnk, m.nk);
    gl.uniformMatrix4fv(u.mA, false, m.A);
    gl.uniformMatrix4fv(u.mB, false, m.B);
    gl.uniform2fv(u.msplit, m.split);
  };
  // the zones in the uniforms of ZONE_FS. A level of 1 goes 80 % of the way to
  // the color: the lines stay readable on it.
  const zonesIn = ({ u }: Program) => {
    const zs = deformed?.zones.slice(0, MAX_ZONES) ?? [];
    const flat = (f: (z: (typeof zs)[number]) => number[]) => new Float32Array(zs.flatMap(f));
    if (!zs.length) return 0;
    gl.uniform3fv(u['zc[0]'], flat((z) => z.c));
    gl.uniform3fv(u['zx[0]'], flat((z) => z.axes[0]));
    gl.uniform3fv(u['zy[0]'], flat((z) => z.axes[1]));
    gl.uniform3fv(u['zz[0]'], flat((z) => z.axes[2]));
    gl.uniform3fv(u['zh[0]'], flat((z) => z.half));
    gl.uniform4fv(u['zk[0]'], flat((z) => [...(zoneColors[z.slot] ?? accent), 0.8 * Math.min(1, z.level)]));
    return zs.length;
  };
  // the faces, with their part id as colour (ids) or the background. The rig
  // and the bolts take no zone color. The slab has its own pass (veil), so the
  // steel under it keeps its faces, its lines and its outlines.
  const fills = (M: Float32Array, ids: boolean, slab = false) => {
    const P = ids ? fillP : zoneP;
    gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u.M, false, M);
    const nz = ids ? 0 : zonesIn(P);
    // the gone parts come first (see show()): further back than the rest
    const offset = gl.isEnabled(gl.POLYGON_OFFSET_FILL);
    let back = false;
    const setBack = (b: boolean) => {
      if (b === back) return;
      back = b;
      gl.polygonOffset(b ? 4 : 0.5, b ? 16 : 2);
      if (!offset) gl[b ? 'enable' : 'disable'](gl.POLYGON_OFFSET_FILL);
    };
    for (const p of pieces) {
      if (!p.visible || !p.fill.draw || (p.part.kind === 'slab') !== slab) continue;
      setBack(marks?.[p.part.id] === 'gone');
      gl.uniform3fv(P.u.off, p.off);
      gl.uniform4f(P.u.color, ...(ids ? p.id : bg), 1);
      if (!ids) gl.uniform1i(P.u.nz, p.part.kind === 'rig' || p.part.kind === 'bolts' ? 0 : nz);
      gl.uniform3fv(P.u.bolt, p.screw);
      moveBy(P, p.move);
      gl.bindVertexArray(p.fill.vao);
      gl.drawArrays(gl.TRIANGLES, 0, p.fill.draw);
    }
    setBack(false);
  };
  const lines = (M: Float32Array, slab = false) => {
    gl.useProgram(lineP.p);
    gl.uniformMatrix4fv(lineP.u.M, false, M);
    gl.uniform2f(lineP.u.res, canvas.width, canvas.height);
    gl.uniform3f(lineP.u.view, ...cam.Z);
    for (const p of pieces) {
      if (!p.visible || !p.lines?.draw || (p.part.kind === 'slab') !== slab) continue;
      gl.uniform3fv(lineP.u.off, p.off);
      gl.uniform4f(lineP.u.color, ...(p.fade < 1 ? mix(bg, p.color, p.fade) : p.color), 1);
      gl.uniform1f(lineP.u.width, p.width);
      gl.uniform3fv(lineP.u.bolt, p.screw);
      moveBy(lineP, p.move);
      gl.bindVertexArray(p.lines.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, QUAD_IDX.length, gl.UNSIGNED_SHORT, 0, p.lines.draw);
    }
  };
  // The slab, as a light veil on top of the steel. The depth goes first, so each
  // pixel gets the color once and the veil stays even. Steel in front hides it.
  const veil = (M: Float32Array) => {
    const slabs = pieces.filter((p) => p.visible && p.fill.draw && p.part.kind === 'slab');
    if (!slabs.length) return;
    gl.useProgram(fillP.p);
    gl.uniformMatrix4fv(fillP.u.M, false, M);
    const draw = () => {
      for (const p of slabs) {
        gl.uniform3fv(fillP.u.off, p.off);
        gl.uniform4f(fillP.u.color, ...rig, VEIL * p.fade);
        gl.uniform3fv(fillP.u.bolt, REST);
        moveBy(fillP, p.move);
        gl.bindVertexArray(p.fill.vao);
        gl.drawArrays(gl.TRIANGLES, 0, p.fill.draw);
      }
    };
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.colorMask(false, false, false, false);
    draw();
    gl.colorMask(true, true, true, true);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    draw();
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    lines(M, true);
  };
  // the seams being made, on top of all (a hidden seam stays hidden)
  const welds = (M: Float32Array) => {
    if (!anim?.welds) return;
    const u = weldP.u;
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.useProgram(weldP.p);
    gl.uniformMatrix4fv(u.M, false, M);
    gl.uniform2f(u.res, canvas.width, canvas.height);
    gl.uniform1f(u.width, 2 * SPARK * dpx);
    gl.uniform3f(u.view, ...cam.Z);
    gl.uniform1f(u.now, anim.t);
    gl.uniform1f(u.cool, anim.cool);
    for (const [k, c] of Object.entries(WELD_COLORS)) gl.uniform3f(u[k], ...rgb(c));
    gl.bindVertexArray(anim.welds.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, QUAD_IDX.length, gl.UNSIGNED_SHORT, 0, anim.welds.n);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
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
    const outlines = two || pieces.some((p) => p.visible && p.id[2] === 0.5);
    if (outlines) {
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
      gl.uniform1f(outlineP.u.width, two ? outWidth : thinWidth);
      gl.uniform1f(outlineP.u.only, two ? 0 : 1);
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
    veil(M);
    if (outlines) {
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.useProgram(downP.p);
      tex(0, lt.color, downP.u.tLine);
      gl.uniform2f(downP.u.px, ...px);
      gl.uniform3f(downP.u.color, ...(marks ? mix(fg, bg, FADE) : fg));
      gl.bindVertexArray(null);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.BLEND);
    }
    welds(M);
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
    dpx = pr;
    // about 3 samples per CSS px each way: 2x on a 1x screen, 1.5x on a 2x one
    const ss = Math.min(2, Math.max(1, 3 / pr));
    const [rw, rh] = [Math.round(w * pr * ss), Math.round(h * pr * ss)];
    setSize(rt, rw, rh);
    setSize(lt, rw, rh);
    texel = [1 / rw, 1 / rh];
    outWidth = THICK * pr * ss;
    thinWidth = ONE * pr * ss;
    px = [1 / (w * pr), 1 / (h * pr)];
    if (fitted && pieces.length) reset();
    else place();
    redraw();
  };
  new ResizeObserver((e) => resize(e)).observe(host);

  // ---- the build animation: same timeline as the SVG
  // t: the time of the frame, ms from the start. welds: the seams (effects
  // only), cool: how long they take to cool.
  type Anim = { t0: number; t: number; slots: ReturnType<typeof timeline>; dirs: V[]; end: number; effects: boolean; welds?: Buf; cool: number };
  let anim: Anim | null = null;
  let clock: number | null = null; // seek(): the build stays at this time
  let played: [number, number | undefined, boolean] | null = null; // the last build(), for seek()
  const ease = (t: number) => 1 - (1 - t) ** 3;
  const animate = (now: number): boolean => {
    if (!anim) return false;
    const t = (anim.t = clock ?? now - anim.t0);
    pieces.forEach((p, i) => {
      const sl = anim!.slots.get(p.part.step)!;
      p.visible = t >= sl.start;
      if (p.part.kind === 'bolts' && sl.bolt) {
        // the shader screws them in
        if (anim!.effects) return void (p.screw = [t - sl.start, sl.bolt.gap, sl.bolt.dur]);
        // one bolt after the other
        const n = Math.min(p.part.dots.length, Math.max(0, Math.floor((t - sl.start) / sl.bolt.gap) + 1));
        p.fill.draw = p.ends[n][0] / 3;
        if (p.lines) p.lines.draw = p.ends[n][1] / 6;
        return;
      }
      const u = Math.min(1, Math.max(0, (t - sl.start) / sl.dur));
      // the slab is poured: it comes in place, and shows little by little
      if (anim!.effects && p.part.kind === 'slab') {
        p.off = [0, 0, 0];
        p.fade = ease(u);
        return;
      }
      // with the effects, it slows down as on a log scale (land())
      const k = anim!.effects ? land(u) : ease(u);
      const far = p.part.kind === 'plate' || p.part.kind === 'base' || p.part.kind === 'slab' ? 0.12 * radius : 2.6 * radius;
      p.off = mul(anim!.dirs[i], far * (1 - k));
      // the anchor nuts of a base plate screw down after it lands
      if (anim!.effects && sl.nuts) p.screw = [t - sl.nuts.start, sl.nuts.gap, sl.nuts.dur];
    });
    if (t < anim.end) return clock === null;
    stopAnim();
    return false;
  };
  const stopAnim = () => {
    free(anim?.welds);
    anim = null;
    for (const p of pieces) {
      p.visible = true;
      p.off = [0, 0, 0];
      p.screw = REST;
      p.fade = 1;
      p.fill.draw = p.fill.n;
      if (p.lines) p.lines.draw = p.lines.n;
    }
  };

  // ---- the structure
  const moveOf = (part: Part) => {
    const m = deformed?.moves[part.id];
    return m ? pack(m) : STILL;
  };
  const show = (parts: Part[], m?: Record<string, Mark>) => {
    stopAnim();
    setHover(null);
    if (parts !== shown) deformed = null; // its moves are for the old parts
    shown = parts;
    marks = m ?? null;
    for (const p of pieces) {
      free(p.fill);
      free(p.lines);
    }
    pieces = [];
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    const indexOf = new Map(parts.map((q, i) => [q.id, i]));
    parts.forEach((part, pi) => {
      const tri: number[] = [];
      const seg: number[] = [];
      for (const fc of part.faces) {
        triangles(fc.pts, tri);
        for (const [i, j] of fc.edges) seg.push(...fc.pts[i], ...fc.pts[j]);
        for (const p of fc.pts) for (let k = 0; k < 3; k++) [lo[k], hi[k]] = [Math.min(lo[k], p[k]), Math.max(hi[k], p[k])];
      }
      // the bolts (Dot in steel.ts): the head, and the nut on the far side
      // when we know it
      const ends: [number, number][] = [[tri.length, seg.length]];
      // the faces are not a bolt: 0 for their SCREW attributes
      const g: Geo = { tri, seg, rad: new Array<number>(seg.length / 2).fill(0), ta: new Array<number>((tri.length / 3) * 8).fill(0), sa: new Array<number>((seg.length / 6) * 8).fill(0) };
      part.dots.forEach((dt, i) => {
        if (dt.axis) {
          const h = dt.half ?? 0;
          head(add(dt.p, mul(dt.axis, h)), dt.axis, g, i);
          shank(add(dt.p, mul(dt.axis, h)), dt.axis, 2 * h + NUT, g, i, ROLE.shank);
          nut(sub(dt.p, mul(dt.axis, h)), mul(dt.axis, -1), g, i);
        } else if (dt.n && dt.anchor) nut(dt.p, dt.n, g, i, true);
        else if (dt.n && !dt.far) {
          head(dt.p, dt.n, g, i);
          if (dt.grip === undefined) shank(dt.p, dt.n, STUB, g, i, ROLE.stub);
          else {
            shank(dt.p, dt.n, dt.grip + NUT, g, i, ROLE.shank);
            nut(sub(dt.p, mul(dt.n, dt.grip)), mul(dt.n, -1), g, i);
          }
        }
        ends.push([tri.length, seg.length]);
      });
      if (!tri.length) return;
      const bolts = tri.length > ends[0][0];
      const tag = (part.joint ? indexOf.get(part.joint.of) ?? pi : pi) + 1;
      const p: Piece = {
        part, ends,
        fill: fillBuf(tri, bolts ? g.ta : undefined),
        lines: seg.length ? lineBuf(seg, g.rad.some((x) => x) ? g.rad : undefined, bolts ? g.sa : undefined) : undefined,
        // blue marks the bolts (a head or a nut gets no outline) and the
        // round parts (outlined with one weight too). A pin joint has one id:
        // no outline inside it, and a pick gives its moving part.
        id: [(tag & 255) / 255, (tag >> 8) / 255, part.kind === 'bolts' ? 1 : part.round ? 0.5 : 0],
        off: [0, 0, 0], visible: true, color: fg, width: THIN, move: moveOf(part), screw: REST, fade: 1,
      };
      lineStyle(p);
      pieces.push(p);
    });
    // the gone parts first: their lines draw under the lines of the new ones
    if (marks) pieces.sort((a, b) => +(marks![b.part.id] === 'gone') - +(marks![a.part.id] === 'gone'));
    centre = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    radius = Math.max(500, 0.5 * Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]));
    box = [lo as V, hi as V];
    reset();
  };

  // the buffer of the welds: each segment of each seam, with the times the
  // welder is at its ends. A seam moves with its part, as the MOVE chunk
  // does: a hub test shows its shape at the step of the slider.
  const seams = (slots: Anim['slots']) => {
    const inst: number[] = [];
    for (const { part } of pieces) {
      const w = slots.get(part.step)?.weld;
      if (!w || !part.welds) continue;
      const m = deformed?.moves[part.id];
      const at = (v: V) => (m ? movePoint(v, m) : v);
      seamTimes(part.welds, w).forEach(([t0, t1], i) => inst.push(...at(part.welds![i][0]), ...at(part.welds![i][1]), t0, t1));
    }
    return inst.length ? weldBuf(inst) : undefined;
  };
  const build = (speed = 1, duration?: number, effects = true) => {
    played = [speed, duration, effects];
    stopAnim();
    setHover(null);
    const slots = timeline(pieces.map((p) => p.part), { speed, duration, effects });

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
    anim = { t0: performance.now(), t: 0, slots, dirs, end, effects, cool: COOL_MS / speed };
    if (effects) anim.welds = seams(slots);
    clock = null;
    redraw();
  };
  const seek = (ms: number | null) => {
    if (ms !== null && !anim && played) build(...played); // the build is over: play it again
    if (anim && ms === null && clock !== null) anim.t0 = performance.now() - clock;
    clock = ms;
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
    const m = matrix([x, y]);
    fills(m, true);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    // the steel answers first, also under the slab
    if (!shown[pixel[0] + pixel[1] * 256 - 1]) {
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      fills(m, true, true);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    }
    bind(null);
    return shown[pixel[0] + pixel[1] * 256 - 1] ?? null;
  };
  // the hovered part: its lines in the accent colour, a bit thicker
  let hovered: Part | null = null;
  function lineStyle(p: Piece) {
    const on = p.part === hovered || (!!hovered && p.part.joint?.of === hovered.id);
    const mk = marks?.[p.part.id];
    const plain = p.part.kind === 'rig' || p.part.kind === 'slab' ? rig : fg;
    if (!marks) p.color = on || p.part.accent ? accent : plain;
    else p.color = on ? accent : mk === 'new' ? added : mk === 'gone' ? gone : mix(plain, bg, FADE);
    p.width = (two ? THIN : ONE) * (on ? 2 : mk ? MARKED : 1);
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
    if (anim) anim.welds = undefined;
    init();
    resize();
    if (shown.length) show(shown, marks ?? undefined);
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
    // a deformed shape needs more room than the box of the undeformed one
    const room = deformed ? 0.8 : 0.9;
    zoom = (1.1 * radius * room) / Math.max(1, asp > 1 ? Math.max(ey, ex / asp) : Math.max(ex, ey * asp));
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
    seek,
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
      zoneColors = (c.zones ?? []).map(rgb);
      if (c.added) added = rgb(c.added);
      if (c.gone) gone = rgb(c.gone);
      for (const p of pieces) lineStyle(p);
      redraw();
    },
    deform(d) {
      const refit = !d !== !deformed && fitted;
      deformed = d;
      for (const p of pieces) p.move = moveOf(p.part);
      if (anim?.welds) {
        free(anim.welds);
        anim.welds = seams(anim.slots);
      }
      if (refit && pieces.length) reset();
      redraw();
    },
    stats() {
      let [faces, bolts, lines] = [0, 0, 0];
      for (const p of pieces) {
        faces += p.part.faces.length;
        bolts += p.part.dots.filter((d) => !d.far).length;
        lines += p.lines?.n ?? 0;
      }
      return { faces, bolts, lines };
    },
  };
}
