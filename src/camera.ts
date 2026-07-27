import {Matrix4} from '@math.gl/core';

/**
 * Port of the Cinder POV class (src/POV.cpp): an auto-rotating orbit camera
 * with eased angle/distance and passive-pointer pitch. The original applied
 * its constants once per frame at 60 fps; here they are dt-scaled so the
 * feel is framerate-independent.
 */

/** Opening vertical orbit, in radians: 30 deg above the equator. */
const START_TILT = (30 * Math.PI) / 180;

export class Camera {
  /** Accumulated auto-orbit angle - see `advanceOrbit`. */
  orbit = 0;
  /**
   * Auto-orbit rate, on the wall clock rather than the month cursor, so the
   * spin and the playback rate can be dialled in against each other: a slow
   * turn over fast months, or the reverse. (Tying one revolution to one year of
   * data made the two inseparable - months could only go faster by spinning the
   * globe faster.) The original's 0.01 rad per frame at 60 fps is 34 deg/sec;
   * 30 is that, rounded. 0 stops the spin without stopping playback.
   */
  orbitDegreesPerSecond = 30;
  /** Pointer nudges, eased and added on top of the orbit. */
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
   *
   * Opens 30 deg above the equator, looking down towards the north pole - where
   * the land is, and with it nearly all of the seasonal CO2 swing. A mouse
   * overrides it on the first move, since onPointerMove sets the tilt absolutely
   * from the pointer's height; on touch, drag is relative, so it holds.
   */
  tilt = START_TILT;
  tiltDest = START_TILT;
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

  /**
   * Advance the auto-orbit by one frame's worth. Called only while playback
   * runs, so stopping the piece stops the globe - which is what makes the city
   * labels readable.
   */
  advanceOrbit(dt: number): void {
    this.orbit += ((this.orbitDegreesPerSecond * Math.PI) / 180) * dt;
  }

  update(dt: number): void {
    const frames = dt * 60;
    const ease = 1 - Math.pow(0.9, frames);
    // Original per-frame: angle -= (angle - angleDest) * 0.1. Only the
    // pointer's contribution is eased now; the orbit itself comes from the
    // clock, and easing it would let the globe drift out of step.
    this.angle += (this.angleDest - this.angle) * ease;
    this.dist += (this.distDest - this.dist) * ease;
    this.tilt += (this.tiltDest - this.tilt) * ease;

    // True spherical orbit: the distance to the globe stays constant as the
    // camera rises, so it keeps its framing all the way to the pole.
    const heading = this.orbit + this.angle;
    const horizontal = Math.cos(this.tilt) * this.dist;
    this.eye = [
      Math.sin(heading) * horizontal,
      Math.sin(this.tilt) * this.dist,
      Math.cos(heading) * horizontal
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

  /**
   * Ease back to the opening tilt.
   *
   * The pointer's height sets the tilt absolutely, and the sparkline sits at the
   * very top of the window - so simply reaching for it drove the tilt to about
   * -63 degrees and left the globe being viewed from underneath. Scrubbing calls
   * this so the view recovers while you use it.
   */
  resetTilt(): void {
    this.tiltDest = START_TILT;
  }

  adjustDist(delta: number): void {
    this.distDest = Math.min(this.maxDist, Math.max(this.minDist, this.distDest + delta));
  }

  /** Multiply the target distance (pinch-to-zoom). */
  scaleDist(factor: number): void {
    this.distDest = Math.min(this.maxDist, Math.max(this.minDist, this.distDest * factor));
  }

  /** Incremental orbit, for drag on touch where there is no hover position. */
  nudge(deltaAngle: number, deltaTilt: number): void {
    this.angleDest += deltaAngle;
    const max = (this.maxTiltDegrees * Math.PI) / 180;
    this.tiltDest = Math.max(-max, Math.min(max, this.tiltDest + deltaTilt));
  }

  /**
   * Frame the globe: distance is derived from its largest possible radius so
   * the framing holds no matter how long the record is (the globe grows with
   * the CO2 trend). Keeps the original's 0.8 dolly-in ratio.
   */
  frameRadius(maxRadius: number, snap = true): void {
    // 2.3x leaves the biggest month filling ~75% of the short axis. The globe
    // grows with the CO2 trend, so early months sit well inside this.
    this.distDest = maxRadius * 2.3;
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
