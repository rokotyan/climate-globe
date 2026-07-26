import type {CO2Dataset} from './data';
import type {PlaybackFrame} from './playback';
import {normToCss, normalizePpm} from './color';

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

  constructor(dataset: CO2Dataset) {
    this.colorMin = dataset.colorMin;
    this.colorMax = dataset.colorMax;
    this.drawColorbar();
    this.setRange(dataset.colorMin, dataset.colorMax);
  }

  /** Keep the colorbar labels and readout tint in sync with the globe ramp. */
  setRange(min: number, max: number): void {
    this.colorMin = min;
    this.colorMax = max;
    this.vminLabel.textContent = `${Math.round(min)} ppm`;
    this.vmaxLabel.textContent = `${Math.round(max)} ppm`;
  }

  /**
   * Suffix appended to the provenance line while grain is topping a month up,
   * so synthetic texture is never presented as measured data.
   */
  grainNote = '';

  update(frame: PlaybackFrame): void {
    this.dateEl.textContent = `${frame.year} ${String(frame.month).padStart(2, '0')}`;
    const norm = normalizePpm(frame.meanPpm, this.colorMin, this.colorMax);
    this.ppmEl.textContent = `${frame.meanPpm.toFixed(1)} ppm`;
    this.ppmEl.style.color = normToCss(norm);
    const source = frame.source + this.grainNote;
    if (this.sourceEl.textContent !== source) {
      this.sourceEl.textContent = source;
    }
  }

  private drawColorbar(): void {
    const canvas = document.getElementById('colorbar') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const {width, height} = canvas;
    for (let x = 0; x < width; x++) {
      ctx.fillStyle = normToCss(x / (width - 1));
      ctx.fillRect(x, 0, 1, height);
    }
  }
}
