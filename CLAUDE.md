# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Steel structures from a seed, drawn as technical line drawings (SVG with hidden lines removed), with a 3D view and a build animation. Read `README.md` first: it explains every part. `ROADMAP.md` lists what comes next.

It comes from `resslab-hub` (`tools/steel-generator`, branch `feat/simulator-steel-structure`), moved here with its history in November 2026. RESSLab Hub uses it for its logo (RESSLab-Team/resslab-hub#263) through an exported SVG, not as a dependency. Later it may be a package for a loading animation and a view of each experiment. So keep the core (sections, generate, steel, the painter renderer) free of three.js: only `hlr.ts` and `webgl.ts` load it.

## Commands

Node 24 or newer runs the `.ts` files directly. Imports keep the `.ts` extension.

```sh
pnpm install              # once
node --test               # solver tests, no clash and no floating part on 240 structures, the specimens (about 4 s)
pnpm run type-check       # tsc, strict, no emit (about 0.2 s)
node --test solver.test.ts                         # one file
node --test --test-name-pattern "clash|support"    # some tests by name
pnpm dev                  # the playground (Vue app in app/) with live reload, on PLAYGROUND_PORT or 5180
pnpm build                # the playground as a static site in dist/ (build output, never commit it)
node cli.ts --seed 5 --view iso --out s5.svg       # also --form, --family eu, --animate, --frames, --painter, --size 96
node pick.ts --count 150 --top 12 --sheet best.html
node cli.ts --specimen specimens/Chi_and_Uang_2002_DC2.json --view iso   # a real test from a JSON file (specimen.ts)
```

Run `node --test` after every change to `generate.ts`, `steel.ts` or `clash.ts`. `cli.ts` prints the solver log, the part count and `FLOATING` if a part comes before the part it stands on. It's the fastest way to look at one seed.

Node only strips the types. `pnpm run type-check` checks them (`tsc` with `tsconfig.json`, no emit). CI runs `node --test`, then the type check, on every push and pull request. `erasableSyntaxOnly` refuses TypeScript that Node can't strip (no `enum`, no `namespace`, no constructor parameter properties). There is no linter.

## How it fits together

1. `sections.ts` turns the CSV tables into a `Catalog`. In Node, `tables.ts` reads `sections/`. In the playground, `app/state.ts` imports the CSV files with `?raw`.
2. `generate(params, catalog)` in `generate.ts` builds a `Structure` (topology), then loops: `solve()` from `solver.ts`, `fix()` on a mechanism, `size()` from the forces. Then it adds trusses and rods, then the details (splice, base gussets). Last, `parts()` turns the structure into `Part[]` with the geometry helpers of `steel.ts`. With `params.specimen` (a real test, from `specimen.ts`), `generate()` skips all that: `buildSpecimen()` builds the given column and beams, solves once with no fix and no sizing, adds the cap and continuity plates, then calls `parts()`.
3. A `Part` (type in `steel.ts`) is what every renderer takes: faces in mm, bolts as `dots`, `step` (build order), `supports` (ids of the parts it stands on), `boxes` (for `clash.ts`), `kind` and `from` (for the animation).
4. Three renderers take `Part[]`: `render` in `steel.ts` (painter, fast, sometimes wrong), `renderHLR` in `hlr.ts` (exact, the default, the only one for export), `createViewer` in `webgl.ts` (3D view of the playground). All of them share `camera()` and `timeline()` from `steel.ts`, so the views and the animation match.
5. The playground is a Vue 3 app in `app/`, served by Vite (`vite.config.ts`). It imports the core modules directly. `app/state.ts` holds the settings and keeps them in the URL hash, `Drawing.vue` draws (3D, SVG, both, or vs main). `app/dev-plugin.ts` is for the dev server only: the branch info, the "vs main" bundle (the merge base with `main`, from `git archive`), and a full reload when a file outside `app/` changes.

Seeds must stay stable. `generate()` uses a separate `mulberry32` random stream for each stage (form, topology, trusses and rods, details). When you add a new random feature, give it its own stream. If it takes draws from the main `rng`, every seed after it changes, and the seeds picked for the logo change too.

Units are mm everywhere. `hlr.ts` converts to metres before it calls three-edge-projection (see the README). Import `three-edge-projection/src/ProjectionGenerator.js`, not the package root. The library ships no types: `three-edge-projection.d.ts` types the part `hlr.ts` uses. If `hlr.ts` uses more of it, add it there.

## Rules

- AISC copyright: the AISC Steel Sculpture drawings and plans are AISC's work. Never commit or publish anything taken from them. Only generic kinds of steel details (splices, gussets, clevis, trusses) go into the generator.
- `sections/*.csv` are copies of the RESSLab Hub tables. Change them in the hub first, then copy them here.
- Commits use Conventional Commits.

## Worktrees (wtx)

Every branch has its own git worktree, tmux session and agent. The session is `steel-viz/<branch>` and its panes are `agent`, `playground` and `shell`. The `playground` pane runs `pnpm dev` on the port in `.env.worktree` (`PLAYGROUND_PORT`). Don't start it again. Its log is `.wt-logs/playground.log`. `wtx open playground` opens it, `wtx curl playground /__dev/info` checks it is up.

- Work on this branch only. Never push `main`. When the work is ready, say so and a human runs `wtx land <branch>` from the main checkout.
- A pre-push hook enforces this. If it refuses a push, that is the design, not a bug to work around.

`resslab-hub` is at `../resslab-hub`, access `pair`. You can read it as much as you like, with no prompt, but never write in it. To change it (a section table, the logo SVG), ask for a paired worktree: a human runs `wtx go <branch> --with resslab-hub`, the hub branch is cut from `dev`, and the change lands through a hub pull request.
