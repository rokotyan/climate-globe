import type {Dataset, MonthInfo} from './data';
import type {PlaybackFrame} from './playback';
import {normToCss, normalizePpm, type PaletteId} from './color';
import {Sparkline} from './sparkline';
import {loadCurrent, type CurrentReadings} from './current';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthName(m: MonthInfo): string {
  return `${MONTH_NAMES[m.month - 1]} ${m.year}`;
}

/**
 * HTML overlay HUD: colorbar (drawn from the shared ramp), "YYYY MM" date,
 * and the global-mean ppm readout tinted by the same ramp - restoring the
 * commented-out HUD from the original draw() (EarthquakeApp.cpp).
 */
export class Hud {
  private dataset: Dataset;
  private dateEl = document.getElementById('date') as HTMLDivElement;
  private ppmEl = document.getElementById('ppm') as HTMLDivElement;
  private sourceEl = document.getElementById('source') as HTMLDivElement;
  private hintEl = document.getElementById('hint');
  private vminLabel = document.getElementById('vmin-label')!;
  private vmaxLabel = document.getElementById('vmax-label')!;
  private colorMin: number;
  private colorMax: number;
  private unit: string;
  private decimals: number;
  private palette: PaletteId = 'default';
  /** Rebuilt per layer by renderInfo, since each has its own curve and scale. */
  private sparkline: Sparkline | null = null;

  private paletteMix = 1;

  /**
   * Present-day figures from outside the record, keyed by layer - see
   * src/current.ts. Empty until the fetch lands, which is why renderInfo is
   * re-run when it does.
   */
  private current: CurrentReadings = {};

  constructor(dataset: Dataset) {
    this.dataset = dataset;
    this.colorMin = dataset.colorMin;
    this.colorMax = dataset.colorMax;
    this.unit = dataset.unit;
    this.decimals = dataset.decimals;
    this.palette = dataset.palette;
    this.drawColorbar();
    this.setRange(dataset.colorMin, dataset.colorMax);
    this.renderInfo(dataset);

    // Fetched rather than awaited: the headline shows the record's own last
    // month for the moment it takes, then redraws with the present-day figure.
    void loadCurrent().then((current) => {
      this.current = current;
      this.renderInfo(this.dataset);
    });
  }

  /** Point the readout, colorbar and summary at another layer. */
  setDataset(dataset: Dataset): void {
    this.dataset = dataset;
    this.unit = dataset.unit;
    this.decimals = dataset.decimals;
    this.palette = dataset.palette;
    this.drawColorbar();
    this.setRange(dataset.colorMin, dataset.colorMax);
    this.renderInfo(dataset);
  }

  /**
   * Standing summary of what the record shows: where CO2 is now, the shape of
   * how it got there, and - if the record changes product partway - why the
   * surface loses its fine texture when it does. Derived from the data so it
   * stays true whenever the dataset is regenerated.
   */
  private renderInfo(dataset: Dataset): void {
    const el = document.getElementById('info');
    if (!el) return;

    const months = dataset.months;
    const first = months[0];
    const last = months[months.length - 1];
    const {unit, decimals} = dataset;

    // A present-day figure from outside the record where one exists, since the
    // satellite products lag by months. CO has no global-mean source at all, so
    // it falls back to reporting its own last month.
    const reading = this.current[dataset.id];
    const headline = reading ? reading.value : last.mean;
    const asOf = reading ? reading.asOf : monthName(last);
    const note = reading ? reading.note : 'latest';

    const lines = [
      `<div class="info-head">AIRS ${dataset.label} · ${first.year}–${last.year}</div>`,
      `<div class="info-figure">${headline.toFixed(decimals)} ${unit} ` +
        `<span>${note}, ${asOf}</span></div>`,
      // Where the climb used to be stated ("+57 ppm since Sep 2002 · +15%"),
      // the sparkline shows it instead - and marks the month on screen.
      `<div class="info-spark" id="spark"></div>`
    ];

    el.innerHTML = lines.join('');
    // After the innerHTML above, which would otherwise discard its DOM.
    const host = document.getElementById('spark');
    this.sparkline = host ? new Sparkline(host, dataset) : null;
  }

  /**
   * The stop/start hint tells the viewer what to do, so it has to say the thing
   * that is actually available - left on "TAP TO PAUSE" while stopped it would
   * be plainly wrong.
   */
  setPlaying(playing: boolean): void {
    const text = playing ? 'TAP TO PAUSE' : 'TAP TO PLAY';
    if (this.hintEl && this.hintEl.textContent !== text) this.hintEl.textContent = text;
  }

  /** Keep the colorbar and readout tint on the same ramp as the globe. */
  setPalette(paletteMix: number): void {
    this.paletteMix = paletteMix;
    this.drawColorbar();
  }

  /** Keep the colorbar labels and readout tint in sync with the globe ramp. */
  setRange(min: number, max: number): void {
    this.colorMin = min;
    this.colorMax = max;
    this.vminLabel.textContent = `${Math.round(min)} ${this.unit}`;
    this.vmaxLabel.textContent = `${Math.round(max)} ${this.unit}`;
  }

  update(frame: PlaybackFrame): void {
    this.dateEl.textContent = `${frame.year} ${String(frame.month).padStart(2, '0')}`;
    const norm = normalizePpm(frame.meanPpm, this.colorMin, this.colorMax);
    const color = normToCss(norm, this.paletteMix, this.palette);
    this.ppmEl.textContent = `${frame.meanPpm.toFixed(this.decimals)} ${this.unit}`;
    this.ppmEl.style.color = color;
    // Same tint as the readout, so the marker, the number and the globe all
    // report the same value in the same colour.
    this.sparkline?.update(frame, color);
    if (this.sourceEl.textContent !== frame.source) {
      this.sourceEl.textContent = frame.source;
    }
  }

  private drawColorbar(): void {
    const canvas = document.getElementById('colorbar') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const {width, height} = canvas;
    for (let x = 0; x < width; x++) {
      ctx.fillStyle = normToCss(x / (width - 1), this.paletteMix, this.palette);
      ctx.fillRect(x, 0, 1, height);
    }
  }
}
