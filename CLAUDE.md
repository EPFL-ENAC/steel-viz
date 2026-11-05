# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Steel structures from a seed, drawn as technical line drawings (SVG with hidden lines removed), with a 3D view and a build animation. Read `README.md` first: it explains every part. `ROADMAP.md` lists what comes next.

It comes from `resslab-hub` (`tools/steel-generator`, branch `feat/simulator-steel-structure`), moved here with its history in November 2026. RESSLab Hub uses it for its logo (RESSLab-Team/resslab-hub#263) through an exported SVG, not as a dependency. Later it may be a package for a loading animation and a view of each experiment. The package loads no other package: `hlr.ts` has its own hidden line removal and `webgl.ts` is plain WebGL2. `package.test.ts` checks it: the light entry `index.ts` and the 3D entry `3d.ts` must load no package and no Node API.

## Commands

Node 24 or newer runs the `.ts` files directly. Imports keep the `.ts` extension.

```sh
pnpm install              # once
node --test               # solver tests, no clash and no floating part on 240 structures, the specimens, the hub tables (about 22 s)
pnpm run type-check       # tsc, strict, no emit (about 0.2 s)
node --test solver.test.ts                         # one file
node --test --test-name-pattern "clash|support"    # some tests by name
pnpm dev                  # the playground (Vue app in app/) with live reload, on PLAYGROUND_PORT or 5180
pnpm build                # the playground as a static site in dist/ (build output, never commit it)
pnpm run build:lib        # the package (index.ts, 3d.ts) as JS and .d.ts in lib/ (only a release tag has it, see release.sh)
node cli.ts --seed 5 --view iso --out s5.svg       # also --form, --family eu, --shapes 0..1, --round-tubes 0..1, --animate, --frames, --painter, --size 96
node cli.ts --seed 5 --storeys 2 --bracing chevron --conn welded --span 1.4 --arm-length 0.5,0.9   # the look settings, see Params in generate.ts
node pick.ts --count 150 --top 12 --sheet best.html
node pick.ts --by variety --top 12 --sheet v.html  # sort by the kinds of detail (score.ts), or --by mix
node cli.ts --specimen specimens/Chi_and_Uang_2002_DC2.json --view iso   # a real test from a JSON file (specimen.ts)
node hub-count.ts         # how many tests of each hub table we draw (needs resslab-hub-data next to the repo, or give its path)
```

Run `node --test` after every change to `generate.ts`, `gable.ts`, `steel.ts`, `skew.ts`, `clash.ts`, `bench.ts`, `rig.ts`, `hub.ts` or `deform*.ts`. `cli.ts` prints the solver log, the part count and `FLOATING` if a part comes before the part it stands on. It's the fastest way to look at one seed.

Node only strips the types. `pnpm run type-check` checks them (`tsc` with `tsconfig.json`, no emit). CI runs `node --test`, then the type check, on every push and pull request. `erasableSyntaxOnly` refuses TypeScript that Node can't strip (no `enum`, no `namespace`, no constructor parameter properties). There is no linter.

## How it fits together

1. `sections.ts` turns the CSV tables into a `Catalog`. In Node, `tables.ts` reads `sections/`. In the playground, `app/state.ts` imports the CSV files with `?raw`.
2. `generate(params, catalog)` in `generate.ts` builds a `Structure` (topology), then loops: `solve()` from `solver.ts`, `fix()` on a mechanism, `size()` from the forces. On a tree, `skewArms()` first turns some arms off a flange face (`skew.ts` draws their cut end and end plate). A one storey portal can get a pitched roof first (`gable.ts`: the draw, the solver model, the parts, called from small hooks). Then it adds trusses and rods, then the details (splice, base gussets). Last, `parts()` turns the structure into `Part[]` with the geometry helpers of `steel.ts`. With `params.specimen` (a real test, from `specimen.ts`), `generate()` skips all that. A beam-to-column test goes to `buildSpecimen()`: it builds the given column and beams, solves once with no fix and no sizing, adds the cap and continuity plates, then calls `parts()`. A brace or column test goes to `buildBrace()` or `buildColumn()` in `bench.ts`, with no solve. All of them draw the test rig with `rig.ts` (parts of kind `rig`, drawn lighter). `hub.ts` reads a record of a hub table as a `Specimen`: `toSpecimen()` picks the reader from a field that only this table has. A reader throws in two forms only, `<id>: <field> is missing` and `<id>: <field> "<value>" is not supported yet`. Keep them when you add a reader: `hub-count.ts` groups the errors by them.
3. A `Part` (type in `steel.ts`) is what every renderer takes: faces in mm, bolts as `dots`, `step` (build order), `supports` (ids of the parts it stands on), `boxes` (for `clash.ts`), `kind` and `from` (for the animation), `round` (it has a round bar: the 3D view outlines it, set where the bar is built with `isRound()`).
4. Three renderers take `Part[]`: `render` in `steel.ts` (painter, fast, sometimes wrong), `renderHLR` in `hlr.ts` (exact, the default, the only one for export), `createViewer` in `webgl.ts` (3D view of the playground). All of them share `camera()` and `timeline()` from `steel.ts`, so the views and the animation match.
5. The package has two entries. `index.ts` (`@epfl-enac/steel-viz`) re-exports the core: generate, loadCatalog, `renderHLR`, the painter render, timeline, the specimen input (`toSpecimen` and the readers of `hub.ts`). `3d.ts` (`@epfl-enac/steel-viz/3d`) re-exports `createViewer`. The package has no dependency. The hub passes its own CSV text to `loadCatalog()`, the package ships no table. When you export something new for the hub, add it to `index.ts` (or `3d.ts` if it is part of the 3D view).
6. The playground is a Vue 3 app in `app/`, served by Vite (`vite.config.ts`). It imports the core modules directly. `app/state.ts` holds the settings and keeps them in the URL hash, `Drawing.vue` draws (3D, SVG, both, or vs main). `app/dev-plugin.ts` is for the dev server only: the branch info, the "vs main" bundle (the merge base with `main`, from `git archive`), the hub tables at `/__dev/hub` (read only, from the folder `findHubData()` finds), and a full reload when a file outside `app/` changes. `app/tests.ts` is the hub test mode of the playground (`specimen=<table>/<id>` in the hash): it loads the tables, reads every row with `toSpecimen()`, and `fetchRecord()` is the one place that fetches a test.
7. The deformed shape of a hub test: `deform.ts` has what all tables share (`Move`, `readResponse`, `protocol`), `DEFORMS` in `deforms.ts` lists the tables, `deform-connection.ts` is the first one. `viewer.deform(state)` in `webgl.ts` bends in the vertex shader: its `MOVE` chunk and `movePoint()` must stay the same math. `app/response.ts` holds the step and the shape, `app/Response.vue` is the control. A new table needs no change in `app/` or `webgl.ts`: the README says what to do. `deform*.ts` must not import `tables.ts` (no Node API). The shape is schematic, the UI must keep saying so.

`hub-count.ts` is a Node script, the core never imports it. It reads every table of `HUB_TABLES` (in `tables.ts`, with `findHubData()`) from `resslab-hub-data` (read only, never write in it) and prints how many tests we draw, with the errors grouped by field. `hub.test.ts` runs the same loop and fails on a clash, a floating part or an error in another form. CI has no copy of the data, so there it is skipped.

Seeds must stay stable. `generate()` uses a separate `mulberry32` random stream for each stage (form, topology, trusses and rods, details). When you add a new random feature, give it its own stream. If it takes draws from the main `rng`, every seed after it changes, and the seeds picked for the logo change too. The shape of a member (`shapeP`: double angle brace, channel secondary, tee chord) is one draw per member, seeded from the seed and the member id (`shaped()` in `generate.ts`), so it doesn't depend on the order of the other draws.

Units are mm everywhere. `hlr.ts` is our own hidden line removal, with no package (its header says how it works). Run `node --test hlr.test.ts` after a change there, and look at a few drawings in the playground ("vs main").

## Rules

- AISC copyright: the AISC Steel Sculpture drawings and plans are AISC's work. Never commit or publish anything taken from them. Only generic kinds of steel details (splices, gussets, clevis, trusses) go into the generator.
- The I and HSS tables in `sections/` are copies of the RESSLab Hub tables. Change them in the hub first, then copy them here. The channel and angle tables are ours until the hub has them: `sections/README.md` says where they come from and how to make them again.
- Commits use Conventional Commits.
- Never add a `prepare` or `prepack` script to `package.json`: pnpm runs them when the hub installs the git dependency. The built `lib/` goes into the release tag only (`release.sh`, run by a human). Never commit `lib/` on a branch, and never create or push a tag.

## Worktrees (wtx)

Every branch has its own git worktree, tmux session and agent. The session is `steel-viz/<branch>` and its panes are `agent`, `playground` and `shell`. The `playground` pane runs `pnpm dev` on the port in `.env.worktree` (`PLAYGROUND_PORT`). Don't start it again. Its log is `.wt-logs/playground.log`. `wtx open playground` opens it, `wtx curl playground /__dev/info` checks it is up.

- Work on this branch only. Never push `main`. When the work is ready, say so and a human runs `wtx land <branch>` from the main checkout.
- A pre-push hook enforces this. If it refuses a push, that is the design, not a bug to work around.

`resslab-hub` is at `../resslab-hub`, access `pair`. You can read it as much as you like, with no prompt, but never write in it. To change it (a section table, the logo SVG), ask for a paired worktree: a human runs `wtx go <branch> --with resslab-hub`, the hub branch is cut from `dev`, and the change lands through a hub pull request.
