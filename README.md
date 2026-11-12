# steel-viz

Steel structures drawn like a technical drawing, with a 3D view and a build animation. It started as a test for the RESSLab Hub logo (RESSLab-Team/resslab-hub#263).

What RESSLab Hub uses it for:

- Now: the logo. The hub takes an exported SVG, not this code.
- Next: the build animation as a loading animation, then a view of each experiment in the hub. For that, the repo is also a package with two entries (see "Use as a package" below). The input for the experiments is ready: `--specimen` draws a beam-to-column test, a brace test or a column test from its real sections, not from a seed (see below).

What comes next is in [ROADMAP.md](ROADMAP.md).

It builds a steel structure from a seed, in one of three forms:

- Tree: one column on a base plate, with arms, braces and secondary beams.
- Portal: two columns with beams between them, on one or two storeys, and a few arms out of the columns. A portal can get a pitched roof on its top bay beam (see "Gable portal").
- Box: four columns in a rectangle. Beams and braces stay in its four walls, nothing sticks out of them.

Each bay storey gets its own bracing: none (moment connections), knee braces at both ends, a chevron (two braces up to the middle of the beam), one diagonal, or an X (two diagonals that cross, see "X bracing"). `--form` picks the form (`mix` lets the seed pick it, a tree seed gives the same tree in both).

A small frame solver checks that the structure stands up. If it does not, the generator adds a brace or changes a pinned connection to a moment connection. Then it sizes each member from the AISC or EU section tables in `sections/`. The I and tube tables are copies of RESSLab Hub (from `frontend/src/assets/connection/` and `frontend/src/assets/hss/` in the hub). Copy them again when the hub changes them. The channel, angle and round tube tables are ours until the hub has them. `sections/README.md` says where they come from and how to make them again. The tees are not in a table: a tee is an I cut in two (`W16X50` gives `WT8X25`, `IPE 300` gives `1/2 IPE 300`).

Some members get another shape, from a draw of their own. `shapeP` gives the chance (0.35 by default, `--shapes` in the CLI, "Channels, angles, tees" in the playground):

| member | usual shape | other shape |
|---|---|---|
| the braces of an arm (all of them, one draw per arm) | square tube, on a gusset with a knife plate | double angle (two angles back to back, long leg from 75 to about 200 mm), bolted on a gusset plate that sits in the gap between the angles (`gusset_lap`). Or one angle on a small brace (see below). |
| the diagonals of a truss (all of them, one draw per truss) | square tube, on a gusset with a knife plate | double angle, bolted on a lap plate, as for a brace. On a tee chord, the lap plate is welded on the tip of the stem, in its plane, so the two angles sit on each side of the stem. If one diagonal has no room for its two lap plates (a short diagonal of a low truss), all the diagonals of the truss stay square tubes |
| a secondary beam | I | channel (C, MC, UPN, UPE), coped like an I, on the same shear tab |
| a truss bottom chord | I | tee (WT, or half an IPE or HE), flange down, stem up, toward the diagonals, like the bottom chord of a real truss. Each diagonal has one plate: welded on the tip of the stem, in its plane (a stem extension), it goes into the slot of the tube and is welded there. The stem, the plate and the tube are in one plane, with no bolts. A double angle diagonal is bolted on this plate instead, one angle on each side. The axis of each diagonal meets the chord on its centroid, so the diagonals put no moment in the chord. |

The sizing rules are the same for both shapes: L / r under 200 for a brace, a secondary fits between the flanges of its arm, the same depth limits for a chord. A tee chord gets only one continuity plate in the column, at its flange (the bottom), and no stiffener at the truss nodes: the diagonals land on its stem. The solver model keeps the nodes on the top line of the chord, as for an I chord. Every tee chord has its stem up, so this takes no random draw. Each draw is seeded from the member id, so it takes nothing from the other draws. With `--shapes 0`, a seed gives only I, tube and rod members, as before these shapes.

One angle braces. Half of the arms with angle braces try one angle first (one more draw per arm, on its own stream, only for these arms). The list has the single angles first, then the double angles, so a small brace gets one angle and a big one still gets two. The angle is bolted by one leg on the gusset plate (two bolts), its back on the plate face, like the hub brace tests (`sideShift()` in `bench.ts`). Its legs go from 50 to 155 mm. Its compression check is E5 (see the checks below). The sizing keeps Lc / r of E5 under 200, and b / t of each leg under 0.71 sqrt(E / Fy), so it needs no E4. On a column web, its outstanding leg must fit between the column flanges. A short brace never takes one angle.

Unequal angles. A double angle or one angle can have unequal legs, the long leg always on the gusset (`d` of the section). One angle keeps its legs under 1.7 to 1 (E5 is written for that). The AISC table had its unequal angles already, the EU table takes the small ones from blue-prints (`sections/README.md`). The X braces keep the equal angles only.

Some arm braces and truss diagonals are round tubes (CHS and pipes, 60 to 300 mm), from a draw of their own. `roundP` gives the chance (0.3 by default, `--round-tubes` in the CLI, "Round tubes" in the playground). It is one draw per arm, on its own stream, keyed by the arm, so with `roundP` 0 a seed gives the same parts as before. A double angle comes first: a round tube only takes the place of a square tube. A round tube brace has one of two ends, from the same draw:

- Slotted tube on a knife plate (`gusset`): the same end as a square tube. The knife plate goes into a slot cut in the tube.
- End cap plate (`gusset_cap`): a round plate welded on the tube end, and a tab welded on the cap, bolted on the gusset. No slot. On a tube of 114 mm or more (`CAP_WIDE_D`), the tab has the same 4 bolts as the knife plate (151 mm wide). From 82 to 114 mm, the tab has one line of 2 bolts on the brace axis, so it is 76 mm wide (2 edge distances), and the gusset is narrower too. A tube under 82 mm (`CAP_MIN_D`, in `steel.ts`) keeps the slot. Why 82 mm: the tab is welded on the cap all around, with a 6 mm fillet, so the tab and its weld need a circle of 91 mm on the cap. The cap is the tube plus a 5 mm lip on each side, for its own weld on the tube. So d + 10 >= 91.2. In the tables, this gives the cap to the tubes of 88.9 and 101.6 mm, and not to the ones of 76 mm and less.

The diagonals of a truss take the same draw as the braces of an arm: one draw per truss, keyed by the arm (`arm3-webs`), so all the diagonals of a truss have the same kind and the same end. A double angle comes first here too. A diagonal is short, so the smallest round tube that holds is often under 82 mm. When the draw gives end caps, the diagonals take a round tube of 82 mm or more, so they can have the cap. On a low truss, a round tube diagonal has the small gusset and no cap, like a short brace. If one diagonal of the truss finds no section that fits, all of them stay square tubes.

A round tube has 12 sides in the drawings (a rod has 16). With 12, no line runs along the tube, and the width changes by 3 % only with the view. Its long sides have no line of their own: the outline comes from the renderer (`hlr.ts`, and the outline pass of the 3D view, also with one weight).

A full brace needs 1 m along the arm and down the column. On a tree at the default height (2500 mm), this never fits. So a tree arm that `braceP` picks and that has no room for a full brace can get a short one. `shortBraceP` gives the chance (0.5 by default, `--short-braces` in the CLI, "Short arm braces" in the playground). It is one draw per arm, on its own stream, keyed by the arm, so with `shortBraceP` 0 a seed gives the same parts as before. Portals and boxes never get a short brace, so they don't change.

A short brace goes at 45 degrees, or flatter down to about 30 degrees when the tube would be too short. It reaches at most 0.6 of the arm, and its tube is at least 250 mm long between the gussets. It has the small gusset of the low truss, with one row of 2 bolts (a double angle keeps its lap plate, and a round tube gets no end cap). It never gets one angle. It can go down to 500 mm from the floor, and 450 mm above the arm below it. To keep this fit after the sizing:

- The arm stays 310 mm deep or less, and the brace 150 mm or less.
- The column stays 400 mm deep or less, if the arm is on a column flange.
- The arm gets no truss, and an end plate takes the place of flange plates.

On seeds 1 to 40, 13 trees get a short brace with the default values, 30 with `braceP` 1, and 38 with `braceP` 1 and `shortBraceP` 1.

The sizing works in two steps, with public formulas from EC3 (Eurocode 3) and AISC 360-22. First the load cases:

- Gravity: the self weight, the load on the arms, half of it on the secondaries, the point load on a post top.
- Gravity and a side load along +x, -x, +y or -y, so 4 more cases. These are the notional loads, small side loads for the frame imperfections. At each node of a column, the side load is phi times the vertical load that enters the column there (EC3 5.3.2 figure 5.4). The beams get no side load, so a beam does not bend about its weak axis for it.
- For `aisc`, phi is 0.002 (AISC 360-22 C2.2b).
- For `eu`, phi is 1/200 × alpha_h × alpha_m (EC3 5.3.2(3)). alpha_h = 2 / sqrt(h), with h the height in m, kept between 2/3 and 1. alpha_m = sqrt(0.5 (1 + 1/m)), with m the columns in one row along the side load that carry at least half of the mean column load. Up to 4 m high, a tree gets 1/200, a portal about 1/231 in its plane and 1/200 across.

The solver factors the stiffness matrix once. Each side case is one more back substitution (`sideCase()` in `solver.ts`). Specimens get the gravity case only. The log gives phi, for example `notional loads 0.002 of the vertical loads (AISC 360-22 C2.2b)`.

1. The whole structure: the solver finds the elastic critical load factor `alphaCr`. It is how many times the load the structure takes before it buckles as a whole (a buckling analysis with the geometric stiffness, in `solver.ts`). `alphaCr` comes from the gravity case alone. The moments of every case are then multiplied by `1 / (1 - 1/alphaCr)`, for the sway effects (EC3 5.2.2). This rule needs `alphaCr >= 3`. If it is lower, the member with the most strain energy in the buckling mode gets a heavier section, and the solver runs again.
2. Each member, in `checks.ts`: flexural buckling (AISC E3), flexural-torsional buckling of tees and double angles (E4), lateral torsional buckling of I sections and channels (F2), of tees and double angles (F9) and of one angle (F10), one angle in compression (E5), weak axis bending (F6), local buckling of the wall of a round tube (F8, E7), the two together with the axial force (H1-1), and shear (chapter G). A member takes the worst of the 5 cases, and the moments of two cases are never mixed. The tooltip of the playground gives that case. The buckling length is the member length, because step 1 already has the sway. The ratio must stay under 0.6. There are no AISC phi factors, the 0.6 is the margin.

Not checked: local buckling of thin plates (E7, F3, F9, F10) except for round tubes, E4 for a channel, and the connectors of a double angle (E6). Cb is 1, which is on the safe side for cantilevers. The same AISC formulas size the EU sections too. A few trees with a cantilever truss stay under `alphaCr` 3 (eu tree 19 of the 240 structures of the tests, and also eu tree 7 with `shapeP` 0): the bottom chord sways out of the truss plane, and nothing braces it sideways. The log says it.

A round tube has no lateral torsional buckling, but its wall can buckle locally when it is thin. The checks use D / t (outside diameter over wall) with AISC F8 for bending and E7 for compression:

| D / t | bending (F8) | compression (E7) |
|---|---|---|
| up to 0.07 E / Fy | Fy Z, compact | Fcr A |
| up to 0.11 E / Fy | (0.021 E / (D / t) + Fy) S, noncompact | Fcr A |
| up to 0.31 E / Fy | the same | Fcr Ae, Ae = (0.038 E / (Fy D / t) + 2/3) A |
| up to 0.45 E / Fy | 0.33 E / (D / t) S, slender | the same |
| 0.45 E / Fy or more | refused | refused |

S is the elastic modulus, Z the plastic one. In bending, Mn is never above Fy Z. The same Mn is used about both axes. A refused tube gets the ratio Infinity, and `size()` never picks it. At Fy 345 (AISC) the limits are 42.6, 67, 189 and 274. The thinnest tube of the tables has D / t 62 (`HSS10.750X0.188`), so only the noncompact case happens with the real tables, and it changes no seed: the round tubes are braces, pinned at both ends, so they only take the small moment of their own weight. `tubes.test.ts` checks each case with numbers worked by hand.

Shear (AISC chapter G) is checked along both axes of a member: along the depth (it goes with the strong axis moment) and across. The solver gives the shear at the two ends, and with a uniform load the largest one is at an end. The sway factor of step 1 multiplies it too, like the moments. There is no interaction with the moment (AISC has none for rolled shapes).

| kind | along the depth | across |
|---|---|---|
| I, channel | web, G2.1: 0.6 Fy d tw Cv1 (kv 5.34) | flanges, G6: 0.6 Fy bf tf Cv2 for each (kv 1.2) |
| tee | stem, G3: 0.6 Fy d tw Cv2 (kv 1.2) | flange, G6 |
| angle, double angle | legs along the shear, G3 (kv 1.2) | the other legs, G3 |
| square or rectangular tube | G4: 0.6 Fy 2 h t Cv2 (kv 5), h = d - 3t | the same with bf |
| round tube | G5: Fcr A / 2, the length of the member as Lv (safe side) | the same |
| solid rod | 0.6 Fy on 3/4 of the area (not in chapter G: the peak stress of a round bar is 4/3 of the mean) | the same |

Cv1 is 1 when h / tw stays under 1.10 sqrt(kv E / Fy) (62.7 at Fy 345, 61.8 at Fy 355). It is the case for all the I sections and channels of the tables except IPE AA 450 and IPE AA 500, so in practice the web check is 0.6 Fy d tw. Shear governs on short arms with a heavy load: aisc seed 63 gets a W16X26 (same weight, deeper web) in place of a W10X26 on its arm6. `shear.test.ts` checks each row with numbers worked by hand.

The open shapes (channel, tee, double angle, one angle) get their own checks. The tables have no warping constant Cw, no shear center and no elastic modulus for them, so `checks.ts` computes them from the plates of the section (`rects()` in `sections.ts`). J is the thin wall J (the sum of b t³ / 3).

| shape | bending about the depth | across | compression |
|---|---|---|---|
| channel | F2, like an I, with Cw = (tf b'³ h0² / 12)(3 b' tf + 2 h0 tw) / (6 b' tf + h0 tw) (b' = bf - tw / 2, h0 = d - tf) and c = (h0 / 2) sqrt(Iy / Cw) | Fy Z, at most 1.6 Fy S (F6) | E3 |
| tee | F9: the lower of My = Fy S and Mcr = (1.95 E / Lb) sqrt(Iy J)(B + sqrt(1 + B²)), B = -2.3 (d / Lb) sqrt(Iy / J) | the same as a channel | E4 |
| double angle | F9: F10-2 and F10-3 with My and that Mcr, at most 1.5 My | the same as a channel | E4 |
| one angle | F10, bent about a leg with no restraint, toe in compression: Mcr = (0.58 E b⁴ t / Lb²)(sqrt(1 + 0.88 (Lb t / b²)²) - 1), 0.8 My for the LTB part, at most 1.5 My. An unequal angle takes its short leg for b: a simple approximation, lower than the long leg would give (AISC asks for the principal axes, F10.2(b)(iii)). | the same | E5 (below) |

The solver gives the size of the moment, not its sign. A chord that runs over several panels has both signs, so a tee or a double angle always has its stem (or its legs along the depth) in compression. This is the lower case, on the safe side, like Cb = 1. S is the smaller elastic modulus, to the tip of the stem.

E5 for one angle (an arm brace): both ends are loaded through the leg on the gusset, with two bolts, and nothing loads the brace along its length. So E5(a) applies: ra is the radius about the geometric axis parallel to that leg, Lc / r = 72 + 0.75 L / ra up to L / ra = 80, 32 + 1.25 L / ra after it, then E3 with that slenderness. E5 has the end eccentricity in it, so the check adds no moment for it. An unequal angle bolted by its long leg takes the same formulas. The one bolted by its short leg (E5(b)) is never drawn.

E4 for a tee and a double angle: the shear center is where the flange (or the outstanding legs) meets the stem, Cw = 0 (the E4 user note), Fez = G J / (A r0²), r0² = y0² + (Ix + Iy) / A, H = 1 - y0² / r0². Fe is the lower of Fex (flexural buckling about x) and the flexural-torsional value of E4-3, then Fcr comes from E3 as for the other shapes.

These checks make the tee chords heavier (often 2 or 3 sizes): with the stem in compression, a long and light tee buckles sideways well before Fy S. A chord on a column web must still fit between the flanges of the deepest column, like the rafter of a gable. When no tee that fits is strong enough, the chord takes the heaviest one that fits and ends over the limit. The light and wide channels (MC10X6.5) give way to deeper or thicker ones. `open-shapes.test.ts` checks each formula with numbers worked by hand.

Then come the small details, from a random draw of their own, so a seed keeps the same structure:

- Column splice (on about a third of the structures): above a free level between 30 and 70 % of the height, the columns change to a lighter section, sized from the forces up there. A bearing splice is a cap plate and a base plate bolted at the corners. A flange splice has bolted plates on both flanges and on the web, with fill plates when the two sections don't have the same depth. If the plates would go through a brace or its gusset (a steep brace, or a wide double angle), the splice moves to the nearest free height, or is left out.
- A cap plate on top of each column.
- Continuity plates: plates across the column, at the flange levels of each moment beam that lands on a column flange.
- Stiffeners in a beam, over the point where a brace pushes on it.
- Gussets at the column foot: none, on the two flange faces, or on all four faces.

Trusses and tension rods also come from a draw of their own, after the fix loop:

- Truss: a beam gets a bottom chord 700 to 900 mm under it, with diagonals in a zigzag between the two. In a bay, both ends of the zigzag are on the bottom chord. On an arm, it ends at the tip on the top chord. The truss takes the place of the braces of that beam, but not of a short brace. A box beam gets a truss less often than a portal beam, because a box has 4 to 8 bay beams. A tree arm gets a lower truss, 450 to 650 mm, so it fits above the arm below it on the same face. It ends at the tip, on the top chord. Its tube diagonals have a small gusset with one row of 2 bolts. The diagonals are square tubes, or double angles from `shapeP` (see the shapes above), with the same checks as a brace. On seeds 1 to 40, a truss comes on 4 or 5 trees (it depends on the family), 11 portals and 12 boxes.
- Tension rod: a round bar from the column down to the top of an arm that sticks out, with a clevis (a fork and a pin) at each end. Only on an arm with no braces, and only when the column has room above it, under the next arm and its braces. A flat rod puts its clevis tab far back on the arm: when the tab goes through the end connection (the top flange plate of `flange_plates`), the rod moves out along the arm, 50 mm at a time, or it is left out when there is no room (`clearRods()` in `generate.ts`).

The solver checks the structure again with them and sizes the chords, the diagonals and the rods. If the structure does not stand up anymore, they are left out.

Then come posts and beam splices, each from a draw of its own (`postP` and `beamSpliceP` in `Params`, 0.3 each). With both at 0, a seed gives the same parts as before they existed.

- Post: a short column, 400 to 900 mm high, on the top flange of a beam. It has a base plate bolted to the flange with 4 bolts, and a cap plate. It is free at the top. It goes on an arm that sticks out (with no rod and no truss, and only if the column has room above it), or on a bay beam of the top storey. At most 2 in a structure. Its flanges are not wider than the beam flange. The solver takes it: it is fixed on the beam, and it brings the load of 800 mm of beam as a point load at its top. The solver sizes it, and if the structure does not stand up with the posts, they are left out.
- Beam splice: a bay beam of 2000 mm or more, with no truss, is cut in two pieces. Bolted plates on both flanges and on the web join them, the same plates as a flange splice of a column. The cut is between 20 and 40 % of the span from one end, where the moment is small, and clear of the end plates, the braces, the secondary beams and a post. A box gets it less often, because it has many bay beams. It is a full strength splice, so the solver keeps the beam in one piece.

### X bracing

An X is two diagonals in the same bay storey, one from each column up to the beam. They cross in the bay. Each X is one of three kinds:

- Flat bars, bolted on a lapped gusset plate at each end (`gusset_lap`, the same plate as a double angle). The two bars sit on the two faces of the plates. Where they cross, a filler plate fills the gap between them, with one bolt through the three.
- Single equal angles, drawn the same way as the flat bars.
- Rods, with a clevis at each end, like a tension rod. Each rod is off the bay plane by half its diameter plus 3 mm, so the two pass each other. A turnbuckle cuts each rod at 1/4 of its length from the lower end.

The members of an X only take tension. A slack one in compression does nothing. The solver is linear, so it takes them this way:

- In the model, each diagonal has half its section (area and inertias) and its full self weight. The two together are as stiff as one full diagonal in tension.
- In the check, the force is `2 N` in tension and there is no compression. The loads can reverse, so each diagonal is checked as the one in tension.
- They add no compression to the buckling analysis of the whole structure.

So the sizing has no buckling for them. Rods and flat bars only need the area. Angles also need `L / rmin` under 300 (`rmin` about the weak axis of one angle). A flat bar list is computed like the rods: AISC 2" to 6" wide, EU 50 to 150 mm, thickness up to a quarter of the width. The single angles are the equal angles of the angle table, legs 50 to 150 mm.

The X comes from a draw of its own, keyed by the arm id (`xP`, 0.3 by default): when `bracing` is auto and the seed picks a diagonal, the bay storey gets an X instead. `xKind` picks the kind, or the same draw does. With `xP` at 0, a seed gives the same parts as before the X. With `--bracing x`, the bays are the same as with `--bracing diagonal`, with an X in place of each diagonal. If the second diagonal doesn't fit, the bay keeps a plain diagonal.

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
| welded flanges, bolted web | `welded_tab` | column flange, column web | moment | the flanges welded like `welded`, and the shear tab on the web |
| welded flange plates | `welded_plates` | column flange, column web | moment | the plates of `flange_plates`, thick as the test says, with no bolts. The web tab has no bolts too. Specimens only. |
| welded, with a haunch | `welded_haunch` | column flange | moment | the flanges welded like `welded`, and a haunch under the bottom flange at the column face. Specimens only. |

The fix loop and the sizing only use the first four kinds. The other five come after, from a draw of their own (`connKindsP`, 0.35 by default). Each beam end takes one draw, keyed by its id like the member shapes, so the result doesn't depend on the order of the draws. Under `connKindsP`, the end gets a kind that can take the place of the one it has, and that fits where it lands. Clip angles, the two seats and the tee take the place of a shear tab. The stiffened end plate takes the place of an end plate. Each one has the same pin or moment and the same setback as the kind it replaces. So the solver, the sections and the members don't change, only the plates at the end. A secondary beam on a beam can only get clip angles or a tee. A truss chord keeps its kind.

`welded_tab` is for the WUF-B tests of the hub. No random draw picks it, only `--conn welded_tab` or a specimen. Its tab has the size of the shear tab: 10 mm thick, 115 mm from the face, one line of 2 to 8 bolts at 75 mm, as many as the clear web of the beam takes.

`welded_plates` and `welded_haunch` need numbers from the test, so only a specimen can have them: they aren't in `--conn`, the playground list or any draw. The haunch is its own part (`beam1-from-haunch`), because it runs along the beam. It stands on the beam and the column (`supports`), in this order, so in the deformed view it bends with the beam. Its box only touches the beam and the column face. The column gets one more pair of continuity plates at the bottom of the haunch, and the doubler still stops at the plates of the beam flanges.

The column splice keeps clear of the seats and the end plates. A new kind that would go through another part goes back to the old one. With `connKindsP` at 0, a seed gives the same parts as before these kinds (`params-conn-kinds-off.test.ts` checks it). With `--conn` set to one kind, there is no draw: every beam end that can take it gets it.

A detail plate that would go through another part is left out. For example, a continuity plate on the side of the web where another beam frames in.

### Skewed arms

A tree arm can leave a column flange face at 30 or 45 degrees, not at a right angle. It comes from a draw of its own (`skewP`, 0.3 by default, `--skew` in the CLI, "Skewed arms" in the playground). Each arm takes one draw, keyed by its id, like the member shapes. `skewArms()` in `generate.ts` picks the arms, `skew.ts` draws the end.

The end of the beam is cut at the skew, so it lies flat on the flange. Two details:

- Skewed end plate: the plate lies flat on the column flange, and the cut end of the beam is welded to it. It is extended like the square end plate, with 4 rows of 2 bolts. The two bolt lines are centred on the column, so every bolt goes through its flange.
- Welded: the cut end is welded right on the flange. If the cut end is wider than the column flange (`bf / cos(skew)`), it gets the end plate.

Only an arm on a flange face (0 or 180) can be skewed. The web is too thin, and too deep between the flanges. 60 degrees is out: the cut end would be 2 times as wide as the beam flange. A pinned end (shear tab) doesn't work on a cantilever, so a skewed arm always has a moment end.

On a skewed arm:

- The post and the beam splice follow the arm.
- No brace and no secondary beam: an arm that has one is not skewed.
- No truss and no rod: the draw still happens, so the other arms keep their draws, but the result is dropped.
- It doesn't turn toward a web face where an arm with a secondary beam is less than 900 mm higher or lower. Then it turns the other way, or stays square.

The solver keeps the arm on a line through the column axis. The drawn arm goes through the middle of the flange face, so it is shifted to the side by `(d/2) * sin(skew)` (100 to 150 mm). The solver ignores this shift. Only trees get skewed arms. Bay beams and specimens stay square. With `skewP` at 0, a seed gives the same parts as before skewed arms (`params.test.ts` checks it). `geometry-skew.test.ts` checks 80 trees with `skewP` 1.

### Gable portal

A portal can get a pitched roof (`gableP`, 0.35 by default, `--gable`). The bay beam becomes two rafters that go up to a ridge in the middle of the span. On a two storey portal, only the top bay beam takes it: the floor beam stays flat and keeps its bracing, its truss, its rods and its splice.

- The slope is 10 to 20 degrees. It is steeper than most real sheds, because our spans are only 2 to 3 m and a flatter roof doesn't show.
- A haunch at each eave: a deeper part under the rafter, near the column. It is 10 to 15 % of the span long (at least 300 mm, at most 40 % of a rafter), and 0.6 to 1.0 times the rafter depth. It is cut from an I, or made of welded plates. It is a web triangle and a bottom flange.
- The rafter ends are cut plumb (vertical), so they sit flat on the end plates.
- At each eave, an extended end plate on the column flange, from 90 mm over the rafter to 90 mm under the haunch, with bolts over and under each flange.
- At the ridge, two end plates bolted face to face. It is a full strength splice.
- The gable beam gets no braces, no secondary beam, no truss, no rod, no post and no beam splice. The column splice keeps clear of the eave plate. On a column web, the rafter stays narrow enough to fit between the flanges of a column. If the upper shaft of a column splice is too narrow for it, there is no column splice.

The solver takes the sloped rafters as they are. The load stays vertical. The haunch is a stiffer element (more inertia and area) with no check of its own: the rafter at the end of the haunch governs, as in a real design. The buckling length of the rafter is one rafter, from the eave to the ridge. Under the vertical load, the rafters push the column tops out. The log gives this horizontal thrust at the eaves, and the columns are sized for it. With cantilever arms on the columns, it can be negative (the rafters then pull the column tops in).

Purlins (`purlinP`, 0.5 by default, `--purlins`): half of the gables get short channels across the two rafters. Each purlin is a channel turned to the pitch of the roof, its toes up the slope. It stands on a cleat (a small plate on the rafter top flange) with one or two bolts through its web. They are 800 to 1400 mm apart, from the eave plate to the ridge plate, and 600 to 1200 mm long. The channel is the deepest one with a depth of at most 0.6 times the rafter depth. A catalog with no channel table gives no purlins. They have their own random stream: they change no other part of a seed, and with `purlinP` at 0 a seed gives the same parts as before them.

The purlins are not in the solver model. The load on the rafter already stands for the roof that the purlins carry, so adding them would count it twice. Their own weight is about 0.1 % of the rafter load. So with or without purlins, a gable gets the same sections.

The gable has its own random stream, and it always takes all its draws, in the same order. With `gableP` at 0, a seed gives the same parts as main (checked once against main, part by part, on 640 structures). The code is in `gable.ts`. `generate.ts` only calls it.

Later, the same code can take a box (the gable on the two bays of one side, with a ridge beam between them).

### The look settings

Arms, height and load are not the only knobs. These `Params` in `generate.ts` change the look too. Each one has an auto or default value. At that value the seed takes the same draws, so it gives the same structure as before (`params.test.ts` checks it on 30 seeds). Only `skewP`, `xP` and `shortBraceP` are different: at their default, some trees get skewed arms or short braces, and some bays get an X. Set them to 0 for the structures of before. When you set one, the seed still takes its draw, then the value replaces it.

| param | default | CLI | playground | what it does |
|---|---|---|---|---|
| `storeys` | 0 (auto) | `--storeys 0\|1\|2` | Layout, storeys | one or two storeys for a portal or a box |
| `spanK` | 1 | `--span 1` | Layout, span | multiplies the bay spans (0.6 to 1.6 in the playground) |
| `bracing` | auto | `--bracing none\|knee\|chevron\|diagonal\|x` | Layout, bracing | the bracing of every bay storey |
| `xKind` | auto | `--x-kind flat\|rod\|angle` | Layout, X kind | the kind of every X (see "X bracing") |
| `armL` | 0.3, 0.7 | `--arm-length 0.3,0.7` | Layout, arm length | the band of arm lengths, as a part of the height. Portal side arms take 3/4 of the band. |
| `armZ` | 0.35, 0.95 | `--arm-height 0.35,0.95` | Layout, arm height | the band of heights where arms leave the column |
| `conn` | auto | `--conn shear_tab\|end_plate\|...` (see "Beam end connections") | Layout, connections | the beam connection. A secondary beam keeps its own when it can't take this one. |
| `gableP` | 0.35 | `--gable` | Layout, gable roof | the chance of a pitched roof on the top bay beam of a portal (see "Gable portal"). At 0, the same parts as before it. At its default, some portal seeds change. |
| `purlinP` | 0.5 | `--purlins` | Layout, purlins | the chance that a gable gets purlins on its rafters (see "Gable portal"). At 0, the same parts as before them. Only gable seeds change, and only by new parts. |
| `braceP` | 0.3 | `--braces` | Details | the chance of braces on an arm |
| `secondaryP` | 0.35 | `--secondaries` | Details | the chance of secondary beams |
| `postP` | 0.3 | `--posts` | Details | the chance of posts |
| `beamSpliceP` | 0.3 | `--beam-splices` | Details | the chance of a beam splice |
| `trussK` | 1 | `--trusses` | Details | multiplies the truss chances (0 for none) |
| `rodP` | 0.4 | `--rods` | Details | the chance of a tension rod |
| `xP` | 0.3 | `--x-braces` | Details, X braces | the chance that an auto diagonal is an X |
| `colSpliceP` | 0.6 | `--col-splice` | Details | the chance of a column splice |
| `connKindsP` | 0.35 | `--conn-kinds` | Details, more connection kinds | the chance that a beam end gets one of the newer kinds (see "Beam end connections") |
| `skewP` | 0.3 | `--skew` | Details, skewed arms | the chance that a tree arm leaves its column at 30 or 45 degrees (see "Skewed arms"). 0 gives the trees of before. |
| `roundP` | 0.3 | `--round-tubes` | Details, round tubes | the chance that the braces of an arm, or the diagonals of a truss, are round tubes |
| `shortBraceP` | 0.5 | `--short-braces` | Details, short arm braces | the chance of a short brace on a tree arm with no room for a full one |

```sh
node cli.ts --seed 5 --form portal --storeys 2 --bracing chevron --conn welded --span 1.4
node cli.ts --seed 5 --form tree --arm-length 0.5,0.9 --arm-height 0.6,1
```

A setting can give a mechanism (the status says so), never a clash or a floating part (`params-*.test.ts` and `geometry-*.test.ts`, 25 seeds for each case). One known limit: above a load of 200 kN/m (the top of the slider), a tree with short braces can have clashes.

Parts must not go through each other. A secondary beam is coped (its flanges cut back) where it meets the flanges of its arm, and its plate fits between those flanges. A brace stays above the arms under it on the same face of its column, and is long enough that its two gussets don't touch. `clash.ts` checks this with boxes, and `geometry-*.test.ts` runs it on every form, 240 structures, on 72 more with every member in its other shape (`shapeP` 1), and on 72 more with round tube braces (`roundP` 1). The round tube diagonals are checked on the 120 structures of each family with `roundP` 1.

It can also draw a real test of RESSLab Hub instead of a seed: a specimen. For now it draws four kinds of test, each one in its test rig:

- A beam-to-column subassembly (the test of one connection): one column with one or two beams. That's the `connection` table of the hub, 99 of its 100 tests. The last one is a frame test, see "The frame test" below.
- A brace test: one brace, alone or in a test frame. That's the `braces` table, all its 294 tests. See "Brace tests" below.
- A column test: one column, pushed sideways at its top under an axial load. That's the `columns` table, all its 153 tests. See "Column tests" below.
- An HSS column test: one square or rectangular tube, standing like a column test, or lying on two rollers and pushed at mid span. That's the `hss_columns` table, all its 284 tests. See "HSS column tests" below.
- An EBF link test: the link of an eccentrically braced frame (the short piece of beam that yields in shear), alone or in a one bay frame. That's the `eccentric_braced_frames` table, all its 240 tests. See "EBF link tests" below.

The sections are the real ones, so there is no fix loop and no sizing. The solver runs once, and the log gives `alphaCr` and the max ratio under `--load`, only as information. The end plates, the continuity plates and the doubler plates are drawn. Splices, foot gussets, trusses, rods and posts are not.

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
- `connection`: one of the kinds of "Beam end connections" above that fit a column (`shear_tab`, `end_plate`, `flange_plates`, `welded`, `clip_angles`, `seated`, `stiffened_seat`, `tee`, `end_plate_stiffened`, `welded_tab`, `welded_plates`, `welded_haunch`). A beam alone on a pinned kind (a shear tab, clip angles, a seat, a tee) is a mechanism: the log says so, and the drawing still comes out.
- `tPlate`: the thickness of the plates of `welded_plates`, in mm. `haunch: { "depth", "length", "straight" }`: the haunch of `welded_haunch`, in mm, deep at the column face. `straight` gives a rectangle with a closing plate, not a triangle.
- `continuity: false` leaves out the continuity plates. `tContinuity` is the thickness of each plate, in mm (by default, the column flange, at least 10). `beams: []` gives a column alone.
- `doubler: { "n", "t", "w" }`: doubler plates on the column web, in the panel zone (I column only). `n` 1 puts one plate on the −x side of the web (the side the iso view looks at), `n` 2 one on each side. `t` is one plate, `w` its width (by default, and at most, the web between the flanges, centred). They stop at the continuity plates. With no continuity plates, they go 150 mm past the beam flanges, above and below (the usual 6 in).
- `load`: `beam` (the default) or `column`, what the actuators push (see the rig above).
- `slab: { "left", "right", "concrete", "rib", "ribWidth", "ribs" }`: the concrete slab on the top flange, in mm (see "The concrete slab"). `ribs` is `parallel` or `perpendicular`.

From a hub record:

- The sections come from the numbers (`d_c b_cf t_cf t_cw`, `d_b b_bf t_bf t_bw`), not from the names. The names are free text (`build up H section`) and don't link to the section tables.
- An exterior test has one beam of length `l_b`. Some exterior tests give the whole span in `l_b`: if `l_o` is under 0.7 `l_fc`, the beam ends at `l_o` from the column face. An interior test has two, one on each flange, `l_b / 2` each (there `l_b` is the whole span). The beams are at half the column height `h_c`.
- `t_cp` 0 means no continuity plates. Else it is their thickness (`tContinuity`). When `t_cp` is NA or missing, the plates are as thick as the column flange, and a note says so.
- `n_dp` 1 or 2 gives the doubler plates: `t_dp` is one plate, `wd` its width. The data has no height (`dz` is the clear depth between the beam flanges): we take the rule of `doubler` above. For `n_dp` 1 the data doesn't say which side, we draw it on −x.
- `specimen_type` gives the load: "Interior - Column Loaded - Subassembly" is column loaded.
- The connection is the closest one we can draw:

| hub | drawn as | not drawn yet |
|---|---|---|
| WUF-W | welded | |
| WUF-B | welded flanges, bolted web (the tab has the shear tab size, `t_pl` is NA) | |
| RBS | welded, with the cut in the beam flanges (`rbs.ts`) | where the cut is and how long: the data doesn't say, so we take a = 0.625 `b_bf` from the column face and b = 0.75 `d_b` (the middle of the AISC 358 ranges). The depth comes from `b_bf_rbs` |
| BFP | flange plates | |
| WFP | welded flange plates, thick as `t_pl` | |
| BEEP | end plate | |
| KBB | welded, with a haunch (`haunch.ts`) | the data says haunch, not Kaiser bracket: `d_h` is only on these rows, and the comments say "hanch". It has no outline, so we take `d_h` deep at the column face, `s_h` long, web and flange thick and wide as the beam, triangular unless the comments say straight (PN500C-SH) |

What we draw differently from the real test goes into the log as a note: the connection, the RBS cut, the haunch, what we take for the slab. A missing number throws an error that names the field.

```sh
node cli.ts --specimen specimens/Chi_and_Uang_2002_DC2.json --view iso   # writes steel-Chi_and_Uang_2002_DC2-iso.svg
node cli.ts --specimen connections/Chi_and_Uang_2002_DC2 --view iso      # the same test, as <table>/<id>
```

`--specimen` takes a JSON file or `<table>/<id>`. With `<table>/<id>`, it reads the row from resslab-hub-data next to the repo, as the dev server does. Without the hub data, it reads the examples of `specimens/`. `--specimen` takes the same drawing options as a seed (`--view`, `--detail`, `--animate`, `--frames`, `--painter`, `--size`). The family comes from `--family`, else from the file, else aisc. `--seed`, `--form`, `--arms` and `--height` don't apply. `specimen.test.ts` covers the two hub files, the format and the errors. `doubler.test.ts` covers the doubler plates: the hub fields, where they sit next to the continuity plates, and the panel zone.

### The frame test

One `connections` row is not a subassembly: `Del_Caprio_et_al_2014_RBS-A` ("Exterior - Frame"). The joint of the row is one joint of a small frame, 1½ bay by 1½ storey, half scale. The row gives this joint only. The rest comes from the report (Del Carpio Ramos, Mosqueda and Lignos 2014, MCEER-14-0003), in `FRAME_TESTS` of `frame.ts`. Each value from the report has a note in the log.

What we draw:

- Two W12x30 columns, 3200 mm high, each one fixed on a base plate, on an interface plate on the floor. A cap plate on each column top.
- The W14x26 girder over the bay (`l_b`, 4572 mm), then past the second column as a 2375 mm cantilever. The tip stands on a pinned link. The RBS cut of the row is at each end that is on a column: both ends of the bay beam (`rbs2` in `steel.ts`), and the cantilever near the second column.
- A doubler plate on the second column only (the report says so, the row has `n_dp` 0).
- W8x10 joists across the girder and into the column webs, under the slab. They are drawn, but they are not in the solver model.
- The slab on both beams, with an opening at each column (`holes` in `slab.ts`).
- The rig: the strong wall, a horizontal actuator on the HSS loading beam of the first column, a second one on the link member that joins the two column tops, two vertical actuators from a reaction beam, and the out-of-plane frame (two braced posts across each column, with a roller on each post).

The solver holds the column tops sideways (the top actuator and the out-of-plane frame) and the cantilever tip up (`holdFrame()`). The test has no response file, so the playground says "No measured response for this test.", and `--step` and `--peak` stop with an error. `deform-connection.ts` throws for a frame, so a response file added later gives a clear error. A second frame test needs its own entry in `FRAME_TESTS`: without it, the reader throws `specimen_type "Exterior - Frame" is not supported yet`. `frame.test.ts` has a copy of the row, so CI checks it.

### The concrete slab

14 of the 100 `connections` rows have `slab` YES, and we draw all of them. `slab.ts` draws the concrete and the deck ribs on the top flange. The reader takes `w_l`, `w_r`, `h_co`, `h_p`, `b_o` and `deck_ribs_orientation` (`perpenticular` in the data, `perpendicular` also works). If a size is missing, the steel is drawn alone and the log says so.

The data doesn't give all of it, so we take these:

| What | We take | Why |
|---|---|---|
| Slab length | from the column to 100 mm before the pin plate at the beam tip | the tip rig stays visible from above |
| Rib spacing | 305 mm | the usual 12 in of a 2 in or 3 in deck |
| Rib shape | a rectangle of width `b_o` | `b_o` is the mean width |
| Left and right | one side for all the beams, `w_r` on the right when you look along the first beam | the data doesn't say which side |
| Opening | the column plus 25 mm on each side | the column goes through with no clash |
| Behind the column | interior test: each part stops at the column axis. Exterior test: the slab goes around the column, 100 mm past its back flange | the opening stays closed |

Each beam has its own slab part, with the beam as its support. So in the deformed view the slab moves with its beam through `follow()`, with no crack model. The faces of the slab are cut at the stations of the beam, so it bends the same way. The hinge level stays |M| / Mp of the steel beam alone, and the rail says so. So a test with a slab can go above 1 (`Ricles_et_al_2004_SPEC-2` and `SPEC-5`).

The slab must not hide the RBS cut or the top of the joint, so no renderer lets it hide the steel:

- `renderHLR`: the steel lines are hidden against a scene with no slab, so they stay in full line. The slab lines are hidden against everything, and they have the class `g` of the rig.
- `render` (painter): the slab has the class `g` and no fill. Its back lines show, this is only the fast view.
- `createViewer`: a light veil on top of the steel, with its own light lines. The steel under it answers the mouse first.

Only a specimen gets a slab, so the seeds don't change. The studs are inside the concrete, so they aren't drawn.

### How many hub tests we draw

`hub-count.ts` reads every table that `hub.ts` knows from a copy of [resslab-hub-data](https://github.com/RESSLab-Team/resslab-hub-data). It reads each row as a `Specimen`, runs `generate()`, and looks for clashes and floating parts. It is a Node script: the package does not include it.

```sh
node hub-count.ts                         # looks for a resslab-hub-data folder next to the repo (or next to a parent folder, for a worktree)
node hub-count.ts ../../resslab-hub-data  # or give the folder
```

It prints one line for each table, then the errors grouped by field (November 2026):

```text
connections: 100 / 100 drawn, 0 mechanism, 0 clash, 0 floating
braces: 294 / 294 drawn, 0 mechanism, 0 clash, 0 floating
columns: 153 / 153 drawn, 0 mechanism, 0 clash, 0 floating
hss_columns: 284 / 284 drawn, 0 mechanism, 0 clash, 0 floating
eccentric_braced_frames: 240 / 240 drawn, 0 mechanism, 0 clash, 0 floating
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
| Flat Bar | a flat bar, `b_br` x `t_br`, on the middle of its end plates |
| Angle | one equal angle, `d_br` x `t_br`. Its back lies on one face of the gusset, the outstanding leg points away from it. Unequal legs are not supported. The rail says when `area` is more than 5 % off the drawn section (`Jain_3L`, `Jain_7L`). |
| Double Channel | two channels, webs back to back, `ANGLE_GAP` apart, the gusset in the gap. The flange is the thicker of `t_br` and `w_br`. `area` says if `b_br` is one channel or the pair. With no `w_br`, `t_br` is two flanges, `b_br` is the pair and the web comes from `area`. The rail says when a row doesn't read the usual way. |

The stitches of a double channel (`stick_space`) are not drawn, like the ones of a double angle. The rail says when a row has them.

A brace test of our own, as JSON:

```json
{ "test": "brace", "id": "my-brace", "section": "HSS6X6X3/8", "length": 3000, "clear": 2400,
  "angle": 40, "ends": "gusset", "frame": "SBF", "plates": { "top": 12, "bottom": 12 } }
```

`brace.test.ts` covers the three hub files of `specimens/` (`Fell_et_al_HSS1-1` SB, `Takeuchi_Matsui_528` SBF, `Wakabayashi_DPC1-1` DBF), every frame with every end type, the section shapes and the errors. `angle-channel.test.ts` covers the single angles and the double channels.

### Column tests

A record of the hub `columns` table (it has an `axis_of_bending`) is a column test. `bench.ts` draws it, with no solve.

- The column is an I from `d_c`, `b_cf`, `t_cf` and `t_cw`. The name is not used (it is often "Built Up S10"). Its length is `l_c`, between the two end plates. Careful: `h_c` is the web height, not a height.
- The foot end plate is bolted to a floor block. A loading head sits on the top end plate. The head block is only as wide as the mounts of the actuators need, so the head has a base plate as big as the end plate (as thick as it, from 25 to 50 mm). The bolts go through the two plates, 25 mm outside the head block. The end plates grow when the head block needs it. An actuator pushes the head sideways, from a reaction wall. Its length follows the column, so its foot stays on the wall at the auto scale: its two pin joints plus 0.25 L, and at least the length of an axial actuator (`pushLength()` in `bench.ts`). Vertical actuators above the head bring the axial load. They hang from a crosshead (two posts and a beam).
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
- `test_configuration` CF (cantilever): the rig of a Fixed-Free column. DC (double curvature): the rig of a Fixed-Fixed column. 3PB (three-point bending): the tube lies on two rollers, and an actuator pushes it down at mid span, from a crosshead. Its length uses 0.1 L and not 0.25 L, because mid span moves half as much as the head of a standing column. For the axial load, an end plate at each end: a pin on a reaction block at one end, an actuator from a reaction wall at the other.
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

### Deformed shape of a test

A hub test has measured responses: the drift against the actuator force, the panel zone shear, the beam moment against the chord rotation. In the playground, a test with response files plays its loading protocol in the 3D view. The specimen deforms, the rig follows, and the zones that work take a color. Today this is for the beam-to-column tests (`connections`).

The responses are one or two numbers for each step, not a field of displacements. So the shape is a schematic model that matches the measured numbers. It isn't a measured shape. The rail says so and shows the scale factor. The displacements are multiplied by it. "Auto" takes the smallest of 1, 2, 5, 10 and 20 that brings the largest drift to about 0.1 rad.

How the steps line up: if all the files of a test have the same row count, row i is step i. If not, each file gets a pseudo time, its total travel in x from 0 to 1. The steps are the rows of `Global`, and the other files are read at the same pseudo time. This works because a protocol is cycles of growing amplitude, but it's an approximation. A long file is thinned to 2000 steps, and its turning points stay. Only on a very noisy file do the smallest ones go.

The connection model is in `deform-connection.ts`. The column turns with the drift θ, the panel zone shears by γ, and the beam bends by its chord rotation θb. The column takes what is left, θ − γ − θb. A beam loaded test turns all of it back about the foot pin, so the top pin stays in place and the beam tips move. A column loaded test keeps the turn, so the top actuator moves the column and the tip links turn.

A test doesn't always have all the files. The rail lists what we estimate instead:

- No `Panel_zone` file: the elastic distortion V / (G d_c (t_cw + n_dp t_dp)), at most θ / 2. The doubler plates take shear with the web.
- No beam file: half of what is left of the drift goes to the beam, half to the column. The moment comes from the actuator force.

The colors come from the data, and the rail shows each value next to its color:

- Beam hinge, in orange: |M| / Mp at the column face, over one beam depth. Mp is `z_xb` times the beam yield stress. On an RBS test the hinge is at the center of the cut, s = a + b / 2 from the column face, over the length of the cut. M at the cut is M at the face times (l_o - s) / l_o: with the beam file l_o is `l_o` of the record, with Global it is the lever of the actuator force. Mp is `z_xb_rbs` times the same yield stress. On a haunch test the hinge starts just past the haunch tip, over one beam depth, so it doesn't color the haunch. M is at `s_h` from the column face, the same way, and Mp is the one of the plain beam.
- Panel zone, in blue: |V| / Rn, between the beam flanges. Rn is `r_n_pl_m_aisc`, else `r_n_pl_n_aisc`, else `r_n_el_n_aisc`.

A test with a missing capacity has no zone for it, and the rail says why. A test with only a `Panel_zone` file has no force, so it has no beam hinge zone, and the rail says why too.

The SVG export stays the undeformed drawing. "Copy SVG at this step" gives one deformed frame, drawn by `shapeSvg()` (`renderHLR` on `deformParts()`). The command line gives the same frame with `--step`:

```sh
node cli.ts --specimen connections/Lee_et_al_2002_CR1 --step 440 --view 225,35 --out cr1-440.svg
```

The step counts from 0, like the slider, so step 440 is "441 / 637" on the page. The CLI reads the test and its response files from the same place as the page: resslab-hub-data, or with none, `specimens/` and `specimens/responses/`. The scale is the auto scale. The log gives the step, the scale, the zones and the notes. A test with no response file, or a step past the last one, stops with an error and exit code 1. `--step` doesn't go with `--animate`, `--frames` or `--painter`. The playground rounds the angles of the view, so iso is 225, 35 there and 225, 35.264 in the CLI. To get the same file as the page, give `--view 225,35`.

The files in `specimens/responses/` are copies from resslab-hub-data, which is public domain. They are the examples of the tests and of the static build. The dev server reads all the others from the hub data.

The brace model is in `deform-braces.ts`. The file gives the axial displacement and the force. The brace gets longer by the displacement, and the top end, the rig and the actuator follow. In a frame, the top sways and the pinned columns turn. In compression, past buckling, the middle moves sideways by (2 / π) sqrt(Lb Δ), with Lb the length that bends and Δ the shortening.

Δ counts from the longest length so far, less the elastic part. So a brace that was pulled far buckles at a positive displacement. `protocol()` gives this history in `Sample.lo` and `Sample.hi`.

The way it bends depends on the ends:

| ends | direction | shape | Lb |
|---|---|---|---|
| gusset | out of plane | half sine, it folds at the end of the tube | length of the tube |
| gusset, single angle | out of plane, toward the outstanding leg, never on its diagonal | half sine, it folds where the gussets end, because a gusset is one flat plate and an angle lies on its face | length between the gussets |
| fixed | weak axis, out of plane for a round or square section | (1 - cos 2πξ) / 2, the ends stay square | length of the tube |
| pin | weak axis, in plane for a round or square section | half sine | work point to work point |

The scale multiplies the axial move only. The bow stays at real size, because it is already 5 to 15 % of the length. The rail says so. Auto stops at ×10, because a short brace at ×20 loses a third of its length on screen.

Each brace has two zones. The axial zone (blue) is N / Pt in tension and |N| / Pc in compression. It drops after buckling. The hinge zone (orange) is the moment in the middle over Mp, |N| a / Mp, half of that for fixed ends. The force falls but the bow grows, so the hinge stays lit while the middle works hardest.

In a DBF the file gives the force of the two braces together. Each brace shows half of it. The second brace goes the other way, with its own history. Its hinge uses |F| - `p_t_theory`, which is an upper limit: the brace in tension hardens, and the file can't tell how much.

#### How a table adds its deformed shape

The dev server, the rail, the chart and the viewer read `DEFORMS` in `deforms.ts`. They have no rule for a table. To add a table (braces, columns, HSS columns, EBF links), do these three things:

1. Write `deform-<table>.ts` with a `DeformTable`: its `responses` (the folders in `resslab-hub-data/<table>/`), its `shape()` and its `autoScale()`. `shape()` gives one `Move` for each member and each rig part that moves, then calls `follow()`: a part with no move takes the move of the part it stands on.
2. Add one line to `DEFORMS`.
3. Copy the response files of its example tests to `specimens/responses/<table>/<Folder>/<id>.csv`, and add a test to `deform-<table>.test.ts`. Don't add it to `deform.test.ts`, because several branches add a table at the same time.

A `ResponseSpec` has two optional fields for a table whose files don't follow the usual form. `file` gives the file name of a row id, when it is not `<id>.csv`. `cols` names the two columns, when they are not the first two. A name that is not in the header throws. `deform-links.ts` uses both: the file of row 74 is `id74.csv`, and its columns are `gamma_t` and `V`.

A `Move` is the same for all tables, and the vertex shader does the same math as `movePoint()`:

- `knots`: a bend along the axis. Each knot gives the deflection `w`, the slope `t` and the turn `r` of the cross section. If `r` equals `t`, sections stay square to the axis (bending). If not, the part shears (a panel zone, an EBF link).
- `A`, `B`, `split`: two rigid moves, blended along the axis. An actuator has its cylinder on `A` and its rod on `B`, so it gets longer. A pinned link has a linear blend. A clevis tongue has `A` only: one rigid turn about its pin.

A pin joint is cut in parts, so that only the moving side turns. The mount is the base, the ears and the pin. It stays with the part it stands on. The tongue and what comes after it turn about the pin. `clevis()` returns the tongue and `<id>-mount`. `actuator()` and `link()` return the moving part and two mounts, `<id>-mount-from` and `<id>-mount-to`. The moving part keeps the id of the joint, so a table sets its move with `strutMove()` or `clevisMove()`, and it has nothing to do for a mount that follows its support. A mount has a `joint` field (the moving part, the pin, the tongue end). The drawing and the build use it to see the joint as one part: same lines, same weights, same step, and a hover lights up the whole joint. `deform-rig.test.ts` reads the pins from it. For each joint at the peak step, the test makes sure that the mount doesn't move on a static part, moves with a moving part, and meets the tongue at the pin. It also makes sure that the tongue keeps its length.

A tongue is rigid, so the end of a `rig-pin` tongue can be some mm away from the column end after a big turn.

A `Zone` is a box with a level (1 is the capacity), a `slot` for its color, a label and the ratio it shows. `ResponseSpec.slot` gives the chart the same color. `deform-connection.ts` is the example to copy. Keep every face that takes a color at least 1 mm off the edges of the box: the shader tests `<=`, so a face exactly on an edge gets jagged bands. `deform-zones.test.ts` checks it.

#### The shape of a column test

`deform-column.ts` has one model for the tables `columns` and `hss_columns`, because `buildColumn()` draws both. Each table has its own `DeformTable`, and only the way to read a step changes.

The lever is the whole distance between the ends, so the top moves θ L. The shape comes from `ends`:

| `ends` | how it bends | top slope |
|---|---|---|
| `fixed-free` | a cantilever | 1.5 δ/L |
| `fixed-flexible` | between the two, from `l_sc` / `l_c` | 1.2 δ/L at 0.75 |
| `fixed-fixed` | double curvature, the head stays level | 0 |
| `3pb` | a simple beam with the load at mid span. Mid span moves θ L/2, and the column goes straight on past the rollers. | |

The other rules:

- The column moves along the push, also when it is turned by `angle`. A bi-axial test with two files moves along the sum of the two rotations, so `Move.n` changes at each step. The signs of the files are real, so the model reads `Sample.x` and never `Sample.along`.
- The axial shortening moves the top by the file value, with its sign (the files go negative), and the column shrinks between its two ends. With no file there is no shortening, and the rail says so. `hss_columns` has no such file.
- The hinge zones are at the base, also at the top for `fixed-fixed`, and at mid span for `3pb`. The level is |M| / Mp. The file has one moment, so the top hinge uses the same level as the base.
- Mp comes from `axis_of_bending`, not from the folder of the file. `hss_columns` has M in kN m and Mp in kN mm.
- The axial load does not reduce Mp. We tried the EC3 and AISC rules on the real tests, and they spread the peak levels more. The rail gives P / Py, because a hinge can form below level 1 under a high axial load.
- The scale can go past what the rig allows. At the auto scale no real column test does this, a test in `deform-rig.test.ts` checks every step. With a scale picked by hand, the head can pass the pin of the actuator: the pins then stay two tongues apart, and the whole foot (base, ears, pin) leaves its support in one piece, because `actuatorMove()` moves its mount. The shortening stops at half the length. The rail says so in both cases.

### The drawing

The output is an SVG line drawing with the hidden lines removed. The SVG can also build itself step by step, as an animation.

Two renderers:

- `hlr.ts` (the default): exact hidden lines, in plain TypeScript (no package). It puts the triangles of all faces in a grid on the screen, and cuts out of each edge the pieces that are behind a triangle. It takes about 25 to 30 ms for one structure (about 1550 faces).
- `render` in `steel.ts` (`--painter`): the painter's trick, ported from `sculpture_render.py` (resslab-hub, branch `feat/logo-aisc`). About 5 ms, but some lines are wrong. The playground uses it only while you drag the view in an SVG mode.

The playground also has a 3D view (`webgl.ts`, the "3D" choice, on by default). It is for looking at the structure, not for export. It runs in plain WebGL2, with no three.js, and builds the geometry once per structure, so you can turn it, move it and zoom with every bolt shown, at the frame rate of the screen. Faces are filled with the background and the GPU depth buffer hides the hidden lines. Edges are thin lines: each segment is a small quad with round ends, drawn as instances and sized in the vertex shader (as three's `LineSegments2` did before). A second pass gives the thick outlines with the same rule as `hlr.ts` (a jump in depth over 50 mm, or another part behind), read from a depth and part-id texture. With one weight, this pass runs only on the parts with `round` set (rods, round tubes, the round bars of the test rig: pins, actuators, links, rollers), at the thin width: their long sides have no line of their own. That pass works per pixel, so it runs at about 3 samples per CSS px (2x on a 1x screen) and is averaged down, or the outlines would show stair steps. Each bolt has a head and a nut, with thin lines only. A bolt on a face (a `Dot` with `n`) gets its nut on the far face of the steel under its head: `grips()` in `steel.ts` finds it after `generate()`, with a ray through the clash boxes, and keeps it as `Dot.grip`. When it can't tell where the steel ends (more than 150 mm, a rig block, a stiffener in line with the bolt), the bolt has no nut. When two end plates sit back to back, one bolt goes through both, and the dot of the other plate is its far end (`Dot.far`). An anchor rod gets a nut on the base plate. Past each nut, the end of the bolt is a short bar with 12 faces. The bolts get no outline pass, so the line shader draws the 2 corners of that bar that are on its outline from the current view, and hides the 10 others. The SVG still draws the heads only. The build animation plays in 3D too, on the same `timeline()`. The lines are close to the exact drawing but not the same (no gaps, no merged lines). "Copy SVG" always gives the exact drawing from `hlr.ts`, for the current view.

The "3D / SVG / Both" switch picks the viewer. "SVG" shows the exact drawing, at full size or at a px size. "Both" puts the 3D view on the left and the exact drawing on the right, with the same view. When you turn one, the other follows. While you drag, the SVG uses the fast painter drawing, then the exact one when you let go.

In the 3D view: drag to turn, right drag (or shift drag) to move, the wheel or two fingers to zoom, double click to see the whole structure again. The view sliders follow. Hover a part with the mouse to see what it is: its type, and for a member its section, length, connections, ratio and forces (from `result.members`). The part under the mouse comes from the same part-id pass, drawn for one pixel only.

The exact renderer draws like a technical drawing:

- Two line weights. Outlines are thick (9 mm at the drawing scale) and inner edges are thin (4 mm). To find an outline, it looks just beside each line, on both sides. The line is an outline when one side sees nothing, a surface more than 50 mm further back, or another part behind it. So each part keeps its own outline, a plate on a flange too.
- Gaps. A line that goes behind something stops a little before it, so the depth reads better. The gap is as wide as an outline.
- No double lines. Lines that lie on top of each other in the same part are merged, and a thin line under a thick one is removed.
- Widths for a size. `--size 96` (or "96 px" in the playground) says the drawing will be shown 96 px wide. Then the outlines are 2 px and the inner lines 1 px, so a small logo keeps readable lines. Small drawings also show less: no bolts at 160 px or less, no plates at 64 px or less, no secondary beams at 40 px or less (`DETAIL` in `steel.ts`).

`--flat` (or "One" in the line weights of the playground) draws every line at one width, as before, with no gaps. In the playground, the line weights are on auto by default: one weight in the 3D view, two in the SVG and in "Copy SVG".

The test rig (parts of kind `rig`) is drawn lighter than the specimen. In the SVG, its parts have the class `g` and the color `var(--rig, #9e9e9e)`, so a page can set `--rig`. Its lines are thinner: 0.7 times the width in the painter renderer, and in `hlr.ts` its outline is no heavier than its inner lines. In the 3D view, `setColors({ bg, fg, accent, rig })` sets the rig color. Without `rig`, it is half way between `fg` and `bg`. The playground uses `--fg-muted`, and its tooltip adds "(test rig)" to the name of a rig part.

The build animation (`--animate`) shows the parts put in place, like on a site. The columns come down from above. An arm slides in from outside the frame, along its own axis, after its plates. A bay beam is lowered between its two columns. Then the bolts go in one by one (see bolts and welds below). A part waits only for the parts it stands on, and up to three beams can fly in at the same time (`CRANES` in `steel.ts`), so a big structure builds in about 4 s. The animation has two knobs. `speed` says how fast one part comes in (2 is twice as fast). `duration` (ms, optional) says how long the whole build lasts: `timeline(parts, { speed, duration })` keeps the order and the time of each part, and moves their start times so the last part lands at the end. So a short build with slow parts has many parts in the air at once. With the effects on (below), a build that is shorter than `duration` never waits: all of it slows down by the same factor (each part, each bolt, each weld), so something always moves, and `speed` has no effect then. With the effects off, it moves the start times as before, so there are pauses. If one part is slower than the whole build, all parts come at once (`shortestBuild()` gives the shortest build that keeps the order). `RenderOpts` and `Viewer.build()` take the same two. The CLI takes them with `--animate`: `--speed 2` and `--duration 8` (in s, like the playground). Without `--duration`, the build keeps its own length. The painter (`--painter`) has no knobs. Each part has a `kind` and a `from` direction for this (set in `generate.ts`), and `timeline()` in `steel.ts` says when each part moves and lands. A line that a later part hides stays visible until that part lands. While a beam moves, its lines are already cut where other parts will hide it at the end, so a small hole can move with it.

Bolts and welds: with the effects on (the default), the build looks more like a real site. The parts also come in slower than with no effects, each kind at its own pace (`FX_MS` in `steel.ts`: a column 1100 ms, a beam 1000 ms, a plate 450 ms), so you have time to see them arrive and fit.

- A bolt comes in along its axis, then screws in, then its nut goes on and screws in. The bolts of a part go one after the other, `SCREW_GAP` (100 ms) apart, and each one takes `SCREW_MS` (2300 ms): the head the first `BOLT_IN` (45 %), the nut the rest. So a plate of 8 bolts takes 3000 ms. Each piece first comes close with no turn (the first `SEAT_AT`, 45 % of its time, from 250 mm to 14 mm). It starts still and slows down at the end (a smoothstep), so we see where it comes from. Then it turns and goes in with the turn, like on a thread, and slows down to the end. In 3D, the head turns 240° (`HEAD_TURN`) and the nut 360° (`NUT_TURN`). A hex turned by 60° looks the same, so a turn faster than about 30° a frame looks still, or backward: a test keeps them under 12° a frame at 60 fps. In 3D, the whole bolt shows while it goes in: the shank, with a coarse thread (a helix, 6 mm a turn) that turns with it. At rest the shank is in the steel and in the nut, so it is hidden and the drawing stays the same. In the SVG, a bolt head fades in 12 head sizes out, glides close along its axis, then goes in slowly, with no turn (a hex that turns, seen at an angle, looks like a wobble).
- A site weld is made: a bright spark runs along the seam and leaves an orange bead, which cools and goes. `Part.welds` gives the seams, as 3D segments in mm, in the order the welder goes. A seam belongs to the part that comes last. Shop welds (gussets, shear tabs, the end cap of a tube) have no seam. At rest no seam is drawn, so compare still says "same parts".
- The anchor nuts of a base plate screw down after the plate lands (3D only).
- A part slows down as on a log scale: its speed goes with the way it has left, `land(t) = (1 - e^(-3t)) / (1 - e^(-3))` in `steel.ts`. It starts at 3 times its mean speed and touches down at 0.16 times, so it never crawls at the end. The SVG has the same curve as a CSS `cubic-bezier` (`LAND_CSS`, a test checks they stay close). With the effects off, it is the cubic ease of before.
- The slab is poured: it shows in place, little by little, and doesn't slide in.

All these times are in the slots of `timeline()` (`Slot.bolt`, `Slot.weld`, `Slot.nuts`), so the SVG and the 3D view play the same build. Nothing waits for a bolt, a weld or a nut, so only the end of the build moves a bit. `slotEnd()` counts them, so `duration` fits them too. In the 3D view, one shader chunk (`SCREW`) moves the heads and the nuts, with no new draw call per bolt, and one more draw call draws all the seams. The SVG uses CSS only, and `prefers-reduced-motion` stops it and hides the welds. At the end of the build, the drawing is the same as at rest.

To turn the effects off:

- `timeline(parts, { effects: false })`, `RenderOpts.effects: false`, `viewer.build(speed, duration, false)`.
- `--plain` with `--animate` in `cli.ts`, and with `--at-ms` in `shot.ts`.
- The "Bolts and welds" toggle in the animation section of the playground (`effects=0` in the URL hash).

With the effects off, the build is the one of before: the parts only fly in and the bolts pop in. The animated SVG is then the same file as before.

To find a structure that works as a logo, `score.ts` gives each one a score from 0 to 1. It looks at the big shapes from the chosen view: do they fill a square, does the weight sit on the columns, how many members, how many members cross each other. `pick.ts` scans many seeds and lists the best ones (450 structures take about 2 s). In the playground, "Find good seeds" does the same for 200 seeds and shows the best 8.

To find a structure that works as a teaching sculpture, `score.ts` also gives its variety: how many different kinds of detail it shows, from a fixed list of 28 (`VARIETY_KINDS`). One kind is one detail a student can point at and name: a beam end kind, a splice, a truss, a tension rod, a post, foot gussets, a member shape, a kind of X brace. On the default seeds it goes from 4 to 16, with a mean of about 7.6. A box shows the most. Some kinds are rare: a round tube only gets its end caps from 82 mm, so only about 1 seed in 65 has them.

The logo score and the variety have almost nothing to do with each other, so a seed can be good at one and bad at the other. The mix takes half of each, and counts 12 kinds or more as a full variety. `pick.ts --by logo|variety|mix` says what to sort by (logo if you don't give it). "Find good seeds" has the same choice in "Sort by", and a new sort uses the last scan again. The Analysis section of the playground shows the variety of the current seed, with its kinds.

```sh
node pick.ts --count 150 --arms 4,5,6 --top 12 --sheet best.html  # best.html shows the 12 best drawings
node pick.ts --by variety --top 12 --sheet v.html                 # the seeds with the most kinds of detail
```

It needs Node 24 or newer. Node runs the `.ts` files directly. Install the deps once (Vite and Vue for the playground, esbuild for a test, TypeScript for the type check):

```sh
pnpm install                                          # once
pnpm test                                             # solver, member checks and geometry tests (3 files at once)
pnpm run type-check                                   # checks the types (Node only strips them)
node cli.ts --seed 5 --view iso --frames --out s5.svg # one structure, plus build frames
pnpm dev                                              # the playground, with live reload
pnpm build                                            # the playground as a static site in dist/
```

Files:

- `vec.ts`: vector helpers.
- `sections.ts`: section properties (I, tube, rod, round tube, channel, double angle, tee) from the CSV tables. The rods and the tees are made in code. The round tubes (CHS and pipes) are in `Catalog.pipes`, not in `all`, so a specimen finds its section by name as before.
- `sections/`, `tables.ts`: the CSV tables (see `sections/README.md`), and how Node reads them. `tables.ts` also reads a hub test and its response files for `cli.ts` and `shot.ts`.
- `solver.ts`: 3D frame solver (6 DOF per node, pinned ends, finds mechanisms), the buckling analysis (`alphaCr`), and the side load cases on the same factored matrix (`sideCase()`).
- `checks.ts`: the member checks (AISC 360-22 E3, E4, E7 and F8 for round tubes, F2, F6, F9, F10, H1-1, G for shear). `tubes.test.ts` checks the round tubes, `shear.test.ts` the shear, `open-shapes.test.ts` the channels, tees and angles.
- `generate.ts`: topology, the fix loop, trusses and rods, posts and beam splices, and the sizing. Also the specimen path (`buildSpecimen`), and it sends a brace test, a column test (also HSS) or a link test to `bench.ts`.
- `skew.ts`: the end of a skewed arm: the cut end, its clash boxes, the skewed end plate.
- `slab.ts`: the concrete slab of a beam-to-column test. See "The concrete slab". `slab.test.ts` checks it.
- `bench.ts`: a brace test, a column test or an EBF link test in its rig (`buildBrace`, `buildColumn`: standing, or lying for 3PB, `buildLink`).
- `specimen.ts`, `specimens/`: a real test as input (the `Specimen` type, the section lookup), and hub records as examples and test data.
- `hub.ts`: reads a record of the hub test tables as a `Specimen` (`toSpecimen` and one reader for each table).
- `hub-count.ts`, `hub.test.ts`: read every row of resslab-hub-data and count what we can draw (`node hub-count.ts [folder]`). See "How many hub tests we draw".
- `deform.ts`: the deformed shape of a test, for all tables: how a part moves (`Move`, `movePoint`), the response files (`readResponse`), the steps (`protocol`). See "Deformed shape of a test".
- `deforms.ts`, `deform-connection.ts`, `deform-braces.ts`: the tables that have a deformed shape, the shape of a beam-to-column test and the shape of a brace test. `deform.test.ts` and `deform-braces.test.ts` check them.
- `deform-column.ts`: the shape of a column test, for `columns` and `hss_columns`. `deform-column.test.ts` checks it.
- `rig.ts`: the test rig parts (reaction blocks, pins, links, actuators, rollers, rig frame members). A pin joint is several parts: a mount and a moving part.
- `steel.ts`: geometry (profiles, copes, plates, clevis, bolts), camera and the painter renderer.
- `clash.ts`: do two parts go through each other (each part as a few boxes).
- `score.ts`, `pick.ts`: the logo score and the variety, and the scan over many seeds.
- `hlr.ts`: the exact hidden-line renderer, with bolt heads as real hex solids. No package. `hlr.test.ts` checks it on small cases.
- `webgl.ts`: the 3D view of the playground, in plain WebGL2.
- `triangles.ts`: the triangles of a flat face, for `webgl.ts` and `hlr.ts`.
- `cli.ts`, `cli.test.ts`: the command line, and the tests of its flags and of `--step`.
- `shot.ts`: a PNG of the 3D view, at any step of a test, for agents (`node shot.ts <table>/<id> --peak --out a.png`). `--compare 1|2` and `--base <ref>` shoot "Compare with main", `--theme dark` the dark theme. `--at-ms 300,900` takes frames of the build at these times (ms from its start), with `--duration` in s (default 8), `--speed` and `--plain` (no bolts and welds): it stops the clock of the viewer with `seek()`. It starts its own Vite and headless Chrome. It isn't in the package.
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

- `@epfl-enac/steel-viz`: the light entry. `generate`, `loadCatalog`, the exact drawing `renderHLR`, the painter `render`, `timeline`, `camera`, `VIEWS`, and the specimen input (`toSpecimen`, `fromHubConnection`, `fromHubBrace`, `fromHubColumn`, `fromHubHssColumn`, `fromHubEbf`). It loads no package. `package.test.ts` checks it. Use it for the loading animation and the SVG drawings. For the deformed shape: `DEFORMS`, `readResponse`, `protocol`, `deformParts`, `movePoint`, `follow`.
- `@epfl-enac/steel-viz/3d`: `createViewer` (the WebGL view). It loads no package either, but it is bigger. Import it with a dynamic `import()`, only on the page that needs it, so it stays out of the main bundle. `viewer.deform(state)` draws a `DeformState`, and `viewer.deform(null)` gives back the undeformed drawing. `viewer.show(parts, marks?)` takes an optional `Record<id, Mark>` (`Mark` is `'new' | 'gone'`): the marked parts get the colors `added` and `gone` of `setColors()`, and the others go lighter. Without marks, the drawing is the same as before.

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

The hub has no channel, angle or round tube table, so this catalog has no channels, no double angles and no round tubes: the braces and the secondary beams keep their tube and I sections. The tees still come, because they are made from the I table. To get the same drawing as here, also pass the channel, angle and round tube CSV files of `sections/` (`loadCatalog('aisc', iCsv, hssCsv, channelCsv, angleCsv, chsCsv)`). For no other shape at all, pass `shapeP: 0` and `roundP: 0` to `generate()`.

A tree of today can have skewed arms (`skewP`, 0.3 by default) and short braces (`shortBraceP`, 0.5 by default), and a bay an X (`xP`, 0.3 by default). The logo is an exported SVG, so it doesn't change. To export the same seed again with the same look, pass `skewP: 0`, `shortBraceP: 0` and `xP: 0`.

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
- "Compare with main" (in View, dev server only) has two modes. "Side by side" (`compare=1` in the hash) draws the same structure twice, side by side, in the viewer you picked (3D, SVG or both): this checkout on the left, the code of `main` on the right (the merge base, so only what the branch changed). Turn one and the other turns too, and in 3D the zoom and pan follow. When the base viewer has no `setFrame()` (main before this), the dev server leaves it out of the base bundle, and the page draws the base structure with the viewer of this checkout. The label of the view says "viewer of this branch" then. The title block says "same parts" or what differs (new, gone and changed parts, the column, the status), with the list of part ids. `PLAYGROUND_BASE` picks another base branch. That code comes from `git archive`, in `node_modules/.cache/steel-viz-base/`. An old link with `viewer=diff` opens in SVG with compare on.
- "One view" (`compare=2`) draws both structures in one 3D view, on top of each other. The new parts are green, the gone parts red, and the parts that didn't change are lighter. A changed part is there twice: its old shape in red, its new shape in green. It uses the same match as the title block (`diffParts()` in `app/diff.ts`), and `overlayParts()` makes the list for the viewer: the base copies get the id `was:<id>`. The hover is blue in this mode, and the tooltip of a red part shows the base part, with its real id. It is 3D only (`hlr.ts` has no colors).
- `base=<git ref>` in the hash picks the base for one link, for example `base=564ac4d~1` (any commit, tag or branch git knows). Without it, `PLAYGROUND_BASE` or `main`. Reload the page after you change it. `node shot.ts --seed 5 --compare 2 --base 564ac4d~1 --theme dark --out c.png` shoots it (`--compare 1` gives both panes in one image).

At the top of the rail, "Seed / Hub test" picks what to draw. "Hub test" draws a real test of the RESSLab Hub in its rig:

- In the dev server, the tables come from the `resslab-hub-data` folder next to the repo (or next to a parent folder, so a wtx worktree finds it too). `app/dev-plugin.ts` serves them read only at `/__dev/hub`. A static build has no hub data: it lists the examples of `specimens/` only, and says so.
- Pick the table, search a test by its id (or the name, for the EBF links), and walk the tests with Prev and Next, or ← and →. Shift ← → turns the view.
- The rail shows what the reader made of the record (the key fields and the notes), or its error. A row we can't draw stays in the list, and the sheet shows its error.
- "Paste a record" takes a hub record as JSON, or our own `Specimen`. The browser keeps it.
- A test with response files gets the "Deformed shape" block: play, a slider over the steps, the scale, a chart of one response with a dot on the step, and the level of each zone. `app/dev-plugin.ts` serves the files read only at `/__dev/hub/<table>/responses/<id>`. A static build has the files of `specimens/responses/` only. In "Compare with main", the right pane stays undeformed.
- The URL hash keeps the test: `specimen=<table>/<id>`. The seed settings are hidden. "Compare with main" reads the record with the reader of `main`, and says in its pane when `main` can't draw the test.

The controls are in a rail of sections you can fold: test, structure, layout, details, view, animation, good seeds, analysis. A section says how many of its settings are not on their default, and has a button to reset them. The browser keeps which sections are open. The rail uses the EPFL design tokens and CSS, copied in `app/epfl/` (see its README). The dark theme is ours. On a phone, the drawing comes first and the rail under it.

"Build time" is 0 by default: no animation, a change draws the new structure at once. Over 0, each change plays the build in that time, and "Play again" plays it once more. "Build time" and "Part speed" (×0.25 to ×4) are the two knobs of `timeline()`. With "Bolts and welds" on, a "Build time" longer than the build slows all of it down, so "Part speed" does nothing then. Under them, the rail says about how many parts are in the air at once. "Bolts and welds" turns the effects of the build on or off (see the build animation above).
