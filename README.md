# steel-viz

Steel structures drawn like a technical drawing, with a 3D view and a build animation. It started as a test for the RESSLab Hub logo (RESSLab-Team/resslab-hub#263).

What RESSLab Hub uses it for:

- Now: the logo. The hub takes an exported SVG, not this code.
- Next: the build animation as a loading animation, then a view of each experiment in the hub. For that, the repo is also a package with two entries (see "Use as a package" below). The input for the experiments is ready: `--specimen` draws a beam-to-column test, a brace test or a column test from its real sections, not from a seed (see below).

What comes next is in [ROADMAP.md](ROADMAP.md).

It builds a steel structure from a seed, in one of three forms:

- Tree: one column on a base plate, with arms, braces and secondary beams.
- Portal: two columns with beams between them, on one or two storeys, and a few arms out of the columns.
- Box: four columns in a rectangle. Beams and braces stay in its four walls, nothing sticks out of them.

Each bay storey gets its own bracing: none (moment connections), knee braces at both ends, a chevron (two braces up to the middle of the beam) or one diagonal. `--form` picks the form (`mix` lets the seed pick it, a tree seed gives the same tree in both).

A small frame solver checks that the structure stands up. If it does not, the generator adds a brace or changes a pinned connection to a moment connection. Then it sizes each member from the AISC or EU section tables in `sections/`. The I and tube tables are copies of RESSLab Hub (from `frontend/src/assets/connection/` and `frontend/src/assets/hss/` in the hub). Copy them again when the hub changes them. The channel and angle tables are ours until the hub has them. `sections/README.md` says where they come from and how to make them again. The tees are not in a table: a tee is an I cut in two (`W16X50` gives `WT8X25`, `IPE 300` gives `1/2 IPE 300`).

Some members get another shape, from a draw of their own. `shapeP` gives the chance (0.35 by default, `--shapes` in the CLI, "Channels, angles, tees" in the playground):

| member | usual shape | other shape |
|---|---|---|
| the braces of an arm (all of them, one draw per arm) | square tube, on a gusset with a knife plate | double angle (two equal angles back to back, legs from 75 to about 200 mm), bolted on a gusset plate that sits in the gap between the angles (`gusset_lap`) |
| a secondary beam | I | channel (C, MC, UPN, UPE), coped like an I, on the same shear tab |
| a truss bottom chord | I | tee (WT, or half an IPE or HE), flange up, stem down. The diagonals land on its flange like on an I. |

The sizing rules are the same for both shapes: L / r under 200 for a brace, a secondary fits between the flanges of its arm, the same depth limits for a chord. A tee chord gets only one continuity plate in the column and no stiffener at the truss nodes, because it has no bottom flange. Each draw is seeded from the member id, so it takes nothing from the other draws. With `--shapes 0`, a seed gives only I, tube and rod members, as before these shapes.

The sizing works in two steps, with public formulas from EC3 (Eurocode 3) and AISC 360-22:

1. The whole structure: the solver finds the elastic critical load factor `alphaCr`. It is how many times the load the structure takes before it buckles as a whole (a buckling analysis with the geometric stiffness, in `solver.ts`). The moments are then multiplied by `1 / (1 - 1/alphaCr)`, for the sway effects (EC3 5.2.2). This rule needs `alphaCr >= 3`. If it is lower, the member with the most strain energy in the buckling mode gets a heavier section, and the solver runs again.
2. Each member, in `checks.ts`: flexural buckling (AISC E3), lateral torsional buckling of I sections (F2), weak axis bending (F6), and the two together with the axial force (H1-1). The buckling length is the member length, because step 1 already has the sway. The ratio must stay under 0.6. There are no AISC phi factors, the 0.6 is the margin.

Not checked: shear, local buckling of thin plates (E7, F3), torsional buckling (E4), and notional loads (the small side loads for the frame imperfections). The channels, double angles and tees take their full plastic moment: no lateral torsional buckling for them (F2 for a channel, F9 for a tee), and E4 is the check that matters most for a double angle or a tee. Cb is 1, which is on the safe side for cantilevers. The same AISC formulas size the EU sections too. A few trees with a cantilever truss stay under `alphaCr` 3 (eu tree 19 of the 240 structures of the tests, and also eu tree 7 with `shapeP` 0): the bottom chord sways out of the truss plane, and nothing braces it sideways. The log says it.

Then come the small details, from a random draw of their own, so a seed keeps the same structure:

- Column splice (on about a third of the structures): above a free level between 30 and 70 % of the height, the columns change to a lighter section, sized from the forces up there. A bearing splice is a cap plate and a base plate bolted at the corners. A flange splice has bolted plates on both flanges and on the web, with fill plates when the two sections don't have the same depth. If the plates would go through a brace or its gusset (a steep brace, or a wide double angle), the splice moves to the nearest free height, or is left out.
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

### Beam end connections

Each beam end has one kind of connection. The kinds are a small catalog, `CONNS` in `steel.ts`. Each entry says where the kind fits, if the solver takes it as a pin or a moment, its setback (the gap the beam leaves at its end), how far its plates go past the beam on the support, and how to draw its plates, bolts and clash boxes. A new kind is one entry there.

| kind | `--conn` | fits | solver | parts |
|---|---|---|---|---|
| shear tab | `shear_tab` | column flange, column web, beam | pin | one plate in the web plane, one line of bolts through the beam web |
| end plate | `end_plate` | column flange, column web, beam | moment | a plate on the beam end, bolted to the face. On a column it is extended, with bolts above and below the flanges. On a beam it is flush. |
| flange plates | `flange_plates` | column flange, column web | moment | a bolted plate on each flange, welded to the face |
| welded | `welded` | column flange, column web, beam | moment | no plate |
| clip angles | `clip_angles` | column flange, column web, beam | pin | two angles, one on each side of the beam web. One line of bolts through both angles and the web, two lines into the face. |
| seated | `seated` | column flange, column web | pin | a seat angle under the bottom flange, bolted to the face, and a small angle on the top flange |
| stiffened seat | `stiffened_seat` | column flange, column web | pin | a seat plate under the bottom flange on a welded stiffener, and a small angle on the top flange |
| tee | `tee` | column flange, column web, beam | pin | a WT: its flange bolted to the face, its stem bolted to the beam web. On a channel, the stem is on the side away from its flanges. |
| stiffened end plate | `end_plate_stiffened` | column flange, column web | moment | the extended end plate, with a triangle stiffener above the top flange and below the bottom flange |

The fix loop and the sizing only use the first four kinds. The other five come after, from a draw of their own (`connKindsP`, 0.35 by default). Each beam end takes one draw, keyed by its id like the member shapes, so the result doesn't depend on the order of the draws. Under `connKindsP`, the end gets a kind that can take the place of the one it has, and that fits where it lands. Clip angles, the two seats and the tee take the place of a shear tab. The stiffened end plate takes the place of an end plate. Each one has the same pin or moment and the same setback as the kind it replaces. So the solver, the sections and the members don't change, only the plates at the end. A secondary beam on a beam can only get clip angles or a tee. A truss chord keeps its kind.

The column splice keeps clear of the seats and the end plates. A new kind that would go through another part goes back to the old one. With `connKindsP` at 0, a seed gives the same parts as before these kinds (`params.test.ts` checks it). With `--conn` set to one kind, there is no draw: every beam end that can take it gets it.

A detail plate that would go through another part is left out. For example, a continuity plate on the side of the web where another beam frames in.

### The look settings

Arms, height and load are not the only knobs. These `Params` in `generate.ts` change the look too. Each one has an auto or default value. At that value the seed takes the same draws, so it gives the same structure as before (`params.test.ts` checks it on 30 seeds). When you set one, the seed still takes its draw, then the value replaces it.

| param | default | CLI | playground | what it does |
|---|---|---|---|---|
| `storeys` | 0 (auto) | `--storeys 0\|1\|2` | Layout, storeys | one or two storeys for a portal or a box |
| `spanK` | 1 | `--span 1` | Layout, span | multiplies the bay spans (0.6 to 1.6 in the playground) |
| `bracing` | auto | `--bracing none\|knee\|chevron\|diagonal` | Layout, bracing | the bracing of every bay storey |
| `armL` | 0.3, 0.7 | `--arm-length 0.3,0.7` | Layout, arm length | the band of arm lengths, as a part of the height. Portal side arms take 3/4 of the band. |
| `armZ` | 0.35, 0.95 | `--arm-height 0.35,0.95` | Layout, arm height | the band of heights where arms leave the column |
| `conn` | auto | `--conn shear_tab\|end_plate\|...` (see "Beam end connections") | Layout, connections | the beam connection. A secondary beam keeps its own when it can't take this one. |
| `braceP` | 0.3 | `--braces` | Details | the chance of braces on an arm |
| `secondaryP` | 0.35 | `--secondaries` | Details | the chance of secondary beams |
| `postP` | 0.3 | `--posts` | Details | the chance of posts |
| `beamSpliceP` | 0.3 | `--beam-splices` | Details | the chance of a beam splice |
| `trussK` | 1 | `--trusses` | Details | multiplies the truss chances (0 for none) |
| `rodP` | 0.4 | `--rods` | Details | the chance of a tension rod |
| `colSpliceP` | 0.6 | `--col-splice` | Details | the chance of a column splice |
| `connKindsP` | 0.35 | `--conn-kinds` | Details, more connection kinds | the chance that a beam end gets one of the newer kinds (see "Beam end connections") |

```sh
node cli.ts --seed 5 --form portal --storeys 2 --bracing chevron --conn welded --span 1.4
node cli.ts --seed 5 --form tree --arm-length 0.5,0.9 --arm-height 0.6,1
```

A setting can give a mechanism (the status says so), never a clash or a floating part (`params-*.test.ts`, 25 seeds for each case).

Parts must not go through each other. A secondary beam is coped (its flanges cut back) where it meets the flanges of its arm, and its plate fits between those flanges. A brace stays above the arms under it on the same face of its column, and is long enough that its two gussets don't touch. `clash.ts` checks this with boxes, and `geometry.test.ts` runs it on every form, 240 structures, and on 72 more with every member in its other shape (`shapeP` 1).

It can also draw a real test of RESSLab Hub instead of a seed: a specimen. For now it draws four kinds of test, each one in its test rig:

- A beam-to-column subassembly (the test of one connection): one column with one or two beams. That's the `connection` table of the hub, 99 of its 100 tests.
- A brace test: one brace, alone or in a test frame. That's the `braces` table, 279 of its 294 tests. See "Brace tests" below.
- A column test: one column, pushed sideways at its top under an axial load. That's the `columns` table, all its 153 tests. See "Column tests" below.
- An HSS column test: one square or rectangular tube, standing like a column test, or lying on two rollers and pushed at mid span. That's the `hss_columns` table, all its 284 tests. See "HSS column tests" below.
- An EBF link test: the link of an eccentrically braced frame (the short piece of beam that yields in shear), alone or in a one bay frame. That's the `eccentric_braced_frames` table, all its 240 tests. See "EBF link tests" below.

The sections are the real ones, so there is no fix loop and no sizing. The solver runs once, and the log gives `alphaCr` and the max ratio under `--load`, only as information. The end plates and the continuity plates are drawn. Splices, foot gussets, trusses, rods and posts are not.

The test rig is drawn with lighter lines (parts of kind `rig`, built with `rig.ts`). The column has an end plate on each end. A pin on a floor block holds its foot. A loading head sits on the top end plate. All the pins turn about the same axis, at right angles to the plane of the first beam.

- Beam loaded (the default): a pinned link holds the head to a reaction post. A vertical actuator pushes each beam tip, from a floor block.
- Column loaded: an actuator pushes the head, from a reaction wall. Each beam tip stands on a pinned link to a floor block.

The pin of the link (or of the actuator) on the head is the top pin of the column. The solver holds the nodes the same way, but an actuator only brings the load, it holds nothing. So a column loaded test with no beam, or with a beam on a shear tab, is a mechanism.

`hub.ts` reads two kinds of JSON file. The first one is a record of a hub table, as the hub API gives it (numbers, `null`) or as a row of its CSV file (strings, `NA`). A field says which table: `specimen_type` for `connection`, `brace_angle` for `braces`, `axis_of_bending` for `columns`, `test_configuration` for `hss_columns`, `link_loc` for `eccentric_braced_frames`. The files in `specimens/` are hub records (resslab-hub-data is public domain). The second one is our own `Specimen`, for a test that is not in the hub:

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

- `section`: a name from the table of `family` (`W14x82` and `HEB 300` work, written the hub way), a built-up name read as d x bf x tw x tf (`H-700x300x13x24`), or the dimensions in mm (`{ "id", "d", "bf", "tf", "tw" }`, with `"shape": "RHS"` for a tube, or `{ "id", "shape": "CHS", "d", "t" }` for a round tube). With a name, the full table is used, also the deep W sections that the random generator never takes.
- `bearing`: 0 and 180 put the beam on a column flange, 90 and 270 on the web.
- `length`: from the column axis to the beam tip, in mm.
- `at`: the height of the beam centre line above the column foot. By default, half the column height.
- `connection`: one of the kinds of "Beam end connections" above that fit a column (`shear_tab`, `end_plate`, `flange_plates`, `welded`, `clip_angles`, `seated`, `stiffened_seat`, `tee`, `end_plate_stiffened`). A beam alone on a pinned kind (a shear tab, clip angles, a seat, a tee) is a mechanism: the log says so, and the drawing still comes out.
- `continuity: false` leaves out the continuity plates. `beams: []` gives a column alone.
- `load`: `beam` (the default) or `column`, what the actuators push (see the rig above).

From a hub record:

- The sections come from the numbers (`d_c b_cf t_cf t_cw`, `d_b b_bf t_bf t_bw`), not from the names. The names are free text (`build up H section`) and don't link to the section tables.
- An exterior test has one beam of length `l_b`. An interior test has two, one on each flange, `l_b / 2` each (there `l_b` is the whole span). The beams are at half the column height `h_c`.
- `t_cp` 0 means no continuity plates.
- `specimen_type` gives the load: "Interior - Column Loaded - Subassembly" is column loaded.
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

### How many hub tests we draw

`hub-count.ts` reads every table that `hub.ts` knows from a copy of [resslab-hub-data](https://github.com/RESSLab-Team/resslab-hub-data). It reads each row as a `Specimen`, runs `generate()`, and looks for clashes and floating parts. It is a Node script: the package does not include it.

```sh
node hub-count.ts                         # looks for a resslab-hub-data folder next to the repo (or next to a parent folder, for a worktree)
node hub-count.ts ../../resslab-hub-data  # or give the folder
```

It prints one line for each table, then the errors grouped by field (November 2026):

```text
connections: 99 / 100 drawn, 0 mechanism, 0 clash, 0 floating
  specimen_type "Exterior - Frame" is not supported yet: 1 (Del_Caprio_et_al_2014_RBS-A)
braces: 279 / 294 drawn, 0 mechanism, 0 clash, 0 floating
  cross_section_shape "Angle" is not supported yet: 8 (Jain_1L, Jain_2L, Jain_3L, Jain_4L, Jain_5L, ...)
  cross_section_shape "Double Channel" is not supported yet: 5 (Black_Strut-11, Lehman_Roeder_HSS29, Aslani_C1, Aslani_C2, Aslani_C3)
  cross_section_shape "Flat Bar" is not supported yet: 2 (Wakabayashi_FTBM, Wakabayashi_FTBC)
columns: 153 / 153 drawn, 0 mechanism, 0 clash, 0 floating
hss_columns: 284 / 284 drawn, 0 mechanism, 0 clash, 0 floating
```

A row that does not read throws an error in one of two forms: `<id>: <field> is missing`, or `<id>: <field> "<value>" is not supported yet`. "mechanism" counts the tests where the solver finds a mechanism. Only the beam-to-column tests are solved, so it is 0 for the other tables.

`hub.test.ts` runs the same loop. It fails if a drawn test has a clash or a floating part, or if an error is not in one of the two forms. CI has no copy of resslab-hub-data, so there the test is skipped.

### Brace tests

A record of the hub `braces` table (it has a `brace_angle`) is a brace test. `bench.ts` draws it. The brace is in a vertical plane, `brace_angle` above the horizontal, with `l_b` between its two work points. There is no solve: the brace is only drawn.

- `configuration` gives the rig. SB: the bottom end on a floor block, the top end under a loading beam, and an actuator pushes the beam from a reaction wall. SBF: a one bay frame around the brace, its columns on pins, the actuator on the top beam. DBF: two braces in an X in the same frame. They are side by side where they cross, and the middle connection is not drawn. `nr` is drawn as SB.
- `boundary_condition` gives the ends. Gusset plate: a gusset at each end, and the tube runs on it up to `(l_b - l_b_clear) / 2` from the work point. Fixed: an end plate on a seat. Pin: an end plate on a pin joint, the pin at the work point.
- The rig faces (the floor block, the frame flanges) come as close to the work points as the end details let them.
- `t_t` and `t_b` give the thickness of the gussets (or end plates). Some rows have the end type there ("Pin-Pin Ended"). Then the thickness is a default, and the log says so.
- The gussets have a generic outline. `l_1t` to `l_8b` are not used, nobody says what the 8 lengths are.

The section comes from the numbers:

| `cross_section_shape` | drawn as |
|---|---|
| Rectangular HSS | a tube, `d_br` x `b_br` x `t_br` |
| Circular HSS | a round tube, `d_br` x `t_br` |
| Round Bar | a rod, `d_br` |
| I-shaped | an I. `t_br` is the flange and `w_br` the web (the data dictionary says the other way round). A `WT` name gives a tee. |
| Double Angle | from the name. `L152x89x9.5` and `2 L89x64x6.4` are long leg x short leg x t, long legs back to back. `49.7x3.88` has equal legs. `d_br` and `b_br` don't mean the same thing in every row, so they are used only when the name doesn't read. |
| Angle, Double Channel, Flat Bar | not drawn yet (15 rows) |

A brace test of our own, as JSON:

```json
{ "test": "brace", "id": "my-brace", "section": "HSS6X6X3/8", "length": 3000, "clear": 2400,
  "angle": 40, "ends": "gusset", "frame": "SBF", "plates": { "top": 12, "bottom": 12 } }
```

`brace.test.ts` covers the three hub files of `specimens/` (`Fell_et_al_HSS1-1` SB, `Takeuchi_Matsui_528` SBF, `Wakabayashi_DPC1-1` DBF), every frame with every end type, the section shapes and the errors.

### Column tests

A record of the hub `columns` table (it has an `axis_of_bending`) is a column test. `bench.ts` draws it, with no solve.

- The column is an I from `d_c`, `b_cf`, `t_cf` and `t_cw`. The name is not used (it is often "Built Up S10"). Its length is `l_c`, between the two end plates. Careful: `h_c` is the web height, not a height.
- The foot end plate is bolted to a floor block. A loading head sits on the top end plate. An actuator pushes the head sideways, from a reaction wall. Vertical actuators above the head bring the axial load. They hang from a crosshead (two posts and a beam).
- `boundary_condition` gives the top. Fixed-Free: one vertical actuator, the top is free to turn. Fixed-Fixed: two vertical actuators side by side, on a spreader beam, so the head can't turn. Fixed-Flexible: drawn like Fixed-Free, and the log says the spring is not drawn.
- `axis_of_bending` turns the column under the push: Strong 0°, Weak 90°. Bi-axial is drawn at 45°, because the table has no loading angle (the log says so). The rig doesn't turn.
- `t_top_plate` and `t_bottom_plate` give the end plates. Some rows have "NR": then the plate is `max(25, 1.5 t_cf)` thick, and the log says so.
- Some tests were done with the column lying down ("horizontal configuration" in `test_procedure`). They are drawn standing, and the log says so.

A column test of our own, as JSON (`angle` in degrees, between the push and the web):

```json
{ "test": "column", "id": "my-column", "section": "W14X90", "length": 3000,
  "ends": "fixed-fixed", "angle": 0, "plates": { "top": 40, "bottom": 50 } }
```

`column.test.ts` covers the two hub files of `specimens/` (`Elkady_and_Lignos_C1` Fixed-Fixed, `Elkady_and_Lignos_C6` Fixed-Flexible and Bi-axial), every end type at four angles, the end plates and the errors.

### HSS column tests

A record of the hub `hss_columns` table (it has a `test_configuration`) is also a column test, of a tube. `bench.ts` draws it, with no solve.

- The tube is an RHS from `depth__mm`, `width__mm` and `flange_thickness__mm` (the wall). The id is `tube_section`. All 284 rows are square or rectangular tubes, so no round tube (CHS) for now.
- `test_configuration` CF (cantilever): the rig of a Fixed-Free column. DC (double curvature): the rig of a Fixed-Fixed column. 3PB (three-point bending): the tube lies on two rollers, and an actuator pushes it down at mid span, from a crosshead. For the axial load, an end plate at each end: a pin on a reaction block at one end, an actuator from a reaction wall at the other.
- `length__mm` is read with `stiffness_coefficient` k (the end moment over the chord rotation is k EI / L). k 3: `length__mm` goes from the point of zero moment to the end. So a CF column is `length__mm` high, but a DC column or a 3PB span is twice `length__mm`, and the log says so. k 6: `length__mm` is the whole DC column (or 3PB span). Another k throws an error. The dictionary doesn't say this, it's our reading of the hub images and of the numbers.
- `loading_angle` turns the tube under the push (0°: the push along the depth).
- `axial_load_ratio` 0, with a `Constant` sequence: no axial load, so no axial actuator. A DC column keeps its two vertical actuators: they hold the top straight.
- The table has no end plate. They are drawn `max(25, 1.5 t)` thick, and the log says so.

A 3PB test of our own: `"ends": "3pb"`, `length` between the rollers, `"axial": false` for no axial load. `plates.bottom` is the plate at the pin end, `plates.top` at the actuator end.

`hss.test.ts` covers the two hub files of `specimens/` (`Kuwada_et_al_2015__DT16-LD24-A45-ny03` CF at 45°, `Yamada_et_al_2012__No-14` 3PB with an axial load), 3PB at four angles with and without the axial load, the length rule, and the errors.

### EBF link tests

A record of the hub `eccentric_braced_frames` table (it has a `link_loc`) is a link test. `bench.ts` draws it (`buildLink`), with no solve. The id is `ebf-<id>`, because `spec_id` is not unique.

- The link is an I from the nominal sizes `h_n`, `bf_n`, `tf_n` and `tw_n`, `e` long. The `_m` columns are the measured sizes of the same link, not the beam outside it. The beam pieces next to the link have the link section (in an EBF the link is a piece of the beam), drawn as rig.
- `l_confi` gives the rig. `link_loc` (middle or edge) is only kept: 22 rows say TF1 and edge, they are drawn as TF1 and the log says so.
  - TF1: the link alone. Its first end plate on a tall reaction block, its second end plate on a vertical loading beam. An actuator, hung from a crosshead, pushes the beam up and down.
  - TF2, TF3 (and TF2c, TF3c): the pinned frame of the brace tests, `l_st` between the column axes, the beam axis `h_st` above the foot pins. The link is in the middle of the beam, a frame brace goes from near each foot up to a link end. An actuator pushes a column at beam height, from a reaction wall. TF3c ("link in a system") is drawn as TF2.
  - TF4, TF4c: the same frame, the link against a column, one frame brace under its other end. The actuator pushes the other column.
  - The `c` configs have a concrete slab. It is not drawn yet, and the log says so.
- `l_con_typ` with `bolted`: an end plate at each link end, `t_e_s` thick (else `max(20, 1.5 tf)`, and the log says so). TF1 always has end plates, past the flanges, with the bolts outside the flanges. In a frame, the end plates are flush with the flanges.
- Stiffeners: an end stiffener on both faces of the web at each end, always. Then the ones of the data. `l_s_side` single: on the front only, double: on the front and the back, each face with its own count and spacing. `l_s_no_f` (or `_b`) stiffeners, `l_s_d_pnl_1_f` the end panels, `l_s_d_pnl_2_f` the inner panels (non-regular only). When the panels don't add up to `e` (more than 3 % off), they go at equal spacing, and the log says so (about 60 rows). NA: no stiffener. NR: only the end stiffeners, with a note. `t_s` is their thickness (else `max(10, 0.75 tw)`).
- No `l_st`, `h_st` (189 rows): the span is `max(3000, 3 e)`. The height comes from the brace angle `a_b_b` when there is one, else it is 0.6 times the span. A frame too small for the link and its braces is drawn bigger. The log says each of these.
- `a_b_b` is read as the brace angle. When the frame sizes give an angle more than 3° away, the log says so (Bozkurt & Topkaya, Itani et al., Roeder & Popov).
- Not drawn: the extra flange plates (`tf_add_n`), the channels of a built-up `C ...` profile (drawn as an I), the lateral bracing of the link. The log says the first two.

A link test of our own, as JSON (`stiffeners` in mm from the first link end, `frame` optional):

```json
{ "test": "link", "id": "my-link", "section": "W18X40", "e": 711, "at": "middle", "config": "TF2",
  "ends": "bolted", "stiffeners": { "t": 10, "front": [237, 474], "back": [] },
  "frame": { "span": 4000, "height": 2500 } }
```

`ebf.test.ts` covers the two hub files of `specimens/` (`Hjelmstad_and_Popov_1983_4` TF1, `Volynkin_and_Clifton_2016_AL-4C` TF4), every config with a short, a mid and a long link at every level of detail, the frame sizes, the stiffener rule, and the errors.

The output is an SVG line drawing with the hidden lines removed. The SVG can also build itself step by step, as an animation.

Two renderers:

- `hlr.ts` (the default): exact hidden lines, in plain TypeScript (no package). It puts the triangles of all faces in a grid on the screen, and cuts out of each edge the pieces that are behind a triangle. It takes about 25 to 30 ms for one structure (about 1550 faces).
- `render` in `steel.ts` (`--painter`): the painter's trick, ported from `sculpture_render.py` (resslab-hub, branch `feat/logo-aisc`). About 5 ms, but some lines are wrong. The playground uses it only while you drag the view in an SVG mode.

The playground also has a 3D view (`webgl.ts`, the "3D" choice, on by default). It is for looking at the structure, not for export. It runs in plain WebGL2, with no three.js, and builds the geometry once per structure, so you can turn it, move it and zoom with every bolt shown, at the frame rate of the screen. Faces are filled with the background and the GPU depth buffer hides the hidden lines. Edges are thin lines: each segment is a small quad with round ends, drawn as instances and sized in the vertex shader (as three's `LineSegments2` did before). A second pass gives the thick outlines with the same rule as `hlr.ts` (a jump in depth over 50 mm, or another part behind), read from a depth and part-id texture. That pass works per pixel, so it runs at about 3 samples per CSS px (2x on a 1x screen) and is averaged down, or the outlines would show stair steps. Bolt heads get thin lines only. The build animation plays in 3D too, on the same `timeline()`. The lines are close to the exact drawing but not the same (no gaps, no merged lines). "Copy SVG" always gives the exact drawing from `hlr.ts`, for the current view.

The "3D / SVG / Both" switch picks the viewer. "SVG" shows the exact drawing, at full size or at a px size. "Both" puts the 3D view on the left and the exact drawing on the right, with the same view. When you turn one, the other follows. While you drag, the SVG uses the fast painter drawing, then the exact one when you let go.

In the 3D view: drag to turn, right drag (or shift drag) to move, the wheel or two fingers to zoom, double click to see the whole structure again. The view sliders follow. Hover a part with the mouse to see what it is: its type, and for a member its section, length, connections, ratio and forces (from `result.members`). The part under the mouse comes from the same part-id pass, drawn for one pixel only.

The exact renderer draws like a technical drawing:

- Two line weights. Outlines are thick (9 mm at the drawing scale) and inner edges are thin (4 mm). To find an outline, it looks just beside each line, on both sides. The line is an outline when one side sees nothing, a surface more than 50 mm further back, or another part behind it. So each part keeps its own outline, a plate on a flange too.
- Gaps. A line that goes behind something stops a little before it, so the depth reads better. The gap is as wide as an outline.
- No double lines. Lines that lie on top of each other in the same part are merged, and a thin line under a thick one is removed.
- Widths for a size. `--size 96` (or "96 px" in the playground) says the drawing will be shown 96 px wide. Then the outlines are 2 px and the inner lines 1 px, so a small logo keeps readable lines. Small drawings also show less: no bolts at 160 px or less, no plates at 64 px or less, no secondary beams at 40 px or less (`DETAIL` in `steel.ts`).

`--flat` (or "One" in the line weights of the playground) draws every line at one width, as before, with no gaps. In the playground, the line weights are on auto by default: one weight in the 3D view, two in the SVG and in "Copy SVG".

The test rig (parts of kind `rig`) is drawn lighter than the specimen. In the SVG, its parts have the class `g` and the color `var(--rig, #9e9e9e)`, so a page can set `--rig`. Its lines are thinner: 0.7 times the width in the painter renderer, and in `hlr.ts` its outline is no heavier than its inner lines. In the 3D view, `setColors({ bg, fg, accent, rig })` sets the rig color. Without `rig`, it is half way between `fg` and `bg`. The playground uses `--fg-muted`, and its tooltip adds "(test rig)" to the name of a rig part.

The build animation (`--animate`) shows the parts put in place, like on a site. The columns come down from above. An arm slides in from outside the frame, along its own axis, after its plates. A bay beam is lowered between its two columns. Then the bolts pop in one by one. A part waits only for the parts it stands on, and up to three beams can fly in at the same time (`CRANES` in `steel.ts`), so a big structure builds in about 4 s. The animation has two knobs. `speed` says how fast one part comes in (2 is twice as fast). `duration` (ms, optional) says how long the whole build lasts: `timeline(parts, { speed, duration })` keeps the order and the time of each part, and moves their start times so the last part lands at the end. So a short build with slow parts has many parts in the air at once, and a long build with fast parts has pauses. If one part is slower than the whole build, all parts come at once (`shortestBuild()` gives the shortest build that keeps the order). `RenderOpts` and `Viewer.build()` take the same two. Each part has a `kind` and a `from` direction for this (set in `generate.ts`), and `timeline()` in `steel.ts` says when each part moves and lands. A line that a later part hides stays visible until that part lands. While a beam moves, its lines are already cut where other parts will hide it at the end, so a small hole can move with it.

To find a structure that works as a logo, `score.ts` gives each one a score from 0 to 1. It looks at the big shapes from the chosen view: do they fill a square, does the weight sit on the columns, how many members, how many members cross each other. `pick.ts` scans many seeds and lists the best ones (450 structures take about 2 s). In the playground, "Find good seeds" does the same for 200 seeds and shows the best 8.

```sh
node pick.ts --count 150 --arms 4,5,6 --top 12 --sheet best.html  # best.html shows the 12 best drawings
```

It needs Node 24 or newer. Node runs the `.ts` files directly. Install the deps once (Vite and Vue for the playground, esbuild for a test, TypeScript for the type check):

```sh
pnpm install                                          # once
node --test                                           # solver, member checks and geometry tests
pnpm run type-check                                   # checks the types (Node only strips them)
node cli.ts --seed 5 --view iso --frames --out s5.svg # one structure, plus build frames
pnpm dev                                              # the playground, with live reload
pnpm build                                            # the playground as a static site in dist/
```

Files:

- `vec.ts`: vector helpers.
- `sections.ts`: section properties (I, tube, rod, round tube, channel, double angle, tee) from the CSV tables. The rods and the tees are made in code. No table has a round tube (CHS): only a specimen gives one.
- `sections/`, `tables.ts`: the CSV tables (see `sections/README.md`), and how Node reads them.
- `solver.ts`: 3D frame solver (6 DOF per node, pinned ends, finds mechanisms), and the buckling analysis (`alphaCr`).
- `checks.ts`: the member checks (AISC 360-22 E3, F2, F6, H1-1).
- `generate.ts`: topology, the fix loop, trusses and rods, posts and beam splices, and the sizing. Also the specimen path (`buildSpecimen`), and it sends a brace test, a column test (also HSS) or a link test to `bench.ts`.
- `bench.ts`: a brace test, a column test or an EBF link test in its rig (`buildBrace`, `buildColumn`: standing, or lying for 3PB, `buildLink`).
- `specimen.ts`, `specimens/`: a real test as input (the `Specimen` type, the section lookup), and hub records as examples and test data.
- `hub.ts`: reads a record of the hub test tables as a `Specimen` (`toSpecimen` and one reader for each table).
- `hub-count.ts`, `hub.test.ts`: read every row of resslab-hub-data and count what we can draw (`node hub-count.ts [folder]`). See "How many hub tests we draw".
- `rig.ts`: the test rig parts (reaction blocks, pins, links, actuators, rollers, rig frame members).
- `steel.ts`: geometry (profiles, copes, plates, clevis, bolts), camera and the painter renderer.
- `clash.ts`: do two parts go through each other (each part as a few boxes).
- `score.ts`, `pick.ts`: the logo score, and the scan over many seeds.
- `hlr.ts`: the exact hidden-line renderer, with bolt heads as real hex solids. No package. `hlr.test.ts` checks it on small cases.
- `webgl.ts`: the 3D view of the playground, in plain WebGL2.
- `triangles.ts`: the triangles of a flat face, for `webgl.ts` and `hlr.ts`.
- `cli.ts`: the command line.
- `app/`, `vite.config.ts`: the playground, a Vue app served by Vite.
- `index.ts`, `3d.ts`: the two entries of the package (see below).
- `package.test.ts`: checks that the light entry and the 3D entry load no package and no Node API.
- `tsconfig.lib.json`, `release.sh`: the package build, and the release tag.

`dist/`, `lib/` and the SVGs are build output, they stay out of git. `lib/` is only in the commit of a release tag.

## Use as a package (RESSLab Hub)

The repo is also the package `@epfl-enac/steel-viz`. It is not on npm. The hub takes it from a git tag:

```json
"@epfl-enac/steel-viz": "github:EPFL-ENAC/steel-viz#v0.1.0"
```

It has two entries:

- `@epfl-enac/steel-viz`: the light entry. `generate`, `loadCatalog`, the exact drawing `renderHLR`, the painter `render`, `timeline`, `camera`, `VIEWS`, and the specimen input (`toSpecimen`, `fromHubConnection`, `fromHubBrace`, `fromHubColumn`, `fromHubHssColumn`, `fromHubEbf`). It loads no package. `package.test.ts` checks it. Use it for the loading animation and the SVG drawings.
- `@epfl-enac/steel-viz/3d`: `createViewer` (the WebGL view). It loads no package either, but it is bigger. Import it with a dynamic `import()`, only on the page that needs it, so it stays out of the main bundle.

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

For the EU family, pass `european-sections.csv` and `hss-european-sections.csv` with `'eu'`. A test of the hub goes through `toSpecimen(record)` (or `fromHubConnection`, `fromHubBrace`, `fromHubColumn`, `fromHubHssColumn`, `fromHubEbf`), then `generate({ specimen }, catalog)`.

The hub has no channel or angle table, so this catalog has no channels and no double angles: the braces and the secondary beams keep their tube and I sections. The tees still come, because they are made from the I table. To get the same drawing as here, also pass the channel and angle CSV files of `sections/` (`loadCatalog('aisc', iCsv, hssCsv, channelCsv, angleCsv)`). For no other shape at all, pass `shapeP: 0` to `generate()`.

The package has no dependency, so the hub installs nothing else. For the 3D view:

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
- The settings (seed, form, shapes, view, viewer...) live in the URL hash. A reload keeps them, and you can send the link.
- Above the controls: the branch, its commit, and if it has changes not committed.
- "Compare with main" (in View, dev server only) draws the same structure twice, side by side, in the viewer you picked (3D, SVG or both): this checkout on the left, the code of `main` on the right (the merge base, so only what the branch changed). Turn one and the other turns too, and in 3D the zoom and pan follow. When the base viewer has no `setFrame()` (main before this), the dev server leaves it out of the base bundle, and the page draws the base structure with the viewer of this checkout. The label of the view says "viewer of this branch" then. The title block says "same parts" or what differs (new, gone and changed parts, the column, the status), with the list of part ids. `PLAYGROUND_BASE` picks another base branch. That code comes from `git archive`, in `node_modules/.cache/steel-viz-base/`. An old link with `viewer=diff` opens in SVG with compare on.

The controls are in a rail of sections you can fold: structure, layout, details, view, animation, good seeds, analysis. A section says how many of its settings are not on their default, and has a button to reset them. The browser keeps which sections are open. The rail uses the EPFL design tokens and CSS, copied in `app/epfl/` (see its README). The dark theme is ours. On a phone, the drawing comes first and the rail under it.

"Build time" is 0 by default: no animation, a change draws the new structure at once. Over 0, each change plays the build in that time, and "Play again" plays it once more. "Build time" and "Part speed" (×0.25 to ×4) are the two knobs of `timeline()`. Under them, the rail says about how many parts are in the air at once.
