#version 300 es
precision highp float;

// Fullscreen quad in clip space; two triangles from a 12-float buffer.
in vec2 position;

out vec2 vUv;

void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
