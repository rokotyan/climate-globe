#version 300 es
precision highp float;

in vec2 vUv;

uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uIntensity;

out vec4 fragColor;

void main() {
  vec3 scene = texture(uScene, vUv).rgb;
  vec3 bloom = texture(uBloom, vUv).rgb;
  // Purely additive, and the scene passes through untouched - no tone curve.
  // A tonemap would rescale every cell's colour and quietly break the mapping
  // the colorbar promises; light may be added on top of that, never applied to
  // it. Anything over 1.0 simply clips, which is what a blown-out limb is.
  fragColor = vec4(scene + bloom * uIntensity, 1.0);
}
