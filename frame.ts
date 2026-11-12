// A frame test: the joint of a hub row is one joint of a small frame, with
// the rest of the frame and its rig around it. The row ("Exterior - Frame")
// gives the joint only: the rest comes from the report of the test, in
// FRAME_TESTS, with a note for each value.
//
// The frame: two columns, each fixed on a base plate, on an interface plate
// on the strong floor. The girder runs from column 0 (the joint of the row)
// to column 1, then past it as a cantilever. The cantilever tip stands on a
// pinned link. Joists go across the girder and into the column webs, under
// the slab.
//
// The rig (frameRig), from the figures of the report, drawn:
// - a strong wall past column 0, and two horizontal actuators on it. The
//   bottom one pushes the loading beam on column 0, at the girder. The top one
//   pushes the link member that joins the two column tops (a clevis on each
//   column cap).
// - the out-of-plane frame: a pair of posts across each column, braced, a
//   beam on each pair, and a roller on each post that holds the specimen
//   across. A reaction beam on the two pair beams holds two vertical
//   actuators, one over each column, that push the link member down.
//
// generate.ts calls this file from small hooks: specimen() (frameLayout),
// model() (holdFrame) and parts() (frameRig: the rig, the joists, the slab).
// A frame has no deformed shape yet (deform-connection.ts says so). Units
// are mm. No Node API here.
import { add, len, mul, norm, sub, type V } from './vec.ts';
import { rodSection, type Catalog, type Section } from './sections.ts';
import { actuator, block, clevis, hingeSize, link, rigBars, rigMember, rigSection } from './rig.ts';
import { flat, type P2, type Part } from './steel.ts';
import { TIP_GAP, type SlabBeam } from './slab.ts';
import { findSection, type ConnSpecimen } from './specimen.ts';
import type { FNode } from './solver.ts';
import type { Structure } from './generate.ts';

// What the hub row of a frame test doesn't give, from the report. height: the
// columns. top: the top of the slab above the column foot (the top of steel
// of the girder is under the slab). overhang: the cantilever, from the axis of
// column 1 to the end plate at its tip.
export type FrameTest = { height: number; top: number; overhang: number; frame: NonNullable<ConnSpecimen['frame']>; notes: string[] };

const DEL_CARPIO = 'Del Carpio Ramos, Mosqueda and Lignos (2014), MCEER-14-0003';
export const FRAME_TESTS: Record<string, FrameTest> = {
  'Del_Caprio_et_al_2014_RBS-A': {
    height: 3200, top: 2286, overhang: 2375,
    frame: {
      doubler1: { n: 1, t: 7.94 },
      joists: { section: 'W8x10', pitch: 1524, out: 609.6 },
      loadingBeam: { section: 'HSS6x6x1/2', length: 450 },
    },
    notes: [
      `a frame test: the row has the joint at the first column only. The rest of the frame and its rig come from ${DEL_CARPIO} (fig. 5-1, 5-18, drawings S1.01 and S1.03)`,
      'from the report, not in the row: the columns 3200 mm high (h_c in the row is not the column), the top of the slab 2286 mm above the base plates, the cantilever 2375 mm past the second column',
      'from the report, not in the row: a 7.94 mm doubler plate on the second column, W8x10 joists every 1524 mm (609.6 mm each side of the girder), the HSS6x6x1/2 loading beam on the first column',
      'the joists are drawn, but they are not in the solver model',
      'the rig sizes are drawn from the figures of the report: the strong wall, the interface plates, the out-of-plane frame, the reaction beam, the link member',
      'not drawn: the gravity load plates on the slab, the vertical guide pipe, the bolts of the interface plates, the column stiffeners at the joists, the pins at the feet of the out-of-plane frame',
      'the report gives the RBS cut a 95.25, b 285.75, c 33.3 mm: we keep the cut of the row, like the other RBS tests',
    ],
  },
};

// The frame of a structure (Structure.frame). doubler1: the doubler plates of
// column 1 (w: the drawn width). joist, loading: the sections, from the
// specimen. rig: the sections of the rig members.
export type FrameSt = {
  doubler1?: { n: 1 | 2; t: number; w: number };
  joist?: { sec: Section; pitch: number; out: number };
  loading?: { sec: Section; length: number };
  rig: { post: Section; beam: Section; link: Section };
};

// The sizes of the rig, drawn from the figures of the report.
const INTERFACE = { along: 1524, across: 2743, t: 38.1 }; // 5 ft x 9 ft x 1.5 in, one under each column
const WALL = { at: 5880, t: 600, w: 2000, top: 4000 }; // at: its face, from column 0
const POSTS = { x: 723.9, at: [-450, 576], height: 5105.4 }; // 4'-9" apart, 16'-9" high. at: from each column axis
const BRACING = { D: 30, z: [150, 1650] };
const ROLLER = { D: 50, length: 110, arm: 100 };
const LINK_OUT = 300; // the link member, past each column axis
const DA = 80; // the pins of the horizontal actuators
const DV = 50; // the pins of the vertical actuators, the column top clevises and the tip link
const TIP_BLOCK = 400;
const JOIST_GAP = 6.35; // a joist on a column web starts past the flange tips

// The checked frame of a specimen, but the doublers (generate.ts checks them).
export function frameLayout(spec: ConnSpecimen, cat: Catalog, bad: (msg: string) => Error): FrameSt {
  const f = spec.frame!;
  const out: FrameSt = { rig: { post: rigSection(cat, 300, 150), beam: rigSection(cat, 350, 170), link: rigSection(cat, 300, 165) } };
  const j = f.joists;
  if (j) {
    const sec = findSection(j.section, cat);
    if (sec.kind !== 'I') throw bad('frame: the joists must be an I section');
    if (!(j.pitch > sec.bf)) throw bad(`frame: the joist pitch must be more than the joist width, not ${JSON.stringify(j.pitch)}`);
    if (!(j.out > 0)) throw bad(`frame: the joist length out must be a number above 0, not ${JSON.stringify(j.out)}`);
    out.joist = { sec, pitch: j.pitch, out: j.out };
  }
  const lb = f.loadingBeam;
  if (lb) {
    if (!(lb.length > 0)) throw bad(`frame: the loading beam length must be a number above 0, not ${JSON.stringify(lb.length)}`);
    out.loading = { sec: findSection(lb.section, cat), length: lb.length };
  }
  return out;
}

const Z: V = [0, 0, 1];
const tipOf = (st: Structure, a: Structure['arms'][number]): V => add(add(st.cols[a.col].x, mul(dirOf(st), a.L)), [0, 0, a.z]);
const dirOf = (st: Structure): V => norm(sub(st.cols[1].x, st.cols[0].x));

// The solver supports of a frame test. model() fixes the feet. The link
// member holds the column tops along the frame, the out-of-plane frame holds
// them across. The tip link holds the cantilever tip up.
export function holdFrame(st: Structure, nodes: FNode[]) {
  const hold = (x: V, dofs: number[]) => {
    const n = nodes.find((q) => Math.hypot(...sub(q.x, x)) < 1);
    if (n) n.fixed = [0, 1, 2, 3, 4, 5].map((d) => dofs.includes(d));
  };
  for (const c of st.cols) hold(add(c.x, [0, 0, st.H]), [0, 1]);
  for (const a of st.arms) if (a.to === undefined) hold(tipOf(st, a), [2]);
}

// A joist: o on the axis of what it stands on (column col, or the girder arm),
// at its top of steel. side: the way it goes. It starts at `from` mm from o
// (0: at the support face, generate.ts finds it) and ends at `out`. pad: a
// doubler plate between the column web and its shear tab.
export type Joist = { id: string; col?: number; arm?: number; o: V; side: V; from: number; out: number; pad?: number };

export type FrameRig = { below: Part[]; above: Part[]; joists: Joist[]; slab: SlabBeam[] };

// The rig, the joists and the slab beams of a frame test. tp: the end plate on
// each column cap. tb: the base plates. ids: the part ids of the columns.
// below: put down before column 0. above: put on last.
export function frameRig(st: Structure, tp: number, tb: number, ids: string[]): FrameRig {
  const fr = st.frame!;
  const { col, H } = st;
  const [bay, tip] = st.arms;
  const { post, beam, link: lk } = fr.rig;
  const o = st.cols[0].x;
  const h = dirOf(st);
  const A: V = [Math.round(h[1]), -Math.round(h[0]), 0]; // across, like across() in generate.ts
  const span = len(sub(st.cols[1].x, o));
  const P = (s: number, x: number, z: number): V => add(add(add(o, mul(h, s)), mul(A, x)), [0, 0, z]);
  // a block size along h, across and up, in x, y, z
  const size = (s: number, x: number, z: number): V => (Math.abs(h[0]) > 0.5 ? [s, x, z] : [x, s, z]);
  const ro = { step: 0 };
  const up: V = [0, 0, -1]; // the blocks come up from the floor
  const floor = -tb - INTERFACE.t;
  const zt = bay.z;
  const zb = bay.z - bay.sec.d;
  const at = [0, span]; // the column axes, along h

  // the cantilever tip: the pin of its link, like the beam tips of specimenRig
  const sPin = span + tip.L - 1.3 * DV - 30;
  const below = [
    ...at.map((s, i) => block(`interface${i + 1}`, P(s, 0, -tb - INTERFACE.t / 2), size(INTERFACE.along, INTERFACE.across, INTERFACE.t), { ...ro, from: up, type: 'Interface plate' })),
    block('wall', P(-WALL.at - WALL.t / 2, 0, (floor + WALL.top) / 2), size(WALL.t, WALL.w, WALL.top - floor), { ...ro, from: up, type: 'Reaction wall' }),
    block('tip-block', P(sPin, 0, floor + TIP_BLOCK / 2), size(TIP_BLOCK, TIP_BLOCK, TIP_BLOCK), { ...ro, from: up }),
  ];

  const above: Part[] = [];
  // the end plate at the cantilever tip
  const tipPlate = flat(P(span + tip.L + 10, 0, zt - tip.sec.d / 2), A, Z, 20, rect(tip.sec.bf + 50, tip.sec.d + 50));
  above.push({ id: `${tip.id}-end`, step: 0, supports: [tip.id], kind: 'plate', from: h, faces: tipPlate.faces, boxes: [tipPlate.box], dots: [], info: { type: 'End plate', of: tip.id } });
  // the loading beam on column 0, its top at the top of the girder, and its end plate
  const ld = fr.loading;
  const zLoad = ld ? zt - ld.sec.d / 2 : zt - bay.sec.d / 2;
  let sLoad = -col.d / 2; // where the bottom actuator pushes
  if (ld) {
    sLoad = -col.d / 2 - ld.length;
    above.push(rigMember('loading-beam', ld.sec, P(-col.d / 2, 0, zLoad), P(sLoad, 0, zLoad), { ...ro, supports: [ids[0]], type: 'Loading beam' }));
    const w = Math.max(ld.sec.bf, ld.sec.d) + 100;
    above.push(block('loading-plate', P(sLoad - 12.5, 0, zLoad), size(25, w, w), { ...ro, supports: ['loading-beam'], type: 'End plate' }));
    sLoad -= 25;
  }

  // the out-of-plane frame: a pair of posts across each column, on its interface plate
  const zTop = floor + POSTS.height;
  const pairs = at.map((s, i) => s + POSTS.at[i]);
  const xIn = POSTS.x - post.tw / 2; // the post web face
  if (POSTS.x - post.bf / 2 < (fr.joist?.out ?? 0) + 20 || POSTS.x - post.bf / 2 < Math.max(st.slab?.left ?? 0, st.slab?.right ?? 0) + 20)
    throw new Error(`${st.id}: the out-of-plane frame is too close to the joists or the slab`);
  pairs.forEach((s, i) => {
    const ps = [-1, 1].map((sx, k) => {
      const id = `frame-post${2 * i + k + 1}`;
      above.push(rigMember(id, post, P(s, sx * POSTS.x, -tb), P(s, sx * POSTS.x, zTop), { ...ro, supports: [`interface${i + 1}`], type: 'Out-of-plane frame post' }, h));
      return id;
    });
    const xr = xIn - BRACING.D / 2; // the bars stop short of the web: their square ends would poke in
    const [z0, z1] = BRACING.z;
    above.push(rigBars(`frame-bracing${i + 1}`, rodSection('bracing', BRACING.D), [[P(s, -xr, z0), P(s, xr, z1)], [P(s, xr, z0), P(s, -xr, z1)]], { ...ro, supports: ps }));
    const X = POSTS.x + post.bf / 2;
    above.push(rigMember(`frame-beam${i + 1}`, beam, P(s, -X, zTop + beam.d / 2), P(s, X, zTop + beam.d / 2), { ...ro, supports: ps, type: 'Out-of-plane frame beam' }));
    // a roller on each post, on the side of the loading beam (pair 0) or the
    // bottom flange of the cantilever (pair 1)
    const [half, zr] = i === 0 && ld ? [ld.sec.bf / 2, zLoad] : [tip.sec.bf / 2, zb + tip.sec.tf / 2];
    const xc = half + ROLLER.D / 2;
    ps.forEach((pid, k) => {
      const sx = k ? 1 : -1;
      const id = `roller${2 * i + k + 1}`;
      const xa = xc + ROLLER.D / 2;
      above.push(block(`${id}-arm`, P(s, (sx * (xa + xIn)) / 2, zr), size(ROLLER.arm, xIn - xa, ROLLER.arm), { ...ro, supports: [pid], type: 'Roller arm' }));
      above.push(rigMember(id, rodSection('roller', ROLLER.D), P(s, sx * xc, zr - ROLLER.length / 2), P(s, sx * xc, zr + ROLLER.length / 2), { ...ro, supports: [`${id}-arm`], type: 'Roller' }));
    });
  });
  // the reaction beam on the two pair beams, along the frame
  const zReact = zTop + beam.d;
  above.push(rigMember('reaction-beam', beam, P(pairs[0] - post.d / 2, 0, zReact + beam.d / 2), P(pairs[1] + post.d / 2, 0, zReact + beam.d / 2), { ...ro, supports: ['frame-beam1', 'frame-beam2'], type: 'Reaction beam' }));

  // a clevis on each column cap, the link member on the two tongues
  const reach = hingeSize(DV).reach;
  const zLink = H + tp + reach;
  at.forEach((s, i) => above.push(...clevis(`top-pin${i + 1}`, P(s, 0, H + tp), Z, A, DV, reach, { ...ro, supports: [`${ids[i]}-cap`] })));
  above.push(rigMember('link-beam', lk, P(-LINK_OUT, 0, zLink + lk.d / 2), P(span + LINK_OUT, 0, zLink + lk.d / 2), { ...ro, supports: ['top-pin1', 'top-pin2'], type: 'Link member' }));
  // the actuators: two from the wall, one down on the link member over each column
  const wall = -WALL.at;
  above.push(...actuator('top-actuator', P(wall, 0, zLink + lk.d / 2), P(-LINK_OUT, 0, zLink + lk.d / 2), A, DA, { ...ro, supports: ['wall', 'link-beam'] }));
  above.push(...actuator('bottom-actuator', P(wall, 0, zLoad), P(sLoad, 0, zLoad), A, DA, { ...ro, supports: ['wall', ld ? 'loading-plate' : ids[0]] }));
  at.forEach((s, i) => above.push(...actuator(`vertical-actuator${i + 1}`, P(s, 0, zReact), P(s, 0, zLink + lk.d), A, DV, { ...ro, supports: ['reaction-beam', 'link-beam'] })));
  // the cantilever tip stands on a pinned link
  above.push(...link('tip-link', P(sPin, 0, floor + TIP_BLOCK), P(sPin, 0, zb), A, DV, { ...ro, supports: ['tip-block', tip.id] }));

  // the joists: at each column (past the flange tips, on the web), and every
  // `pitch` along the girder from column 0, clear of the columns, the RBS cuts
  // and the tip link
  const joists: Joist[] = [];
  const js = fr.joist;
  if (js) {
    const sides: V[] = [mul(A, -1), A];
    const padOf = (ci: number, side: V) => {
      const dp = ci ? fr.doubler1 : st.doubler;
      return dp && (dp.n === 2 || side[0] < 0) ? dp.t : undefined; // n 1: on the -x side (details() in generate.ts)
    };
    const clear = col.d / 2 + (bay.rbs ? bay.rbs.a + bay.rbs.b : 0) + js.sec.bf / 2 + 50;
    const stations: { s: number; col?: number; arm?: number }[] = at.map((s, ci) => ({ s, col: ci }));
    for (let s = js.pitch; s < sPin - 2 * DV - js.sec.bf; s += js.pitch) {
      const near = at.some((c) => Math.abs(s - c) < clear);
      if (!near) stations.push({ s, arm: s < span ? 0 : 1 });
    }
    stations.sort((a, b) => a.s - b.s);
    let n = 0;
    for (const q of stations)
      for (const side of sides) {
        const pad = q.col !== undefined ? padOf(q.col, side) : undefined;
        joists.push({ id: `joist${++n}`, ...(q.col !== undefined ? { col: q.col } : { arm: q.arm }), o: P(q.s, 0, zt), side, from: q.col !== undefined ? col.bf / 2 + JOIST_GAP : 0, out: js.out, ...(pad ? { pad } : {}) });
      }
  }

  // the slab: on the bay from column 0 to column 1, with an opening at each,
  // then on the cantilever up to the tip link
  const slab: SlabBeam[] = [
    { id: bay.id, z: bay.z, o: P(0, 0, bay.z), h, end: span, holes: [0, span] },
    { id: tip.id, z: tip.z, o: P(span, 0, tip.z), h, from: 0, end: sPin - span - 1.3 * DV - TIP_GAP },
  ];
  return { below, above, joists, slab };
}

const rect = (w: number, h: number): P2[] => [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
