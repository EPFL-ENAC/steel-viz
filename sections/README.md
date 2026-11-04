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

## Our own tables: channels and angles

The hub has no channel or angle table, so these four files are ours for now. If the hub needs them one day (its brace data has angle and channel braces), move them to the hub with a hub pull request. From then on they are copies like the others.

| file | columns | source |
|---|---|---|
| `channel-aisc-sections.csv` | `id,d,bf,tw,tf` | steelpy 1.1.1, `steelpy/shape files/C_shapes.csv` and `MC_shapes.csv` |
| `angle-aisc-sections.csv` | `id,d,b,t` | steelpy 1.1.1, `steelpy/shape files/L_shapes.csv` |
| `channel-european-sections.csv` | `id,d,bf,tw,tf` | structuralcodes 0.7.3, `structuralcodes/geometry/profiles/_upn.py` and `_upe.py` |
| `angle-european-sections.csv` | `id,d,b,t` | structuralcodes 0.7.3, `structuralcodes/geometry/profiles/_l.py` and `_li.py` |

- `d`: depth (channel) or long leg (angle). `bf`: flange width. `b`: short leg. `tw`, `tf`, `t`: thicknesses.
- The AISC values are in inches in the source, here in mm rounded to 0.1 mm. The ids are the AISC names: `C15X33.9`, `L4X3-1/2X1/2`.
- Channel flanges are tapered in the real C, MC and UPN shapes. `tf` is the mean thickness from the source. We draw parallel flanges, and no fillets, like for the I sections.
- There is no T table. A WT is a W cut in two, so `sections.ts` makes the tees from the I tables.

### Licence

steelpy (AISC Shapes Database v16.0, by the steelpy authors) and structuralcodes (by fib, the International Federation for Structural Concrete) are both under the Apache License 2.0. The four files above are derived from their data. We only keep the dimensions and change the units and the names.

### Make them again

The sandbox can't reach aisc.org, but it can reach PyPI. Get the two wheels, each in its own empty folder, and unzip them. Nothing in them is run:

```sh
D=$(mktemp -d); mkdir $D/steelpy $D/sc
curl -sL -o $D/steelpy/w.zip https://files.pythonhosted.org/packages/b0/34/648794eed665b024ee071a94042f34ce7fb9141d067ce58efa961dddf9eb/steelpy-1.1.1-py3-none-any.whl
curl -sL -o $D/sc/w.zip https://files.pythonhosted.org/packages/d1/2b/070ad77b71853dc46d74d050851811816558fc5206d672a4d2c2b6020171/structuralcodes-0.7.3-py3-none-any.whl
(cd $D/steelpy && unzip -q w.zip) && (cd $D/sc && unzip -q w.zip)
node sections/shapes.ts $D/steelpy $D/sc
```
