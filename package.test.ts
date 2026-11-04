// The two entries of the package. The light entry (index.ts) is for a loading
// animation in RESSLab Hub: it must not load any package, or a Node API. The
// 3D entry (3d.ts, the viewer) must not either. esbuild bundles each entry for
// the browser and lists the files that went in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const inputs = async (entry: string | { contents: string }) => {
  const r = await build({
    ...(typeof entry === 'string' ? { entryPoints: [entry] } : { stdin: { ...entry, resolveDir: import.meta.dirname } }),
    absWorkingDir: import.meta.dirname,
    bundle: true,
    write: false,
    metafile: true,
    format: 'esm',
    platform: 'browser', // a node: import fails the build
    logLevel: 'silent',
  });
  return Object.keys(r.metafile.inputs);
};

test('the light entry loads no package and no Node API', async () => {
  const files = await inputs('index.ts');
  assert.ok(files.includes('steel.ts') && files.includes('generate.ts') && files.includes('hlr.ts'));
  assert.deepEqual(files.filter((f) => f.includes('node_modules')), []);
});

test('the 3D entry loads no package and no Node API', async () => {
  // webgl.ts is plain WebGL2
  const files = await inputs('3d.ts');
  assert.ok(files.includes('webgl.ts') && files.includes('triangles.ts'));
  assert.deepEqual(files.filter((f) => f.includes('node_modules')), []);
});

test('the same bundle finds a package', async () => {
  // so the tests above can fail
  const files = await inputs({ contents: "import { ref } from 'vue'; console.log(ref);" });
  assert.ok(files.some((f) => f.includes('node_modules')), 'vue is not in the bundle');
});
