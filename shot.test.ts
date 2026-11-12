// shot.ts needs Chrome, and CI has none. So only what runs without it: the
// arguments, reading the examples of specimens/, and the peak step.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toSpecimen } from './hub.ts';
import { findChrome, frameFile, parseShotArgs, peakStep, shotHash } from './shot.ts';
import { loadCurves, loadRows, rowId } from './tables.ts';

const CR1 = 'connections/Lee_et_al_2002_CR1';

test('the commands of the brief', () => {
  assert.deepEqual(parseShotArgs([CR1, '--out', 'a.png']).test, { table: 'connections', id: 'Lee_et_al_2002_CR1' });
  assert.equal(parseShotArgs([CR1, '--step', '440', '--out', 'a.png']).step, 440);
  assert.equal(parseShotArgs([CR1, '--step', '0', '--out', 'a.png']).step, 0);
  assert.equal(parseShotArgs([CR1, '--peak', '--out', 'a.png']).peak, true);
  const seed = parseShotArgs(['--seed', '5', '--out', 's.png']);
  assert.equal(seed.seed, 5);
  assert.equal(seed.test, undefined);
  assert.equal(seed.dpr, 2);
});

test('the angle and the pixels', () => {
  const a = parseShotArgs([CR1, '--az', '-30', '--el', '12.5', '--dpr', '4', '--out', 'a.png']);
  assert.deepEqual([a.az, a.el, a.dpr], [-30, 12.5, 4]);
  assert.equal(parseShotArgs([CR1, '--az=-30', '--out', 'a.png']).az, -30);
});

test('an id can hold a slash', () => {
  assert.deepEqual(parseShotArgs(['braces/a/b', '--out', 'a.png']).test, { table: 'braces', id: 'a/b' });
});

test('what it refuses', () => {
  const refused: [string[], RegExp][] = [
    [['--out', 'a.png'], /a test.*or --seed/],
    [[CR1, '--seed', '5', '--out', 'a.png'], /not both/],
    [[CR1, CR1, '--out', 'a.png'], /one test/],
    [[CR1, '--step', '4', '--peak', '--out', 'a.png'], /--step or --peak/],
    [['--seed', '5', '--step', '4', '--out', 'a.png'], /a seed has no steps/],
    [['--seed', '5', '--peak', '--out', 'a.png'], /a seed has no steps/],
    [[CR1], /--out/],
    [['connections', '--out', 'a.png'], /<table>\/<id>/],
    [['connections/', '--out', 'a.png'], /<table>\/<id>/],
    [[CR1, '--step', 'x', '--out', 'a.png'], /--step needs/],
    [[CR1, '--step', '-1', '--out', 'a.png'], /argument is ambiguous|--step needs/],
    [[CR1, '--step', '1.5', '--out', 'a.png'], /--step needs/],
    [[CR1, '--az', 'x', '--out', 'a.png'], /--az needs/],
    [[CR1, '--dpr', '0', '--out', 'a.png'], /--dpr needs/],
    [['--seed', 'x', '--out', 'a.png'], /--seed needs/],
    [[CR1, '--nope', '--out', 'a.png'], /--nope/],
    [[CR1, '--compare', '3', '--out', 'a.png'], /--compare needs/],
    [[CR1, '--base', 'main', '--out', 'a.png'], /--base is for --compare/],
    [[CR1, '--compare', '2', '--base=-x', '--out', 'a.png'], /--base needs/],
    [[CR1, '--compare', '1', '--dpr', '4', '--out', 'a.png'], /--compare 1/],
    [[CR1, '--theme', 'blue', '--out', 'a.png'], /--theme needs/],
    [[CR1, '--form', 'tree', '--out', 'a.png'], /for a seed/],
    [[CR1, '--family', 'eu', '--out', 'a.png'], /for a seed/],
    [['--seed', '5', '--form', 'dome', '--out', 'a.png'], /--form needs/],
    [['--seed', '5', '--family', 'us', '--out', 'a.png'], /--family needs/],
  ];
  for (const [argv, message] of refused) assert.throws(() => parseShotArgs(argv), message, argv.join(' '));
});

test('the hash of the page', () => {
  assert.equal(shotHash({ seed: 5 }), 'seed=5');
  const h = new URLSearchParams(shotHash({ test: { table: 'connections', id: 'a' }, az: -30 }));
  assert.equal(h.get('specimen'), 'connections/a');
  assert.equal(h.get('view'), '');
  assert.equal(h.get('az'), '-30');
  assert.equal(h.has('el'), false);
  assert.equal(h.has('compare'), false);
  const c = new URLSearchParams(shotHash({ seed: 5, compare: 2, base: '564ac4d~1', theme: 'dark' }));
  assert.equal(c.get('compare'), '2');
  assert.equal(c.get('base'), '564ac4d~1');
  assert.equal(c.get('theme'), 'dark');
  const f = parseShotArgs(['--seed', '140', '--form', 'tree', '--family', 'eu', '--out', 'a.png']);
  assert.deepEqual([f.form, f.family], ['tree', 'eu']);
  assert.equal(shotHash(f), 'seed=140&form=tree&family=eu');
  assert.equal(parseShotArgs(['--seed', '5', '--out', 'a.png']).form, undefined);
});

test('compare, base and theme', () => {
  const a = parseShotArgs(['--seed', '5', '--compare', '2', '--base', '564ac4d~1', '--theme', 'dark', '--out', 'a.png']);
  assert.equal(a.compare, 2);
  assert.equal(a.base, '564ac4d~1');
  assert.equal(a.theme, 'dark');
  assert.equal(parseShotArgs([CR1, '--out', 'a.png']).compare, undefined);
});

test('CHROME comes first, a missing one gives nothing', () => {
  assert.equal(findChrome({ CHROME: process.execPath }), process.execPath);
  assert.equal(findChrome({ CHROME: '/no/such/chrome' }), undefined);
  assert.equal(findChrome({ PATH: '/no/such/folder' }), undefined);
});

test('the examples of specimens/, as the page reads them with no hub data', () => {
  const rows = loadRows('connections', undefined);
  assert.ok(rows.map(rowId).includes('Chi_and_Uang_2002_DC2'));
  assert.ok(rows.every((r) => toSpecimen(r)));
});

test('the peak step of an example', () => {
  const record = loadRows('connections', undefined).find((r) => rowId(r) === 'Chi_and_Uang_2002_DC2')!;
  const spec = toSpecimen(record);
  const curves = loadCurves('connections', 'Chi_and_Uang_2002_DC2', undefined);
  const { step, move, scale } = peakStep('connections', spec, record, curves);
  assert.ok(Number.isInteger(step) && step > 0, `step ${step}`);
  assert.ok(move > 0, `move ${move}`);
  assert.ok(scale > 0, `scale ${scale}`);
  assert.deepEqual(peakStep('connections', spec, record, curves), { step, move, scale });
});

test('no curves, no peak', () => {
  const record = loadRows('connections', undefined).find((r) => rowId(r) === 'Chi_and_Uang_2002_DC2')!;
  assert.throws(() => peakStep('connections', toSpecimen(record), record, {}), /no measured response/);
});

test('the zoom', () => {
  const a = parseShotArgs([CR1, '--zoom', '8', '--at', '0.25,0.75', '--out', 'a.png']);
  assert.deepEqual([a.zoom, a.at], [8, [0.25, 0.75]]);
  const b = parseShotArgs(['--seed', '5', '--zoom', '2.5', '--out', 's.png']);
  assert.deepEqual([b.zoom, b.at], [2.5, [0.5, 0.5]], 'toward the middle by default');
  assert.equal(parseShotArgs([CR1, '--out', 'a.png']).zoom, undefined);
  const refused: [string[], RegExp][] = [
    [[CR1, '--at', '0.5,0.5', '--out', 'a.png'], /--at is for --zoom/],
    [[CR1, '--zoom', '0', '--out', 'a.png'], /--zoom needs/],
    [[CR1, '--zoom', 'x', '--out', 'a.png'], /--zoom needs/],
    [[CR1, '--zoom', '2', '--at', '0.5', '--out', 'a.png'], /--at needs/],
    [[CR1, '--zoom', '2', '--at', '0.5,', '--out', 'a.png'], /--at needs/],
    [[CR1, '--zoom', '2', '--at', '1.5,0.5', '--out', 'a.png'], /--at needs/],
    [[CR1, '--zoom', '2', '--at', '0.1,0.2,0.3', '--out', 'a.png'], /--at needs/],
  ];
  for (const [argv, message] of refused) assert.throws(() => parseShotArgs(argv), message, argv.join(' '));
});

test('frames of the build', () => {
  const a = parseShotArgs(['--seed', '5', '--at-ms', '300,900,1500', '--out', 'b.png']);
  assert.deepEqual([a.atMs, a.duration, a.speed], [[300, 900, 1500], 8, 1], 'the build time of the review links by default');
  const b = parseShotArgs([CR1, '--at-ms', '0', '--duration', '4.5', '--speed', '2', '--out', 'b.png']);
  assert.deepEqual([b.atMs, b.duration, b.speed], [[0], 4.5, 2]);
  assert.equal(shotHash(b), 'specimen=connections%2FLee_et_al_2002_CR1&duration=4.5&speed=2');
  assert.equal(parseShotArgs([CR1, '--out', 'a.png']).duration, undefined, 'no frames: the page as it is, at rest');
  assert.equal(frameFile('out/b.png', 300, true), 'out/b-300.png');
  assert.equal(frameFile('out/b.png', 300, false), 'out/b.png');
  assert.equal(frameFile('out.v2/b', 40, true), 'out.v2/b-40');
  const refused: [string[], RegExp][] = [
    [[CR1, '--duration', '8', '--out', 'a.png'], /are for --at-ms/],
    [[CR1, '--speed', '2', '--out', 'a.png'], /are for --at-ms/],
    [[CR1, '--at-ms', '300', '--step', '4', '--out', 'a.png'], /not with --step/],
    [[CR1, '--at-ms', '300', '--peak', '--out', 'a.png'], /not with --step/],
    [[CR1, '--at-ms', '300', '--compare', '2', '--out', 'a.png'], /not for --compare/],
    [[CR1, '--at-ms', 'x', '--out', 'a.png'], /--at-ms needs/],
    [[CR1, '--at-ms', '300,', '--out', 'a.png'], /--at-ms needs/],
    [[CR1, '--at-ms', '300', '--duration', '0', '--out', 'a.png'], /--duration needs/],
    [[CR1, '--at-ms', '300', '--speed', '-1', '--out', 'a.png'], /--speed needs|ambiguous/],
  ];
  for (const [argv, message] of refused) assert.throws(() => parseShotArgs(argv), message, argv.join(' '));
});
