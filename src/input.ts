import type {Camera} from './camera';
import type {Playback} from './playback';
import type {CO2Globe} from './co2-globe';
import type {Controls} from './controls';
import type {LayerSwitch} from './layer-switch';

/**
 * Pointer, touch and keyboard bindings.
 *
 * Mouse keeps the original's passive feel: the camera follows the pointer
 * without any dragging (EarthquakeApp::mouseMove), and a click steps a month.
 * Touch has no hover, so it gets the conventional mapping instead - drag to
 * orbit, pinch to zoom, tap to step.
 */

interface Targets {
  canvas: HTMLCanvasElement;
  camera: Camera;
  playback: Playback;
  globe: CO2Globe;
  controls: Controls;
  layerSwitch: LayerSwitch;
}

const TAP_SLOP_PX = 12;
const TAP_MS = 400;
/** Screen pixels to radians when dragging. */
const DRAG_ANGLE = 0.006;
const DRAG_TILT = 0.005;

export function bindInput({canvas, camera, playback, globe, controls, layerSwitch}: Targets): void {
  const overUi = (e: Event) =>
    (e.target as HTMLElement | null)?.closest('#controls, #layers') !== null;

  // --- Mouse: passive, no drag (the original's feel) ---
  let lastMouseX: number | null = null;
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const dx = lastMouseX === null ? 0 : e.clientX - lastMouseX;
    lastMouseX = e.clientX;
    if (overUi(e)) return;
    camera.onPointerMove(e.clientY, dx, window.innerHeight);
  });

  // Click stops and starts the piece. The original stepped a month here, but
  // stopping is what a viewer reaches for - and it is what brings up the city
  // labels, so the globe becomes readable.
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') playback.togglePlay();
  });

  // --- Touch / pen: drag to orbit, pinch to zoom, tap to step ---
  const active = new Map<number, {x: number; y: number}>();
  let downAt = 0;
  let moved = 0;
  let pinchDist = 0;

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || overUi(e)) return;
    canvas.setPointerCapture(e.pointerId);
    active.set(e.pointerId, {x: e.clientX, y: e.clientY});
    if (active.size === 1) {
      downAt = e.timeStamp;
      moved = 0;
    } else if (active.size === 2) {
      pinchDist = spread(active);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') return;
    const prev = active.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    active.set(e.pointerId, {x: e.clientX, y: e.clientY});
    moved += Math.abs(dx) + Math.abs(dy);

    if (active.size >= 2) {
      const now = spread(active);
      if (pinchDist > 0 && now > 0) camera.scaleDist(pinchDist / now);
      pinchDist = now;
      return;
    }
    // Drag follows the finger: right/up moves the globe right/up.
    camera.nudge(dx * DRAG_ANGLE, -dy * DRAG_TILT);
  });

  const endPointer = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    const wasSingle = active.size === 1;
    active.delete(e.pointerId);
    if (active.size < 2) pinchDist = 0;
    if (wasSingle && moved < TAP_SLOP_PX && e.timeStamp - downAt < TAP_MS) {
      playback.togglePlay();
    }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  // --- Wheel zoom ---
  window.addEventListener(
    'wheel',
    (e) => {
      if (overUi(e)) return;
      e.preventDefault();
      const notches = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY / 3 : e.deltaY / 100;
      camera.adjustDist(notches * 20);
    },
    {passive: false}
  );

  // --- Keyboard (mappings from the original) ---
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
    if (e.key >= '1' && e.key <= '9') {
      layerSwitch.selectByIndex(Number(e.key) - 1);
      return;
    }
    switch (e.key) {
      case 'p':
        playback.togglePlay();
        break;
      case 'f':
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen();
        break;
      case 'l':
        globe.lightMix = globe.lightMix > 0 ? 0 : 1;
        controls.refresh();
        break;
      case 'h':
        controls.toggleVisible();
        break;
      case 'ArrowRight':
        // The original's click-to-advance, now that click stops and starts
        playback.step();
        break;
      case 'ArrowUp':
        camera.adjustDist(-10);
        break;
      case 'ArrowDown':
        camera.adjustDist(10);
        break;
    }
  });
}

function spread(points: Map<number, {x: number; y: number}>): number {
  const [a, b] = [...points.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
}
