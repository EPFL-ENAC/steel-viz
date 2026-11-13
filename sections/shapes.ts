// Makes the channel, angle and round tube tables of this folder from three
// Python packages (see README.md here). Run it once when a source changes:
//   node sections/shapes.ts <steelpy dir> <structuralcodes dir> <blue-prints dir>
// Each dir is an unpacked wheel. Nothing in them is run, we only read text:
// CSV files for steelpy, dict and tuple literals in .py files for the others.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [steelpy, structuralcodes, blueprints] = process.argv.slice(2);
if (!steelpy || !structuralcodes || !blueprints) {
  console.error('usage: node sections/shapes.ts <steelpy dir> <structuralcodes dir> <blue-prints dir>');
  process.exit(1);
}

const out = (file: string, head: string, rows: (string | number)[][]) => {
  writeFileSync(new URL(`./${file}`, import.meta.url), [head, ...rows.map((r) => r.join(','))].join('\n') + '\n');
  console.log(`${file}: ${rows.length} rows`);
};

// AISC, inches -> mm, rounded to 0.1 mm
const mm = (x: string) => Math.round(+x * 254) / 10;
const csv = (file: string) => {
  const [head, ...lines] = readFileSync(join(steelpy, 'steelpy', 'shape files', file), 'utf8').trim().split(/\r?\n/);
  const keys = head.split(',');
  return lines.map((l) => Object.fromEntries(l.split(',').map((c, i) => [keys[i], c.trim()])));
};
// steelpy writes the dot and the fraction both as `_`: C15X33_9, L12X12X1_3_8
const channelName = (s: string) => s.replace(/_/g, '.');
const angleName = (s: string) =>
  s.split('X').map((p) => {
    const q = p.split('_');
    return q.length === 3 ? `${q[0]}-${q[1]}/${q[2]}` : q.length === 2 ? `${q[0]}/${q[1]}` : p;
  }).join('X');

const channels = [...csv('C_shapes.csv'), ...csv('MC_shapes.csv')];
out('channel-aisc-sections.csv', 'id,d,bf,tw,tf', channels.map((r) => [channelName(r.shape), mm(r.d), mm(r.bf), mm(r.tw), mm(r.tf)]));
out('angle-aisc-sections.csv', 'id,d,b,t', csv('L_shapes.csv').map((r) => [angleName(r.shape), mm(r.d), mm(r.b), mm(r.t)]));
// round HSS and pipes: HSS6_625X0_280 -> HSS6.625X0.280, Pipe3_1_2STD ->
// Pipe3-1/2STD. t is tdes, the design wall (0.93 tnom), the one AISC uses
// for A, I and Z.
const pipeName = (s: string) => {
  const q = s.split('_');
  return q.length === 3 ? `${q[0]}-${q[1]}/${q[2]}` : q.length === 2 ? `${q[0]}/${q[1]}` : s;
};
out('chs-aisc-sections.csv', 'id,d,t', [
  ...csv('HSS_R_shapes.csv').map((r) => [channelName(r.shape), mm(r.OD), mm(r.tdes)]),
  ...csv('PIPE_shapes.csv').map((r) => [pipeName(r.shape), mm(r.OD), mm(r.tdes)]),
]);

// structuralcodes: `'UPN80': {'h': 80.0, 'b': 45.0, ...}`, values in mm
const dicts = (file: string) => {
  const text = readFileSync(join(structuralcodes, 'structuralcodes', 'geometry', 'profiles', file), 'utf8');
  return [...text.matchAll(/'([^']+)':\s*\{([^}]*)\}/g)].map(([, name, body]) => ({
    name,
    ...Object.fromEntries([...body.matchAll(/'(\w+)':\s*([\d.]+)/g)].map(([, k, v]) => [k, +v])),
  })) as ({ name: string } & Record<string, number>)[];
};
const spaced = (name: string) => name.replace(/^([A-Z]+)/, '$1 '); // UPN80 -> UPN 80
out('channel-european-sections.csv', 'id,d,bf,tw,tf', [...dicts('_upn.py'), ...dicts('_upe.py')].map((r) => [spaced(r.name), r.h, r.b, r.tw, r.tf]));
// blue-prints, a profile file: `"CHS21_3x2_3": __CHSProfileParameters("CHS 21.3x2.3", 21.3, 2.3),`, in mm
const profiles = (file: string) => readFileSync(join(blueprints, 'blueprints', 'structural_sections', 'steel', 'standard_profiles', file), 'utf8');

// _li.py has only 5 sizes of unequal angles. The small ones come from the
// LNP profiles of blue-prints (`"LNP 60x40x6", 60, 40, 6, 6, ...`: long leg,
// short leg, the two thicknesses), the ones _li.py doesn't have, after its rows.
const angles = [...dicts('_l.py'), ...dicts('_li.py')].map((r) => [spaced(r.name), r.h, r.b, r.t]);
const has = new Set(angles.map(([, d, b, t]) => `${d} ${b} ${t}`));
const lnp = [...profiles('lnp.py').matchAll(/Parameters\("LNP ([^"]+)",\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/g)]
  .map(([, , d, b, t, t2]) => [+d, +b, +t, +t2])
  .filter(([d, b, t, t2]) => d > b && t === t2 && !has.has(`${d} ${b} ${t}`))
  .map(([d, b, t]) => [`L ${d}x${b}x${t}`, d, b, t]);
out('angle-european-sections.csv', 'id,d,b,t', [...angles, ...lnp]);

const chs = profiles('chs.py');
out('chs-european-sections.csv', 'id,d,t', [...chs.matchAll(/Parameters\("(CHS [^"]+)",\s*([\d.]+),\s*([\d.]+)\)/g)].map(([, id, d, t]) => [id, +d, +t]));
