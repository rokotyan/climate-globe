/**
 * The ppm color ramp, shared by the HUD and mirrored in GLSL (shaders/co2.vs.glsl).
 * Same green->red HSV ramp as the original (CO2Mesh.cpp): hue 0.3 (green, low ppm)
 * down to 0.0 (red, high ppm), s = v = 1.
 */

export function normalizePpm(ppm: number, vmin: number, vmax: number): number {
  return Math.min(1, Math.max(0, (ppm - vmin) / (vmax - vmin)));
}

/** norm in [0,1] -> [r,g,b] in [0,1] */
export function normToColor(norm: number): [number, number, number] {
  const hue = 0.3 * (1 - Math.min(1, Math.max(0, norm)));
  return hsvToRgb(hue, 1, 1);
}

export function normToCss(norm: number): string {
  const [r, g, b] = normToColor(norm);
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
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
