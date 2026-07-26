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

out vec3 vColor;
out vec3 vWorldPos;
// Passed to the fragment stage so it needs no uniforms of its own.
flat out float vLightMix;

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

float fetchPpm(int m, ivec2 rowCol) {
  int perRow = int(uMonthsPerAtlasRow);
  ivec2 origin = ivec2((m % perRow) * int(uGridCols), (m / perRow) * int(uGridRows));
  return texelFetch(co2Texture, origin + ivec2(rowCol.y, rowCol.x), 0).r;
}

void main() {
  ivec2 rowCol = ivec2(gridIndex);
  float ppm = mix(fetchPpm(int(uMonthA), rowCol), fetchPpm(int(uMonthB), rowCol), uT);
  float norm = clamp((ppm - uVmin) / (uVmax - uVmin), 0.0, 1.0);

  // Same ramp as the original CO2Mesh.cpp: hue 0.3 (green) -> 0.0 (red), s = v = 1.
  // Mirrored in TS for the HUD (src/color.ts) - keep in sync.
  float hue = 0.3 * (1.0 - norm);
  vColor = hsv2rgb(vec3(hue, 1.0, 1.0));

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
