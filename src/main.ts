import {luma} from '@luma.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {AnimationLoop} from '@luma.gl/engine';
import {loadDataset, loadDatasetWithFallback, type Dataset, type LayerId} from './data';
import {LayerSwitch} from './layer-switch';
import {Camera} from './camera';
import {Playback} from './playback';
import {CO2Globe} from './co2-globe';
import {Hud} from './hud';
import {Controls} from './controls';
import {Labels} from './labels';
import {Bloom} from './post';
import {bindInput} from './input';

async function main(): Promise<void> {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;

  const dataset = await loadDatasetWithFallback();

  const device = await luma.createDevice({
    type: 'webgl',
    adapters: [webgl2Adapter],
    createCanvasContext: {canvas, autoResize: true, useDevicePixels: true}
  });

  const camera = new Camera();
  const playback = new Playback(dataset);
  const startParam = new URLSearchParams(window.location.search).get('start');
  if (startParam !== null) playback.seek(Number(startParam));
  const globe = new CO2Globe(device, dataset);
  const bloom = new Bloom(device);
  const hud = new Hud(dataset);
  const labels = new Labels(document.getElementById('cities')!, dataset);
  const controls = new Controls(globe, playback, hud, dataset, camera, bloom);
  camera.frameRadius(globe.maxRadius);

  // Layers are fetched on first use and kept, so switching back is instant.
  const loaded = new Map<LayerId, Dataset>([[dataset.id, dataset]]);
  const layerSwitch = new LayerSwitch(document.getElementById('layers')!, async (id) => {
    let next = loaded.get(id);
    if (!next) {
      next = await loadDataset(id);
      loaded.set(id, next);
    }
    globe.setDataset(next);
    playback.setDataset(next);
    hud.setDataset(next);
    camera.frameRadius(globe.maxRadius, false);
    controls.refresh();
  });

  bindInput({canvas, camera, playback, globe, controls, layerSwitch, bloom});

  let lastTime: number | null = null;

  const loop = new AnimationLoop({
    device,
    autoResizeViewport: true,
    onRender: ({aspect, time}) => {
      const dt = lastTime === null ? 1 / 60 : Math.min((time - lastTime) / 1000, 0.1);
      lastTime = time;

      playback.update(dt);
      // The spin runs on its own rate, but only while the piece does - a
      // stopped globe is what the city labels are for.
      if (playback.playing) camera.advanceOrbit(dt);
      camera.update(dt);
      const frame = playback.frame();

      const viewProj = camera.getViewProjection(aspect);
      // Draws offscreen when bloom is on, straight to the canvas when it is
      // off; composite() is the no-op in the latter case.
      const renderPass = bloom.beginScenePass(canvas.width, canvas.height);
      globe.render(
        renderPass, viewProj, camera.eye, frame.monthA, frame.monthB, frame.t, bloom.enabled
      );
      renderPass.end();
      bloom.composite();

      // Labels project through the same matrix the globe was just drawn with.
      // They belong to the paused, readable state - keep positioning them
      // while they fade so they never fade out mid-drift.
      labels.setVisible(!playback.playing);
      hud.setPlaying(playback.playing);
      labels.update(camera, globe, frame, viewProj, canvas.clientWidth, canvas.clientHeight);
      hud.update(frame);
    }
  });

  await loop.start();
  document.body.classList.add('ready');
}

main().catch((err) => {
  console.error(err);
  const loading = document.getElementById('loading');
  if (loading) loading.textContent = `failed to start: ${err.message ?? err}`;
});
