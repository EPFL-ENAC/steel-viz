// A PNG of the 3D view, for an agent that can't open the playground. Node only,
// no package: the core never imports it, and it isn't in the package.
//
//   node shot.ts connections/Lee_et_al_2002_CR1 --out cr1.png            # at rest
//   node shot.ts connections/Lee_et_al_2002_CR1 --step 440 --out cr1.png # at one step, from 0 as the slider
//   node shot.ts connections/Lee_et_al_2002_CR1 --peak --out cr1.png     # at the step with the biggest move
//   node shot.ts --seed 5 --out s5.png                                   # a seed
//   also --az and --el for the angle, --dpr for more pixels (default 2)
//   node shot.ts connections/Sato_et_al_2007_BFP-1 --zoom 8 --at 0.5,0.4 --out b.png # 8x closer, toward a point
//     (--at: x,y as parts of the canvas, 0,0 top left, default the middle)
//
// It starts its own Vite on a free port and its own headless Chrome with a temp
// profile, and stops both at the end. It doesn't use the playground pane: from
// the sandbox, only processes of the same command can reach each other. Chrome
// comes from the env CHROME, or from google-chrome on the PATH.
//
// It prints the notes of the rail and the page errors. It exits 1 on any failure:
// a page error, no canvas, a test that doesn't exist.
import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { movePoint, protocol, readResponse, responseFile, type Curve, type Protocol } from './deform.ts';
import { DEFORMS } from './deforms.ts';
import { generate } from './generate.ts';
import { hubTable, toSpecimen, type HubRecord } from './hub.ts';
import { loadCatalog, parseCsv } from './sections.ts';
import type { Specimen } from './specimen.ts';
import { HUB_TABLES, findHubData, readTables } from './tables.ts';

const ROOT = import.meta.dirname;
const [WIDTH, HEIGHT] = [1500, 950]; // the page, in CSS px
const DRAW_MS = 50_000; // the page must draw in this time
const DEADLINE_MS = 60_000; // the whole run, with the cleanup after it
const AFTER_ERROR_MS = 5_000; // a page error and no drawing yet: don't wait for long

const USAGE = 'usage: node shot.ts <table>/<id> [--step N | --peak] [--az N] [--el N] [--dpr N] [--zoom N [--at x,y]] --out file.png\n       node shot.ts --seed N [--az N] [--el N] [--dpr N] [--zoom N [--at x,y]] --out file.png';

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

// ---- the arguments
export type ShotArgs = {
  test?: { table: string; id: string };
  seed?: number;
  step?: number;
  peak: boolean;
  az?: number;
  el?: number;
  dpr: number;
  zoom?: number; // this many times closer, toward at
  at: [number, number]; // a point of the canvas, as parts of its width and height
  out: string;
};

function number(flag: string, text: string | undefined, ok: (n: number) => boolean, kind: string): number | undefined {
  if (text === undefined) return undefined;
  const n = Number(text);
  if (text.trim() === '' || !Number.isFinite(n) || !ok(n)) throw new Error(`${flag} needs ${kind}, not "${text}"`);
  return n;
}
const isCount = (n: number) => Number.isInteger(n) && n >= 0;

export function parseShotArgs(argv: string[]): ShotArgs {
  // parseArgs refuses "--az -30", it reads -30 as a flag
  const glued = argv.flatMap((arg, i) => {
    if (/^--(az|el)$/.test(arg) && /^-[\d.]/.test(argv[i + 1] ?? '')) return [`${arg}=${argv[i + 1]}`];
    return /^-[\d.]/.test(arg) && /^--(az|el)$/.test(argv[i - 1] ?? '') ? [] : [arg];
  });
  const { values: v, positionals } = parseArgs({
    args: glued,
    allowPositionals: true,
    options: {
      seed: { type: 'string' }, step: { type: 'string' }, peak: { type: 'boolean' },
      az: { type: 'string' }, el: { type: 'string' }, dpr: { type: 'string' }, out: { type: 'string' },
      zoom: { type: 'string' }, at: { type: 'string' },
    },
  });
  if (positionals.length > 1) throw new Error(`give one test, not ${positionals.length}`);
  const name = positionals[0];
  if (name !== undefined && v.seed !== undefined) throw new Error('give a test or --seed, not both');
  if (name === undefined && v.seed === undefined) throw new Error('give a test as <table>/<id>, or --seed');
  if (v.step !== undefined && v.peak) throw new Error('give --step or --peak, not both');
  if (name === undefined && (v.step !== undefined || v.peak)) throw new Error('--step and --peak are for a test, a seed has no steps');
  if (!v.out) throw new Error('give the image with --out');
  if (v.at !== undefined && v.zoom === undefined) throw new Error('--at is for --zoom');
  const at = (v.at ?? '0.5,0.5').split(',').map((x) => (x.trim() === '' ? NaN : Number(x)));
  if (at.length !== 2 || at.some((x) => !(x >= 0 && x <= 1))) throw new Error(`--at needs x,y with two numbers from 0 to 1, not "${v.at}"`);
  const a: ShotArgs = {
    seed: number('--seed', v.seed, isCount, 'a whole number from 0'),
    step: number('--step', v.step, isCount, 'a whole number from 0'),
    peak: !!v.peak,
    az: number('--az', v.az, () => true, 'a number'),
    el: number('--el', v.el, () => true, 'a number'),
    dpr: number('--dpr', v.dpr, (n) => n > 0, 'a number above 0') ?? 2,
    zoom: number('--zoom', v.zoom, (n) => n > 0, 'a number above 0'),
    at: at as [number, number],
    out: v.out,
  };
  if (name !== undefined) {
    const at = name.indexOf('/');
    if (at <= 0 || at === name.length - 1) throw new Error(`give the test as <table>/<id>, not "${name}"`);
    a.test = { table: name.slice(0, at), id: name.slice(at + 1) };
  }
  return a;
}

// the settings of the page, as app/state.ts reads them
export function shotHash(a: Pick<ShotArgs, 'test' | 'seed' | 'az' | 'el'>): string {
  const h = new URLSearchParams();
  if (a.test) h.set('specimen', `${a.test.table}/${a.test.id}`);
  else h.set('seed', String(a.seed));
  if (a.az !== undefined || a.el !== undefined) h.set('view', ''); // '' when the angle is free
  if (a.az !== undefined) h.set('az', String(a.az));
  if (a.el !== undefined) h.set('el', String(a.el));
  return h.toString();
}

// ---- Chrome
export function findChrome(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const name = env.CHROME || 'google-chrome';
  const dirs = name.includes('/') ? [''] : (env.PATH ?? '').split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    const file = join(dir, name);
    try {
      accessSync(file, constants.X_OK);
      return file;
    } catch {
      // not here
    }
  }
  return undefined;
}

// ---- the test, read from the same source as the page
// The page gives the first row for an unknown id (fetchRecord in app/tests.ts),
// so we look at the id here, before anything starts.
export const rowId = (r: HubRecord) => String(r.id || r.test_id || '?');

export function loadRows(table: string, hubData: string | undefined): HubRecord[] {
  if (hubData) {
    const file = join(hubData, HUB_TABLES[table]);
    if (!existsSync(file)) throw new Error(`no table ${table} in ${hubData}`);
    return parseCsv(readFileSync(file, 'utf8')) as HubRecord[];
  }
  const dir = join(ROOT, 'specimens');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as HubRecord)
    .filter((r) => hubTable(r) === table);
}

// the response files of a test: { folder: curve }, only the ones it has
export function loadCurves(table: string, id: string, hubData: string | undefined): Record<string, Curve> {
  const out: Record<string, Curve> = {};
  for (const s of DEFORMS[table].responses) {
    const dir = hubData ? join(hubData, dirname(HUB_TABLES[table]), s.folder) : join(ROOT, 'specimens', 'responses', table, s.folder);
    const file = join(dir, responseFile(s, id));
    if (existsSync(file)) out[s.folder] = readResponse(readFileSync(file, 'utf8'), s.cols);
  }
  return out;
}

function stepsOf(curves: Record<string, Curve>): Protocol {
  try {
    return protocol(curves);
  } catch {
    throw new Error('no measured response for this test, so it has no steps');
  }
}

// The step with the biggest move of any face point, at the scale of the page.
export function peakStep(table: string, spec: Specimen, record: HubRecord, curves: Record<string, Curve>): { step: number; move: number; scale: number } {
  const T = DEFORMS[table];
  const p = stepsOf(curves);
  const scale = T.autoScale(p);
  const family = spec.family ?? 'aisc';
  const r = generate({ specimen: spec }, loadCatalog(family, ...readTables(family)), 'bolts');
  const parts = r.parts.map((part) => ({ id: part.id, points: part.faces.flatMap((f) => f.pts) }));
  const best = { step: 0, move: -1, scale };
  for (let step = 0; step < p.n; step++) {
    let moves;
    try {
      moves = T.shape(r, spec, record, p.at(step), scale).moves;
    } catch (e) {
      throw new Error(`no deformed shape at step ${step}: ${(e as Error).message}`);
    }
    for (const part of parts) {
      const m = moves[part.id];
      if (!m) continue;
      for (const pt of part.points) {
        const q = movePoint(pt, m);
        const move = Math.hypot(q[0] - pt[0], q[1] - pt[1], q[2] - pt[2]);
        if (move > best.move) Object.assign(best, { step, move });
      }
    }
  }
  return best;
}

type Job = { label: string; step?: number; n?: number; peak?: { move: number; scale: number } };

function readJob(a: ShotArgs): Job {
  if (!a.test) return { label: `seed ${a.seed}` };
  const { table, id } = a.test;
  if (!Object.hasOwn(HUB_TABLES, table)) throw new Error(`no table "${table}": ${Object.keys(HUB_TABLES).join(', ')}`);
  const hubData = findHubData();
  const record = loadRows(table, hubData).find((r) => rowId(r) === id);
  if (!record) throw new Error(`no test "${id}" in the table ${table} (read from ${hubData ?? 'the examples of specimens/'})`);
  const spec = toSpecimen(record); // it says which field it can't read
  const job: Job = { label: `${table}/${id}` };
  if (a.step === undefined && !a.peak) return job;
  const curves = loadCurves(table, id, hubData);
  job.n = stepsOf(curves).n;
  if (a.peak) {
    const { step, move, scale } = peakStep(table, spec, record, curves);
    return { ...job, step, peak: { move, scale } };
  }
  if (a.step! > job.n - 1) throw new Error(`--step ${a.step} is over the last step of this test, ${job.n - 1}`);
  return { ...job, step: a.step };
}

// ---- the processes
type Child = { name: string; proc: ChildProcess; log: string; exited: Promise<void> };

function start(name: string, cmd: string, args: string[], env: NodeJS.ProcessEnv, bail: (e: Error) => void): Child {
  // detached: its own process group, so we can stop it with all its children
  const proc = spawn(cmd, args, { cwd: ROOT, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let done = () => {};
  const child: Child = { name, proc, log: '', exited: new Promise((ok) => (done = ok)) };
  const add = (d: Buffer) => { child.log = (child.log + d).slice(-4000); };
  proc.stdout!.on('data', add);
  proc.stderr!.on('data', add);
  proc.on('error', (e) => {
    done();
    bail(new Error(`${name} did not start: ${e.message}`));
  });
  proc.on('exit', (code, signal) => {
    done();
    // the last lines can come just after the exit
    setTimeout(() => {
      const end = child.log.trim().split('\n').slice(-10).join('\n');
      bail(new Error(`${name} stopped early (${signal ?? `exit code ${code}`})${end ? `:\n${end}` : ''}`));
    }, 100);
  });
  return child;
}

const signalGroup = (c: Child, signal: NodeJS.Signals) => {
  try {
    process.kill(-c.proc.pid!, signal);
  } catch {
    // nothing left in the group
  }
};

async function stop(kids: Child[], profile: string) {
  for (const c of kids) signalGroup(c, 'SIGTERM');
  await Promise.race([Promise.all(kids.map((c) => c.exited)), sleep(2000)]);
  for (const c of kids) signalGroup(c, 'SIGKILL'); // the children that outlive the first one
  if (profile) rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

const freePort = () =>
  new Promise<number>((ok, no) => {
    const s = createServer();
    s.on('error', no);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => ok(port));
    });
  });

async function untilAnswers(url: string) {
  for (;;) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await sleep(100);
  }
}

async function devtoolsPort(chrome: Child): Promise<number> {
  for (;;) {
    const m = /DevTools listening on ws:\/\/[^:]+:(\d+)\//.exec(chrome.log);
    if (m) return Number(m[1]);
    await sleep(50);
  }
}

// ---- the DevTools protocol, on the global WebSocket
type Page = {
  send(method: string, params?: object): Promise<any>;
  // runs a function of this file in the page
  call<T>(fn: (...args: never[]) => T, ...args: unknown[]): Promise<Awaited<T>>;
};

async function openPage(port: number, errors: string[], bail: (e: Error) => void): Promise<Page> {
  const tab = (await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()) as { webSocketDebuggerUrl: string };
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((ok, no) => {
    ws.onopen = ok;
    ws.onerror = () => no(new Error('no connection to Chrome'));
  });
  let last = 0;
  const waiting = new Map<number, { ok(v: unknown): void; no(e: Error): void }>();
  ws.onclose = () => bail(new Error('Chrome closed the connection'));
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    if (m.id) {
      const w = waiting.get(m.id);
      waiting.delete(m.id);
      if (m.error) w?.no(new Error(m.error.message));
      else w?.ok(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errors.push(d.exception?.description ?? d.text);
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push(m.params.args.map((a: { value?: unknown; description?: string }) => a.value ?? a.description).join(' '));
    }
  };
  const send: Page['send'] = (method, params = {}) =>
    new Promise((ok, no) => {
      const id = ++last;
      waiting.set(id, { ok, no });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const call: Page['call'] = async (fn, ...args) => {
    const r = await send('Runtime.evaluate', {
      expression: `(${fn})(${args.map((v) => JSON.stringify(v)).join(',')})`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  return { send, call };
}

// ---- what runs in the page (the source text of these functions goes to Chrome)
const pageState = () => {
  const text = (s: string) => document.querySelector(s)?.textContent?.trim() ?? '';
  const c = document.querySelector<HTMLCanvasElement>('.gl canvas');
  const b = c?.getBoundingClientRect();
  return {
    error: text('.test-error') || text('pre.error'),
    svgOnly: !!document.querySelector('.pane.v-svg'), // no WebGL2
    note: text('.pane-note'), // the canvas stays in the DOM under a note
    drawn: text('.titleblock').includes('WebGL'), // Pane.vue writes it after viewer.show()
    box: b && b.width && b.height ? { x: b.x, y: b.y, width: b.width, height: b.height } : null,
    buffer: c ? c.width : 0,
  };
};
const maxTexture = () => {
  const gl = document.createElement('canvas').getContext('webgl2');
  return gl ? (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) : 0;
};
const slider = () => {
  const s = document.querySelector<HTMLInputElement>('input[aria-label^="Step"]');
  return s && { max: Number(s.max), shown: document.querySelector('.player .num')?.textContent?.trim() ?? '' };
};
const setStep = (step: number) => {
  const s = document.querySelector<HTMLInputElement>('input[aria-label^="Step"]')!;
  s.value = String(step);
  s.dispatchEvent(new Event('input', { bubbles: true }));
};
// the wheel of webgl.ts: exp(-deltaY * 0.0015) times closer, toward the mouse
const zoomAt = (k: number, fx: number, fy: number) => {
  const c = document.querySelector<HTMLCanvasElement>('.gl canvas')!;
  const b = c.getBoundingClientRect();
  const at = { clientX: b.left + fx * b.width, clientY: b.top + fy * b.height };
  c.dispatchEvent(new WheelEvent('wheel', { ...at, deltaY: -Math.log(k) / 0.0015, bubbles: true, cancelable: true }));
};
// the only thing over the canvas: the capture must show the canvas alone
const hideHint = () => document.querySelector<HTMLElement>('.hint')?.style.setProperty('visibility', 'hidden');
const nextFrames = () => new Promise<void>((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok())));
const railNotes = () => [...new Set([...document.querySelectorAll('.source-note, .response .note, .test-notes li')].map((e) => e.textContent?.trim() ?? ''))].filter(Boolean);

async function waitDrawn(page: Page, errors: string[]) {
  const end = Date.now() + DRAW_MS;
  let state: Awaited<ReturnType<typeof pageState>> | null = null;
  let errorAt = 0;
  for (;;) {
    // Vite can reload the page once it has optimized its packages: try again
    state = await page.call(pageState).catch(() => state);
    if (state?.error) throw new Error(state.error);
    if (state?.svgOnly) throw new Error('no canvas: WebGL2 did not start, the page shows the SVG');
    if (state?.drawn && state.box && !state.note) return state.box;
    if (errors.length) errorAt ||= Date.now();
    if (Date.now() > end || (errorAt && Date.now() - errorAt > AFTER_ERROR_MS)) throw new Error(state?.note ? `no drawing, the page says: ${state.note}` : 'no canvas');
    await sleep(100);
  }
}

// Above 2x, a bigger device scale gives no new pixels: webgl.ts caps its buffer
// at 2x. So the device scale stays at 2 and the canvas grows. The view fits
// again, so the framing is the same, and the lines stay 2 px wide.
async function growCanvas(page: Page, box: { width: number; height: number }, dpr: number) {
  const k = dpr / 2;
  const biggest = Math.max(box.width, box.height);
  // the render targets of webgl.ts are 1.5x the buffer: 3 px per CSS px at 2x
  const limit = await page.call(maxTexture);
  if (biggest * k * 3 > limit) throw new Error(`--dpr ${dpr} is too big, the limit here is ${Math.floor(((limit / biggest / 3) * 2) * 10) / 10}`);
  const [width, height] = [Math.round(WIDTH - box.width + box.width * k), Math.round(HEIGHT - box.height + box.height * k)];
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 0, mobile: false });
  for (;;) {
    const s = await page.call(pageState);
    if (s.box && Math.abs(s.box.width - box.width * k) < 2 && Math.abs(s.buffer - s.box.width * 2) < 2) return s.box;
    await sleep(50);
  }
}

async function goToStep(page: Page, job: Job) {
  const s = await page.call(slider);
  if (!s) throw new Error('the page has no step slider for this test');
  if (s.max !== job.n! - 1) throw new Error(`the page has ${s.max + 1} steps, but this script reads ${job.n}: they must read the same files`);
  await page.call(setStep, job.step);
  const want = `${job.step! + 1} / ${job.n}`;
  for (;;) {
    if ((await page.call(slider))?.shown === want) break;
    await sleep(50);
  }
  const { error } = await page.call(pageState);
  if (error) throw new Error(`at step ${job.step}: ${error}`);
}

// ---- one run
async function shoot(a: ShotArgs, job: Job, out: string, chromeBin: string, viteBin: string, kids: Child[], setProfile: (p: string) => void, errors: string[], bail: (e: Error) => void) {
  const port = await freePort();
  const local = '127.0.0.1,localhost';
  const env = { ...process.env, NO_PROXY: local, no_proxy: local };
  kids.push(start('Vite', viteBin, ['--port', String(port), '--strictPort', '--host', '127.0.0.1'], { ...env, PLAYGROUND_PORT: String(port) }, bail));
  const profile = mkdtempSync(join(tmpdir(), 'steel-viz-shot-'));
  setProfile(profile);
  // --no-sandbox: Chrome runs in the sandbox of the session, it can't make its own.
  // The device scale comes from this flag, not from the DevTools protocol. Set
  // there, devicePixelContentBoxSize stays in CSS px, webgl.ts reads it for its
  // buffer, and the image is a 1x drawing scaled up.
  const chrome = start('Chrome', chromeBin, [
    '--headless=new', `--force-device-scale-factor=${Math.min(a.dpr, 2)}`, '--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    '--remote-debugging-port=0', "--remote-allow-origins=*", `--user-data-dir=${profile}`,
    `--window-size=${WIDTH},${HEIGHT}`, 'about:blank',
  ], env, bail);
  kids.push(chrome);

  const base = `http://127.0.0.1:${port}/`;
  const [cdpPort] = await Promise.all([devtoolsPort(chrome), untilAnswers(base)]);
  const page = await openPage(cdpPort, errors, bail);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 0, mobile: false });
  await page.send('Page.navigate', { url: `${base}#${shotHash(a)}` });

  let box = await waitDrawn(page, errors);
  if (a.dpr > 2) box = await growCanvas(page, box, a.dpr);
  if (job.step !== undefined) await goToStep(page, job);
  if (a.zoom !== undefined) await page.call(zoomAt, a.zoom, ...a.at);
  await page.call(hideHint);
  await page.call(nextFrames); // the frame with the shape, then one more

  // the canvas has no preserveDrawingBuffer, so no toDataURL
  const shot = await page.send('Page.captureScreenshot', { format: 'png', clip: { ...box, scale: 1 } });
  const png = Buffer.from(shot.data, 'base64');
  writeFileSync(out, png);

  const s = await page.call(slider);
  console.log(job.label);
  if (s) {
    const n = s.max + 1;
    const at = Number(s.shown.split(' / ')[0]) - 1;
    console.log(`${job.step === undefined ? 'at rest, ' : ''}step ${at} of ${s.max}, the page shows ${at + 1} / ${n}`);
  } else if (a.test) console.log('at rest, no steps');
  if (job.peak) console.log(`biggest move: ${Math.round(job.peak.move)} mm in the image, with the shape scale x${job.peak.scale}`);
  const notes = await page.call(railNotes);
  if (notes.length) console.log(`notes:\n${notes.map((n) => `  ${n}`).join('\n')}`);
  console.log(`page errors: ${errors.length ? '' : 'none'}`);
  for (const e of errors) console.log(`  ${e}`);
  // the size in the IHDR chunk of the PNG
  console.log(`${a.out}: ${png.readUInt32BE(16)} x ${png.readUInt32BE(20)} px`);
  return errors.length ? 1 : 0;
}

async function main(argv: string[]): Promise<number> {
  let a: ShotArgs;
  try {
    a = parseShotArgs(argv);
  } catch (e) {
    throw new Error(`${(e as Error).message}\n${USAGE}`);
  }
  const chromeBin = findChrome();
  if (!chromeBin) throw new Error('no Chrome: install google-chrome, or set CHROME to its path');
  const viteBin = join(ROOT, 'node_modules', '.bin', 'vite');
  if (!existsSync(viteBin)) throw new Error('no Vite: run pnpm install first');
  const job = readJob(a);
  const out = resolve(a.out); // relative to the folder of the caller, the children run in the repo
  mkdirSync(dirname(out), { recursive: true });

  const kids: Child[] = [];
  const errors: string[] = [];
  let profile = '';
  let bail: (e: Error) => void = () => {};
  const bailed = new Promise<never>((_, no) => (bail = no));
  bailed.catch(() => {}); // the end of a good run stops the children too

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => bail(new Error(`stopped by ${signal}`)));
  process.on('exit', () => { // also on a crash of this script
    for (const c of kids) signalGroup(c, 'SIGKILL');
  });
  const timer = setTimeout(() => bail(new Error(`stopped after ${DEADLINE_MS / 1000} s`)), DEADLINE_MS);
  try {
    return await Promise.race([shoot(a, job, out, chromeBin, viteBin, kids, (p) => (profile = p), errors, bail), bailed]);
  } catch (e) {
    if (errors.length) console.error(`page errors:\n${errors.map((x) => `  ${x}`).join('\n')}`);
    throw e;
  } finally {
    clearTimeout(timer);
    await stop(kids, profile);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`shot: ${(e as Error).message}`);
      process.exit(1);
    },
  );
}
