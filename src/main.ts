import {luma} from '@luma.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {AnimationLoop} from '@luma.gl/engine';
import {loadDatasetWithFallback} from './data';
import {Camera} from './camera';
import {Playback} from './playback';
import {CO2Globe} from './co2-globe';
import {Hud} from './hud';
import {Controls} from './controls';
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
  const hud = new Hud(dataset);
  const controls = new Controls(globe, playback, hud, dataset, camera);
  camera.frameRadius(globe.maxRadius);

  bindInput({canvas, camera, playback, globe, controls});

  let lastTime: number | null = null;

  const loop = new AnimationLoop({
    device,
    autoResizeViewport: true,
    onRender: ({device, aspect, time}) => {
      const dt = lastTime === null ? 1 / 60 : Math.min((time - lastTime) / 1000, 0.1);
      lastTime = time;

      playback.update(dt);
      camera.setOrbit(playback.playedMonths);
      camera.update(dt);
      const frame = playback.frame();

      const renderPass = device.beginRenderPass({clearColor: [0, 0, 0, 1], clearDepth: 1});
      globe.render(renderPass, camera.getViewProjection(aspect), frame.monthA, frame.monthB, frame.t);
      renderPass.end();

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
