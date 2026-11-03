#version 300 es
precision highp float;

in vec2 vUv;

uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uIntensity;
/* 0 on a dark background, 1 on a light one - see Bloom.setBackground. */
uniform float uTint;

out vec4 fragColor;

void main() {
  vec3 scene = texture(uScene, vUv).rgb;
  vec4 bloom = texture(uBloom, vUv);
  // Purely additive, and the scene passes through untouched - no tone curve.
  // A tonemap would rescale every cell's colour and quietly break the mapping
  // the colorbar promises; light may be added on top of that, never applied to
  // it. Anything over 1.0 simply clips, which is what a blown-out limb is.
  //
  // On a light background adding light has nowhere to go - an off-white plus
  // a little red is white - so the halo is blended as a tint instead: the
  // scene gives way by the blurred mask and the halo's colour fills the gap,
  // which is a lerp from the page toward the limb's colour. Over the globe the
  // mask is near zero except at the limb, so the surface stays the ramp's.
  float give = uTint * bloom.a * uIntensity;
  fragColor = vec4(scene * (1.0 - give) + bloom.rgb * uIntensity, 1.0);
}
