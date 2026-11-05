// Dev server only (Vite plugin):
// - /__dev/info: the branch, the commit, and the base commit for "vs main".
// - /__dev/base.js: the generator and the renderers of the base branch, bundled
//   from `git archive` of the merge base with PLAYGROUND_BASE (default main).
//   It sets globalThis.BASE (see app/engine.ts). Kept per commit in
//   node_modules/.cache. With its WebGL viewer (and three.js) only when that
//   viewer has setFrame(): an older one can't zoom with ours, so the page
//   draws the base structure with the viewer of this checkout (app/engine.ts).
//   With toSpecimen() when the base has it, so main reads a hub test itself.
// - /__dev/hub: the hub tables we can serve, { tables: [...] }, and
//   /__dev/hub/<table>: the CSV text of one, from the resslab-hub-data folder
//   that findHubData() finds (read only). Only the names of HUB_TABLES: no
//   path from the URL goes to the disk. app/tests.ts reads them.
// - A change outside app/ (generator, renderers, tables) reloads the whole
//   page. The settings live in the URL hash, so they stay.
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import type { Plugin } from 'vite';
import type { Family } from '../sections.ts';
import { HUB_TABLES, SHAPE_FILES, TABLE_FILES, findHubData } from '../tables.ts';

const app = dirname(fileURLToPath(import.meta.url));
const root = dirname(app);
const BASE_REF = process.env.PLAYGROUND_BASE || 'main';

const git = (...args: string[]) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

const info = () => ({
  branch: git('rev-parse', '--abbrev-ref', 'HEAD') || '?',
  sha: git('rev-parse', '--short', 'HEAD'),
  dirty: git('status', '--porcelain', '--untracked-files=no') !== '',
  base: { ref: BASE_REF, sha: git('merge-base', 'HEAD', BASE_REF).slice(0, 7) },
});

async function bundleBase(sha: string) {
  const dir = join(root, 'node_modules', '.cache', 'steel-viz-base', sha);
  if (!existsSync(join(dir, 'generate.ts'))) {
    mkdirSync(dir, { recursive: true });
    execSync(`git archive ${sha} | tar -x -C "${dir}"`, { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
  }
  // the base may have no shape tables (before channels and angles): read the
  // files it has, its loadCatalog() takes as many as it knows
  const tables = (fam: Family) =>
    JSON.stringify([...TABLE_FILES[fam], ...SHAPE_FILES[fam]].map((f) => join(dir, 'sections', f)).filter(existsSync).map((f) => readFileSync(f, 'utf8')));
  const webgl = join(dir, 'webgl.ts');
  const gl = existsSync(webgl) && readFileSync(webgl, 'utf8').includes('setFrame');
  const hub = join(dir, 'hub.ts');
  const reader = existsSync(hub) && readFileSync(hub, 'utf8').includes('export function toSpecimen');
  const r = await build({
    stdin: {
      // steel.ts as a whole: an export the base does not have yet is just undefined
      contents: `import { loadCatalog } from './sections.ts';
import { generate } from './generate.ts';
import * as steel from './steel.ts';
import { renderHLR } from './hlr.ts';
${gl ? "import { createViewer } from './webgl.ts';" : 'const createViewer = undefined;'}
${reader ? "import { toSpecimen } from './hub.ts';" : 'const toSpecimen = undefined;'}
globalThis.BASE = { loadCatalog, generate, steel, renderHLR, createViewer, toSpecimen, TABLES: { aisc: ${tables('aisc')}, eu: ${tables('eu')} } };`,
      resolveDir: dir,
      loader: 'ts',
    },
    nodePaths: [join(root, 'node_modules')],
    bundle: true,
    format: 'iife',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
  });
  console.log(`  vs ${BASE_REF}: bundled ${sha.slice(0, 7)}`);
  return r.outputFiles[0].text;
}

const bases = new Map<string, Promise<string>>();
function baseScript() {
  const sha = git('merge-base', 'HEAD', BASE_REF);
  if (!sha) return Promise.resolve(`globalThis.BASE_ERROR = ${JSON.stringify(`no merge base with ${BASE_REF}`)};`);
  if (!bases.has(sha)) {
    const p = bundleBase(sha).catch((e) => {
      bases.delete(sha); // try again on the next load
      const msg = e.errors?.length ? e.errors.map((x: any) => x.text).join('\n') : String(e.message ?? e);
      return `globalThis.BASE_ERROR = ${JSON.stringify(msg)};`;
    });
    bases.set(sha, p);
  }
  return bases.get(sha)!;
}

const hubData = findHubData();
const hubFile = (table: string) => (hubData && Object.hasOwn(HUB_TABLES, table) ? join(hubData, HUB_TABLES[table]) : undefined);

export const devTools = (): Plugin => ({
  name: 'steel-viz-dev',
  apply: 'serve',
  configureServer(server) {
    baseScript(); // ready before the page asks for it
    console.log(hubData ? `  hub tests: ${hubData}` : '  hub tests: no resslab-hub-data folder, only the examples of specimens/');
    // the CSV is read at each request: a change in resslab-hub-data shows on reload
    server.middlewares.use('/__dev/hub', (req, res) => {
      const name = (req.url ?? '').split('?')[0].replace(/^\/+/, '');
      const file = hubFile(name);
      if (!name) {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ tables: Object.keys(HUB_TABLES).filter((t) => existsSync(hubFile(t) ?? '')) }));
      } else if (!file || !existsSync(file)) {
        res.statusCode = 404;
        res.end(`no hub table "${name}"`);
      } else {
        res.setHeader('content-type', 'text/csv; charset=utf-8');
        res.end(readFileSync(file, 'utf8'));
      }
    });
    server.middlewares.use('/__dev/info', (_, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(info()));
    });
    server.middlewares.use('/__dev/base.js', async (_, res) => {
      res.setHeader('content-type', 'text/javascript');
      res.end(await baseScript());
    });
  },
  handleHotUpdate({ file, server }) {
    if (file.startsWith(app + '/')) return; // the Vue app: normal hot reload
    server.ws.send({ type: 'full-reload' });
    return [];
  },
});
