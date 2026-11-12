// Dev server only (Vite plugin):
// - /__dev/info: the branch, the commit, and the base commit for "vs main".
// - /__dev/base.js: the generator and the renderers of the base branch, bundled
//   from `git archive` of the merge base with the base: ?base=<ref> (the
//   `base` of the hash of the page), else PLAYGROUND_BASE, else main.
//   It sets globalThis.BASE (see app/engine.ts). Kept per commit in
//   node_modules/.cache. With its WebGL viewer (and three.js) only when that
//   viewer has setFrame(): an older one can't zoom with ours, so the page
//   draws the base structure with the viewer of this checkout (app/engine.ts).
//   With toSpecimen() when the base has it, so main reads a hub test itself.
// - /__dev/hub: the hub tables we can serve, { tables: [...] }, and
//   /__dev/hub/<table>: the CSV text of one, from the resslab-hub-data folder
//   that findHubData() finds (read only). Only the names of HUB_TABLES: no
//   path from the URL goes to the disk. app/tests.ts reads them.
// - /__dev/hub/<table>/responses/<id>: the response files of one test,
//   { "<folder>": "<CSV text>" }, for the folders of DEFORMS[table]. The id
//   must be a file of the folder: again no path from the URL goes to the disk.
// - A change outside app/ (generator, renderers, tables) reloads the whole
//   page. The settings live in the URL hash, so they stay.
//
// This file must not import the generator (tables.ts, deforms.ts, deform.ts
// and all they pull in), not even with a fixed import(): vite.config.ts
// imports this file, and Vite restarts the whole server when a file the
// config imports changes. So load() gets them from the runner of Vite's ssr
// environment. The runner drops a module when its file changes.
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { isRunnableDevEnvironment, type Plugin, type ViteDevServer } from 'vite';
import type { Family } from '../sections.ts';

const app = dirname(fileURLToPath(import.meta.url));
const root = dirname(app);
const BASE_REF = process.env.PLAYGROUND_BASE || 'main';

// types only: erased, so not a config import
type Gen = typeof import('../tables.ts') & typeof import('../deforms.ts') & Pick<typeof import('../deform.ts'), 'responseFile'>;

let server: ViteDevServer | undefined;
async function load(): Promise<Gen> {
  const ssr = server?.environments.ssr;
  if (!ssr || !isRunnableDevEnvironment(ssr)) throw new Error('the ssr environment of Vite has no runner');
  const [tables, deforms, deform] = await Promise.all(['tables.ts', 'deforms.ts', 'deform.ts'].map((f) => ssr.runner.import(join(root, f))));
  return { ...tables, ...deforms, responseFile: deform.responseFile };
}

const git = (...args: string[]) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

// the base of a request: ?base=<ref> (from the hash of the page), else
// PLAYGROUND_BASE, else main. Only a ref git knows as a commit: no option,
// and git gets it as one argument (no shell).
function baseRef(url: string | undefined) {
  const ref = new URLSearchParams((url ?? '').split('?')[1] ?? '').get('base') || BASE_REF;
  const ok = !ref.startsWith('-') && git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`) !== '';
  return { ref, ok };
}

const info = (url: string | undefined) => {
  const { ref, ok } = baseRef(url);
  return {
    branch: git('rev-parse', '--abbrev-ref', 'HEAD') || '?',
    sha: git('rev-parse', '--short', 'HEAD'),
    dirty: git('status', '--porcelain', '--untracked-files=no') !== '',
    base: { ref, sha: ok ? git('merge-base', 'HEAD', ref).slice(0, 7) : '' },
  };
};

async function bundleBase(sha: string, ref: string) {
  const { TABLE_FILES, SHAPE_FILES } = await load();
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
  console.log(`  vs ${ref}: bundled ${sha.slice(0, 7)}`);
  return r.outputFiles[0].text;
}

const bases = new Map<string, Promise<string>>();
function baseScript(url?: string) {
  const { ref, ok } = baseRef(url);
  const fail = (msg: string) => Promise.resolve(`globalThis.BASE_ERROR = ${JSON.stringify(msg)};`);
  if (!ok) return fail(`git knows no commit "${ref}"`);
  const sha = git('merge-base', 'HEAD', ref);
  if (!sha) return fail(`no merge base with ${ref}`);
  if (!bases.has(sha)) {
    const p = bundleBase(sha, ref).catch((e) => {
      bases.delete(sha); // try again on the next load
      const msg = e.errors?.length ? e.errors.map((x: any) => x.text).join('\n') : String(e.message ?? e);
      return `globalThis.BASE_ERROR = ${JSON.stringify(msg)};`;
    });
    bases.set(sha, p);
  }
  return bases.get(sha)!;
}

const hubFile = (g: Gen, hubData: string | undefined, table: string) =>
  hubData && Object.hasOwn(g.HUB_TABLES, table) ? join(hubData, g.HUB_TABLES[table]) : undefined;

// the response files of a test. undefined: no such table
function hubResponses(g: Gen, hubData: string | undefined, table: string, id: string) {
  if (!hubData || !Object.hasOwn(g.DEFORMS, table) || !Object.hasOwn(g.HUB_TABLES, table)) return undefined;
  const out: Record<string, string> = {};
  for (const spec of g.DEFORMS[table].responses) {
    const dir = join(hubData, dirname(g.HUB_TABLES[table]), spec.folder);
    const file = g.responseFile(spec, id);
    if (existsSync(dir) && readdirSync(dir).includes(file)) out[spec.folder] = readFileSync(join(dir, file), 'utf8');
  }
  return out;
}

export const devTools = (): Plugin => ({
  name: 'steel-viz-dev',
  apply: 'serve',
  configureServer(s) {
    server = s;
    baseScript(); // ready before the page asks for it
    load().then(
      (g) => {
        const hubData = g.findHubData();
        console.log(hubData ? `  hub tests: ${hubData}` : '  hub tests: no resslab-hub-data folder, only the examples of specimens/');
      },
      (e) => console.log(`  hub tests: the generator does not load: ${e.message ?? e}`),
    );
    // the CSV is read at each request: a change in resslab-hub-data shows on reload
    server.middlewares.use('/__dev/hub', async (req, res) => {
      try {
        const g = await load();
        const hubData = g.findHubData();
        const name = (req.url ?? '').split('?')[0].replace(/^\/+/, '');
        const file = hubFile(g, hubData, name);
        const test = name.match(/^(\w+)\/responses\/([\w.()%-]+)$/);
        if (test) {
          const files = hubResponses(g, hubData, test[1], decodeURIComponent(test[2]));
          res.statusCode = files ? 200 : 404;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(files ?? {}));
        } else if (!name) {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ tables: Object.keys(g.HUB_TABLES).filter((t) => existsSync(hubFile(g, hubData, t) ?? '')) }));
        } else if (!file || !existsSync(file)) {
          res.statusCode = 404;
          res.end(`no hub table "${name}"`);
        } else {
          res.setHeader('content-type', 'text/csv; charset=utf-8');
          res.end(readFileSync(file, 'utf8'));
        }
      } catch (e: any) {
        // a syntax error in the generator while you type: an answer, not a crash
        res.statusCode = 500;
        res.end(String(e?.message ?? e));
      }
    });
    // the use() path is cut from req.url: what is left is ?base=…
    server.middlewares.use('/__dev/info', (req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(info(req.url)));
    });
    // baseScript() never rejects: an error goes to globalThis.BASE_ERROR
    server.middlewares.use('/__dev/base.js', async (req, res) => {
      res.setHeader('content-type', 'text/javascript');
      res.end(await baseScript(req.url));
    });
  },
  // the ssr runner (load()): Vite drops its changed modules itself, and logs
  // "(ssr) page reload <file>"
  hotUpdate({ type, file }) {
    if (this.environment.name !== 'client' || type !== 'update') return;
    if (file.startsWith(app + '/')) return; // the Vue app: normal hot reload
    this.environment.hot.send({ type: 'full-reload' });
    return [];
  },
});
