#version 300 es
precision highp float;

in vec2 vUv;

uniform sampler2D uSource;
/** One texel step along the axis being blurred, times the pass's spread. */
uniform vec2 uStep;

out vec4 fragColor;

/* Separable Gaussian on bilinear taps: sampling between texels lets 5 fetches
   cover the same span a 9-tap would, since each one already averages a pair.
   Offsets and weights are the standard sigma ~2 collapse. */
const float OFFSETS[3] = float[3](0.0, 1.3846153846, 3.2307692308);
const float WEIGHTS[3] = float[3](0.2270270270, 0.3162162162, 0.0702702703);

void main() {
  vec3 sum = texture(uSource, vUv).rgb * WEIGHTS[0];
  for (int i = 1; i < 3; i++) {
    vec2 delta = uStep * OFFSETS[i];
    sum += texture(uSource, vUv + delta).rgb * WEIGHTS[i];
    sum += texture(uSource, vUv - delta).rgb * WEIGHTS[i];
  }
  fragColor = vec4(sum, 1.0);
}
