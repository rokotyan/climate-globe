#!/usr/bin/env node
/**
 * Refresh public/data/current.json - present-day global figures for the HUD's
 * headline number.
 *
 * The satellite record lags by months, so the piece quotes a present-day value
 * from outside it. These are the only keyless, CORS-clean, globally-averaged
 * sources found for the four layers:
 *
 *   CO2   NOAA GML, daily smoothed global marine surface
 *   CH4   NOAA GML, monthly global marine surface
 *   temp  ERA5 daily 2 m air temperature, via Climate Reanalyzer
 *   CO    none exists - NOAA measures CO at 258 stations but publishes no
 *         global mean, so the HUD falls back to the record's own last month
 *
 * Note the altitude mismatch this introduces: NOAA's CO2 and CH4 are marine
 * boundary layer surface values, while the globe shows AIRS mid-tropospheric
 * air ~8 km up, a few ppm lower. The figures carry note:"surface" so the HUD
 * can say so. Temperature has no such gap - ERA5's 2 m air temperature is the
 * same quantity as the layer's surf_air_temp.
 *
 * Run by .github/workflows/refresh-current.yml on a weekly cron, which commits
 * the result. Never fails the build: a source that is down or malformed leaves
 * that layer's committed value in place, and the app falls back to its own
 * record if the whole file is missing.
 *
 *   node tools/fetch-current.mjs
 */

import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data', 'current.json');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Plausible ranges, mirroring prepare_data.py's `valid` - a truncated or
 *  error-page response parses to nonsense rather than failing outright. */
const VALID = {co2: [300, 600], ch4: [1000, 3000], temp: [-5, 30]};

async function text(url) {
  const resp = await fetch(url, {headers: {'user-agent': 'airs-co2/1.0'}});
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.text();
}

/** NOAA's fixed-width tables: '#' comments, then whitespace-separated numbers. */
function noaaRows(body) {
  return body
    .split('\n')
    .filter((l) => l.trim() && !l.trimStart().startsWith('#'))
    .map((l) => l.trim().split(/\s+/).map(Number))
    .filter((r) => r.every((v) => Number.isFinite(v)));
}

function inRange(id, value) {
  const [lo, hi] = VALID[id];
  return Number.isFinite(value) && value >= lo && value <= hi;
}

/**
 * co2_trend_gl.txt: year month day smoothed trend. Already smoothed, so a
 * single day is not the noisy figure a raw daily global mean would be.
 */
async function co2() {
  const rows = noaaRows(await text('https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_trend_gl.txt'));
  const [year, month, day, value, trend] = rows[rows.length - 1];
  if (!inRange('co2', value)) throw new Error(`implausible value ${value}`);
  return {
    value: round(value, 1),
    trend: round(trend, 1),
    unit: 'ppm',
    asOf: `${day} ${MONTHS[month - 1]} ${year}`,
    note: 'surface',
    source: 'NOAA GML global marine surface',
    url: 'https://gml.noaa.gov/ccgg/trends/global.html'
  };
}

/** ch4_mm_gl.txt: year month decimal average average_unc trend trend_unc. */
async function ch4() {
  const rows = noaaRows(await text('https://gml.noaa.gov/webdata/ccgg/trends/ch4/ch4_mm_gl.txt'));
  const [year, month, , value, , trend] = rows[rows.length - 1];
  if (!inRange('ch4', value)) throw new Error(`implausible value ${value}`);
  return {
    value: round(value, 0),
    trend: round(trend, 0),
    unit: 'ppb',
    asOf: `${MONTHS[month - 1]} ${year}`,
    note: 'surface',
    source: 'NOAA GML global marine surface',
    url: 'https://gml.noaa.gov/ccgg/trends/ch4_data.html'
  };
}

/**
 * Climate Reanalyzer's ERA5 series: one entry per year plus climatological
 * means ('1991-2020'), each 366 slots. Non-leap years pad at the END - 2025's
 * only null is index 365, not Feb 29 - so index + 1 is the day of year for
 * every year alike.
 */
async function temp() {
  const series = JSON.parse(
    await text('https://climatereanalyzer.org/clim/t2_daily/json/era5_world_t2_day.json')
  );
  const years = series.filter((s) => /^\d{4}$/.test(s.name));
  const latest = years[years.length - 1];
  const index = latest.data.reduce((acc, v, i) => (v === null ? acc : i), -1);
  if (index < 0) throw new Error(`no data for ${latest.name}`);
  const value = latest.data[index];
  if (!inRange('temp', value)) throw new Error(`implausible value ${value}`);

  const date = new Date(Date.UTC(Number(latest.name), 0, 1 + index));
  return {
    value: round(value, 1),
    unit: '°C',
    asOf: `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`,
    // ERA5 2 m air temperature is the same quantity as the layer's
    // surf_air_temp, so there is no altitude caveat to carry here.
    note: 'latest',
    source: 'ERA5 daily 2 m air temperature, via Climate Reanalyzer',
    url: 'https://climatereanalyzer.org/clim/t2_daily/'
  };
}

function round(v, places) {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}

/** Whatever is committed, so one source being down cannot blank its layer. */
function existing() {
  try {
    return JSON.parse(readFileSync(OUT, 'utf8'));
  } catch {
    return {layers: {}};
  }
}

const previous = existing();
const layers = {...previous.layers};
let failures = 0;

for (const [id, fetchOne] of [['co2', co2], ['ch4', ch4], ['temp', temp]]) {
  try {
    layers[id] = await fetchOne();
    console.log(`${id.padEnd(5)} ${layers[id].value} ${layers[id].unit}  (${layers[id].asOf})`);
  } catch (err) {
    failures++;
    const kept = layers[id];
    console.warn(
      `${id.padEnd(5)} FAILED: ${err.message}` +
        (kept ? ` - keeping committed ${kept.value} ${kept.unit} (${kept.asOf})` : ' - no prior value')
    );
  }
}

if (!Object.keys(layers).length) {
  console.error('every source failed and nothing was committed before; writing nothing');
  process.exit(0);
}

// CO is deliberately absent: no global-mean product exists for it, and the HUD
// treats a missing layer as "use the record's own last month".
writeFileSync(
  OUT,
  JSON.stringify({fetched: new Date().toISOString().slice(0, 10), layers}, null, 2) + '\n'
);
console.log(`\nwrote ${OUT}${failures ? ` (${failures} source(s) failed, prior values kept)` : ''}`);
