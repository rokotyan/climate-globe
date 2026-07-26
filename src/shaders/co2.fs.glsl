#version 300 es
precision highp float;

in vec3 vColor;
in vec3 vWorldPos;
flat in float vLightMix;

out vec4 fragColor;

void main() {
  // Per-face normal for optional faceted shading; vLightMix = 0 is the
  // faithful unlit look of the original (GL_LIGHTING was never enabled).
  vec3 n = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
  float diffuse = 0.35 + 0.65 * abs(dot(n, normalize(vec3(0.2, 0.6, 1.0))));
  float shade = mix(1.0, diffuse, vLightMix);
  fragColor = vec4(vColor * shade, 1.0);
}
