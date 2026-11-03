#!/usr/bin/env node
/**
 * Record PNG frames of the globe, one directory per layer, for assembly with
 * ffmpeg.
 *
 * Screenshots the whole page rather than the canvas, because the HUD - date,
 * readout, sparkline, colorbar, tabs, credit - is DOM overlaid on the WebGL
 * canvas. canvas.captureStream() would hand back a bare globe on black.
 *
 * Frames are deterministic: `?capture` stops everything that moves on its own,
 * and this sets the month and the orbit angle explicitly per frame. Wall-clock
 * speed therefore does not matter, and a slow machine produces the same file as
 * a fast one - no dropped or duplicated frames.
 *
 * Runs headed on purpose. Headless Chrome falls back to SwiftShader for WebGL,
 * which would render this correctly but far too slowly to be worth it.
 *
 *   node tools/record.mjs                        # all four layers
 *   node tools/record.mjs --layers co2 --fps 60
 *   node tools/record.mjs --smoke 4              # 4 frames per layer, to check
 *   node tools/record.mjs --safe none            # HUD out to the edges
 *   node tools/record.mjs --theme light          # on the light background
 *
 * Then, per directory:
 *   ffmpeg -framerate 30 -i out/frames/co2/%05d.png \
 *     -c:v libx264 -pix_fmt yuv420p -crf 18 -preset slow \
 *     -movflags +faststart co2.mp4
 */

import {chromium} from 'playwright-core';
import {mkdir, rm, readdir, stat} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const URL_BASE = arg('url', 'http://localhost:5199/');
const FPS = Number(arg('fps', 30));
/** Months of record per second of video; 12 puts all 280 into ~23s. */
const MONTHS_PER_SECOND = Number(arg('speed', 12));
/** Degrees of orbit per second, matching the app's own default. */
const DEGREES_PER_SECOND = Number(arg('spin', 30));
const SMOKE = Number(arg('smoke', 0));
const OUT = join(ROOT, arg('out', 'out/frames'));
/**
 * 540x960 CSS at 2x, not 1080x1920 CSS. 540 is inside the 620px breakpoint, so
 * the page lays out as it does on a phone - credit at the bottom, tighter HUD -
 * which is what a vertical video wants, while the file is still a true
 * 1080x1920. At 1080 CSS you get the desktop layout stretched into a phone.
 */
const CSS_WIDTH = Number(arg('width', 540));
const CSS_HEIGHT = Number(arg('height', 960));
const SCALE = Number(arg('scale', 2));

const layersArg = process.argv.indexOf('--layers');
const WANTED =
  layersArg >= 0 ? process.argv[layersArg + 1].split(',').map((s) => s.trim()) : null;

const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  args: ['--hide-scrollbars', '--force-device-scale-factor=' + SCALE]
});

const page = await browser.newPage({
  viewport: {width: CSS_WIDTH, height: CSS_HEIGHT},
  deviceScaleFactor: SCALE
});

const SAFE = arg('safe', 'reels'); // 'reels' | 'none'
const THEME = arg('theme', 'dark'); // 'dark' | 'light'
await page.goto(`${URL_BASE}?capture&safe=${SAFE}&theme=${THEME}`, {waitUntil: 'load'});
await page.waitForFunction(() => Boolean(window.__capture), null, {timeout: 60000});
await page.waitForFunction(() => document.body.classList.contains('ready'), null, {
  timeout: 60000
});

const info = await page.evaluate(() => ({
  months: window.__capture.months,
  layers: window.__capture.layers
}));

const layers = WANTED ? info.layers.filter((l) => WANTED.includes(l)) : info.layers;
if (!layers.length) {
  console.error(`no matching layers; available: ${info.layers.join(', ')}`);
  await browser.close();
  process.exit(1);
}

// The record ends one month short: the cursor interpolates between a month and
// the next, so the last whole frame sits on months - 2.
const lastMonth = info.months - 2;
/* +1 so the final frame lands exactly on lastMonth rather than one step short.
   ceil() alone gives 695 frames for a 278-month run at 12/sec and 30fps, whose
   last index is 694 - cursor 277.6, which still displays November 2025 and
   never reaches the end of the record. The piece is about arriving at the
   present, so the last frame should be the present. */
const totalFrames =
  SMOKE || Math.floor((lastMonth / MONTHS_PER_SECOND) * FPS) + 1;

console.log(
  `${layers.length} layer(s) x ${totalFrames} frames at ${FPS}fps ` +
    `(${(totalFrames / FPS).toFixed(1)}s each), ${CSS_WIDTH * SCALE}x${CSS_HEIGHT * SCALE}`
);

const started = Date.now();
for (const layer of layers) {
  const dir = join(OUT, layer);
  await rm(dir, {recursive: true, force: true});
  await mkdir(dir, {recursive: true});

  await page.evaluate((id) => window.__capture.setLayer(id), layer);
  // Let the swap and its texture upload settle before the first frame.
  await page.evaluate(() => window.__capture.drawn());

  for (let i = 0; i < totalFrames; i++) {
    const month = Math.min((i * MONTHS_PER_SECOND) / FPS, lastMonth);
    const orbit = (i * DEGREES_PER_SECOND) / FPS;
    await page.evaluate(
      ([m, o]) => {
        window.__capture.set(m, o);
        return window.__capture.drawn();
      },
      [month, orbit]
    );
    await page.screenshot({
      path: join(dir, `${String(i).padStart(5, '0')}.png`),
      type: 'png'
    });

    if (i % 60 === 0 || i === totalFrames - 1) {
      const done = layers.indexOf(layer) * totalFrames + i + 1;
      const all = layers.length * totalFrames;
      const rate = done / ((Date.now() - started) / 1000);
      process.stdout.write(
        `\r${layer}  ${i + 1}/${totalFrames}   overall ${done}/${all} ` +
          `(${((done / all) * 100).toFixed(0)}%)  ${rate.toFixed(1)} fps  ` +
          `eta ${Math.round((all - done) / rate)}s      `
      );
    }
  }
  process.stdout.write('\n');
}

await browser.close();

// Report what landed, since frame count and total size are what decide whether
// the encode is going to be pleasant.
let bytes = 0;
let count = 0;
for (const layer of layers) {
  const dir = join(OUT, layer);
  for (const f of await readdir(dir)) {
    bytes += (await stat(join(dir, f))).size;
    count++;
  }
}
console.log(
  `\n${count} frames, ${(bytes / 1e6).toFixed(0)} MB in ${OUT}\n` +
    `\nEncode one layer with:\n` +
    `  ffmpeg -framerate ${FPS} -i ${join(OUT, layers[0])}/%05d.png \\\n` +
    `    -c:v libx264 -pix_fmt yuv420p -crf 18 -preset slow \\\n` +
    `    -movflags +faststart ${layers[0]}.mp4\n`
);
