// cli.ts: the flags of the test, its step and the animation, and the shape at
// one step. With no hub data (hubData undefined), as in CI: the examples of
// specimens/ and specimens/responses/.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCliArgs, readSpecimen, readStep } from './cli.ts';
import { shapeSvg } from './deforms.ts';
import { generate } from './generate.ts';
import { renderHLR } from './hlr.ts';
import { loadCatalog } from './sections.ts';
import type { Specimen } from './specimen.ts';
import { readTables } from './tables.ts';

const CR1 = 'connections/Lee_et_al_2002_CR1';
const DC2 = 'connections/Chi_and_Uang_2002_DC2';

test('the commands of the brief', () => {
  const a = parseCliArgs(['--specimen', CR1, '--step', '440', '--view', '225,35', '--out', 'a.svg']);
  assert.deepEqual([a.specimen, a.step, a.animate], [CR1, 440, false]);
  assert.equal(parseCliArgs(['--specimen', CR1, '--step', '0']).step, 0);
  const b = parseCliArgs(['--seed', '5', '--animate', '--speed', '2', '--duration', '8', '--out', 's.svg']);
  assert.deepEqual([b.animate, b.speed, b.duration, b.step], [true, 2, 8, undefined]);
  const c = parseCliArgs(['--seed', '5', '--animate', '--speed', '0.25']);
  assert.deepEqual([c.speed, c.duration], [0.25, undefined], 'no --duration: the build keeps its own length');
  assert.equal(parseCliArgs(['--seed', '5', '--animate', '--plain']).plain, true);
  assert.equal(c.plain, undefined, 'bolts and welds by default');
});

test('the old commands still pass', () => {
  assert.deepEqual(parseCliArgs([]), { specimen: undefined, animate: false, frames: false, painter: false });
  assert.equal(parseCliArgs(['--seed', '7', '--painter', '--animate']).painter, true);
  assert.equal(parseCliArgs(['--specimen', 'specimens/Chi_and_Uang_2002_DC2.json', '--frames']).frames, true);
});

test('what it refuses', () => {
  const refused: [string[], RegExp][] = [
    [['--seed', '5', '--step', '3'], /a seed has no steps/],
    [['--specimen', CR1, '--step'], /--step needs/],
    [['--specimen', CR1, '--step', 'x'], /--step needs/],
    [['--specimen', CR1, '--step', '-1'], /--step needs/],
    [['--specimen', CR1, '--step', '1.5'], /--step needs/],
    [['--specimen', CR1, '--step', '4', '--animate'], /not with --animate/],
    [['--specimen', CR1, '--step', '4', '--frames'], /not with --frames/],
    [['--specimen', CR1, '--step', '4', '--painter'], /not with --painter/],
    [['--seed', '5', '--speed', '2'], /--speed is for --animate/],
    [['--seed', '5', '--duration', '8'], /--duration is for --animate/],
    [['--seed', '5', '--plain'], /--plain is for --animate/],
    [['--seed', '5', '--animate', '--painter', '--plain'], /exact renderer, not --painter/],
    [['--seed', '5', '--animate', '--painter', '--speed', '2'], /exact renderer, not --painter/],
    [['--seed', '5', '--animate', '--painter', '--duration', '8'], /exact renderer, not --painter/],
    [['--seed', '5', '--animate', '--speed', '0'], /--speed needs a number above 0/],
    [['--seed', '5', '--animate', '--speed', 'x'], /--speed needs/],
    [['--seed', '5', '--animate', '--duration', '-2'], /--duration needs/],
    [['--seed', '5', '--animate', '--duration'], /--duration needs/],
    [['--specimen'], /--specimen needs/],
  ];
  for (const [argv, message] of refused) assert.throws(() => parseCliArgs(argv), message, argv.join(' '));
});

test('a test as a JSON file or as <table>/<id>', () => {
  const file = readSpecimen('specimens/Chi_and_Uang_2002_DC2.json', undefined);
  const row = readSpecimen(DC2, undefined);
  assert.equal(row.spec.id, 'Chi_and_Uang_2002_DC2');
  assert.deepEqual(row.spec, file.spec);
  assert.throws(() => readSpecimen('connections/nope', undefined), /no test "nope" in the table connections/);
  assert.throws(() => readSpecimen('nope/x', undefined), /no table "nope"/);
  assert.throws(() => readSpecimen('connections', undefined), /<table>\/<id>/);
});

const build = (spec: Specimen) => generate({ specimen: spec }, loadCatalog(spec.family ?? 'aisc', ...readTables(spec.family ?? 'aisc')), 'bolts');

test('the shape at one step of an example', () => {
  const { record, spec } = readSpecimen(DC2, undefined);
  const r = build(spec);
  const { n, scale, state } = readStep(record, spec, r, 100, undefined);
  assert.ok(n > 100, `n ${n}`);
  assert.ok(scale > 0);
  assert.ok(Object.keys(state.moves).length > 0, 'the parts move');
  const o = { az: 225, el: 35, weights: true };
  const svg = shapeSvg(r.parts, state, o).svg;
  assert.notEqual(svg, renderHLR(r.parts, o).svg, 'the frame is deformed');
  assert.equal(shapeSvg(r.parts, readStep(record, spec, r, 100, undefined).state, o).svg, svg, 'the same file twice');
  assert.doesNotThrow(() => readStep(record, spec, r, n - 1, undefined));
  assert.throws(() => readStep(record, spec, r, n, undefined), new RegExp(`over the last step of this test, ${n - 1}`));
});

test('no response file, no steps', () => {
  // an example with no file in specimens/responses/
  const { record, spec } = readSpecimen('connections/Ciutina_and_Dubina_2008_CP-R-M', undefined);
  assert.throws(() => readStep(record, spec, build(spec), 0, undefined), /no measured response for connections\/Ciutina_and_Dubina_2008_CP-R-M, so it has no steps \(looked in .*specimens\/responses\/connections\)/);
});
