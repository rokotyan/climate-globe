/**
 * The ppm colour ramps, shared by the HUD and mirrored in GLSL
 * (shaders/co2.vs.glsl) - keep the two in sync.
 *
 * `classic` is the original Cinder ramp: HSV hue 0.3 (green, low ppm) down to
 * 0.0 (red, high), s = v = 1.
 *
 * `extended` carries the scale further than the original could: deep green ->
 * green -> yellow -> orange -> red -> dark red, so the modern record has
 * somewhere to go once it saturates what used to be the top of the scale,
 * while staying within the original's warm register.
 */

export type RGB = [number, number, number];

/** Stops as [position, colour]; positions must be ascending and span 0..1. */
export const EXTENDED_STOPS: Array<[number, RGB]> = [
  [0.0, [0.098, 0.455, 0.208]], // deep green
  [0.2, [0.18, 0.608, 0.235]], // green
  [0.38, [0.659, 0.847, 0.169]], // yellow-green
  [0.52, [0.949, 0.882, 0.173]], // yellow
  [0.66, [0.961, 0.58, 0.094]], // orange
  [0.82, [0.886, 0.2, 0.122]], // red
  [1.0, [0.478, 0.055, 0.063]] // dark red
];

export function normalizePpm(ppm: number, vmin: number, vmax: number): number {
  return Math.min(1, Math.max(0, (ppm - vmin) / (vmax - vmin)));
}

export function classicColor(norm: number): RGB {
  const hue = 0.3 * (1 - clamp01(norm));
  return hsvToRgb(hue, 1, 1);
}

export function extendedColor(norm: number): RGB {
  const t = clamp01(norm);
  for (let i = 0; i < EXTENDED_STOPS.length - 1; i++) {
    const [s0, c0] = EXTENDED_STOPS[i];
    const [s1, c1] = EXTENDED_STOPS[i + 1];
    if (t <= s1) {
      const f = (t - s0) / (s1 - s0);
      return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f];
    }
  }
  return EXTENDED_STOPS[EXTENDED_STOPS.length - 1][1];
}

/** paletteMix: 0 = classic green->red, 1 = extended green->violet. */
export function normToColor(norm: number, paletteMix = 1): RGB {
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

export function normToCss(norm: number, paletteMix = 1): string {
  const [r, g, b] = normToColor(norm, paletteMix);
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
