#!/usr/bin/env python3
"""
Convert satellite CO2 data into the compact binary format served by the app:

  co2.bin   little-endian uint16, month-major, then lat row, then lon col
  co2.json  metadata: months (with area-weighted global means), grid, vmin/vmax

Two input paths:

1. AIRS HDF granules (AIRX3C2M / AIRS3C2M, *.hdf) - the ORIGINAL project's
   source. Read at NATIVE resolution: the AIRS L3 grid's first 76 rows and all
   144 columns are exactly the app grid below, so no interpolation happens at
   all. This matters aesthetically: AIRS carries ~1.25 ppm of cell-to-cell
   retrieval noise, and that noise is the "fur" of the original piece. Any
   regridding averages it away.

2. Gridded netCDF (C3S/ESA CCI XCO2, NOAA CarbonTracker) - bilinearly
   regridded onto the app grid. Necessarily smoother; use for coverage past
   the AIRS record.

Both paths gap-fill within each month only (never across time) and quantize to
uint16 over the record's 1st/99th percentile range.

Usage:
  python prepare_data.py INPUT... [-o ../public/data]

See README.md next to this script for how to download the input files.
"""

import argparse
import json
import re
import sys
from pathlib import Path

import numpy as np
import xarray as xr

# Target grid, copied verbatim from the Cinder app (src/CO2Mesh.h)
LAT = np.array(
    [89.5] + list(np.arange(88.0, -61.0, -2.0)),
    dtype=np.float64,
)
LON = np.arange(-180.0, 180.0, 2.5, dtype=np.float64)

assert LAT.shape == (76,) and LON.shape == (144,)


AIRS_VAR = "mole_fraction_of_carbon_dioxide_in_free_troposphere"


CLIMCAPS_VAR = "co2_vmr_uppertrop"


def read_climcaps(path: Path) -> tuple[tuple[int, int], np.ndarray]:
    """
    Read one AIRS CLIMCAPS L3 monthly granule (1x1 degree) onto the app grid.

    Sampled with NEAREST NEIGHBOUR, never averaged: like AIRX3C2M this is a
    real retrieval, and its per-cell noise is the visual "fur". Averaging the
    finer 1-degree cells into the app's 2-degree rows would smooth it away -
    the same mistake that made the model products look blobby.

    The two orbit passes (day/night) are averaged, matching how the older AIRS
    monthly products combine them.
    """
    m = re.search(r"(\d{4})(\d{2})\d{2}", path.name)
    if not m:
        raise SystemExit(f"Cannot parse date from filename: {path.name}")
    year, month = int(m.group(1)), int(m.group(2))

    ds = xr.open_dataset(path)
    if CLIMCAPS_VAR not in ds.variables:
        raise SystemExit(f"{path.name}: no {CLIMCAPS_VAR}")
    da = ds[CLIMCAPS_VAR]
    if "orbit_pass" in da.dims:
        da = da.mean(dim="orbit_pass", skipna=True)
    field = np.asarray(da.values, dtype=np.float64) * 1e6  # m3/m3 -> ppm
    src_lat = np.asarray(ds["lat"].values, dtype=np.float64)
    src_lon = np.asarray(ds["lon"].values, dtype=np.float64)
    ds.close()

    rows = np.abs(src_lat[None, :] - LAT[:, None]).argmin(axis=1)
    cols = np.abs(src_lon[None, :] - LON[:, None]).argmin(axis=1)
    grid = field[np.ix_(rows, cols)]
    grid[(grid < 300.0) | (grid > 500.0)] = np.nan
    return (year, month), grid


def source_label(path: Path) -> str:
    """
    Human-readable provenance for a granule, shown in the app's header so the
    viewer can see which instrument/product each month comes from.
    """
    name = path.name
    if "CO2Std_IR" in name:
        return "AIRS AIRS3C2M (IR-only)"
    if "CO2Std" in name:
        return "AIRS AIRX3C2M"
    if name.startswith("climcaps") or "CLIMCAPS" in name:
        return "AIRS CLIMCAPS L3"
    m = re.match(r"(CT\d{4})\.", name)
    if m:
        return f"NOAA CarbonTracker {m.group(1)}"
    if "OBS4MIPS" in name.upper() or "GHG_PRODUCTS" in name.upper():
        return "C3S/ESA CCI merged satellite XCO₂"
    return path.stem


def read_airs_granule(path: Path) -> tuple[tuple[int, int], np.ndarray]:
    """Read one AIRS L3 granule -> ((year, month), (76,144) ppm grid with NaNs)."""
    m = re.search(r"(\d{4})\.(\d{2})\.\d{2}", path.name)
    if not m:
        raise SystemExit(f"Cannot parse date from filename: {path.name}")
    year, month = int(m.group(1)), int(m.group(2))

    # mask_and_scale=False: keep raw fill values, we mask them ourselves
    ds = xr.open_dataset(path, engine="netcdf4", mask_and_scale=False)
    if AIRS_VAR not in ds.variables:
        raise SystemExit(f"{path.name}: no {AIRS_VAR} (data_vars: {list(ds.data_vars)})")
    raw = np.asarray(ds[AIRS_VAR].values, dtype=np.float64)
    ds.close()

    if raw.shape[1] != LON.size or raw.shape[0] < LAT.size:
        raise SystemExit(f"{path.name}: unexpected AIRS grid {raw.shape}")

    grid = raw[: LAT.size, :] * 1e6  # mole fraction -> ppm
    # AIRS uses -9999 / 0 style fills; drop anything outside physical range
    grid[(grid < 300.0) | (grid > 500.0)] = np.nan
    return (year, month), grid


# A loaded record: month key -> (grid in ppm, provenance label)
Record = dict[tuple[int, int], tuple[np.ndarray, str]]


def load_source(paths: list[Path]) -> Record:
    """
    Load one group of inputs onto the app grid.

    AIRS .hdf granules are read at native resolution (no interpolation, so
    their per-cell "fur" survives); gridded netCDF is bilinearly regridded and
    resampled to monthly means, which also collapses daily files (e.g. the
    CarbonTracker xCO2 dailies) into months.
    """
    hdf = sorted(p for p in paths if p.suffix.lower() == ".hdf")
    climcaps = sorted(
        p for p in paths if p.suffix.lower() != ".hdf" and source_label(p) == "AIRS CLIMCAPS L3"
    )
    nc = sorted(p for p in paths if p.suffix.lower() != ".hdf" and p not in climcaps)
    out: Record = {}

    for i, path in enumerate(hdf):
        key, grid = read_airs_granule(path)
        out[key] = (grid, source_label(path))
        sys.stdout.write(f"\rreading AIRS {i + 1}/{len(hdf)}")
        sys.stdout.flush()
    if hdf:
        print()

    for i, path in enumerate(climcaps):
        key, grid = read_climcaps(path)
        out[key] = (grid, source_label(path))
        sys.stdout.write(f"\rreading CLIMCAPS {i + 1}/{len(climcaps)}")
        sys.stdout.flush()
    if climcaps:
        print()

    if nc:
        da = load_input(nc)
        # Name the actual quantity used, so the app's header is not misleading
        # (CarbonTracker's xCO2 files also carry near-surface co2_400m, which
        # is what find_xco2_var prefers).
        descriptor = {
            "co2_400m": "near-surface",
            "xco2": "column",
            "co2": "surface",
        }.get(str(da.name), str(da.name))
        label = f"{source_label(nc[0])} ({descriptor})"
        # Daily inputs -> monthly means; already-monthly inputs are unchanged.
        da = da.resample(time="MS").mean()
        n = da.sizes["time"]
        for i in range(n):
            ts = str(np.datetime_as_string(da["time"].values[i], unit="M"))
            key = (int(ts[:4]), int(ts[5:7]))
            out[key] = (regrid_month(da.isel(time=i).compute()), label)
            sys.stdout.write(f"\rregridding {label} {i + 1}/{n}")
            sys.stdout.flush()
        print()

    return out


def splice_records(
    primary: Record, extensions: list[Record], bias_correct: bool = True
) -> tuple[list[tuple[int, int]], np.ndarray, list[str]]:
    """
    Splice extension products onto the primary record, in order.

    Earlier sources always win: an extension only supplies months nothing
    before it covered. Products measure different things (AMSU-coupled vs
    IR-only AIRS retrievals; mid-troposphere vs column-averaged CO2), so each
    extension is shifted by the mean offset measured against the record so far
    over their overlapping months - otherwise the animation steps at the join.
    """
    merged: Record = dict(primary)

    for ext in extensions:
        if not ext:
            continue
        label = next(iter(ext.values()))[1]
        overlap = sorted(set(merged) & set(ext))
        offset = 0.0

        if overlap:
            diffs = []
            for key in overlap:
                a, b = merged[key][0], ext[key][0]
                both = np.isfinite(a) & np.isfinite(b)
                if both.any():
                    diffs.append(float(np.mean(b[both] - a[both])))
            if diffs:
                offset = float(np.mean(diffs))
                print(
                    f"{label}: overlap {len(overlap)} months "
                    f"({overlap[0][0]}-{overlap[0][1]:02d}..{overlap[-1][0]}-{overlap[-1][1]:02d}), "
                    f"bias {offset:+.2f} ppm (spread {np.std(diffs):.2f})"
                )
        else:
            print(f"{label}: no overlap - continuity across this splice is unverified")

        if not bias_correct:
            offset = 0.0
        elif offset:
            print(f"  applying {-offset:+.2f} ppm to match the record so far")

        added = 0
        for key, (grid, lbl) in ext.items():
            if key not in merged:
                merged[key] = (grid - offset, lbl)
                added += 1
        print(f"  spliced in {added} months")

    months = sorted(merged)
    grids = np.stack([merged[k][0] for k in months])
    labels = [merged[k][1] for k in months]
    return months, grids, labels


def find_xco2_var(ds: xr.Dataset) -> str:
    # co2_400m first: CarbonTracker's xCO2 files carry both it and the
    # column-average, and near-surface CO2 has ~4x more cell-to-cell
    # structure, which sits far closer to AIRS visually than the very smooth
    # column product does.
    for name in ("co2_400m", "xco2", "XCO2", "co2", "xco2_ppm"):
        if name in ds.data_vars:
            return name
    raise SystemExit(f"No CO2 variable found; data_vars: {list(ds.data_vars)}")


def load_input(paths: list[Path]) -> xr.DataArray:
    ds = xr.open_mfdataset(
        [str(p) for p in paths],
        combine="by_coords",
        data_vars="minimal",
        coords="minimal",
        compat="override",
    )
    da = ds[find_xco2_var(ds)]

    # 3D model products (e.g. NOAA CarbonTracker): take the surface level,
    # which carries the strongest source/sink structure.
    if "level" in da.dims:
        da = da.isel(level=0)

    # Normalize dimension names
    renames = {}
    for dim in da.dims:
        low = str(dim).lower()
        if low.startswith("lat") and dim != "lat":
            renames[dim] = "lat"
        elif low.startswith("lon") and dim != "lon":
            renames[dim] = "lon"
        elif low in ("time", "t") and dim != "time":
            renames[dim] = "time"
    if renames:
        da = da.rename(renames)

    da = da.sortby("time")

    # Mask non-decoded fill values (e.g. raw 1e20 sentinels in the C3S v4.x files)
    da = da.where(np.abs(da) < 1e10)

    # Mole fraction -> ppm if needed
    sample = float(da.isel(time=0).max(skipna=True).compute())
    if sample < 1.0:
        da = da * 1e6

    # Longitudes to [-180, 180)
    lon = da["lon"].values
    if lon.max() > 180:
        da = da.assign_coords(lon=(((da["lon"] + 180) % 360) - 180)).sortby("lon")

    return da


def regrid_month(field: xr.DataArray) -> np.ndarray:
    """Bilinear regrid of one (lat, lon) field to the 76x144 target grid."""
    # Cyclic longitude padding so interpolation works across the dateline
    lon = field["lon"].values
    left = field.isel(lon=-1).assign_coords(lon=lon[-1] - 360.0)
    right = field.isel(lon=0).assign_coords(lon=lon[0] + 360.0)
    padded = xr.concat([left, field.transpose("lat", "lon"), right], dim="lon").sortby("lon")

    # Clamp target lats into the source range (5-deg products only reach +-87.5):
    # rows beyond the source edge get the edge value instead of NaN.
    src_lat = padded["lat"].values
    lat_target = np.clip(LAT, src_lat.min(), src_lat.max())

    out = padded.interp(lat=xr.DataArray(lat_target, dims="row"), lon=xr.DataArray(LON, dims="col"))
    return out.values.astype(np.float64)


def synthesize_noise(
    grids: np.ndarray, sources: list[str], month_keys: list[tuple[int, int]], gain: float = 1.0
) -> list[str]:
    """
    Give the smooth modern months the retrieval noise of the earlier ones.

    The fine texture of the early globes is per-cell retrieval scatter, which
    modern quality screening removes - so the record visibly goes slack after
    2017. Rather than inventing white noise, this lifts the actual residual
    field from an earlier month and lays it over a later one:

      residual = month - 3x3 smoothed month

    Donors are matched by calendar month, so the seasonal pattern of where
    AIRS was noisy (polar night, cloud) lands where it belongs.

    Amplitude is matched **per cell**, not per latitude band. How noisy AIRS
    was varies strongly with longitude as well as latitude - within one row the
    noisiest cell runs about 3x the quietest - so a single factor per row
    flattens that geography. Each cell gets its own target, taken from the
    spread of the donor months at that cell, and the shortfall against the
    recipient's own scatter is made up in quadrature since the two are
    independent.

    Returns updated source labels - recipients are marked, because after this
    their fine texture is borrowed rather than measured.
    """
    from scipy import ndimage

    def residual(g: np.ndarray) -> np.ndarray:
        return g - ndimage.uniform_filter(g, size=3, mode="nearest")

    # The last source is the smooth one; everything before it donates.
    order = list(dict.fromkeys(sources))
    if len(order) < 2:
        print("noise: single source, nothing to do")
        return sources
    recipient_label = order[-1]
    donors = [i for i, s in enumerate(sources) if s != recipient_label]
    recipients = [i for i, s in enumerate(sources) if s == recipient_label]

    # How noisy each cell actually was, across every donor month. `gain` lifts
    # the target above the measured amount when it does not read strongly
    # enough on screen.
    donor_res = np.stack([residual(grids[i]) for i in donors]).astype(np.float32)
    spread = donor_res.std(axis=0)  # (rows, cols)
    target = spread * gain
    own = np.stack([residual(grids[i]) for i in recipients]).astype(np.float32).std(axis=0)
    need = np.sqrt(np.maximum(0.0, target**2 - own**2))

    # Dividing a donor month by that spread turns it into a unit-variance field
    # that still has the month's own shape; `need` then sets the amplitude cell
    # by cell. The floor keeps quiet cells from blowing up the division.
    floor = max(spread.mean() * 0.05, 1e-6)
    unit_scale = need / np.maximum(spread, floor)

    # Donors indexed by calendar month, so a January is dressed with Januaries
    by_month: dict[int, list[int]] = {}
    for i in donors:
        by_month.setdefault(month_keys[i][1], []).append(i)

    for n, i in enumerate(recipients):
        pool = by_month.get(month_keys[i][1]) or donors
        grids[i] += residual(grids[pool[n % len(pool)]]) * unit_scale

    after = np.stack([residual(grids[i]) for i in recipients]).astype(np.float32).std(axis=0)
    print(
        f"noise: {len(recipients)} months of '{recipient_label}' dressed with residuals "
        f"from {len(donors)} earlier months, gain {gain:g}, matched per cell "
        f"(now {after.mean():.2f} vs target {target.mean():.2f} ppm)"
    )
    return [f"{s} + resampled noise" if s == recipient_label else s for s in sources]


def gap_fill(months: np.ndarray) -> np.ndarray:
    """months: (n, 76, 144) with NaNs. Fill with lat-band mean, then temporal fill."""
    filled = months.copy()

    # 0. Months with no observations at all (e.g. Jan 2015 in the C3S merged
    # record): interpolate the whole grid between the nearest valid months.
    n = filled.shape[0]
    empty = [m for m in range(n) if np.isnan(filled[m]).all()]
    valid = [m for m in range(n) if m not in empty]
    if not valid:
        raise SystemExit("Gap fill failed: no valid months at all")
    for m in empty:
        before = max((v for v in valid if v < m), default=None)
        after = min((v for v in valid if v > m), default=None)
        if before is None:
            filled[m] = filled[after]
        elif after is None:
            filled[m] = filled[before]
        else:
            t = (m - before) / (after - before)
            filled[m] = filled[before] * (1 - t) + filled[after] * t
        print(f"  filled empty month {m} from neighbors {before}/{after}")

    # 1. Spatial fill within the SAME month: nearest observed cell, then
    # smooth the filled region so coverage edges do not leave terraces or
    # rings. Never fill across time - that leaks late-record ppm levels into
    # early years (e.g. a 2022-red polar cap on the 2003 globe).
    from scipy import ndimage

    pad = 24  # cyclic longitude padding so the fill respects the dateline
    for m in range(filled.shape[0]):
        grid = filled[m]
        mask = np.isnan(grid)
        if not mask.any():
            continue
        g = np.concatenate([grid[:, -pad:], grid, grid[:, :pad]], axis=1)
        gm = np.isnan(g)
        nearest = tuple(ndimage.distance_transform_edt(gm, return_distances=False, return_indices=True))
        g_filled = g[nearest]
        g_smooth = ndimage.gaussian_filter(g_filled, sigma=2.0, mode="nearest")
        g[gm] = g_smooth[gm]
        filled[m] = g[:, pad:-pad]

    if np.isnan(filled).any():
        raise SystemExit("Gap fill failed: NaNs remain (input record too sparse?)")
    return filled


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inputs", nargs="+", type=Path, help="Input granule(s) / netCDF file(s)")
    parser.add_argument(
        "--extend",
        action="append",
        nargs="+",
        type=Path,
        default=[],
        metavar="FILE",
        help="Files supplying only months nothing earlier covers, bias-corrected "
        "against the record so far over any overlap. Repeat the flag to chain "
        "several products, most-preferred first "
        "(e.g. --extend AIRS3C2M/*.hdf --extend carbontracker/*.nc).",
    )
    parser.add_argument(
        "--no-bias-correct",
        action="store_true",
        help="Splice --extend data as-is instead of removing its offset",
    )
    parser.add_argument(
        "--synth-noise",
        action="store_true",
        help="Lay the retrieval noise of the earlier products over the smooth "
        "modern ones, so the record keeps its texture throughout. Recipient "
        "months are labelled '+ resampled noise'.",
    )
    parser.add_argument(
        "--noise-gain",
        type=float,
        default=1.0,
        metavar="X",
        help="Scale the synthesized noise above the donor era's own scatter "
        "(default 1.0 = match it).",
    )
    parser.add_argument("-o", "--outdir", type=Path, default=Path(__file__).parent / "../public/data")
    args = parser.parse_args()

    primary = load_source(args.inputs)
    extensions = [load_source(group) for group in args.extend]
    month_keys, grids, sources = splice_records(
        primary, extensions, bias_correct=not args.no_bias_correct
    )

    n = len(month_keys)
    print(
        f"{n} months, {month_keys[0][0]}-{month_keys[0][1]:02d} .. "
        f"{month_keys[-1][0]}-{month_keys[-1][1]:02d}"
    )
    for label in dict.fromkeys(sources):
        covered = [k for k, s in zip(month_keys, sources) if s == label]
        print(
            f"  {label}: {len(covered)} months "
            f"({covered[0][0]}-{covered[0][1]:02d}..{covered[-1][0]}-{covered[-1][1]:02d})"
        )

    gaps = [
        (y, m)
        for (y, m) in (
            (k // 12, k % 12 + 1)
            for k in range(
                month_keys[0][0] * 12 + month_keys[0][1] - 1,
                month_keys[-1][0] * 12 + month_keys[-1][1],
            )
        )
        if (y, m) not in set(month_keys)
    ]
    if gaps:
        print(f"  WARNING: {len(gaps)} missing month(s) in the span, e.g. {gaps[:6]}")

    missing = int(np.isnan(grids).sum())
    print(f"missing cells: {missing} of {grids.size} ({100 * missing / grids.size:.1f}%)")
    grids = gap_fill(grids)

    if args.synth_noise:
        sources = synthesize_noise(grids, sources, month_keys, args.noise_gain)

    # Area-weighted global means
    weights = np.cos(np.deg2rad(LAT))[:, None]
    means = (grids * weights).sum(axis=(1, 2)) / (weights.sum() * LON.size)

    # Record range, for reference and as the fallback display domain.
    vmin = float(np.floor(grids.min()))
    vmax = float(np.ceil(grids.max()))
    print(f"record range: {vmin} .. {vmax} ppm")

    # Suggested display ramp, spanning the record's monthly means with headroom
    # so neither end saturates and the whole animation stays legible.
    #
    # The original Cinder ramp was hue = clamp((1-(co2-370)/25)*0.25, 0, 0.3),
    # i.e. linear from 365 ppm (green) to 395 ppm (red) - correct for its
    # 2002-2012 record ending near 392 ppm. This formula reproduces that low
    # anchor (365) and grows the top end as the record extends, instead of
    # pinning 395 and flattening every later month to saturated red.
    color_min = float(np.floor(means.min() - 6.0))
    color_max = float(np.ceil(means.max() + 4.0))
    print(
        f"display ramp: {color_min} .. {color_max} ppm "
        f"(monthly means {means.min():.1f} .. {means.max():.1f})"
    )

    # uint8 scaled to each month's OWN range. A month spans ~30-40 ppm, so 8
    # bits give ~0.13 ppm steps - far below the data's own ~1 ppm retrieval
    # noise and ~0.2% of the colour ramp, i.e. invisible - while halving the
    # payload against a global uint16. Per-month rather than global scaling is
    # what makes 8 bits enough: the record as a whole spans ~106 ppm.
    lo = grids.min(axis=(1, 2))
    hi = grids.max(axis=(1, 2))
    span = np.where(hi > lo, hi - lo, 1.0)
    quantized = (
        np.clip((grids - lo[:, None, None]) / span[:, None, None] * 255, 0, 255)
        .round()
        .astype(np.uint8)
    )
    err = np.abs(lo[:, None, None] + quantized / 255.0 * span[:, None, None] - grids)
    print(
        f"encoding: uint8 per month, max error {err.max():.3f} ppm "
        f"(mean {err.mean():.4f}); month spans {span.min():.1f}..{span.max():.1f} ppm"
    )

    # Per-month cell-to-cell RMS ("fur"): how much fine texture each month
    # actually carries. The old AIRS retrievals run ~1-2 ppm; modern
    # quality-screened products are ~0.4. The app uses this to optionally top
    # the smoother months up to a common texture level.
    from scipy import ndimage as _ndi

    fur = [
        float(np.std(g - _ndi.uniform_filter(g, size=3, mode="nearest"))) for g in grids
    ]
    print(f"per-month fur: {min(fur):.2f} .. {max(fur):.2f} ppm cell-to-cell RMS")
    for label in dict.fromkeys(sources):
        vals = [f for f, s in zip(fur, sources) if s == label]
        print(f"  {label}: {np.mean(vals):.2f} ppm mean")

    months = [
        {
            "year": y,
            "month": mo,
            "mean": round(float(means[i]), 2),
            "source": sources[i],
            "fur": round(fur[i], 3),
            # Dequantization bounds for this month's uint8 block
            "lo": round(float(lo[i]), 3),
            "hi": round(float(hi[i]), 3),
        }
        for i, (y, mo) in enumerate(month_keys)
    ]

    outdir = args.outdir.resolve()
    outdir.mkdir(parents=True, exist_ok=True)
    (outdir / "co2.bin").write_bytes(quantized.tobytes())
    (outdir / "co2.json").write_text(
        json.dumps(
            {
                "rows": int(LAT.size),
                "cols": int(LON.size),
                "lat": [float(v) for v in LAT],
                "lon": [float(v) for v in LON],
                "months": months,
                "vmin": vmin,
                "vmax": vmax,
                "colorMin": color_min,
                "colorMax": color_max,
                "encoding": "u8",
            }
        )
    )
    size_mb = (outdir / "co2.bin").stat().st_size / 1e6
    print(f"wrote {outdir / 'co2.bin'} ({size_mb:.1f} MB) and co2.json")


if __name__ == "__main__":
    main()
