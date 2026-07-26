#version 300 es
precision highp float;

// Unit direction on the sphere for this grid cell (from lat/lon, fixed)
in vec3 unitDir;
// (row, col) into the data grid
in vec2 gridIndex;

// All months packed into one R32F atlas: uMonthsPerAtlasRow slices per atlas
// row, each slice is cols x rows texels (x = lon col, y = lat row).
uniform sampler2D co2Texture;

uniform mat4 uViewProj;
uniform float uMonthA;
uniform float uMonthB;
uniform float uT;
uniform float uVmin;
uniform float uVmax;
uniform float uRadiusBase;
uniform float uPerPpm;
uniform float uLightMix;
uniform float uGridRows;
uniform float uGridCols;
uniform float uMonthsPerAtlasRow;
uniform float uMonthMean;
uniform float uRefMid;
uniform float uTexLimit;
// Per-cell grain (ppm) added to each month, to top the smoother modern
// products up to the texture level of the older AIRS retrievals. 0 = the
// data exactly as measured.
uniform float uGrainA;
uniform float uGrainB;
// 0 = classic green->red ramp, 1 = extended green->violet ramp
uniform float uPaletteMix;

out vec3 vColor;
out vec3 vWorldPos;
// Passed to the fragment stage so it needs no uniforms of its own.
flat out float vLightMix;

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

/* The original Cinder ramp: hue 0.3 (green) -> 0.0 (red), s = v = 1. */
vec3 classicRamp(float t) {
  return hsv2rgb(vec3(0.3 * (1.0 - t), 1.0, 1.0));
}

/* Extended ramp, carrying the scale past red where the original topped out.
   Mirrored in TS as EXTENDED_STOPS (src/color.ts) - keep the two in sync. */
vec3 extendedRamp(float t) {
  const int N = 7;
  vec3 c[7] = vec3[7](
    vec3(0.098, 0.455, 0.208), // deep green
    vec3(0.180, 0.608, 0.235), // green
    vec3(0.659, 0.847, 0.169), // yellow-green
    vec3(0.949, 0.882, 0.173), // yellow
    vec3(0.961, 0.580, 0.094), // orange
    vec3(0.886, 0.200, 0.122), // red
    vec3(0.478, 0.055, 0.063)  // dark red
  );
  float s[7] = float[7](0.0, 0.20, 0.38, 0.52, 0.66, 0.82, 1.0);

  vec3 col = c[N - 1];
  for (int i = 0; i < N - 1; i++) {
    if (t <= s[i + 1]) {
      col = mix(c[i], c[i + 1], (t - s[i]) / (s[i + 1] - s[i]));
      break;
    }
  }
  return col;
}

vec3 rampColor(float t) {
  t = clamp(t, 0.0, 1.0);
  if (uPaletteMix <= 0.0) return classicRamp(t);
  if (uPaletteMix >= 1.0) return extendedRamp(t);
  return mix(classicRamp(t), extendedRamp(t), uPaletteMix);
}

float fetchPpm(int m, ivec2 rowCol) {
  int perRow = int(uMonthsPerAtlasRow);
  ivec2 origin = ivec2((m % perRow) * int(uGridCols), (m / perRow) * int(uGridRows));
  return texelFetch(co2Texture, origin + ivec2(rowCol.y, rowCol.x), 0).r;
}

/* Deterministic per (cell, month) value in [-1,1]. Stable for a given month so
   the grain does not shimmer between frames, and lerped between months just
   like the data, so it evolves without popping. */
float grainAt(int m, ivec2 rowCol) {
  vec3 p = vec3(float(rowCol.x), float(rowCol.y), float(m));
  float h = fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  return h * 2.0 - 1.0;
}

void main() {
  ivec2 rowCol = ivec2(gridIndex);
  int mA = int(uMonthA);
  int mB = int(uMonthB);
  float ppmA = fetchPpm(mA, rowCol) + grainAt(mA, rowCol) * uGrainA;
  float ppmB = fetchPpm(mB, rowCol) + grainAt(mB, rowCol) * uGrainB;
  float ppm = mix(ppmA, ppmB, uT);
  float norm = clamp((ppm - uVmin) / (uVmax - uVmin), 0.0, 1.0);

  vColor = rampColor(norm);

  // Original CO2Mesh math, radius = 200 + 5*(co2 - 375), decomposed into the
  // slow trend (monthMean vs record midpoint) plus local texture. The local
  // deviation is soft-limited like the original's [360,400] window, so
  // extreme surface cells cannot become huge quills.
  float deviation = uTexLimit * tanh((ppm - uMonthMean) / uTexLimit);
  float radius = uRadiusBase + uPerPpm * (uMonthMean - uRefMid) + uPerPpm * deviation;
  vWorldPos = radius * unitDir;
  vLightMix = uLightMix;
  gl_Position = uViewProj * vec4(vWorldPos, 1.0);
}
