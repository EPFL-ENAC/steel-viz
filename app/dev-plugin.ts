// Dev server only (Vite plugin):
// - /__dev/info: the branch, the commit, and the base commit for "vs main".
// - /__dev/base.js: the generator and the renderers of the base branch, bundled
//   from `git archive` of the merge base with PLAYGROUND_BASE (default main).
//   It sets globalThis.BASE. Kept per commit in node_modules/.cache.
// - A change outside app/ (generator, renderers, tables) reloads the whole
//   page. The settings live in the URL hash, so they stay.
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import type { Plugin } from 'vite';
import type { Family } from '../sections.ts';
import { TABLE_FILES } from '../tables.ts';

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
  const tables = (fam: Family) => JSON.stringify(TABLE_FILES[fam].map((f) => readFileSync(join(dir, 'sections', f), 'utf8')));
  const r = await build({
    stdin: {
      contents: `import { loadCatalog } from './sections.ts';
import { generate } from './generate.ts';
import { render } from './steel.ts';
import { renderHLR } from './hlr.ts';
globalThis.BASE = { loadCatalog, generate, render, renderHLR, TABLES: { aisc: ${tables('aisc')}, eu: ${tables('eu')} } };`,
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

export const devTools = (): Plugin => ({
  name: 'steel-viz-dev',
  apply: 'serve',
  configureServer(server) {
    baseScript(); // ready before the page asks for it
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
