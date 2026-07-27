/**
 * CO2 dataset: monthly global grids on the original AIRS 76x144 lat/lon grid.
 * Values are stored month-major: values[month * rows * cols + row * cols + col], in ppm.
 */

// Grid copied verbatim from the Cinder app (src/CO2Mesh.h).
// Latitudes are non-uniform: 89.5, then 88..-60 in 2 degree steps.
// prettier-ignore
export const LAT: number[] = [
  89.5, 88.0, 86.0, 84.0, 82.0, 80.0, 78.0, 76.0, 74.0, 72.0, 70.0, 68.0, 66.0, 64.0,
  62.0, 60.0, 58.0, 56.0, 54.0, 52.0, 50.0, 48.0, 46.0, 44.0, 42.0, 40.0, 38.0, 36.0,
  34.0, 32.0, 30.0, 28.0, 26.0, 24.0, 22.0, 20.0, 18.0, 16.0, 14.0, 12.0, 10.0, 8.0,
  6.0, 4.0, 2.0, 0.0, -2.0, -4.0, -6.0, -8.0, -10.0, -12.0, -14.0, -16.0, -18.0, -20.0,
  -22.0, -24.0, -26.0, -28.0, -30.0, -32.0, -34.0, -36.0, -38.0, -40.0, -42.0, -44.0,
  -46.0, -48.0, -50.0, -52.0, -54.0, -56.0, -58.0, -60.0
];

export const LON: number[] = Array.from({length: 144}, (_, i) => -180 + i * 2.5);

export interface MonthInfo {
  year: number;
  month: number; // 1-12
  /** Area-weighted global mean ppm */
  mean: number;
  /** Provenance label, e.g. "AIRS AIRX3C2M" - shown in the header */
  source?: string;
  /** Measured cell-to-cell RMS in ppm (this month's own fine texture) */
  fur?: number;
  /** Dequantization bounds for this month's block (u8 encoding) */
  lo?: number;
  hi?: number;
}

export interface Dataset {
  rows: number;
  cols: number;
  lat: number[];
  lon: number[];
  months: MonthInfo[];
  /** Month-major ppm values, rows*cols per month */
  values: Float32Array;
  /** Full value range of the record in ppm (the quantization domain) */
  vmin: number;
  vmax: number;
  /** Suggested display ramp in ppm; for AIRS this is the original's 365-395 */
  colorMin: number;
  colorMax: number;
  synthetic: boolean;

  /** Which layer this is, and how to present its numbers */
  id: LayerId;
  label: string;
  unit: string;
  decimals: number;
  /** Units of globe radius per unit of the quantity (CO2's original is 5/ppm) */
  perUnit: number;
}

export type LayerId = 'co2' | 'ch4' | 'co' | 'temp';

/** Order shown in the switcher; CO2 first, it is the piece's subject. */
export const LAYERS: Array<{id: LayerId; label: string}> = [
  {id: 'co2', label: 'CO₂'},
  {id: 'ch4', label: 'CH₄'},
  {id: 'co', label: 'CO'},
  {id: 'temp', label: 'Temp'}
];

interface Metadata {
  rows: number;
  cols: number;
  lat: number[];
  lon: number[];
  months: MonthInfo[];
  vmin: number;
  vmax: number;
  colorMin?: number;
  colorMax?: number;
  unit?: string;
  label?: string;
  decimals?: number;
  perUnit?: number;
  /** 'u8' = one byte per cell, scaled to each month's own lo/hi (current);
   *  'u16' = two bytes per cell, scaled to the record's vmin/vmax (legacy). */
  encoding: 'u8' | 'u16';
}

/** Load one layer (`<id>.json` + `<id>.bin`). Throws on any failure. */
export async function loadDataset(id: LayerId = 'co2', baseUrl = 'data/'): Promise<Dataset> {
  const metaResp = await fetch(`${baseUrl}${id}.json`);
  if (!metaResp.ok) throw new Error(`${id}.json: HTTP ${metaResp.status}`);
  const meta = (await metaResp.json()) as Metadata;

  const binResp = await fetch(`${baseUrl}${id}.bin`);
  if (!binResp.ok) throw new Error(`${id}.bin: HTTP ${binResp.status}`);
  const buffer = await binResp.arrayBuffer();

  const {vmin, vmax} = meta;
  const cellsPerMonth = meta.rows * meta.cols;
  const expected = meta.months.length * cellsPerMonth;
  const raw = meta.encoding === 'u8' ? new Uint8Array(buffer) : new Uint16Array(buffer);
  if (raw.length !== expected) {
    throw new Error(`${id}.bin length ${raw.length}, expected ${expected}`);
  }

  const values = new Float32Array(raw.length);
  if (meta.encoding === 'u8') {
    // Each month is scaled to its own [lo, hi]
    for (let m = 0; m < meta.months.length; m++) {
      const {lo = vmin, hi = vmax} = meta.months[m];
      const scale = (hi - lo) / 255;
      const start = m * cellsPerMonth;
      for (let i = start; i < start + cellsPerMonth; i++) {
        values[i] = lo + raw[i] * scale;
      }
    }
  } else {
    const scale = (vmax - vmin) / 65535;
    for (let i = 0; i < raw.length; i++) {
      values[i] = vmin + raw[i] * scale;
    }
  }

  return {
    rows: meta.rows,
    cols: meta.cols,
    lat: meta.lat,
    lon: meta.lon,
    months: meta.months,
    values,
    vmin,
    vmax,
    colorMin: meta.colorMin ?? vmin,
    colorMax: meta.colorMax ?? vmax,
    synthetic: false,
    id,
    label: meta.label ?? LAYERS.find((l) => l.id === id)?.label ?? id,
    unit: meta.unit ?? 'ppm',
    decimals: meta.decimals ?? 1,
    // CO2 keeps the original's 5 units of radius per ppm; other layers carry
    // their own, chosen so each has a comparable amount of relief.
    perUnit: meta.perUnit ?? 5
  };
}

/**
 * Synthetic dataset so the piece runs without the real data: secular trend
 * plus a latitude-dependent seasonal cycle (strong in the NH) and slow
 * large-scale spatial variation.
 */
export function generateSyntheticDataset(startYear = 2002, startMonth = 9, numMonths = 280): Dataset {
  const rows = LAT.length;
  const cols = LON.length;
  const values = new Float32Array(numMonths * rows * cols);
  const months: MonthInfo[] = [];

  let year = startYear;
  let month = startMonth;
  for (let m = 0; m < numMonths; m++) {
    const yearsElapsed = m / 12;
    const trend = 372 + 2.45 * yearsElapsed;
    const monthPhase = ((month - 1) / 12) * Math.PI * 2;

    let weightedSum = 0;
    let weightSum = 0;
    for (let r = 0; r < rows; r++) {
      const latRad = (LAT[r] * Math.PI) / 180;
      // NH seasonal amplitude up to ~7 ppm, SH ~1 ppm
      const nh = Math.max(0, Math.sin(latRad));
      const amp = 1 + 6 * nh * nh;
      // NH maximum in boreal spring (April-May), minimum late summer
      const seasonal = amp * Math.cos(monthPhase - (4.5 / 12) * Math.PI * 2);
      const w = Math.cos(latRad);
      for (let c = 0; c < cols; c++) {
        const lonRad = (LON[c] * Math.PI) / 180;
        // Slow-moving large-scale "weather" pattern
        const spatial =
          1.5 * Math.sin(2 * lonRad + m * 0.35 + latRad) +
          1.0 * Math.sin(3 * latRad - m * 0.21) * Math.cos(lonRad + m * 0.13);
        const ppm = trend + seasonal + spatial;
        values[m * rows * cols + r * cols + c] = ppm;
        weightedSum += ppm * w;
        weightSum += w;
      }
    }

    months.push({year, month, mean: weightedSum / weightSum, source: 'synthetic data'});
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }

  // Percentile-based ramp domain (1st/99th over a strided sample)
  const sample: number[] = [];
  for (let i = 0; i < values.length; i += 97) sample.push(values[i]);
  sample.sort((a, b) => a - b);
  const vmin = Math.floor(sample[Math.floor(sample.length * 0.01)]);
  const vmax = Math.ceil(sample[Math.floor(sample.length * 0.99)]);

  return {
    rows, cols, lat: LAT, lon: LON, months, values,
    vmin, vmax, colorMin: vmin, colorMax: vmax,
    synthetic: true,
    id: 'co2', label: 'CO₂', unit: 'ppm', decimals: 1, perUnit: 5
  };
}

/** Real data if available, synthetic when requested via ?synthetic or when fetch fails. */
export async function loadDatasetWithFallback(): Promise<Dataset> {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('synthetic')) {
    try {
      return await loadDataset();
    } catch (err) {
      console.warn('Falling back to synthetic CO2 data:', err);
    }
  }
  return generateSyntheticDataset();
}
