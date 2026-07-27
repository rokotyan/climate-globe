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
// Fraction of the record's trend shown as growth; scales only the mean term,
// leaving the local deviation (the fur) at full strength.
uniform float uTrendGain;
// 0 = classic green->red ramp, 1 = extended green->violet ramp
uniform float uPaletteMix;
// 0 = the concentration ramps above, 1 = the temperature ramp
uniform float uPalette;

out vec3 vColor;
out vec3 vWorldPos;
/* The undisplaced sphere normal. The rim wants this rather than the real
   surface normal: traced along the smooth sphere it draws one clean limb,
   where the displaced normal would catch every fur spike and fray it. */
out vec3 vSphereNormal;
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
    vec3(0.204, 0.343, 0.302), // green
    vec3(0.353, 0.769, 0.278), // bright green
    vec3(0.659, 0.847, 0.169), // yellow-green
    vec3(0.949, 0.882, 0.173), // yellow
    vec3(0.961, 0.580, 0.094), // orange
    vec3(0.886, 0.200, 0.122), // red
    vec3(0.478, 0.055, 0.063)  // dark red
  );
  float s[7] = float[7](0.0, 0.20, 0.32, 0.52, 0.66, 0.82, 1.0);

  vec3 col = c[N - 1];
  for (int i = 0; i < N - 1; i++) {
    if (t <= s[i + 1]) {
      col = mix(c[i], c[i + 1], (t - s[i]) / (s[i + 1] - s[i]));
      break;
    }
  }
  return col;
}

/* Temperature ramp, anchored to actual degrees on the layer's fixed -40..40
   scale: blues below freezing, green where it is comfortable, red past 30.
   Mirrored in TS as TEMP_STOPS (src/color.ts) - keep the two in sync. */
vec3 tempRamp(float t) {
  const int N = 11;
  vec3 c[11] = vec3[11](
    vec3(0.039, 0.165, 0.420), // -40 deep blue
    vec3(0.118, 0.373, 0.749), // -25 blue
    vec3(0.310, 0.659, 0.910), // -10 light blue
    vec3(0.659, 0.863, 0.941), //   0 freezing
    vec3(0.435, 0.780, 0.659), //   8 cool green
    vec3(0.247, 0.686, 0.306), //  16 green
    vec3(0.341, 0.749, 0.247), //  20 green
    vec3(0.910, 0.851, 0.227), //  25 yellow
    vec3(0.941, 0.569, 0.165), //  30 orange
    vec3(0.886, 0.227, 0.118), //  35 red
    vec3(0.557, 0.090, 0.063)  //  40 dark red
  );
  float s[11] = float[11](
    0.0, 0.1875, 0.375, 0.5, 0.6, 0.7, 0.75, 0.8125, 0.875, 0.9375, 1.0
  );

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
  // The temperature palette means particular degrees, so it is used as-is
  // rather than blended with the concentration ramps.
  if (uPalette > 0.5) return tempRamp(t);
  if (uPaletteMix <= 0.0) return classicRamp(t);
  if (uPaletteMix >= 1.0) return extendedRamp(t);
  return mix(classicRamp(t), extendedRamp(t), uPaletteMix);
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

  vColor = rampColor(norm);

  // Original CO2Mesh math, radius = 200 + 5*(co2 - 375), decomposed into the
  // slow trend (monthMean vs record midpoint) plus local texture. The local
  // deviation is soft-limited like the original's [360,400] window, so
  // extreme surface cells cannot become huge quills.
  float deviation = uTexLimit * tanh((ppm - uMonthMean) / uTexLimit);
  float radius =
    uRadiusBase + uTrendGain * uPerPpm * (uMonthMean - uRefMid) + uPerPpm * deviation;
  vWorldPos = radius * unitDir;
  vSphereNormal = unitDir;
  vLightMix = uLightMix;
  gl_Position = uViewProj * vec4(vWorldPos, 1.0);
}
