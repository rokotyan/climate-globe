#version 300 es
precision highp float;

in vec2 vUv;

uniform sampler2D uScene;

out vec4 fragColor;

/* Extracts what should glow using the mask the globe wrote into alpha (its
   Fresnel term) rather than testing brightness.

   A luminance threshold cannot work on this palette. Rec.709 reads bright green
   as 0.65 and deep red - the loudest colour on the ramp - as only 0.34, so it
   glowed the calm early years and left the alarming end dull. Max channel fixed
   the ordering but not the real problem: the ramp peaks near 0.95, so any
   threshold low enough to catch the reds caught the entire surface with them
   and washed the globe to salmon. A mask sidesteps the question entirely.

   Multiplying rgb by the mask keeps the halo the colour of the limb it came
   from, so it stays tinted by the data underneath. */
void main() {
  vec4 scene = texture(uScene, vUv);
  fragColor = vec4(scene.rgb * scene.a, 1.0);
}
