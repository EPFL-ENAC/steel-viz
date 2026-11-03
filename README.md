# steel-viz

Steel structures drawn like a technical drawing, with a 3D view and a build animation. It started as a test for the RESSLab Hub logo (RESSLab-Team/resslab-hub#263).

What RESSLab Hub uses it for:

- Now: the logo. The hub takes an exported SVG, not this code.
- Next: the build animation as a loading animation, then a view of each experiment in the hub. For that, the repo is also a package with two entries (see "Use as a package" below). The input for the experiments is ready: `--specimen` draws a beam-to-column test from its real sections, not from a seed (see below).

What comes next is in [ROADMAP.md](ROADMAP.md).

It builds a steel structure from a seed, in one of three forms:

- Tree: one column on a base plate, with arms, braces and secondary beams.
- Portal: two columns with beams between them, on one or two storeys, and a few arms out of the columns.
- Box: four columns in a rectangle. Beams and braces stay in its four walls, nothing sticks out of them.

Each bay storey gets its own bracing: none (moment connections), knee braces at both ends, a chevron (two braces up to the middle of the beam) or one diagonal. `--form` picks the form (`mix` lets the seed pick it, a tree seed gives the same tree in both).

A small frame solver checks that the structure stands up. If it does not, the generator adds a brace or changes a pinned connection to a moment connection. Then it sizes each member from the AISC or EU section tables of RESSLab Hub. They are copied in `sections/` (from `frontend/src/assets/connection/` and `frontend/src/assets/hss/` in the hub). Copy them again when the hub changes them.

The sizing works in two steps, with public formulas from EC3 (Eurocode 3) and AISC 360-22:

1. The whole structure: the solver finds the elastic critical load factor `alphaCr`. It is how many times the load the structure takes before it buckles as a whole (a buckling analysis with the geometric stiffness, in `solver.ts`). The moments are then multiplied by `1 / (1 - 1/alphaCr)`, for the sway effects (EC3 5.2.2). This rule needs `alphaCr >= 3`. If it is lower, the member with the most strain energy in the buckling mode gets a heavier section, and the solver runs again.
2. Each member, in `checks.ts`: flexural buckling (AISC E3), lateral torsional buckling of I sections (F2), weak axis bending (F6), and the two together with the axial force (H1-1). The buckling length is the member length, because step 1 already has the sway. The ratio must stay under 0.6. There are no AISC phi factors, the 0.6 is the margin.

Not checked: shear, local buckling of thin plates (E7, F3), torsional buckling (E4), and notional loads (the small side loads for the frame imperfections). Cb is 1, which is on the safe side for cantilevers. The same AISC formulas size the EU sections too. A few trees with a cantilever truss stay under `alphaCr` 3 (2 of the 240 seeds of the tests): the bottom chord sways out of the truss plane, and nothing braces it sideways. The log says it.

Then come the small details, from a random draw of their own, so a seed keeps the same structure:

- Column splice (on about a third of the structures): above a free level between 30 and 70 % of the height, the columns change to a lighter section, sized from the forces up there. A bearing splice is a cap plate and a base plate bolted at the corners. A flange splice has bolted plates on both flanges and on the web, with fill plates when the two sections don't have the same depth.
- A cap plate on top of each column.
- Continuity plates: plates across the column, at the flange levels of each moment beam that lands on a column flange.
- Stiffeners in a beam, over the point where a brace pushes on it.
- Gussets at the column foot: none, on the two flange faces, or on all four faces.

Trusses and tension rods also come from a draw of their own, after the fix loop:

- Truss: a beam gets a bottom chord 700 to 900 mm under it, with tube diagonals in a zigzag between the two. In a bay, both ends of the zigzag are on the bottom chord. On an arm, it ends at the tip on the top chord. The truss takes the place of the braces of that beam. A box beam gets a truss less often than a portal beam, because a box has 4 to 8 bay beams. A tree arm gets a lower truss, 450 to 650 mm, so it fits above the arm below it on the same face. It ends at the tip, on the top chord. Its diagonals have a small gusset with one row of 2 bolts. On seeds 1 to 40, a truss comes on 4 or 5 trees (it depends on the family), 11 portals and 12 boxes.
- Tension rod: a round bar from the column down to the top of an arm that sticks out, with a clevis (a fork and a pin) at each end. Only on an arm with no braces, and only when the column has room above it, under the next arm and its braces.

The solver checks the structure again with them and sizes the chords, the diagonals and the rods. If the structure does not stand up anymore, they are left out.

Then come posts and beam splices, each from a draw of its own (`postP` and `beamSpliceP` in `Params`, 0.3 each). With both at 0, a seed gives the same parts as before they existed.

- Post: a short column, 400 to 900 mm high, on the top flange of a beam. It has a base plate bolted to the flange with 4 bolts, and a cap plate. It is free at the top. It goes on an arm that sticks out (with no rod and no truss, and only if the column has room above it), or on a bay beam of the top storey. At most 2 in a structure. Its flanges are not wider than the beam flange. The solver takes it: it is fixed on the beam, and it brings the load of 800 mm of beam as a point load at its top. The solver sizes it, and if the structure does not stand up with the posts, they are left out.
- Beam splice: a bay beam of 2000 mm or more, with no truss, is cut in two pieces. Bolted plates on both flanges and on the web join them, the same plates as a flange splice of a column. The cut is between 20 and 40 % of the span from one end, where the moment is small, and clear of the end plates, the braces, the secondary beams and a post. A box gets it less often, because it has many bay beams. It is a full strength splice, so the solver keeps the beam in one piece.

A detail plate that would go through another part is left out. For example, a continuity plate on the side of the web where another beam frames in.

Parts must not go through each other. A secondary beam is coped (its flanges cut back) where it meets the flanges of its arm, and its plate fits between those flanges. A brace stays above the arms under it on the same face of its column, and is long enough that its two gussets don't touch. `clash.ts` checks this with boxes, and `geometry.test.ts` runs it on every form, 240 structures.

It can also draw a real test of RESSLab Hub instead of a seed: a specimen. For now it draws a beam-to-column subassembly (the test of one connection): one column on a base plate, with one or two beams. That's what the `connection` table of the hub describes, 99 of its 100 tests.

The sections are the real ones, so there is no fix loop and no sizing. The solver runs once, and the log gives `alphaCr` and the max ratio under `--load`, only as information. The cap plate and the continuity plates are drawn. Splices, foot gussets, trusses, rods and posts are not.

`specimen.ts` reads two kinds of JSON file. The first one is a record of the hub `connection` table, as the hub API gives it (numbers, `null`) or as a row of `connections.csv` (strings, `NA`). A file with a `specimen_type` is a hub record. The two files in `specimens/` are hub records (resslab-hub-data is public domain). The second one is our own `Specimen`, for a test that is not in the hub:

```json
{
  "id": "my-test",
  "family": "eu",
  "column": { "section": "HEB 300", "height": 2500 },
  "beams": [
    { "section": "IPE 360", "bearing": 0, "length": 1600, "connection": "welded" },
    { "section": { "id": "H 300x150x7x10", "d": 300, "bf": 150, "tf": 10, "tw": 7 },
      "bearing": 90, "length": 1200, "at": 1600, "connection": "end_plate" }
  ]
}
```

- `section`: a name from the table of `family` (`W14x82` and `HEB 300` work, written the hub way), a built-up name read as d x bf x tw x tf (`H-700x300x13x24`), or the dimensions in mm. With a name, the full table is used, also the deep W sections that the random generator never takes.
- `bearing`: 0 and 180 put the beam on a column flange, 90 and 270 on the web.
- `length`: from the column axis to the beam tip, in mm.
- `at`: the height of the beam centre line above the column foot. By default, half the column height.
- `connection`: `shear_tab`, `end_plate`, `flange_plates` or `welded`. A beam alone on a shear tab is a mechanism: the log says so, and the drawing still comes out.
- `continuity: false` leaves out the continuity plates. `beams: []` gives a column alone.

From a hub record:

- The sections come from the numbers (`d_c b_cf t_cf t_cw`, `d_b b_bf t_bf t_bw`), not from the names. The names are free text (`build up H section`) and don't link to the section tables.
- An exterior test has one beam of length `l_b`. An interior test has two, one on each flange, `l_b / 2` each (there `l_b` is the whole span). The beams are at half the column height `h_c`.
- `t_cp` 0 means no continuity plates.
- The connection is the closest one we can draw:

| hub | drawn as | not drawn yet |
|---|---|---|
| WUF-W | welded | |
| WUF-B | welded | the bolted shear tab on the beam web |
| RBS | welded | the cut in the beam flanges |
| BFP | flange plates | |
| WFP | flange plates | the plates are welded, we draw them bolted |
| BEEP | end plate | |
| KBB | flange plates | the Kaiser bracket |

What we draw differently from the real test goes into the log as a note: the connection, the doubler plates (`n_dp`) and the slab. A test that is not a subassembly ("Exterior - Frame"), or a missing number, throws an error that names the field.

```sh
node cli.ts --specimen specimens/Chi_and_Uang_2002_DC2.json --view iso   # writes steel-Chi_and_Uang_2002_DC2-iso.svg
```

`--specimen` takes the same drawing options as a seed (`--view`, `--detail`, `--animate`, `--frames`, `--painter`, `--size`). The family comes from `--family`, else from the file, else aisc. `--seed`, `--form`, `--arms` and `--height` don't apply. `specimen.test.ts` covers the two hub files, the format and the errors.

The output is an SVG line drawing with the hidden lines removed. The SVG can also build itself step by step, as an animation.

Two renderers:

- `hlr.ts` (the default): exact hidden lines, from [three-edge-projection](https://github.com/gkjohnson/three-edge-projection). It takes 50 to 150 ms for one structure.
- `render` in `steel.ts` (`--painter`): the painter's trick, ported from `sculpture_render.py` (resslab-hub, branch `feat/logo-aisc`). About 5 ms, but some lines are wrong. The playground uses it only while you drag the view in an SVG mode.

The playground also has a 3D view (`webgl.ts`, the "3D" choice, on by default). It is for looking at the structure, not for export. It runs in WebGL with three.js, and builds the geometry once per structure, so you can turn it, move it and zoom with every bolt shown, at the frame rate of the screen. Faces are filled with the background and the GPU depth buffer hides the hidden lines. Edges are thin lines. A second pass gives the thick outlines with the same rule as `hlr.ts` (a jump in depth over 50 mm, or another part behind), read from a depth and part-id texture. That pass works per pixel, so it runs at about 3 samples per CSS px (2x on a 1x screen) and is averaged down, or the outlines would show stair steps. Bolt heads get thin lines only. The build animation plays in 3D too, on the same `timeline()`. The lines are close to the exact drawing but not the same (no gaps, no merged lines). "Copy SVG" always gives the exact drawing from `hlr.ts`, for the current view.

The "3D / SVG / Both" switch picks the viewer. "SVG" shows the exact drawing, at full size or at a px size. "Both" puts the 3D view on the left and the exact drawing on the right, with the same view. When you turn one, the other follows. While you drag, the SVG uses the fast painter drawing, then the exact one when you let go.

In the 3D view: drag to turn, right drag (or shift drag) to move, the wheel or two fingers to zoom, double click to see the whole structure again. The view sliders follow.

The exact renderer draws like a technical drawing:

- Two line weights. Outlines are thick (9 mm at the drawing scale) and inner edges are thin (4 mm). To find an outline, it looks just beside each line, on both sides. The line is an outline when one side sees nothing, a surface more than 50 mm further back, or another part behind it. So each part keeps its own outline, a plate on a flange too.
- Gaps. A line that goes behind something stops a little before it, so the depth reads better. The gap is as wide as an outline.
- No double lines. Lines that lie on top of each other in the same part are merged, and a thin line under a thick one is removed.
- Widths for a size. `--size 96` (or "96 px" in the playground) says the drawing will be shown 96 px wide. Then the outlines are 2 px and the inner lines 1 px, so a small logo keeps readable lines. Small drawings also show less: no bolts at 160 px or less, no plates at 64 px or less, no secondary beams at 40 px or less (`DETAIL` in `steel.ts`).

`--flat` (or "One weight" in the playground) draws every line at one width, as before, with no gaps.

The build animation (`--animate`) shows the parts put in place, like on a site. The columns come down from above. An arm slides in from outside the frame, along its own axis, after its plates. A bay beam is lowered between its two columns. Then the bolts pop in one by one. A part waits only for the parts it stands on, and up to three beams can fly in at the same time (`CRANES` in `steel.ts`), so a big structure builds in about 4 s. Each part has a `kind` and a `from` direction for this (set in `generate.ts`), and `timeline()` in `steel.ts` says when each part moves and lands. A line that a later part hides stays visible until that part lands. While a beam moves, its lines are already cut where other parts will hide it at the end, so a small hole can move with it.

To find a structure that works as a logo, `score.ts` gives each one a score from 0 to 1. It looks at the big shapes from the chosen view: do they fill a square, does the weight sit on the columns, how many members, how many members cross each other. `pick.ts` scans many seeds and lists the best ones (450 structures take about 2 s). In the playground, "Find good seeds" does the same for 200 seeds and shows the best 8.

```sh
node pick.ts --count 150 --arms 4,5,6 --top 12 --sheet best.html  # best.html shows the 12 best drawings
```

It needs Node 24 or newer. Node runs the `.ts` files directly. Install the deps once (three.js, three-mesh-bvh, three-edge-projection, and Vite and Vue for the playground):

```sh
pnpm install                                          # once
node --test                                           # solver, member checks and geometry tests
pnpm run type-check                                   # checks the types (Node only strips them)
node cli.ts --seed 5 --view iso --frames --out s5.svg # one structure, plus build frames
pnpm dev                                              # the playground, with live reload
pnpm build                                            # the playground as a static site in dist/
```

three-edge-projection is not on npm, it comes from GitHub (tag `v0.0.11`). Import `three-edge-projection/src/ProjectionGenerator.js`, not the package root: the root also loads `SilhouetteGenerator`, which needs `clipper2-js`. The library works in metres: it only looks for faces up to 1000 units in front of an edge. So `hlr.ts` turns mm into m before it calls it.

Files:

- `vec.ts`: vector helpers.
- `sections.ts`: section properties and the CSV tables, plus the round rods (not in the hub tables).
- `sections/`, `tables.ts`: the CSV tables, and how Node reads them.
- `solver.ts`: 3D frame solver (6 DOF per node, pinned ends, finds mechanisms), and the buckling analysis (`alphaCr`).
- `checks.ts`: the member checks (AISC 360-22 E3, F2, F6, H1-1).
- `generate.ts`: topology, the fix loop, trusses and rods, posts and beam splices, and the sizing. Also the specimen path (`buildSpecimen`).
- `specimen.ts`, `specimens/`: a real test as input (the `Specimen` type, the section lookup, the hub record reader), and two hub records as examples and test data.
- `steel.ts`: geometry (profiles, copes, plates, clevis, bolts), camera and the painter renderer.
- `clash.ts`: do two parts go through each other (each part as a few boxes).
- `score.ts`, `pick.ts`: the logo score, and the scan over many seeds.
- `hlr.ts`: the exact hidden-line renderer, with bolt heads as real hex solids.
- `webgl.ts`: the 3D view of the playground.
- `three-edge-projection.d.ts`: types for the part of three-edge-projection that `hlr.ts` uses (the library ships none).
- `cli.ts`: the command line.
- `app/`, `vite.config.ts`: the playground, a Vue app served by Vite.
- `index.ts`, `3d.ts`: the two entries of the package (see below).
- `package.test.ts`: checks that the light entry loads no three.js, no other package and no Node API.
- `tsconfig.lib.json`, `release.sh`: the package build, and the release tag.

`dist/`, `lib/` and the SVGs are build output, they stay out of git. `lib/` is only in the commit of a release tag.

## Use as a package (RESSLab Hub)

The repo is also the package `@epfl-enac/steel-viz`. It is not on npm. The hub takes it from a git tag:

```json
"@epfl-enac/steel-viz": "github:EPFL-ENAC/steel-viz#v0.1.0"
```

It has two entries:

- `@epfl-enac/steel-viz`: the light entry. `generate`, `loadCatalog`, the painter `render`, `timeline`, `camera`, `VIEWS`, and the specimen input (`toSpecimen`, `fromHubConnection`). It loads no three.js and no other package. `package.test.ts` checks it. Use it for the loading animation.
- `@epfl-enac/steel-viz/3d`: `renderHLR` (the exact drawing) and `createViewer` (the WebGL view). It loads three.js. Import it with a dynamic `import()`, only on the page that needs it, so three.js stays out of the main bundle.

The package has no section table. The hub has the same CSV files (ours are copies of them), so it passes their text to `loadCatalog()`:

```ts
import iCsv from '@/assets/connection/aisc-sections.csv?raw';
import hssCsv from '@/assets/hss/hss-aisc-sections.csv?raw';
import { generate, loadCatalog, render, VIEWS } from '@epfl-enac/steel-viz';

const catalog = loadCatalog('aisc', iCsv, hssCsv);
const { parts } = generate({ seed: 5 }, catalog);
const [az, el] = VIEWS.iso;
const { svg } = render(parts, { az, el, animate: true }); // an SVG that builds itself with CSS
```

For the EU family, pass `european-sections.csv` and `hss-european-sections.csv` with `'eu'`. A test of the hub goes through `fromHubConnection(record)`, then `generate({ specimen }, catalog)`.

The 3D entry needs three.js, three-mesh-bvh and three-edge-projection. They are optional peer dependencies, so the light entry installs none of them. To use the 3D entry, the hub adds them itself, with the versions of our `package.json`:

```json
"three": "0.187.0",
"three-mesh-bvh": "0.9.17",
"three-edge-projection": "github:gkjohnson/three-edge-projection#v0.0.11"
```

three-edge-projection asks for `clipper2-js` as a peer, and pnpm installs missing peers by default (with Angular for clipper2-js). We don't use it. So in `frontend/pnpm-workspace.yaml` of the hub, make it optional:

```yaml
packageExtensions:
  three-edge-projection:
    peerDependenciesMeta:
      clipper2-js:
        optional: true
```

Then:

```ts
const { createViewer } = await import('@epfl-enac/steel-viz/3d');
```

### How the package is built and released

`pnpm run build:lib` runs `tsc` with `tsconfig.lib.json`. It writes one JS file and one `.d.ts` file per module into `lib/`, only for the modules that the two entries import. `lib/` is never committed on `main`. Only the commit of a release tag has it, so the hub install needs no build. Never add a `prepare` or `prepack` script: pnpm would run it when it installs the git dependency.

To make a release (a human does it):

1. Bump `version` in `package.json` in a normal pull request, and merge it.
2. In the main checkout, on `main`, run `./release.sh 0.1.0`. It checks that `main` is clean and the same as `origin/main`, runs the tests, builds `lib/`, and makes a commit on top of `main` with `lib/` in it. Then it tags that commit `v0.1.0`. `main` doesn't move, and it pushes nothing.
3. `git push origin v0.1.0`. CI runs on the tag too, and checks that the `lib/` of the tag is the same as a fresh build.
4. Change the version in the dependency line of the hub.

## Playground and worktrees

`pnpm dev` serves the playground on `PLAYGROUND_PORT` (5180 when it is not set). With wtx, each worktree runs it in its own `playground` pane, on its own port. `wtx open playground` opens it.

- It reloads on each save. A change in `app/` is a hot reload. A change in the generator, a renderer or a table reloads the page.
- The settings (seed, form, view, viewer...) live in the URL hash. A reload keeps them, and you can send the link.
- Above the controls: the branch, its commit, and if it has changes not committed.
- The "vs main" viewer draws the same structure twice: with this checkout on the left, and with the code of `main` on the right (the merge base, so only what the branch changed). The title block says "same drawing" or what differs. `PLAYGROUND_BASE` picks another base branch. That code comes from `git archive`, in `node_modules/.cache/steel-viz-base/`.
