// Makes the channel and angle tables of this folder from two Python
// packages (see README.md here). Run it once when a source changes:
//   node sections/shapes.ts <steelpy dir> <structuralcodes dir>
// Each dir is an unpacked wheel. Nothing in them is run, we only read
// text: CSV files for steelpy, dict literals in .py files for structuralcodes.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [steelpy, structuralcodes] = process.argv.slice(2);
if (!steelpy || !structuralcodes) {
  console.error('usage: node sections/shapes.ts <steelpy dir> <structuralcodes dir>');
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
out('angle-european-sections.csv', 'id,d,b,t', [...dicts('_l.py'), ...dicts('_li.py')].map((r) => [spaced(r.name), r.h, r.b, r.t]));
