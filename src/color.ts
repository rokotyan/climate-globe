/**
 * The ppm colour ramps, shared by the HUD and mirrored in GLSL
 * (shaders/co2.vs.glsl) - keep the two in sync.
 *
 * `classic` is the original Cinder ramp: HSV hue 0.3 (green, low ppm) down to
 * 0.0 (red, high), s = v = 1.
 *
 * `extended` carries the scale further than the original could: green ->
 * bright green -> yellow -> orange -> red -> dark red, so the modern record has
 * somewhere to go once it saturates what used to be the top of the scale,
 * while staying within the original's warm register.
 */

export type RGB = [number, number, number];

/** Stops as [position, colour]; positions must be ascending and span 0..1. */
export const EXTENDED_STOPS: Array<[number, RGB]> = [
  [0.0, [0.204, 0.343, 0.302]], // green
  [0.2, [0.353, 0.769, 0.278]], // bright green
  [0.32, [0.659, 0.847, 0.169]], // yellow-green
  [0.52, [0.949, 0.882, 0.173]], // yellow
  [0.66, [0.961, 0.58, 0.094]], // orange
  [0.82, [0.886, 0.2, 0.122]], // red
  [1.0, [0.478, 0.055, 0.063]] // dark red
];

/**
 * Temperature reads differently from a concentration: it has meanings attached
 * to particular numbers rather than just "more" and "less". Blues below
 * freezing, green where it is pleasant to stand outside, red once it is not.
 *
 * Positions are for the fixed -40..40 °C ramp the pipeline gives this layer,
 * so each stop sits on the temperature named beside it.
 */
export const TEMP_STOPS: Array<[number, RGB]> = [
  [0.0, [0.039, 0.165, 0.42]], // -40  deep blue
  [0.1875, [0.118, 0.373, 0.749]], // -25  blue
  [0.375, [0.31, 0.659, 0.91]], // -10  light blue
  [0.5, [0.659, 0.863, 0.941]], //   0  pale, at freezing
  [0.6, [0.435, 0.78, 0.659]], //   8  cool green
  [0.7, [0.247, 0.686, 0.306]], //  16  green - comfortable
  [0.75, [0.341, 0.749, 0.247]], //  20  green - still comfortable
  [0.8125, [0.91, 0.851, 0.227]], //  25  yellow
  [0.875, [0.941, 0.569, 0.165]], //  30  orange - hot
  [0.9375, [0.886, 0.227, 0.118]], //  35  red
  [1.0, [0.557, 0.09, 0.063]] //  40  dark red
];

export type PaletteId = 'default' | 'temp';

export function normalizePpm(ppm: number, vmin: number, vmax: number): number {
  return Math.min(1, Math.max(0, (ppm - vmin) / (vmax - vmin)));
}

export function classicColor(norm: number): RGB {
  const hue = 0.3 * (1 - clamp01(norm));
  return hsvToRgb(hue, 1, 1);
}

function sampleStops(stops: Array<[number, RGB]>, norm: number): RGB {
  const t = clamp01(norm);
  for (let i = 0; i < stops.length - 1; i++) {
    const [s0, c0] = stops[i];
    const [s1, c1] = stops[i + 1];
    if (t <= s1) {
      const f = (t - s0) / (s1 - s0);
      return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f];
    }
  }
  return stops[stops.length - 1][1];
}

export function extendedColor(norm: number): RGB {
  return sampleStops(EXTENDED_STOPS, norm);
}

/**
 * paletteMix: 0 = classic green->red, 1 = extended. The temperature palette
 * ignores the mix - it means specific temperatures, so there is nothing
 * sensible to blend it with.
 */
export function normToColor(norm: number, paletteMix = 1, palette: PaletteId = 'default'): RGB {
  if (palette === 'temp') return sampleStops(TEMP_STOPS, norm);
  if (paletteMix <= 0) return classicColor(norm);
  if (paletteMix >= 1) return extendedColor(norm);
  const a = classicColor(norm);
  const b = extendedColor(norm);
  return [
    a[0] + (b[0] - a[0]) * paletteMix,
    a[1] + (b[1] - a[1]) * paletteMix,
    a[2] + (b[2] - a[2]) * paletteMix
  ];
}

export function normToCss(norm: number, paletteMix = 1, palette: PaletteId = 'default'): string {
  const [r, g, b] = normToColor(norm, paletteMix, palette);
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export function hsvToRgb(h: number, s: number, v: number): RGB {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}
