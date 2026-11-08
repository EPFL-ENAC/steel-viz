// shot.ts needs Chrome, and CI has none. So only what runs without it: the
// arguments, reading the examples of specimens/, and the peak step.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toSpecimen } from './hub.ts';
import { findChrome, loadCurves, loadRows, parseShotArgs, peakStep, rowId, shotHash } from './shot.ts';

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
