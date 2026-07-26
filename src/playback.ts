import type {CO2Dataset} from './data';

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
  /** Playback rate; the original app ran at ~10 months/sec. */
  monthsPerSecond = 10;
  private cursor = 0; // fractional month index

  constructor(private dataset: CO2Dataset) {}

  update(dt: number): void {
    if (!this.playing) return;
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
