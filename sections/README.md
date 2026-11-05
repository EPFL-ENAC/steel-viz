# Section tables

One CSV file per table, one row per section, `id` first, dimensions in mm. `sections.ts` reads only the dimensions and computes A, I, J and W itself.

## Copies of the RESSLab Hub tables

These four files are copies. Change them in `resslab-hub` first, then copy them here.

| file | hub file |
|---|---|
| `aisc-sections.csv` | `frontend/src/assets/connection/aisc-sections.csv` |
| `european-sections.csv` | `frontend/src/assets/connection/european-sections.csv` |
| `hss-aisc-sections.csv` | `frontend/src/assets/hss/hss-aisc-sections.csv` |
| `hss-european-sections.csv` | `frontend/src/assets/hss/hss-european-sections.csv` |

## Our own tables: channels, angles and round tubes

The hub has no channel, angle or round tube table, so these six files are ours for now. If the hub needs them one day (its brace data has angle and channel braces, and round tube columns), move them to the hub with a hub pull request. From then on they are copies like the others.

| file | columns | source |
|---|---|---|
| `channel-aisc-sections.csv` | `id,d,bf,tw,tf` | steelpy 1.1.1, `steelpy/shape files/C_shapes.csv` and `MC_shapes.csv` |
| `angle-aisc-sections.csv` | `id,d,b,t` | steelpy 1.1.1, `steelpy/shape files/L_shapes.csv` |
| `channel-european-sections.csv` | `id,d,bf,tw,tf` | structuralcodes 0.7.3, `structuralcodes/geometry/profiles/_upn.py` and `_upe.py` |
| `angle-european-sections.csv` | `id,d,b,t` | structuralcodes 0.7.3, `structuralcodes/geometry/profiles/_l.py` and `_li.py` |
| `chs-aisc-sections.csv` | `id,d,t` | steelpy 1.1.1, `steelpy/shape files/HSS_R_shapes.csv` and `PIPE_shapes.csv` |
| `chs-european-sections.csv` | `id,d,t` | blue-prints 0.8.0, `blueprints/structural_sections/steel/standard_profiles/chs.py` |

- `d`: depth (channel), long leg (angle) or outside diameter (round tube). `bf`: flange width. `b`: short leg. `tw`, `tf`, `t`: thicknesses.
- The AISC values are in inches in the source, here in mm rounded to 0.1 mm. The ids are the AISC names: `C15X33.9`, `L4X3-1/2X1/2`, `HSS6.625X0.280`, `Pipe3-1/2STD`.
- For an AISC round HSS or pipe, `t` is the design wall `tdes` (0.93 times the nominal wall), the one AISC uses for A, I and Z. The EU round tubes have one wall only.
- The files have every size of the source. `sections.ts` keeps the round tubes from 60 to 300 mm.
- Channel flanges are tapered in the real C, MC and UPN shapes. `tf` is the mean thickness from the source. We draw parallel flanges, and no fillets, like for the I sections.
- There is no T table. A WT is a W cut in two, so `sections.ts` makes the tees from the I tables.

### Licence

steelpy (AISC Shapes Database v16.0, by the steelpy authors) and structuralcodes (by fib, the International Federation for Structural Concrete) are both under the Apache License 2.0. blue-prints is under the MIT License, "Copyright © 2025 Blueprints". The six files above are derived from their data. We only keep the dimensions and change the units and the names.

### Make them again

The sandbox can't reach aisc.org, but it can reach PyPI. Get the three wheels, each in its own empty folder, and unzip them. Nothing in them is run:

```sh
D=$(mktemp -d); mkdir $D/steelpy $D/sc $D/bp
curl -sL -o $D/steelpy/w.zip https://files.pythonhosted.org/packages/b0/34/648794eed665b024ee071a94042f34ce7fb9141d067ce58efa961dddf9eb/steelpy-1.1.1-py3-none-any.whl
curl -sL -o $D/sc/w.zip https://files.pythonhosted.org/packages/d1/2b/070ad77b71853dc46d74d050851811816558fc5206d672a4d2c2b6020171/structuralcodes-0.7.3-py3-none-any.whl
curl -sL -o $D/bp/w.zip https://files.pythonhosted.org/packages/b3/fc/b54ddf3459a3aa9d08a2bf8a60337274019bed836bfaee91f5d14cc7622b/blue_prints-0.8.0-py3-none-any.whl
(cd $D/steelpy && unzip -q w.zip) && (cd $D/sc && unzip -q w.zip) && (cd $D/bp && unzip -q w.zip)
node sections/shapes.ts $D/steelpy $D/sc $D/bp
```
