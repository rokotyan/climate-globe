import {Matrix4} from '@math.gl/core';

/**
 * Port of the Cinder POV class (src/POV.cpp): an auto-rotating orbit camera
 * with eased angle/distance and passive-pointer pitch. The original applied
 * its constants once per frame at 60 fps; here they are dt-scaled so the
 * feel is framerate-independent.
 */

export class Camera {
  angle = 0;
  angleDest = 0;
  dist = 600;
  distDest = 750;

  /**
   * Vertical orbit angle in radians, eased like the others. The original
   * offset the eye vertically by a pixel count (eye.y = mouseY - height/2),
   * which at typical distances capped the view at roughly 22 degrees above or
   * below the equator. Orbiting by angle instead lets the pointer carry the
   * camera right over the poles.
   */
  tilt = 0;
  tiltDest = 0;
  /** Limit of the vertical orbit; stays short of 90 deg so `up` never degenerates. */
  maxTiltDegrees = 80;

  readonly center: [number, number, number] = [0, 0, 0];
  eye: [number, number, number] = [0, 0, 600];

  fovyDegrees = 60;
  near = 1;
  far = 20000;

  minDist = 260;
  maxDist = 3000;

  private view = new Matrix4();
  private projection = new Matrix4();
  private viewProjection = new Matrix4();

  update(dt: number): void {
    const frames = dt * 60;
    // Original per-frame: angleDest += 0.01; angle -= (angle - angleDest) * 0.1
    this.angleDest += 0.01 * frames;
    const ease = 1 - Math.pow(0.9, frames);
    this.angle += (this.angleDest - this.angle) * ease;
    this.dist += (this.distDest - this.dist) * ease;
    this.tilt += (this.tiltDest - this.tilt) * ease;

    // True spherical orbit: the distance to the globe stays constant as the
    // camera rises, so it keeps its framing all the way to the pole.
    const horizontal = Math.cos(this.tilt) * this.dist;
    this.eye = [
      Math.sin(this.angle) * horizontal,
      Math.sin(this.tilt) * this.dist,
      Math.cos(this.angle) * horizontal
    ];
    this.view.lookAt({eye: this.eye, center: this.center, up: [0, 1, 0]});
  }

  /**
   * Pointer position drives the camera (no drag), like the original mouseMove:
   * horizontal motion nudges the orbit angle, vertical position sets the tilt.
   * Pointer at the bottom of the window looks down on the globe, at the top
   * looks up at it - the same sense as the original.
   */
  onPointerMove(y: number, dx: number, height: number): void {
    this.angleDest += -dx * 0.025;
    const fraction = Math.max(-1, Math.min(1, (y - height / 2) / (height / 2)));
    this.tiltDest = fraction * ((this.maxTiltDegrees * Math.PI) / 180);
  }

  adjustDist(delta: number): void {
    this.distDest = Math.min(this.maxDist, Math.max(this.minDist, this.distDest + delta));
  }

  /**
   * Frame the globe: distance is derived from its largest possible radius so
   * the framing holds no matter how long the record is (the globe grows with
   * the CO2 trend). Keeps the original's 0.8 dolly-in ratio.
   */
  frameRadius(maxRadius: number, snap = true): void {
    this.distDest = maxRadius * 2.6;
    this.minDist = maxRadius * 1.05;
    this.maxDist = maxRadius * 12;
    // snap=false leaves the current distance alone, so the normal easing
    // glides to the new framing instead of jumping (used by the sliders).
    if (snap) this.dist = this.distDest * 0.8;
  }

  /** Column-major view-projection matrix for the current state. */
  getViewProjection(aspect: number): Float32Array {
    // In portrait/narrow viewports, widen the vertical FOV so the horizontal
    // extent stays as wide as it is at square aspect - otherwise the globe
    // gets clipped left and right.
    const fovy = (this.fovyDegrees * Math.PI) / 180;
    const effectiveFovy =
      aspect < 1 ? 2 * Math.atan(Math.tan(fovy / 2) / aspect) : fovy;

    this.projection.perspective({
      fovy: effectiveFovy,
      aspect,
      near: this.near,
      far: this.far
    });
    this.viewProjection.copy(this.projection).multiplyRight(this.view);
    return new Float32Array(this.viewProjection);
  }
}
