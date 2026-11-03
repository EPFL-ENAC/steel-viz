# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Steel structures from a seed, drawn as technical line drawings (SVG with hidden lines removed), with a 3D view and a build animation. Read `README.md` first: it explains every part. `ROADMAP.md` lists what comes next.

It comes from `resslab-hub` (`tools/steel-generator`, branch `feat/simulator-steel-structure`), moved here with its history in November 2026. RESSLab Hub uses it for its logo (RESSLab-Team/resslab-hub#263) through an exported SVG, not as a dependency. Later it may be a package for a loading animation and a view of each experiment. So keep the core (sections, generate, steel, the painter renderer) free of three.js: only `hlr.ts` and `webgl.ts` load it.

## Commands

Node 24 or newer runs the `.ts` files directly. Imports keep the `.ts` extension.

```sh
pnpm install              # once
node --test               # solver tests, and no clash and no floating part on 240 structures (about 4 s)
node --test solver.test.ts                         # one file
node --test --test-name-pattern "clash|support"    # some tests by name
node build-playground.ts  # playground.html, one page with sliders (build output, never commit it)
node cli.ts --seed 5 --view iso --out s5.svg       # also --form, --family eu, --animate, --frames, --painter, --size 96
node pick.ts --count 150 --top 12 --sheet best.html
```

Run `node --test` after every change to `generate.ts`, `steel.ts` or `clash.ts`. `cli.ts` prints the solver log, the part count and `FLOATING` if a part comes before the part it stands on. It's the fastest way to look at one seed.

Nothing checks the types: Node only strips them, and there is no `tsconfig.json`, no linter and no CI yet. Use only TypeScript that Node can strip (no `enum`, no `namespace`, no constructor parameter properties).

## How it fits together

1. `sections.ts` turns the CSV tables into a `Catalog`. In Node, `tables.ts` reads `sections/`. In the playground, `build-playground.ts` puts the tables inline in the page.
2. `generate(params, catalog)` in `generate.ts` builds a `Structure` (topology), then loops: `solve()` from `solver.ts`, `fix()` on a mechanism, `size()` from the forces. Then it adds trusses and rods, then the details (splice, base gussets). Last, `parts()` turns the structure into `Part[]` with the geometry helpers of `steel.ts`.
3. A `Part` (type in `steel.ts`) is what every renderer takes: faces in mm, bolts as `dots`, `step` (build order), `supports` (ids of the parts it stands on), `boxes` (for `clash.ts`), `kind` and `from` (for the animation).
4. Three renderers take `Part[]`: `render` in `steel.ts` (painter, fast, sometimes wrong), `renderHLR` in `hlr.ts` (exact, the default, the only one for export), `createViewer` in `webgl.ts` (3D view of the playground). All of them share `camera()` and `timeline()` from `steel.ts`, so the views and the animation match.
5. `playground.entry.ts` puts the functions the page needs on `globalThis`. `playground.template.html` uses them. If the page needs a new function, export it there.

Seeds must stay stable. `generate()` uses a separate `mulberry32` random stream for each stage (form, topology, trusses and rods, details). When you add a new random feature, give it its own stream. If it takes draws from the main `rng`, every seed after it changes, and the seeds picked for the logo change too.

Units are mm everywhere. `hlr.ts` converts to metres before it calls three-edge-projection (see the README). Import `three-edge-projection/src/ProjectionGenerator.js`, not the package root.

## Rules

- AISC copyright: the AISC Steel Sculpture drawings and plans are AISC's work. Never commit or publish anything taken from them. Only generic kinds of steel details (splices, gussets, clevis, trusses) go into the generator.
- `sections/*.csv` are copies of the RESSLab Hub tables. Change them in the hub first, then copy them here.
- Commits use Conventional Commits.

## Worktrees (wtx)

Every branch has its own git worktree, tmux session and agent. The session is `steel-viz/<branch>` and its panes are `agent` and `shell`. There is no dev server and no port: open `playground.html` of your worktree as a file.

- Work on this branch only. Never push `main`. When the work is ready, say so and a human runs `wtx land <branch>` from the main checkout.
- A pre-push hook enforces this. If it refuses a push, that is the design, not a bug to work around.

`resslab-hub` is at `../resslab-hub`, access `pair`. You can read it as much as you like, with no prompt, but never write in it. To change it (a section table, the logo SVG), ask for a paired worktree: a human runs `wtx go <branch> --with resslab-hub`, the hub branch is cut from `dev`, and the change lands through a hub pull request.
