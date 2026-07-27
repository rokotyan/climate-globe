import type {LayerId} from './data';

/**
 * Present-day global figures, refreshed weekly by tools/fetch-current.mjs and
 * committed - see .github/workflows/refresh-current.yml.
 *
 * The satellite record runs months behind, so the headline number comes from
 * outside it. Fetched at build time rather than in the browser: the piece then
 * never depends on NOAA being reachable when someone opens it, and the values
 * land in git where they can be reviewed.
 *
 * CO is absent on purpose - no global-mean CO product exists - and a layer with
 * no entry falls back to the record's own last month.
 */

export interface CurrentReading {
  value: number;
  /** Deseasonalized value where the source publishes one (CO2, CH4). */
  trend?: number;
  unit: string;
  /** Human date of the reading, e.g. "26 Jul 2026". */
  asOf: string;
  /**
   * Short qualifier shown beside the figure. "surface" for CO2 and CH4, whose
   * sources measure the marine boundary layer while the globe shows air ~8 km
   * up; "latest" where there is no such gap.
   */
  note: string;
  source: string;
  url: string;
}

export type CurrentReadings = Partial<Record<LayerId, CurrentReading>>;

interface CurrentFile {
  fetched: string;
  layers: CurrentReadings;
}

/**
 * Last-resort figure if current.json is missing or malformed. Kept so the HUD
 * always has something to show, but it is the fallback, not the source.
 */
const FALLBACK: CurrentReadings = {
  co2: {
    value: 425.2,
    unit: 'ppm',
    asOf: 'Jul 2026',
    note: 'surface',
    source: 'NOAA GML global marine surface',
    url: 'https://gml.noaa.gov/ccgg/trends/global.html'
  }
};

/** Never throws: a missing or broken file leaves the piece on the fallback. */
export async function loadCurrent(baseUrl = 'data/'): Promise<CurrentReadings> {
  try {
    const resp = await fetch(`${baseUrl}current.json`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const file = (await resp.json()) as CurrentFile;
    if (!file?.layers || typeof file.layers !== 'object') throw new Error('no layers');
    return file.layers;
  } catch (err) {
    console.warn('current.json unavailable, using built-in figure:', err);
    return FALLBACK;
  }
}
