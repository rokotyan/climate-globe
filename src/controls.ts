import type {CO2Globe} from './co2-globe';
import type {Playback} from './playback';
import type {Hud} from './hud';
import type {Camera} from './camera';
import type {CO2Dataset} from './data';

/**
 * Live tweak panel: sliders bound directly to the render/playback parameters
 * so their effect shows immediately. Purely a dev/authoring overlay - press
 * 'h' to hide it for the clean art view.
 */

interface SliderSpec {
  label: string;
  min: number;
  max: number;
  step: number;
  decimals: number;
  get: () => number;
  set: (v: number) => void;
}

export class Controls {
  private root = document.getElementById('controls') as HTMLDivElement;
  private refreshers: Array<() => void> = [];

  constructor(
    globe: CO2Globe,
    playback: Playback,
    hud: Hud,
    dataset: CO2Dataset,
    camera: Camera
  ) {
    // Size-changing sliders re-frame the camera so the globe cannot outgrow
    // the viewport; snap=false lets the existing easing glide there.
    const reframe = () => camera.frameRadius(globe.maxRadius, false);

    const specs: SliderSpec[] = [
      {label: 'Displacement (units/ppm)', min: 0, max: 12, step: 0.25, decimals: 2,
        get: () => globe.perPpm, set: (v) => { globe.perPpm = v; reframe(); }},
      {label: 'Texture limit (ppm)', min: 0, max: 25, step: 0.5, decimals: 1,
        get: () => globe.texLimit, set: (v) => { globe.texLimit = v; reframe(); }},
      {label: 'Base radius', min: 150, max: 700, step: 10, decimals: 0,
        get: () => globe.radiusBase, set: (v) => { globe.radiusBase = v; reframe(); }},
      {label: 'Lighting', min: 0, max: 1, step: 0.05, decimals: 2,
        get: () => globe.lightMix, set: (v) => (globe.lightMix = v)},
      {label: 'Palette (classic → extended)', min: 0, max: 1, step: 0.05, decimals: 2,
        get: () => globe.paletteMix,
        set: (v) => {
          globe.paletteMix = v;
          hud.setPalette(v);
        }},
      {label: 'Color min (ppm)', min: dataset.vmin - 10, max: dataset.vmax, step: 1, decimals: 0,
        get: () => globe.colorMin,
        set: (v) => {
          globe.colorMin = Math.min(v, globe.colorMax - 1);
          hud.setRange(globe.colorMin, globe.colorMax);
        }},
      {label: 'Color max (ppm)', min: dataset.vmin, max: dataset.vmax + 10, step: 1, decimals: 0,
        get: () => globe.colorMax,
        set: (v) => {
          globe.colorMax = Math.max(v, globe.colorMin + 1);
          hud.setRange(globe.colorMin, globe.colorMax);
        }},
      {label: 'Tilt range (°)', min: 0, max: 88, step: 1, decimals: 0,
        get: () => camera.maxTiltDegrees, set: (v) => (camera.maxTiltDegrees = v)},
      {label: 'Speed (months/sec)', min: 0, max: 30, step: 1, decimals: 0,
        get: () => playback.monthsPerSecond, set: (v) => (playback.monthsPerSecond = v)}
    ];

    const defaults = specs.map((s) => s.get());

    const header = document.createElement('div');
    header.className = 'controls-header';
    header.textContent = 'Parameters';
    const collapse = document.createElement('button');
    collapse.className = 'controls-toggle';
    collapse.textContent = '–';
    collapse.title = 'Collapse';
    collapse.addEventListener('click', () => {
      const collapsed = this.root.classList.toggle('collapsed');
      collapse.textContent = collapsed ? '+' : '–';
    });
    header.appendChild(collapse);
    this.root.appendChild(header);

    const body = document.createElement('div');
    body.className = 'controls-body';
    this.root.appendChild(body);

    for (const spec of specs) {
      const row = document.createElement('label');
      row.className = 'controls-row';

      const top = document.createElement('div');
      top.className = 'controls-label';
      const name = document.createElement('span');
      name.textContent = spec.label;
      const value = document.createElement('span');
      value.className = 'controls-value';
      top.append(name, value);

      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(spec.min);
      input.max = String(spec.max);
      input.step = String(spec.step);
      // Without this the browser restores the previous position on reload,
      // which silently disagrees with the values the app actually starts from.
      input.autocomplete = 'off';

      const sync = () => {
        const v = spec.get();
        input.value = String(v);
        value.textContent = v.toFixed(spec.decimals);
      };
      input.addEventListener('input', () => {
        spec.set(parseFloat(input.value));
        sync();
      });
      sync();
      this.refreshers.push(sync);

      row.append(top, input);
      body.appendChild(row);
    }

    // The panel is an authoring tool, not part of the piece: it stays hidden
    // until asked for with 'h'.
    this.root.classList.add('hidden');

    const reset = document.createElement('button');
    reset.className = 'controls-reset';
    reset.textContent = 'Reset';
    reset.addEventListener('click', () => {
      specs.forEach((s, i) => s.set(defaults[i]));
      this.refresh();
    });
    body.appendChild(reset);

    const hint = document.createElement('div');
    hint.className = 'controls-hint';
    hint.textContent = 'h hide · p pause · l light · click step · wheel zoom';
    body.appendChild(hint);
  }

  /** Re-read every bound value into its slider (after external changes). */
  refresh(): void {
    this.refreshers.forEach((fn) => fn());
  }

  toggleVisible(): void {
    const hidden = this.root.classList.toggle('hidden');
    document.body.classList.toggle('controls-open', !hidden);
  }
}
