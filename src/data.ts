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
}

export interface CO2Dataset {
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
}

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
  encoding: 'u16';
}

/** Load the preprocessed dataset (co2.json + co2.bin). Throws on any failure. */
export async function loadDataset(baseUrl = 'data/'): Promise<CO2Dataset> {
  const metaResp = await fetch(`${baseUrl}co2.json`);
  if (!metaResp.ok) throw new Error(`co2.json: HTTP ${metaResp.status}`);
  const meta = (await metaResp.json()) as Metadata;

  const binResp = await fetch(`${baseUrl}co2.bin`);
  if (!binResp.ok) throw new Error(`co2.bin: HTTP ${binResp.status}`);
  const raw = new Uint16Array(await binResp.arrayBuffer());

  const expected = meta.months.length * meta.rows * meta.cols;
  if (raw.length !== expected) {
    throw new Error(`co2.bin length ${raw.length}, expected ${expected}`);
  }

  // Dequantize u16 -> ppm
  const {vmin, vmax} = meta;
  const values = new Float32Array(raw.length);
  const scale = (vmax - vmin) / 65535;
  for (let i = 0; i < raw.length; i++) {
    values[i] = vmin + raw[i] * scale;
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
    synthetic: false
  };
}

/**
 * Synthetic dataset so the piece runs without the real data: secular trend
 * plus a latitude-dependent seasonal cycle (strong in the NH) and slow
 * large-scale spatial variation.
 */
export function generateSyntheticDataset(startYear = 2002, startMonth = 9, numMonths = 280): CO2Dataset {
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
    synthetic: true
  };
}

/** Real data if available, synthetic when requested via ?synthetic or when fetch fails. */
export async function loadDatasetWithFallback(): Promise<CO2Dataset> {
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
