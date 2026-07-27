import type {Dataset} from './data';
import type {PlaybackFrame} from './playback';

/**
 * The record's global mean as a sparkline, with a marker on the month showing.
 *
 * Where the readout above it gives one number, this gives the shape the numbers
 * make - CO2's rising sawtooth, temperature's flat seasonal oscillation - and
 * places the frame on screen within it, so the globe is never just a value but
 * a value somewhere in a history.
 *
 * It also scrubs: the pointer moving across it seeks the record. A mouse does
 * it on hover alone, matching the camera's passive-pointer feel elsewhere; touch
 * needs a drag, since it has no hover to read.
 *
 * Drawn in a fixed viewBox stretched to whatever width the info block has
 * (preserveAspectRatio="none"), so it needs no measuring and no resize handling.
 * The stroke is non-scaling so that stretch cannot make it anisotropic, and the
 * marker is a DOM element positioned in percentages, so it stays round.
 */

const W = 240;
const H = 40;
/** Vertical room so the extremes are not clipped by the stroke's own width. */
const PAD = 4;

export class Sparkline {
  private dot: HTMLDivElement;
  private lo: number;
  private span: number;
  private lastIndex: number;
  /** True between a touch going down and coming up; a mouse scrubs on hover. */
  private dragging = false;

  /**
   * @param onScrub a fractional month index to seek to, or null when the
   *   pointer releases or leaves and normal playback should resume.
   */
  constructor(root: HTMLElement, dataset: Dataset, onScrub?: (month: number | null) => void) {
    const means = dataset.months.map((m) => m.mean);
    this.lo = Math.min(...means);
    // Scaled to the means' own range, not the colour ramp's: monthly means
    // occupy a small part of the per-cell spread, and on that scale the line
    // would be flat.
    this.span = Math.max(Math.max(...means) - this.lo, 1e-6);
    this.lastIndex = Math.max(means.length - 1, 1);

    const points = means
      .map((v, i) => `${((i / this.lastIndex) * W).toFixed(2)},${this.y(v).toFixed(2)}`)
      .join(' ');

    root.innerHTML =
      `<svg class="spark-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">` +
      `<polygon class="spark-area" points="0,${H} ${points} ${W},${H}"/>` +
      `<polyline class="spark-line" points="${points}" vector-effect="non-scaling-stroke"/>` +
      `</svg>` +
      `<div class="spark-dot"></div>`;
    this.dot = root.querySelector('.spark-dot') as HTMLDivElement;
    if (onScrub) this.bindScrub(root, onScrub);
  }

  private bindScrub(root: HTMLElement, onScrub: (month: number | null) => void): void {
    const monthAt = (clientX: number): number => {
      const box = root.getBoundingClientRect();
      const fraction = box.width > 0 ? (clientX - box.left) / box.width : 0;
      // Fractional on purpose - seek() interpolates, so the scrub is smooth
      // rather than stepping between whole months.
      return Math.min(Math.max(fraction, 0), 1) * this.lastIndex;
    };

    root.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') {
        this.dragging = true;
        root.setPointerCapture(e.pointerId);
      }
      onScrub(monthAt(e.clientX));
      e.preventDefault();
    });

    root.addEventListener('pointermove', (e) => {
      // A mouse scrubs simply by being over it; touch has to be held down.
      if (e.pointerType === 'mouse' || this.dragging) onScrub(monthAt(e.clientX));
    });

    const release = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') this.dragging = false;
      onScrub(null);
    };
    root.addEventListener('pointerup', release);
    root.addEventListener('pointercancel', release);
    // Only a mouse can leave without lifting.
    root.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') onScrub(null);
    });
  }

  /** Value to viewBox y, inverted (higher value, higher on the chart). */
  private y(value: number): number {
    return H - PAD - ((value - this.lo) / this.span) * (H - PAD * 2);
  }

  /** Put the marker on the month on screen, tinted like the readout. */
  update(frame: PlaybackFrame, color: string): void {
    const cursor = frame.monthA + frame.t;
    this.dot.style.left = `${((cursor / this.lastIndex) * 100).toFixed(2)}%`;
    this.dot.style.top = `${((this.y(frame.meanPpm) / H) * 100).toFixed(2)}%`;
    this.dot.style.background = color;
  }
}
