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


def load_airs(paths: list[Path]) -> tuple[list[tuple[int, int]], np.ndarray]:
    """
    Read AIRS L3 monthly CO2 granules at native resolution.

    The AIRS grid is 91x144 with latitudes 89.5, 88, 86 ... and longitudes
    -180..177.5 - its first 76 rows and all 144 columns ARE the app grid, so
    cells map 1:1 with no interpolation and the per-cell retrieval noise (the
    visual "fur") survives intact.

    Returns (months, grids) where months is [(year, month), ...] sorted by
    date and grids is (n, 76, 144) in ppm with NaN for missing cells.
    """
    records: dict[tuple[int, int], np.ndarray] = {}

    for i, path in enumerate(sorted(paths)):
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

        if (year, month) in records:
            raise SystemExit(f"Duplicate month {year}-{month:02d} ({path.name})")
        records[(year, month)] = grid

        sys.stdout.write(f"\rreading AIRS {i + 1}/{len(paths)}")
        sys.stdout.flush()
    print()

    months = sorted(records)
    grids = np.stack([records[k] for k in months])
    return months, grids


def find_xco2_var(ds: xr.Dataset) -> str:
    for name in ("xco2", "XCO2", "co2", "xco2_ppm"):
        if name in ds.data_vars:
            return name
    raise SystemExit(f"No XCO2 variable found; data_vars: {list(ds.data_vars)}")


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
    parser.add_argument("inputs", nargs="+", type=Path, help="Input netCDF file(s)")
    parser.add_argument("-o", "--outdir", type=Path, default=Path(__file__).parent / "../public/data")
    args = parser.parse_args()

    # AIRS granules are read natively (no interpolation); anything else is
    # regridded onto the app grid.
    is_airs = all(p.suffix.lower() == ".hdf" for p in args.inputs)

    if is_airs:
        month_keys, grids = load_airs(args.inputs)
        n = len(month_keys)
        print(f"{n} months, {month_keys[0][0]}-{month_keys[0][1]:02d} .. "
              f"{month_keys[-1][0]}-{month_keys[-1][1]:02d}  (native AIRS grid, no regridding)")
    else:
        da = load_input(args.inputs)
        times = da["time"].values
        n = len(times)
        print(f"{n} months, {str(times[0])[:7]} .. {str(times[-1])[:7]}")

        grids = np.empty((n, LAT.size, LON.size), dtype=np.float64)
        for i in range(n):
            grids[i] = regrid_month(da.isel(time=i).compute())
            sys.stdout.write(f"\rregridding {i + 1}/{n}")
            sys.stdout.flush()
        print()
        month_keys = [
            (int(str(np.datetime_as_string(t, unit="M"))[:4]),
             int(str(np.datetime_as_string(t, unit="M"))[5:7]))
            for t in times
        ]

    missing = int(np.isnan(grids).sum())
    print(f"missing cells: {missing} of {grids.size} ({100 * missing / grids.size:.1f}%)")
    grids = gap_fill(grids)

    # Area-weighted global means
    weights = np.cos(np.deg2rad(LAT))[:, None]
    means = (grids * weights).sum(axis=(1, 2)) / (weights.sum() * LON.size)

    # Quantize over the FULL data range, not percentiles: clipping the tails
    # would flatten exactly the extreme cells that give AIRS its visual "fur".
    vmin = float(np.floor(grids.min()))
    vmax = float(np.ceil(grids.max()))
    print(f"quantization range: {vmin} .. {vmax} ppm (full data range, no clipping)")

    # Suggested display ramp. For AIRS this reproduces the original Cinder
    # mapping exactly: hue = clamp((1 - (co2-370)/25) * 0.25, 0, 0.3) is a
    # linear ramp from 365 ppm (hue 0.3, green) to 395 ppm (hue 0, red).
    if is_airs:
        color_min, color_max = 365.0, 395.0
    else:
        color_min = float(np.floor(np.percentile(grids, 1)))
        color_max = float(np.ceil(np.percentile(grids, 99)))
    print(f"display ramp: {color_min} .. {color_max} ppm")

    quantized = np.clip((grids - vmin) / (vmax - vmin) * 65535, 0, 65535).round().astype("<u2")

    months = [
        {"year": y, "month": mo, "mean": round(float(means[i]), 2)}
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
                "encoding": "u16",
            }
        )
    )
    size_mb = (outdir / "co2.bin").stat().st_size / 1e6
    print(f"wrote {outdir / 'co2.bin'} ({size_mb:.1f} MB) and co2.json")


if __name__ == "__main__":
    main()
