import {CITIES} from './cities';
import type {Camera} from './camera';
import type {CO2Globe} from './co2-globe';
import type {CO2Dataset} from './data';
import type {PlaybackFrame} from './playback';

/**
 * City labels as DOM, positioned from the globe.
 *
 * The names are HTML so they stay crisp and selectable, but everything about
 * where they go comes from the geometry: each sits on the sphere at its own
 * latitude and longitude, at the radius that cell currently has, projected
 * through the same view-projection matrix the shader uses. They fade out as
 * they turn away and are hidden entirely once past the limb.
 */

/** Facing values between these fade the label in; below the first it is hidden. */
const FADE_IN = 0.12;
const FADE_FULL = 0.35;

interface Anchor {
  el: HTMLDivElement;
  dir: [number, number, number];
  row: number;
  col: number;
}

export class Labels {
  private anchors: Anchor[] = [];

  constructor(private root: HTMLElement, dataset: CO2Dataset) {
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
        col: nearest(lon, city.lon)
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
    const [ex, ey, ez] = camera.eye;

    for (const {el, dir, row, col} of this.anchors) {
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

      const sx = (cx / cw * 0.5 + 0.5) * width;
      const sy = (1 - (cy / cw * 0.5 + 0.5)) * height;

      el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0)`;
      el.style.opacity = String(
        Math.min(1, (facing - FADE_IN) / (FADE_FULL - FADE_IN)).toFixed(2)
      );
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
