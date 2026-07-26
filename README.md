# AIRS CO₂ — WebGL2 port

Web port (luma.gl v9 / WebGL2, TypeScript, Vite) of the 2014 Cinder piece in
this repo: monthly global CO₂ concentration rendered as a displaced,
green→red globe, animating through the satellite record with an
auto-rotating orbit camera.

## Run

```sh
npm install
npm run dev        # http://localhost:5199
```

The shipped data is **AIRS CO₂, Sept 2002 – Feb 2026** (280 months), spliced
from three retrievals of the same instrument, each bias-corrected against the
previous over their overlap:

| Months | Product | Fur (cell-to-cell) |
|---|---|---|
| 2002-09 – 2012-02 | AIRX3C2M (AMSU-coupled) — the original's own source | 1.19 ppm |
| 2012-03 – 2017-02 | AIRS3C2M (IR-only) | 1.65 ppm |
| 2017-03 – 2026-02 | CLIMCAPS L3 (1°, modern algorithm) | 0.39 ppm |

Global mean rises 371.6 → 421.4 ppm. The header names the product for the
month on screen. All three are sampled at native resolution (nearest
neighbour, never averaged) so their per-cell retrieval noise — the fine "fur"
of the artwork — is preserved.

Note the fur column: modern quality-screened retrievals deliberately suppress
the per-cell scatter that gives the early years their texture, so the post-2017
months are intrinsically smoother. The **Grain target** slider compensates,
topping each month up to a common texture level (adding least where the data
already has its own); the header then reads "… + grain" so synthetic texture is
never passed off as measured.

To regenerate or swap datasets see [tools/README.md](tools/README.md). Without
`public/data/*`, the app falls back to a synthetic dataset.

URL params: `?synthetic` forces synthetic data, `?start=<n>` starts playback
at month index *n*.

## Controls (same as the original app)

- **pointer** — vertical position tilts the camera, horizontal motion nudges the orbit
- **wheel / ↑ ↓** — zoom
- **click** — advance one month
- **p** — pause/resume playback (camera keeps orbiting)
- **f** — fullscreen (Esc exits)
- **h** — show/hide the parameter panel
- **l** — toggle faceted lighting

## Parameter panel

A live tweak panel (top-left, collapsible, `h` to hide) exposes the look
parameters so you can dial the aesthetic without editing code:

- **Displacement (units/ppm)** — relief amplitude (original used 5)
- **Texture limit (ppm)** — soft cap on a cell's deviation from the monthly
  mean; low = smooth, high = dramatic spikes
- **Base radius** — globe size at the record's midpoint ppm
- **Lighting** — 0 = unlit smooth vertex colors (faithful to the original),
  1 = faceted relief shading
- **Grain target (ppm)** — common cell-to-cell texture level. Each month is
  topped up only by what it lacks, so the noisy early AIRS years are barely
  touched while the smooth modern ones gain the missing fur. 0 = every month
  exactly as measured
- **Color min / max (ppm)** — the green→red ramp domain (also relabels the
  colorbar and re-tints the readout)
- **Speed (months/sec)** — playback rate (original ~10)

Reset restores the defaults. These are authoring controls; the defaults in
`src/co2-globe.ts` / `src/playback.ts` are what ship.

## How it differs from the C++ original

- All months live in one R32F texture atlas; the vertex shader interpolates
  between month slices and computes displacement + color, so nothing is
  rebuilt on the CPU per frame (the original re-lerped the grid and
  recomputed normals every frame).
- The ppm→radius and ppm→hue mappings are parameterized by the dataset's
  vmin/vmax (the record now spans ~372–428 ppm, vs ~370–395 in 2012).
- The HUD colorbar is drawn from the same ramp used by the shader instead of
  the old `colorbar.png`.
- Earth textures, star field, and earthquake features (already disabled in
  the C++ code) were not ported.
