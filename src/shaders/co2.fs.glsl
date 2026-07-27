#version 300 es
precision highp float;

in vec3 vColor;
in vec3 vWorldPos;
in vec3 vSphereNormal;
flat in float vLightMix;

// Camera position in world space, for the rim's view vector.
uniform vec3 uEye;
uniform float uRimStrength;
uniform float uRimPower;
/**
 * 1 when drawing into the offscreen bloom target, 0 when drawing straight to
 * the canvas. The canvas is composited with premultiplied alpha, so a mask in
 * the alpha channel is not merely ignored there - rgb 0.9 against alpha 0.02
 * is an invalid pair, and the browser resolves it to near-white. The mask has
 * to be suppressed when there is no offscreen pass to consume it.
 */
uniform float uAlphaMask;

out vec4 fragColor;

void main() {
  // Per-face normal for optional faceted shading; vLightMix = 0 is the
  // faithful unlit look of the original (GL_LIGHTING was never enabled).
  vec3 n = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
  float diffuse = 0.35 + 0.65 * abs(dot(n, normalize(vec3(0.2, 0.6, 1.0))));
  float shade = mix(1.0, diffuse, vLightMix);

  // Nothing scales the ramp colour: the surface is the value's colour exactly
  // as the colorbar reports it, and every effect below is added on top.
  vec3 surface = vColor * shade;

  // Fresnel rim: grazing angles glow. Added rather than mixed, so it reads as
  // light around the planet instead of altering any cell's reported value, and
  // carried past 1.0 on purpose - the bloom pass picks the excess up as a halo.
  vec3 view = normalize(uEye - vWorldPos);
  float facing = clamp(dot(normalize(vSphereNormal), view), 0.0, 1.0);
  float fresnel = pow(1.0 - facing, uRimPower);
  /* Mostly the cell's own colour, with a cool lift left in. Weighted toward the
     blue it went badly wrong: over a red globe a 40% mix read as pale lavender,
     a lens ring rather than air. 0.75 keeps the halo the colour of the data
     beneath it, and also spares the temperature palette - already full of
     blues - from a rim it would have clashed with. */
  vec3 rimTint = mix(vec3(0.45, 0.68, 1.0), vColor, 0.75);

  /* Alpha is a bloom mask, not opacity - nothing here is transparent, so the
     channel is free, and an explicit mask beats letting the bright pass guess
     from brightness. Thresholding on colour made the whole surface bloom once
     the ramp reached red, hazing over the palette; keying the glow to the limb
     keeps every cell's colour exactly as tuned and turns the bloom into
     atmosphere around the planet rather than fog on top of it.

     The background clears to alpha 1, but its rgb is black, so it contributes
     nothing when the bright pass multiplies the two. */
  fragColor = vec4(surface + rimTint * fresnel * uRimStrength, mix(1.0, fresnel, uAlphaMask));
}
