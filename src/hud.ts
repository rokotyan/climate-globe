import type {Dataset, MonthInfo} from './data';
import type {PlaybackFrame} from './playback';
import {normToCss, normalizePpm} from './color';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Present-day global CO2, quoted for the headline figure.
 *
 * The satellite record runs several months behind, so its last month is not
 * "now" - this is an external reference value and has to be updated by hand.
 */
const CURRENT_READING = {ppm: 429.0, label: 'Jul 2026'};

function monthName(m: MonthInfo): string {
  return `${MONTH_NAMES[m.month - 1]} ${m.year}`;
}

/** Contiguous run of months from one product, for the provenance line. */
function sourceSpans(dataset: Dataset): Array<{label: string; from: number; to: number}> {
  const spans: Array<{label: string; from: number; to: number}> = [];
  for (const m of dataset.months) {
    const label = m.source;
    if (!label) continue;
    const last = spans[spans.length - 1];
    if (last && last.label === label) last.to = m.year;
    else spans.push({label, from: m.year, to: m.year});
  }
  return spans;
}

/**
 * If the record hands over to a product with markedly less per-cell texture,
 * say so and when - otherwise the surface simply appears to go smooth for no
 * visible reason. Returns null when the texture holds up throughout.
 */
function granularityNote(dataset: Dataset): string | null {
  const months = dataset.months;
  const sources = [...new Set(months.map((m) => m.source).filter(Boolean))];
  if (sources.length < 2) return null;

  const lastSource = sources[sources.length - 1];
  const start = months.findIndex((m) => m.source === lastSource);
  if (start <= 0) return null;

  const mean = (list: MonthInfo[]) =>
    list.reduce((sum, m) => sum + (m.fur ?? 0), 0) / Math.max(1, list.length);
  const before = mean(months.slice(0, start));
  const after = mean(months.slice(start));
  if (!(after < before * 0.8)) return null;

  return (
    `Smoother from ${monthName(months[start])}: the record moves to ${lastSource}, ` +
    `whose quality screening strips the per-cell retrieval noise that textures the ` +
    `earlier years (${after.toFixed(1)} vs ${before.toFixed(1)} ppm cell-to-cell).`
  );
}

/**
 * HTML overlay HUD: colorbar (drawn from the shared ramp), "YYYY MM" date,
 * and the global-mean ppm readout tinted by the same ramp - restoring the
 * commented-out HUD from the original draw() (EarthquakeApp.cpp).
 */
export class Hud {
  private dateEl = document.getElementById('date') as HTMLDivElement;
  private ppmEl = document.getElementById('ppm') as HTMLDivElement;
  private sourceEl = document.getElementById('source') as HTMLDivElement;
  private vminLabel = document.getElementById('vmin-label')!;
  private vmaxLabel = document.getElementById('vmax-label')!;
  private colorMin: number;
  private colorMax: number;
  private unit: string;
  private decimals: number;

  private paletteMix = 1;

  constructor(dataset: Dataset) {
    this.colorMin = dataset.colorMin;
    this.colorMax = dataset.colorMax;
    this.unit = dataset.unit;
    this.decimals = dataset.decimals;
    this.drawColorbar();
    this.setRange(dataset.colorMin, dataset.colorMax);
    this.renderInfo(dataset);
  }

  /** Point the readout, colorbar and summary at another layer. */
  setDataset(dataset: Dataset): void {
    this.unit = dataset.unit;
    this.decimals = dataset.decimals;
    this.setRange(dataset.colorMin, dataset.colorMax);
    this.renderInfo(dataset);
  }

  /**
   * Standing summary of what the record shows: where CO2 is now, how far it
   * has climbed since the piece begins, and - if the record changes product
   * partway - why the surface loses its fine texture when it does. Derived
   * from the data so it stays true whenever the dataset is regenerated.
   */
  private renderInfo(dataset: Dataset): void {
    const el = document.getElementById('info');
    if (!el) return;

    const months = dataset.months;
    const first = months[0];
    const last = months[months.length - 1];
    const {unit, decimals} = dataset;

    // CO2 quotes a present-day figure from outside the record, since the
    // satellite products lag by months. The other layers have no such
    // reference, so they report their own last month.
    const isCO2 = dataset.id === 'co2';
    const headline = isCO2 ? CURRENT_READING.ppm : last.mean;
    const asOf = isCO2 ? CURRENT_READING.label : monthName(last);
    const delta = headline - first.mean;
    const percent = (delta / Math.abs(first.mean)) * 100;
    const sign = delta >= 0 ? '+' : '−';
    const mag = Math.abs(delta);

    const lines = [
      `<div class="info-head">AIRS ${dataset.label} · ${first.year}–${last.year}</div>`,
      `<div class="info-figure">${headline.toFixed(decimals)} ${unit} ` +
        `<span>latest, ${asOf}</span></div>`,
      `<div>${sign}${mag.toFixed(mag < 10 ? 1 : 0)} ${unit} since ${monthName(first)}` +
        ` · ${sign}${Math.abs(percent).toFixed(percent < 10 ? 1 : 0)}%</div>`
    ];

    // Provenance is a separate block: on phones it relocates to a centred
    // footer while the headline figures stay in the top corner.
    const provenance: string[] = [];
    const spans = sourceSpans(dataset);
    if (spans.length > 1) {
      // Each product and its years are one unwrappable unit: a plain space
      // (and the en dash, and the hyphen in "IR-only") are all break
      // opportunities, so the years could otherwise end up on their own line.
      provenance.push(
        `<div class="info-sources">${spans
          .map(
            (s) =>
              `<span class="src">${s.label}&nbsp;` +
              `<span class="src-years">${s.from}–${String(s.to).slice(2)}</span></span>`
          )
          .join(' · ')}</div>`
      );
    }
    const note = granularityNote(dataset);
    if (note) provenance.push(`<div class="info-note">${note}</div>`);
    if (provenance.length) {
      lines.push(`<div id="provenance">${provenance.join('')}</div>`);
    }

    el.innerHTML = lines.join('');
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
    this.ppmEl.textContent = `${frame.meanPpm.toFixed(this.decimals)} ${this.unit}`;
    this.ppmEl.style.color = normToCss(norm, this.paletteMix);
    if (this.sourceEl.textContent !== frame.source) {
      this.sourceEl.textContent = frame.source;
    }
  }

  private drawColorbar(): void {
    const canvas = document.getElementById('colorbar') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const {width, height} = canvas;
    for (let x = 0; x < width; x++) {
      ctx.fillStyle = normToCss(x / (width - 1), this.paletteMix);
      ctx.fillRect(x, 0, 1, height);
    }
  }
}
