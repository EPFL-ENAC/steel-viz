# Steel generator (spike)

A test for the hub logo (#263). It builds a steel structure from a seed: one column on a base plate, with arms, braces and secondary beams. A small frame solver checks that the structure stands up. If it does not, the generator adds a brace or changes a pinned connection to a moment connection. Then it sizes each member from the hub's own AISC or EU section tables (`frontend/src/assets/connection/` and `frontend/src/assets/hss/`).

Parts must not go through each other. A secondary beam is coped (its flanges cut back) where it meets the flanges of its arm, and its plate fits between those flanges. A brace stays above the arms under it on the same side, and is long enough that its two gussets don't touch. `clash.ts` checks this with boxes, and `geometry.test.ts` runs it on 120 structures.

The output is an SVG line drawing with the hidden lines removed. The SVG can also build itself step by step, as an animation.

Two renderers:

- `hlr.ts` (the default): exact hidden lines, from [three-edge-projection](https://github.com/gkjohnson/three-edge-projection). It takes 50 to 150 ms for one structure.
- `render` in `steel.ts` (`--painter`): the painter's trick, from `sculpture_render.py` on `feat/logo-aisc`. About 5 ms, but some lines are wrong. The playground uses it only while you drag the view sliders.

The exact renderer draws like a technical drawing:

- Two line weights. Outlines are thick (9 mm at the drawing scale) and inner edges are thin (4 mm). To find an outline, it looks just beside each line, on both sides. The line is an outline when one side sees nothing, a surface more than 50 mm further back, or another part behind it. So each part keeps its own outline, a plate on a flange too.
- Gaps. A line that goes behind something stops a little before it, so the depth reads better. The gap is as wide as an outline.
- No double lines. Lines that lie on top of each other in the same part are merged, and a thin line under a thick one is removed.
- Widths for a size. `--size 96` (or "96 px" in the playground) says the drawing will be shown 96 px wide. Then the outlines are 2 px and the inner lines 1 px, so a small logo keeps readable lines. Small drawings also show less: no bolts at 160 px or less, no plates at 64 px or less, no secondary beams at 40 px or less (`DETAIL` in `steel.ts`).

`--flat` (or "One weight" in the playground) draws every line at one width, as before, with no gaps.

The build animation (`--animate`) shows the parts put in place, like on a site. The column comes down from above. Each beam slides in from outside the frame, along its own axis, after its plates. Then its bolts pop in one by one. Each part has a `kind` and a `from` direction for this (set in `generate.ts`), and `timeline()` in `steel.ts` says when each part moves and lands. A line that a later part hides stays visible until that part lands. While a beam moves, its lines are already cut where other parts will hide it at the end, so a small hole can move with it.

To find a structure that works as a logo, `score.ts` gives each one a score from 0 to 1. It looks at the big shapes from the chosen view: do they fill a square, does the weight sit on the column, how many members, how many members cross each other. `pick.ts` scans many seeds and lists the best ones (450 structures take about 2 s). In the playground, "Find good seeds" does the same for 200 seeds and shows the best 8.

```sh
node pick.ts --count 150 --arms 4,5,6 --top 12 --sheet best.html  # best.html shows the 12 best drawings
```

It needs Node 24 or newer. Node runs the `.ts` files directly. Install the deps once (three.js, three-mesh-bvh, three-edge-projection, esbuild for the playground):

```sh
cd tools/steel-generator
pnpm install                                          # once
node --test                                           # solver and geometry tests
node cli.ts --seed 5 --view iso --frames --out s5.svg # one structure, plus build frames
node build-playground.ts                              # writes playground.html, one page with sliders
```

three-edge-projection is not on npm, it comes from GitHub (tag `v0.0.11`). Import `three-edge-projection/src/ProjectionGenerator.js`, not the package root: the root also loads `SilhouetteGenerator`, which needs `clipper2-js`. The library works in metres: it only looks for faces up to 1000 units in front of an edge. So `hlr.ts` turns mm into m before it calls it.

Files:

- `vec.ts`: vector helpers.
- `sections.ts`: section properties and the CSV tables.
- `solver.ts`: 3D frame solver (6 DOF per node, pinned ends, finds mechanisms).
- `generate.ts`: topology, the fix loop and the sizing.
- `steel.ts`: geometry (profiles, copes, plates, bolts), camera and the painter renderer.
- `clash.ts`: do two parts go through each other (each part as a few boxes).
- `score.ts`, `pick.ts`: the logo score, and the scan over many seeds.
- `hlr.ts`: the exact hidden-line renderer, with bolt heads as real hex solids.
- `cli.ts`, `build-playground.ts`, `playground.entry.ts`, `playground.template.html`: command line and playground page. `build-playground.ts` bundles `playground.entry.ts` with esbuild.

`playground.html` and the SVGs are build output, they stay out of git.
