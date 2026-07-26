# CO₂ data pipeline

The web app ships its data as `web/public/data/co2.bin` + `co2.json`, generated
by `prepare_data.py` from a gridded netCDF record. Until those exist, the app
falls back to synthetic data (or force it with `?synthetic`).

## Current dataset: AIRS — the original project's own source

**AIRX3C2M v005**, mid-tropospheric CO₂, monthly, Sept 2002 – Feb 2012
(114 granules), extended with **AIRS3C2M v005** (the IR-only retrieval,
Jan 2010 – Feb 2017) to reach **174 months, Sept 2002 – Feb 2017**.

AIRX3C2M is exactly what the original Cinder piece used: the AIRS L3 grid's
first 76 rows × 144 columns *are* the `CO2Mesh.h` grid, so the pipeline reads
it at **native resolution with no interpolation**.

That matters visually. AIRS carries ~1.0–1.25 ppm of per-cell retrieval noise,
and that noise is the fine "fur" of the original artwork. Regridding any
coarser product onto this grid averages the fur away (NOAA CarbonTracker
measured 0.54 ppm cell-to-cell; the smooth 5° satellite XCO₂ even less).

Requires a free NASA Earthdata login, plus authorizing the
"NASA GESDISC DATA ARCHIVE" application in your profile, then a token from
https://urs.earthdata.nasa.gov/users/tokens

```sh
cd web/tools
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 1. List all granules
curl -s "https://cmr.earthdata.nasa.gov/search/granules.json?short_name=AIRX3C2M&version=005&page_size=2000&sort_key=start_date" \
  | python -c "import json,sys; [print([l['href'] for l in g['links'] if l['href'].endswith('.hdf') and l['href'].startswith('http')][0]) for g in json.load(sys.stdin)['feed']['entry']]" \
  > airs_urls.txt

# 2. Download (~65 MB). Retry any file that comes back as JSON -
#    GES DISC occasionally returns a transient "Internal server error".
mkdir -p airs_hdf && cd airs_hdf
xargs -P 6 -n 1 curl -sS -L -H "Authorization: Bearer $EDL_TOKEN" -O < ../airs_urls.txt
file *.hdf | grep -v "version 4"   # should print nothing
cd ..

# 3. Extend to Feb 2017 with the IR-only retrieval (same steps, AIRS3C2M)
curl -s "https://cmr.earthdata.nasa.gov/search/granules.json?short_name=AIRS3C2M&version=005&page_size=2000&sort_key=start_date" \
  | python -c "import json,sys; [print([l['href'] for l in g['links'] if l['href'].endswith('.hdf') and l['href'].startswith('http')][0]) for g in json.load(sys.stdin)['feed']['entry']]" \
  > airs3_urls.txt
mkdir -p airs3_hdf && cd airs3_hdf
xargs -P 6 -n 1 curl -sS -L -H "Authorization: Bearer $EDL_TOKEN" -O < ../airs3_urls.txt
cd ..

# 4. Convert. --extend supplies only months the primary lacks, and removes any
#    offset measured over the 26-month overlap (2010-01..2012-02) so the
#    animation has no step at the join. Measured bias: -0.20 ppm.
python prepare_data.py airs_hdf/*.hdf --extend airs3_hdf/*.hdf
```

Omit `--extend` for the original 114-month 2002–2012 record alone.

The HDF-EOS2 granules are read via `xarray`/`netCDF4` (netcdf-c has HDF4
support built in) — `pyhdf` and a separate HDF4 library are **not** needed.

### Reaching the present: CLIMCAPS

AIRX3C2M/AIRS3C2M stop at Feb 2017, but **SNDRAQIL3SMCCP** (AIRS IR-only
CLIMCAPS L3, monthly, 1°×1°) runs 2002 → within ~5 months of today and carries
`co2_vmr_uppertrop`. Full granules are 239 MB, so subset them over OPeNDAP —
the DAP4 constraint pulls ~405 KB each, 580× smaller:

```sh
python - <<'PY' > climcaps_urls.txt
import json, urllib.request
q=('https://cmr.earthdata.nasa.gov/search/granules.json?short_name=SNDRAQIL3SMCCP'
   '&temporal=2013-12-01T00:00:00Z,2030-01-01T00:00:00Z&page_size=300&sort_key=start_date')
for g in json.load(urllib.request.urlopen(q))['feed']['entry']:
    u=next(l['href'] for l in g['links'] if l['href'].endswith('.nc') and 'data.gesdisc' in l['href'])
    print(u.replace('https://data.gesdisc.earthdata.nasa.gov/data/',
                    'https://sounder.gesdisc.eosdis.nasa.gov/opendap/')
          + '.dap.nc4?dap4.ce=/co2_vmr_uppertrop;/lat;/lon')
PY

mkdir -p climcaps
while read url; do
  d=$(echo "$url" | grep -oE 'AIRS\.[0-9]{8}' | cut -d. -f2)
  [ -s "climcaps/climcaps_$d.nc" ] || curl -sS -f -L -H "Authorization: Bearer $EDL_TOKEN" \
    -o "climcaps/climcaps_$d.nc" "$url"
done < climcaps_urls.txt

python prepare_data.py airs_hdf/*.hdf --extend airs3_hdf/*.hdf --extend climcaps/*.nc
```

Note the DAP2 form (`.nc4?var`) silently returns all zeros here — use the DAP4
`.dap.nc4?dap4.ce=` form and sanity-check the values.

CLIMCAPS is 1°×1°, sampled onto the app grid by nearest neighbour rather than
averaged (averaging finer cells would smooth away the retrieval noise). Being
a modern quality-screened product it is nonetheless much smoother than the old
retrievals — ~0.39 ppm cell-to-cell vs 1.19 for AIRX3C2M — which is what the
app's Grain slider exists to compensate for.

## Alternative: NOAA CarbonTracker (no account needed)

**CT2022 monthly surface-level CO₂**, 3°×2°, Jan 2000 – Dec 2020. Useful for
coverage past the AIRS record (through 2020) and needs no account, but being a
smooth model assimilation it has ~half the cell-to-cell variation of AIRS, so
the fine fur of the original does not survive the regridding.

```sh
cd web/tools
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

mkdir ct_monthly && cd ct_monthly
for y in $(seq 2000 2020); do for m in $(seq -w 1 12); do
  curl -sS -O -C - "https://gml.noaa.gov/aftp/products/carbontracker/co2/molefractions/co2_total_monthly/CT2022.molefrac_glb3x2_${y}-${m}.nc"
done; done   # ~6.5 GB
cd ..

python prepare_data.py ct_monthly/*.nc
```

The script takes the surface level of the 34-level files automatically.
Newer CarbonTracker releases (CT2025 reaches 2024) publish only daily ~97 MB
files — extending past 2020 means downloading mid-month snapshots or
averaging days locally.

## Alternative: C3S merged satellite XCO₂ (CDS account)

Column-averaged SCIAMACHY+GOSAT+OCO-2 merged product, 5°×5°, 2003–2022.
Smoother (column average + coarse grid) but observational. With
`~/.cdsapirc` configured (https://cds.climate.copernicus.eu/how-to-api):

```python
import cdsapi
cdsapi.Client().retrieve(
    "satellite-carbon-dioxide",
    {"processing_level": ["level_3"], "variable": "xco2",
     "sensor_and_algorithm": "merged_obs4mips", "version": ["4_5"]},
    "xco2_obs4mips.zip",
)
```

Unzip and run `python prepare_data.py <file>.nc`. The 2003–2014 portion is
also openly mirrored on CEDA (no account):
`https://dap.ceda.ac.uk/neodc/esacci/ghg/data/obs4mips/crdp_3/CO2/v100/xco2_ghgcci_l3_v100_200301_201412.nc?download=1`

## Other surveyed options

- **AIRS AIRX3C2M** (the original project's data): 2.5°×2°, Sep 2002–Feb 2012,
  NASA GES DISC, free Earthdata login. The authentic old aesthetic; ends 2012.
- **OCO-2 GEOS L3 monthly**: 0.5°×0.625°, gapless, Jun 2014–Feb 2022,
  GES DISC/Earthdata. Finest resolution available.
- No product combines high resolution with coverage to the present.

## What prepare_data.py does

- **AIRS `.hdf` inputs**: read at native resolution, no interpolation (the
  AIRS grid's first 76 rows × 144 cols are already the app grid), converted
  from mole fraction to ppm, with non-physical fills (<300 or >500 ppm)
  masked. `--extend` granules fill only uncovered months and are bias-corrected
  against the primary over the overlap.
- **Display ramp** (`colorMin`/`colorMax` in `co2.json`): spans the record's
  monthly means with headroom. The original Cinder ramp
  `hue = clamp((1-(co2-370)/25)*0.25, 0, 0.3)` is linear from 365 ppm (green)
  to 395 ppm (red) — right for a record ending near 392 ppm. The formula
  reproduces that 365 low anchor and grows the top end with the record;
  pinning 395 would flatten every month after early 2013 to saturated red.
- **Gridded netCDF inputs**: bilinearly regridded onto the app grid (cyclic in
  longitude), taking the surface level of 3D files and masking raw 1e20 fills.
- **Both**: fill coverage gaps spatially *within each month* (nearest observed
  cell, then smooth only the filled cells — never across time, which would
  leak late-record values into early years), interpolate fully-empty months
  from neighbors, and compute area-weighted monthly global means.
- **Encoding**: `co2.bin` is one **uint8 per cell, scaled to each month's own
  min/max** (written to `co2.json` as `lo`/`hi`). A month spans ~30–40 ppm, so
  8 bits give ~0.13 ppm steps — an order of magnitude below the data's own
  ~1 ppm retrieval noise, and ~0.2% of the colour ramp. Measured max error is
  0.134 ppm and the per-source fur is unchanged to three decimals, while the
  payload halves against a global uint16. Never clip to percentiles: that
  would flatten the extreme cells that carry the fur.
