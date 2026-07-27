import {CITIES} from './cities';
import type {Camera} from './camera';
import type {CO2Globe} from './co2-globe';
import type {Dataset} from './data';
import type {PlaybackFrame} from './playback';

/**
 * City labels as DOM, positioned from the globe.
 *
 * The names are HTML so they stay crisp and selectable, but everything about
 * where they go comes from the geometry: each sits on the sphere at its own
 * latitude and longitude, at the radius that cell currently has, projected
 * through the same view-projection matrix the shader uses. They fade out as
 * they turn away and are hidden entirely once past the limb.
 *
 * Every city is named. Where two names would land on top of each other the
 * lower-priority one drops to just its dot, so the geography survives even
 * where the type cannot fit - which on a phone-sized globe is often, since East
 * Asia alone crowds Tokyo, Osaka, Shanghai, Beijing and Manila into a few
 * dozen pixels. Suppressing whole tiers by screen width, as this did before,
 * hid names that had plenty of room.
 *
 * The declutter cannot flicker: labels are only shown while playback is
 * stopped, and a stopped globe does not turn.
 */

/** Facing values between these fade the label in; below the first it is hidden. */
const FADE_IN = 0.12;
const FADE_FULL = 0.35;
/** Breathing room around each label's box when testing overlaps, in pixels. */
const PAD_X = 5;
const PAD_Y = 3;

interface Anchor {
  el: HTMLDivElement;
  dir: [number, number, number];
  row: number;
  col: number;
  /** Wins ties for the last free spot - the largest cities keep their names. */
  major: boolean;
  /** Label size in CSS pixels, cached; measuring per frame would force layout. */
  width: number;
  height: number;
  // Per-frame scratch, filled by update()
  x: number;
  y: number;
  facing: number;
}

export class Labels {
  private anchors: Anchor[] = [];
  private measuredFor = '';

  constructor(private root: HTMLElement, dataset: Dataset) {
    const {lat, lon} = dataset;

    for (const city of CITIES) {
      // Same sphere mapping as the mesh (CO2Mesh.cpp), so a label and the
      // surface under it agree.
      const theta = ((90 - city.lat) * Math.PI) / 180;
      const phi = ((180 - city.lon) * Math.PI) / 180;

      const el = document.createElement('div');
      el.className = 'city';
      el.innerHTML = `<span class="city-dot"></span><span class="city-name">${city.name}</span>`;
      root.appendChild(el);

      this.anchors.push({
        el,
        dir: [
          Math.sin(theta) * Math.cos(phi),
          Math.cos(theta),
          Math.sin(theta) * Math.sin(phi)
        ],
        row: nearest(lat, city.lat),
        col: nearest(lon, city.lon),
        major: city.major === true,
        width: 0,
        height: 0,
        x: 0,
        y: 0,
        facing: -1
      });
    }
  }

  update(
    camera: Camera,
    globe: CO2Globe,
    frame: PlaybackFrame,
    viewProj: Float32Array,
    width: number,
    height: number
  ): void {
    this.measure(width, height);

    const [ex, ey, ez] = camera.eye;
    const visible: Anchor[] = [];

    for (const anchor of this.anchors) {
      const {el, dir, row, col} = anchor;
      const r = globe.radiusAtCell(row, col, frame.monthA, frame.monthB, frame.t);
      const x = dir[0] * r;
      const y = dir[1] * r;
      const z = dir[2] * r;

      // Facing: the surface normal is the unit direction, so compare it with
      // the direction to the eye. Negative means the far side of the globe.
      let vx = ex - x;
      let vy = ey - y;
      let vz = ez - z;
      const len = Math.hypot(vx, vy, vz) || 1;
      vx /= len;
      vy /= len;
      vz /= len;
      const facing = dir[0] * vx + dir[1] * vy + dir[2] * vz;
      anchor.facing = facing;

      if (facing < FADE_IN) {
        el.style.opacity = '0';
        continue;
      }

      // Column-major mat4 times a point
      const m = viewProj;
      const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (cw <= 0) {
        el.style.opacity = '0';
        continue;
      }
      const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
      const cy = m[1] * x + m[5] * y + m[9] * z + m[13];

      anchor.x = ((cx / cw) * 0.5 + 0.5) * width;
      anchor.y = (1 - ((cy / cw) * 0.5 + 0.5)) * height;

      el.style.transform =
        `translate3d(${anchor.x.toFixed(1)}px, ${anchor.y.toFixed(1)}px, 0)`;
      el.style.opacity = String(
        Math.min(1, (facing - FADE_IN) / (FADE_FULL - FADE_IN)).toFixed(2)
      );
      visible.push(anchor);
    }

    this.declutter(visible);
  }

  /**
   * Greedy, highest-priority-first: keep a name if its box is still clear, drop
   * it to a bare dot if not. Major cities go first, then the most face-on -
   * those sit nearest the middle of the disc, where a name reads best and is
   * least likely to be clipped by the limb.
   */
  private declutter(visible: Anchor[]): void {
    visible.sort((a, b) =>
      a.major === b.major ? b.facing - a.facing : a.major ? -1 : 1
    );

    const placed: Anchor[] = [];
    for (const anchor of visible) {
      let clear = true;
      for (const other of placed) {
        if (
          anchor.x < other.x + other.width + PAD_X &&
          other.x < anchor.x + anchor.width + PAD_X &&
          anchor.y < other.y + other.height + PAD_Y &&
          other.y < anchor.y + anchor.height + PAD_Y
        ) {
          clear = false;
          break;
        }
      }
      anchor.el.classList.toggle('crowded', !clear);
      if (clear) placed.push(anchor);
    }
  }

  /**
   * Cache each label's pixel size, remeasured only when the viewport changes -
   * the font scales with vmin, so the boxes do too. Done with every name shown,
   * since a label the last frame crowded out would otherwise report the width
   * of its dot alone.
   */
  private measure(width: number, height: number): void {
    const key = `${width}x${height}`;
    if (this.measuredFor === key) return;
    this.measuredFor = key;

    for (const {el} of this.anchors) el.classList.remove('crowded');
    for (const anchor of this.anchors) {
      const box = anchor.el.getBoundingClientRect();
      anchor.width = box.width;
      anchor.height = box.height;
    }
  }

  /** Fades the whole set in and out; per-label facing still applies underneath. */
  setVisible(visible: boolean): void {
    this.root.classList.toggle('visible', visible);
  }
}

/** Index of the closest value in an ascending or descending coordinate array. */
function nearest(values: number[], target: number): number {
  let best = 0;
  let bestDelta = Infinity;
  for (let i = 0; i < values.length; i++) {
    const delta = Math.abs(values[i] - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = i;
    }
  }
  return best;
}
