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
   * Playback rate. The original ran at ~10 months/sec with a slow, unrelated
   * spin; now that a year of data is a turn of the globe, that rate would spin
   * it every 1.2 seconds. 4 months/sec gives a 3 second turn and takes about
   * 70 seconds over the whole record.
   */
  monthsPerSecond = 4;
  private cursor = 0; // fractional month index
  /** Months played since load, never wrapped - drives the camera's orbit. */
  private played = 0;

  constructor(private dataset: Dataset) {}

  /** Swap layers without losing the position in the record. */
  setDataset(dataset: Dataset): void {
    this.dataset = dataset;
    this.cursor = Math.min(this.cursor, dataset.months.length - 2);
  }

  get playedMonths(): number {
    return this.played;
  }

  update(dt: number): void {
    if (!this.playing) return;
    const n = this.dataset.months.length;
    const advance = dt * this.monthsPerSecond;
    this.cursor = (this.cursor + advance) % (n - 1);
    this.played += advance;
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
    const before = this.cursor;
    this.cursor = (Math.floor(this.cursor) + 1) % (n - 1);
    // Carry the orbit along, so stepping turns the globe a month's worth too
    this.played += 1 - (before - Math.floor(before));
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
