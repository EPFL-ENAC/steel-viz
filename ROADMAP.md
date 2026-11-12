# Roadmap

What we plan to do next. A checked item is done.

## Generator

- [x] Channel, angle and WT profiles (C, L and T sections), with their own section tables. Double angle braces, channel secondaries and tee truss chords (`shapeP`, `--shapes`).
- [ ] Move the channel and angle tables to RESSLab Hub when the hub needs them (its `steel_braces.csv` has angle and channel braces). Paired worktree and a hub pull request, then the usual rule: change them in the hub first.
- [ ] Tee chords with the stem up, and the gussets on the stem.
- [ ] Double angle truss diagonals, unequal angles, single angle braces (the `L` section exists now, for the X bracing).
- [x] X bracing in a bay: flat bars, rods with a turnbuckle, or single angles bolted where they cross. Tension only in the solver (`xP`, `xKind`, `--bracing x`).
- [x] Round tube braces (CHS and pipes), on a knife plate or an end cap plate (`roundP`, `--round-tubes`), with our own CHS tables.
- [ ] Move the round tube tables to RESSLab Hub too, when the hub has one.
- [ ] Round tube tree columns. Not easy: every joint on a column (beam ends, continuity plates, splices, base plate) needs a flat face. A round column needs new joints for each one (through plates, ring stiffeners).
- [ ] Round tube truss diagonals.
- [x] End cap plates on smaller tubes: from 82 mm (`CAP_MIN_D`), with a narrow tab (one line of 2 bolts) under 114 mm.
- [x] Bolted beam splice and posts.
- [x] More kinds of beam end connections: clip angles, seated, stiffened seat, tee, stiffened end plate (`CONNS` in `steel.ts`, `connKindsP`, `--conn-kinds`).
- [x] Skewed arms on trees: 30 or 45 degrees off a column flange, with a skewed end plate or a weld (`skewP`, `--skew`, `skew.ts`).
- [ ] Braces, rods and trusses on a skewed arm. They need a skewed gusset and a skewed clevis tab. Today a skewed arm has none.
- [ ] Skewed bay beams, and skewed arms on portals.
- [ ] Shear studs, with a slab or a deck on the beams. Without one they look like loose bolts.
- [x] Trusses on trees. Today a tree never gets one: its arms are too short, too low, or have an arm below them on the same face. Allow a lower truss there.
- [x] Fewer trusses on boxes. Boxes get one on 32 of 40 seeds. Try a lower `TRUSS_P.bay` in `generate.ts`.
- [ ] Trusses on portal arms. They never get one either. The low truss of trees would fit on a few, but it changes portal 143, #2 of the top 12.
- [x] A rod clevis goes through an arm connection on aisc tree 140 (today's code, outside the seeds the tests run). The clevis tab went through the top flange plate of `flange_plates`. `clearRods()` moves the rod out along its arm, or drops it, before and after the sizing. 3 trees had it in seeds 0 to 600 (aisc 140, eu 140, eu 469), `rod.test.ts` has them. `cli.ts` prints the clashes now.
- [x] Gable portal: a one storey portal with a pitched roof, haunches at the eaves and a bolted ridge splice (`gable.ts`, `gableP`, `--gable`).
- [x] Gable on a two storey portal: on the top bay beam only, the floor beam stays flat. Mostly the condition in `addGable()`.
- [ ] Gable on a box: the two bays of one side get the gable, with a ridge beam between the two ridges (a new member type).
- [ ] Purlins on the rafters of a gable portal.
- [ ] A `variety` param in `generate()`, so that the details prefer a kind not used yet. Tried in `moreKinds()`: it gains only 0.06 kind on 200 seeds (9 seeds go up), because only the newer beam end kinds can change there. To be useful, it must also act on the other details.

## Solver

- [x] Buckling: `alphaCr` of the whole structure, and member checks with buckling (AISC 360-22 E3, F2, H1-1).
- [ ] Notional loads (small side loads for the frame imperfections, EC3 5.3).
- [x] A shear check (AISC 360-22 chapter G, along both axes, every kind of section).
- [x] D / t of a round tube (local buckling): F8 in bending, E7 in compression, a tube past 0.45 E / Fy is refused.
- [x] Checks for the channels, double angles and tees: lateral torsional buckling (F2 for a channel, F9 for a tee and a double angle, F10 for one angle) and flexural-torsional buckling (E4). Cw and the shear center come from the dimensions.
- [ ] EC3 member checks for the `eu` family. Today the AISC formulas size both.
- [ ] A lateral brace for the bottom chord of a cantilever truss. Without it, eu tree 19 stays under `alphaCr` 3 (and eu tree 7 with `--shapes 0`).

## Use in RESSLab Hub

Today the hub only takes an exported SVG for its logo (RESSLab-Team/resslab-hub#263). Later:

- [x] A light entry point: the painter renderer and `timeline()`, with no three.js. It is for a loading animation in the slow parts of the hub. Done: `index.ts` (`@epfl-enac/steel-viz`), and `package.test.ts` checks it loads no three.js.
- [x] A separate 3D entry point (`webgl.ts`), loaded only where it is needed. Done: `3d.ts` (`@epfl-enac/steel-viz/3d`).
- [x] The exact drawing with no package, so it can be in the light entry. Done: our own hidden line removal in `hlr.ts`, about 3 times faster than three-edge-projection.
- [x] A specimen input: build the structure of a real experiment from its sections, next to the random seed. Then the hub can show a view of each experiment. Done for the beam-to-column, brace, column, HSS column and EBF link tests (`specimen.ts`, `hub.ts`, `--specimen`). The next steps are under "Specimens".
- [x] Ship built JS and `.d.ts` on a git tag, so the hub can depend on it from GitHub (`github:EPFL-ENAC/steel-viz#v0.1.0`). Done: `pnpm run build:lib` and `release.sh` (see the README).
- [x] The 3D viewer in plain WebGL2, with no three.js (`webgl.ts`). Bundled and minified, `webgl.ts` alone is 19 KB (8 KB gzip), and the `3d` entry went from 648 KB (171 KB gzip) to 398 KB (102 KB gzip).
- [x] Drop three.js from the `3d` entry when `hlr.ts` has no three either (`feat/hlr-native`). Done: `renderHLR` is in the light entry, and the package has no peer dependency anymore.
- [ ] The first release, `v0.1.0`: a human runs `./release.sh 0.1.0` on `main` and pushes the tag. Then use the light entry in the hub for the loading animation (a hub pull request).

## Specimens

The specimen input draws five tables of the hub, each test in its test rig. `node hub-count.ts` gives the counts below (November 2026). No drawn test has a clash or a floating part. The details left out are in the log, as notes. Next:

- [x] The test rig (`rig.ts`): pins, rollers, floor blocks, actuators and frame members, as parts of kind `rig`, drawn lighter. The column no longer stands on a base plate, like in a building.
- [x] Beam-to-column tests (`connections`), beam loaded or column loaded: 99 of 100. The last one is the frame test below.
- [x] RBS: the cut in the beam flanges. Where it starts and how long it is come from the AISC 358 rule, the data doesn't give them.
- [x] WUF-B: the bolted shear tab on the beam web, next to the welded flanges. Done: `welded_tab`, the tab has the size of the shear tab (`t_pl` is NA).
- [x] WFP: welded flange plates, thick as `t_pl`, no bolts. Done: `welded_plates`.
- [x] KBB: the 7 rows are drawn as welded haunches, not as Kaiser brackets, because that's what the data says: only these rows have `d_h` ("shift of the beam effective depth due to presence of hanches"), and the comments say "hanch". Done: `welded_haunch`. The data has no outline, so we take it (`haunch.ts`), and the note in the rail says so. The hinge is at `s_h`.
- [x] Doubler plates on the column web (`n_dp`).
- [x] The concrete slab (`slab`): the concrete and the deck ribs, in light lines, on the 14 tests with a slab. The data has no slab length and no rib spacing, so we take them. The shear studs are not drawn, they are inside the concrete.
- [ ] The slab of the EBF tests (TF2c, TF3c, TF4c, 20 tests). Their rows give no size for it, so they keep their note.
- [x] Continuity plates as thick as in the test (`t_cp`). When `t_cp` is NA, they take the thickness of the column flange, with a note.
- [x] "Exterior - Frame" (one test in the hub, Del_Caprio_et_al_2014_RBS-A). Done: the whole frame and its rig, from the report (`frame.ts`). No deformed shape: the test has no response file.
- [x] Brace tests (`braces`), SB, SBF and DBF: 294 of 294 (the 2 flat bars too).
- [x] Double Channel braces (5 tests): `2C` in `sections.ts`, `doubleChannel()` in `hub.ts`.
- [x] The single `Angle` braces (8 tests): the angle lies on one face of its gusset (`sideShift()` in `bench.ts`).
- [ ] The gusset outline of a brace from `l_1t` to `l_8b`, when someone tells us what the 8 lengths are. Today the gussets have a generic outline.
- [x] Column tests (`columns`): 153 of 153.
- [x] HSS column tests (`hss_columns`), CF, DC and 3PB: 284 of 284. How we read `length__mm` is our own guess (RESSLab-Team/resslab-hub-data#75).
- [ ] A round tube in `hss_columns`: read it as a CHS (`chsSection`). No row has one yet.
- [x] EBF link tests (`eccentric_braced_frames`): 240 of 240.
- [x] A specimen input in the playground: paste a hub record, or pick one from a list.
  Done: "Hub test" at the top of the rail. Pick a table, search a test, walk them with ← and →, or paste a record. The rail shows what the reader made of it, or its error.

## Deformed shape

Play the measured response of a hub test in the 3D view. `deform.ts` is the base, each table is one branch on it. The README says how a table adds its shape.

- [x] Beam-to-column tests (`connections`): the shape, the rig, the zones (beam hinge, panel zone), the chart.
- [x] Brace tests (`braces`).
- [x] Column tests and HSS column tests (`columns`, `hss_columns`).
- [x] EBF link tests (`eccentric_braced_frames`): the link in shear, the frames on their pins, the web zone.
- [x] Actuators and pinned links pivot on their pins: a joint is cut in a mount and a moving part, the bases stay with what they stand on.
- [x] The actuator that pushes a column follows its length: its foot stays on its support at the auto scale, on all the real tests.
- [x] RBS: the hinge at the cut, with Z of the cut section.
- [x] Doubler plates in the panel zone: the elastic estimate of the distortion uses the web and the doublers.
- [x] `--step` in the CLI, for one deformed frame. Done: `--specimen <table>/<id> --step <n>`, the same file as "Copy SVG at this step" with `--view 225,35`.

## Playground

- [x] Compare with main in 3D too, not only in SVG: two views side by side, they turn, zoom and move together.
- [x] Build time 0 by default: no animation, a change draws at once. Build time and part speed as two knobs.
- [x] One line weight in 3D by default (two in the SVG and the export).
- [x] More look settings: storeys, span, bracing, arm bands, connections, detail chances (`Params`, the CLI flags, the Layout and Details sections).
- [x] A rail of sections you can fold, on the EPFL design tokens.
- [x] Compare in one 3D view: both structures on top of each other, the new parts in one color and the gone parts in another.
- [x] The animation knobs in the CLI (`--speed`, `--duration`). Done: with `--animate`, duration in s like the playground.

## Repo

- [x] TypeScript as a dev dependency, a `tsconfig.json` and a `type-check` script.
- [x] A LICENSE (MIT).
- [x] A GitHub Actions CI that runs `node --test` (and the type check).
