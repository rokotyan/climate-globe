import {Buffer, Texture, type Device, type Framebuffer, type RenderPass} from '@luma.gl/core';
import {Model} from '@luma.gl/engine';
import postVs from './shaders/post.vs.glsl?raw';
import brightFs from './shaders/bright.fs.glsl?raw';
import blurFs from './shaders/blur.fs.glsl?raw';
import compositeFs from './shaders/composite.fs.glsl?raw';

/**
 * Bloom.
 *
 * The globe renders into an offscreen target instead of straight to the canvas;
 * the bright parts are extracted, blurred, and added back. On black, that is
 * what turns a lit sphere into something that looks photographed.
 *
 * Worth knowing what actually blooms here: the fur is *geometric*, not
 * luminous - a spike carries the same ramp colour as the trough beside it - so
 * no luminance threshold can single the spikes out. What glows is the Fresnel
 * rim, which is additive and deliberately pushed past 1.0 - so the glow is a
 * halo around the planet rather than anything picked out on its surface.
 *
 * Float targets matter for the same reason: the rim's overshoot only survives
 * to the bright pass if the buffer can hold values above 1. Where rgba16float
 * cannot be rendered, it falls back to rgba8unorm and drops the threshold,
 * which glows the whole surface rather than just the limb - softer, less
 * selective, still better than nothing.
 */

/** Bloom is blurred anyway, so half resolution costs nothing visible. */
const DOWNSCALE = 2;
/** Blur widths in texels, one ping-pong pair each - a cheap two-octave kernel. */
const SPREADS = [1.0, 2.4];

export class Bloom {
  enabled = true;
  /**
   * Halo strength. Shares the rim's Fresnel shape - rimStrength sets how much
   * glow lands on the surface, this how far it spills past the limb - so the
   * two are adjustable independently while staying the same light.
   */
  intensity = 0.05;

  private device: Device;
  private format: 'rgba16float' | 'rgba8unorm';
  private quad: Buffer;
  private brightModel: Model;
  private blurModel: Model;
  private compositeModel: Model;
  /**
   * Mutated in place rather than pushed through a setter: Model has no
   * setUniforms in v9, it reads whatever the object it was handed now holds.
   */
  private brightUniforms: Record<string, unknown>;
  private blurUniforms: Record<string, unknown>;
  private compositeUniforms: Record<string, unknown>;

  private scene: Framebuffer | null = null;
  private pingA: Framebuffer | null = null;
  private pingB: Framebuffer | null = null;
  private width = 0;
  private height = 0;
  /** Half-res target size, kept here rather than read back off the framebuffer. */
  private blurWidth = 1;
  private blurHeight = 1;

  constructor(device: Device) {
    this.device = device;
    // Half-float render targets are an extension in WebGL2 (EXT_color_buffer_
    // half_float); without them the rim's overshoot would clamp before the
    // bright pass ever saw it.
    // Float targets give the rim headroom above 1.0 rather than clipping before
    // the bright pass sees it. rgba8unorm still works, just with a flatter halo.
    this.format = device.isTextureFormatRenderable('rgba16float') ? 'rgba16float' : 'rgba8unorm';

    // Two triangles covering clip space. An attribute-free gl_VertexID quad
    // would also work, but luma wants a buffer layout to derive the pipeline.
    this.quad = device.createBuffer({
      data: new Float32Array([-1, -1, 3, -1, -1, 3]),
      usage: Buffer.VERTEX
    });

    const common = {
      vs: postVs,
      topology: 'triangle-list' as const,
      bufferLayout: [{name: 'position', format: 'float32x2' as const}],
      attributes: {position: this.quad},
      vertexCount: 3,
      parameters: {depthWriteEnabled: false, depthCompare: 'always' as const, cullMode: 'none' as const}
    };

    this.brightUniforms = {};
    this.blurUniforms = {uStep: new Float32Array(2)};
    this.compositeUniforms = {uIntensity: this.intensity};

    this.brightModel = new Model(device, {
      ...common, id: 'bloom-bright', fs: brightFs, uniforms: this.brightUniforms
    });
    this.blurModel = new Model(device, {
      ...common, id: 'bloom-blur', fs: blurFs, uniforms: this.blurUniforms
    });
    this.compositeModel = new Model(device, {
      ...common, id: 'bloom-composite', fs: compositeFs, uniforms: this.compositeUniforms
    });
  }

  /**
   * Where the globe should draw this frame: the offscreen target when bloom is
   * on, the canvas when it is off. Caller ends the pass, then calls composite().
   */
  beginScenePass(width: number, height: number): RenderPass {
    const opts = {clearColor: [0, 0, 0, 1] as [number, number, number, number], clearDepth: 1};
    if (!this.enabled) {
      this.release();
      return this.device.beginRenderPass(opts);
    }
    this.ensureTargets(width, height);
    return this.device.beginRenderPass({...opts, framebuffer: this.scene!});
  }

  /** Bright pass, two blur octaves, then add back over the canvas. */
  composite(): void {
    if (!this.enabled || !this.scene || !this.pingA || !this.pingB) return;

    const sceneColor = this.scene.colorAttachments[0];
    const w = this.blurWidth;
    const h = this.blurHeight;

    // scene -> pingA (thresholded, at half resolution)
    this.brightModel.setBindings({uScene: sceneColor});
    this.drawInto(this.pingA, this.brightModel);

    // Ping-pong H then V per octave, so each pass stays a 1D kernel.
    let source = this.pingA;
    let target = this.pingB;
    for (const spread of SPREADS) {
      for (const axis of [
        [spread / w, 0],
        [0, spread / h]
      ]) {
        this.blurModel.setBindings({uSource: source.colorAttachments[0]});
        (this.blurUniforms.uStep as Float32Array).set(axis);
        this.drawInto(target, this.blurModel);
        [source, target] = [target, source];
      }
    }

    // Whichever buffer the last pass wrote is `source` after the final swap.
    this.compositeModel.setBindings({uScene: sceneColor, uBloom: source.colorAttachments[0]});
    this.compositeUniforms.uIntensity = this.intensity;
    const pass = this.device.beginRenderPass({clearColor: [0, 0, 0, 1], clearDepth: 1});
    this.compositeModel.draw(pass);
    pass.end();
  }

  private drawInto(target: Framebuffer, model: Model): void {
    const pass = this.device.beginRenderPass({framebuffer: target, clearColor: [0, 0, 0, 1]});
    model.draw(pass);
    pass.end();
  }

  private ensureTargets(width: number, height: number): void {
    if (this.scene && this.width === width && this.height === height) return;
    this.release();
    this.width = width;
    this.height = height;

    this.blurWidth = Math.max(1, Math.floor(width / DOWNSCALE));
    this.blurHeight = Math.max(1, Math.floor(height / DOWNSCALE));

    // width/height are load-bearing, not decoration: luma does not infer a
    // framebuffer's size from the attachment textures handed to it, so without
    // them it keeps its 1x1 default. The depth attachment below is then
    // auto-created at 1x1 against a full-size colour texture, the framebuffer
    // comes back INCOMPLETE_DIMENSIONS, and the scene pass silently draws
    // nothing at all.
    this.scene = this.device.createFramebuffer({
      width,
      height,
      colorAttachments: [this.target(width, height)],
      depthStencilAttachment: 'depth16unorm'
    });
    this.pingA = this.device.createFramebuffer({
      width: this.blurWidth,
      height: this.blurHeight,
      colorAttachments: [this.target(this.blurWidth, this.blurHeight)]
    });
    this.pingB = this.device.createFramebuffer({
      width: this.blurWidth,
      height: this.blurHeight,
      colorAttachments: [this.target(this.blurWidth, this.blurHeight)]
    });
  }

  /** Linear sampling is what lets the blur's bilinear taps span two texels. */
  private target(width: number, height: number): Texture {
    return this.device.createTexture({
      format: this.format,
      width,
      height,
      usage: Texture.RENDER | Texture.SAMPLE,
      mipLevels: 1,
      sampler: {
        minFilter: 'linear',
        magFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge'
      }
    });
  }

  private release(): void {
    for (const fb of [this.scene, this.pingA, this.pingB]) {
      fb?.colorAttachments.forEach((view) => view.texture?.destroy());
      fb?.destroy();
    }
    this.scene = this.pingA = this.pingB = null;
    this.width = this.height = 0;
  }

  destroy(): void {
    this.release();
    this.brightModel.destroy();
    this.blurModel.destroy();
    this.compositeModel.destroy();
    this.quad.destroy();
  }

  /** Reported in the parameter panel so the fallback is not silent. */
  get hdr(): boolean {
    return this.format === 'rgba16float';
  }
}
