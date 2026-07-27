import type {Dataset} from './data';

/**
 * Month playback clock. The original app's timeline cue (a 0.1s tween to the
 * next month started every 0.1s) amounts to continuous linear playback at
 * 10 months per second, looping.
 */

export interface PlaybackFrame {
  monthA: number;
  monthB: number;
  t: number;
  year: number;
  month: number;
  meanPpm: number;
  /** Provenance of the month currently on screen */
  source: string;
}

export class Playback {
  playing = true;
  /**
   * Playback rate, free of the camera: the spin has its own rate on the wall
   * clock, so this can be set for how the data should read rather than for how
   * fast the globe should turn. 12 months/sec is a year a second, and covers
   * the whole record in about 23.
   */
  monthsPerSecond = 12;
  /**
   * Held while the sparkline is being scrubbed. Distinct from `playing`, which
   * the city labels key off - a scrub should not make them fade in and out.
   */
  scrubbing = false;
  private cursor = 0; // fractional month index

  constructor(private dataset: Dataset) {}

  /** Swap layers without losing the position in the record. */
  setDataset(dataset: Dataset): void {
    this.dataset = dataset;
    this.cursor = Math.min(this.cursor, dataset.months.length - 2);
  }

  update(dt: number): void {
    if (!this.playing || this.scrubbing) return;
    const n = this.dataset.months.length;
    this.cursor = (this.cursor + dt * this.monthsPerSecond) % (n - 1);
  }

  togglePlay(): void {
    this.playing = !this.playing;
  }

  seek(monthIndex: number): void {
    const n = this.dataset.months.length;
    this.cursor = Math.min(Math.max(monthIndex, 0), n - 2);
  }

  /** Advance exactly one month (original mouseDown behavior). */
  step(): void {
    const n = this.dataset.months.length;
    this.cursor = (Math.floor(this.cursor) + 1) % (n - 1);
  }

  frame(): PlaybackFrame {
    const months = this.dataset.months;
    const monthA = Math.floor(this.cursor);
    const monthB = Math.min(monthA + 1, months.length - 1);
    const t = this.cursor - monthA;
    const a = months[monthA];
    const b = months[monthB];
    return {
      monthA,
      monthB,
      t,
      year: a.year,
      month: a.month,
      meanPpm: a.mean + (b.mean - a.mean) * t,
      source: a.source ?? ''
    };
  }
}
