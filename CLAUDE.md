# CLAUDE.md

Steel structures from a seed, drawn as technical line drawings (SVG with hidden lines removed), with a 3D view and a build animation. Read `README.md` first: it explains every part.

It comes from `resslab-hub` (`tools/steel-generator`, branch `feat/simulator-steel-structure`), moved here with its history in November 2026. RESSLab Hub uses it for its logo (RESSLab-Team/resslab-hub#263) through an exported SVG, not as a dependency. Later it may be a package for a loading animation and a view of each experiment. So keep the core (sections, generate, steel, the painter renderer) free of three.js: only `hlr.ts` and `webgl.ts` load it.

## Commands

Node 24 or newer runs the `.ts` files directly. Imports keep the `.ts` extension.

```sh
pnpm install              # once
node --test               # solver tests, and no clash and no floating part on 240 structures
node build-playground.ts  # playground.html, one page with sliders (build output, never commit it)
node cli.ts --seed 5 --view iso --out s5.svg
node pick.ts --count 150 --top 12 --sheet best.html
```

Run `node --test` after every change to `generate.ts`, `steel.ts` or `clash.ts`.

## Rules

- AISC copyright: the AISC Steel Sculpture drawings and plans are AISC's work. Never commit or publish anything taken from them. Only generic kinds of steel details (splices, gussets, clevis, trusses) go into the generator.
- `sections/*.csv` are copies of the RESSLab Hub tables. Change them in the hub first, then copy them here.
- Commits use Conventional Commits.
