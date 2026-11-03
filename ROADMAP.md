# Roadmap

What we plan to do next. Nothing here is started.

## Generator

- [ ] Channel, angle and WT profiles (C, L and T sections), with their own section tables.
- [ ] Bolted beam splice, posts and studs.
- [ ] Trusses on trees. Today a tree never gets one: its arms are too short, too low, or have an arm below them on the same face. Allow a lower truss there.
- [ ] Fewer trusses on boxes. Boxes get one on 32 of 40 seeds. Try a lower `TRUSS_P.bay` in `generate.ts`.

## Use in RESSLab Hub

Today the hub only takes an exported SVG for its logo (RESSLab-Team/resslab-hub#263). Later:

- [ ] A light entry point: the painter renderer and `timeline()`, with no three.js. It is for a loading animation in the slow parts of the hub.
- [ ] A separate 3D entry point (`webgl.ts`, `hlr.ts`), loaded only where it is needed.
- [ ] A specimen input: build the structure of a real experiment from its sections, next to the random seed. Then the hub can show a view of each experiment.
- [ ] Ship built JS and `.d.ts` on a git tag, so the hub can depend on it the same way it depends on three-edge-projection (`github:EPFL-ENAC/steel-viz#v0.1.0`).

## Repo

- [ ] TypeScript as a dev dependency, a `tsconfig.json` and a `type-check` script.
- [ ] A LICENSE.
- [ ] A GitHub Actions CI that runs `node --test` (and the type check).
