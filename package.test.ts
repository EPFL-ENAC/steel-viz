// The two entries of the package. The light entry (index.ts) is for a loading
// animation in RESSLab Hub: it must not load three.js, or any other package,
// or a Node API. The 3D viewer (webgl.ts) must not either. esbuild bundles
// each entry for the browser and lists the files that went in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const inputs = async (entry: string) => {
  const r = await build({
    entryPoints: [entry],
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
  assert.ok(files.includes('steel.ts') && files.includes('generate.ts'));
  assert.deepEqual(files.filter((f) => f.includes('node_modules')), []);
});

test('the 3D viewer loads no package and no Node API', async () => {
  // webgl.ts is plain WebGL2. three.js comes from hlr.ts only
  const files = await inputs('webgl.ts');
  assert.ok(files.includes('webgl.ts') && files.includes('triangles.ts'));
  assert.deepEqual(files.filter((f) => f.includes('node_modules')), []);
});

test('the 3D entry loads three.js', async () => {
  // so the tests above can fail: the same bundle finds three.js here
  const files = await inputs('3d.ts');
  assert.ok(files.some((f) => /node_modules\/(.*\/)?three\/build\//.test(f)), 'three.js is not in the 3D bundle');
});
