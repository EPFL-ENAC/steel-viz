# Roadmap

What we plan to do next. A checked item is done.

## Generator

- [ ] Channel, angle and WT profiles (C, L and T sections), with their own section tables.
- [ ] Bolted beam splice, posts and studs.
- [ ] Trusses on trees. Today a tree never gets one: its arms are too short, too low, or have an arm below them on the same face. Allow a lower truss there.
- [ ] Fewer trusses on boxes. Boxes get one on 32 of 40 seeds. Try a lower `TRUSS_P.bay` in `generate.ts`.

## Use in RESSLab Hub

Today the hub only takes an exported SVG for its logo (RESSLab-Team/resslab-hub#263). Later:

- [ ] A light entry point: the painter renderer and `timeline()`, with no three.js. It is for a loading animation in the slow parts of the hub.
- [ ] A separate 3D entry point (`webgl.ts`, `hlr.ts`), loaded only where it is needed.
- [x] A specimen input: build the structure of a real experiment from its sections, next to the random seed. Then the hub can show a view of each experiment. Done for beam-to-column tests (`specimen.ts`, `--specimen`), the next steps are under "Specimens".
- [ ] Ship built JS and `.d.ts` on a git tag, so the hub can depend on it the same way it depends on three-edge-projection (`github:EPFL-ENAC/steel-viz#v0.1.0`).

## Specimens

The specimen input draws the beam-to-column tests of the hub `connection` table. Some details are left out, the log lists them as notes. Next:

- [ ] The test rig: pins at the column ends instead of a base plate, and the actuator at the beam tip (or at the column top for a column loaded test). Today the column stands on a base plate, like in a building.
- [ ] RBS: the cut in the beam flanges.
- [ ] WUF-B: the bolted shear tab on the beam web, next to the welded flanges.
- [ ] KBB: the Kaiser bracket, today drawn as bolted flange plates. WFP: welded flange plates, today drawn bolted.
- [ ] Doubler plates on the column web (`n_dp`).
- [ ] The concrete slab (`slab`).
- [ ] Continuity plates as thick as in the test (`t_cp`). Today they take the thickness of the column flange.
- [ ] The column tests of the hub (`column`, `hss_column`). They give a section and a length, but each setup (cantilever, double curvature, 3-point bending) needs its own rig.
- [ ] Braces and EBF. The hub tables have no frame layout (bay, storey), so we can't build the frame from them yet.
- [ ] "Exterior - Frame" (one test in the hub).
- [ ] A specimen input in the playground: paste a hub record, or pick one from a list.

## Repo

- [x] TypeScript as a dev dependency, a `tsconfig.json` and a `type-check` script.
- [ ] A LICENSE.
- [x] A GitHub Actions CI that runs `node --test` (and the type check).
