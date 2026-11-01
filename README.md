# Steel generator (spike)

A test for the hub logo (#263). It builds a steel structure from a seed: one column on a base plate, with arms, braces and secondary beams. A small frame solver checks that the structure stands up. If it does not, the generator adds a brace or changes a pinned connection to a moment connection. Then it sizes each member from the hub's own AISC or EU section tables (`frontend/src/assets/connection/` and `frontend/src/assets/hss/`).

The output is an SVG with hidden lines removed (painter's trick, from `sculpture_render.py` on `feat/logo-aisc`). The SVG can also build itself step by step, as an animation.

It needs Node 24 or newer, with no install. Node runs the `.ts` files directly.

```sh
cd tools/steel-generator
node --test solver.test.ts                            # solver tests
node cli.ts --seed 5 --view iso --frames --out s5.svg # one structure, plus build frames
node build-playground.ts                              # writes playground.html, one page with sliders
```

Files:

- `vec.ts`: vector helpers.
- `sections.ts`: section properties and the CSV tables.
- `solver.ts`: 3D frame solver (6 DOF per node, pinned ends, finds mechanisms).
- `generate.ts`: topology, the fix loop and the sizing.
- `steel.ts`: geometry (profiles, plates, bolts), camera and SVG renderer.
- `cli.ts`, `build-playground.ts`, `playground.template.html`: command line and playground page.

`playground.html` and the SVGs are build output, they stay out of git.
