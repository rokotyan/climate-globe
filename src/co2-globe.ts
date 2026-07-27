import {Buffer, Device, RenderPass, Texture} from '@luma.gl/core';
import {Model} from '@luma.gl/engine';
import type {CO2Dataset} from './data';
import vs from './shaders/co2.vs.glsl?raw';
import fs from './shaders/co2.fs.glsl?raw';

/**
 * The CO2 globe: the original CO2Mesh geometry (76x144 lat/lon grid over a
 * sphere, two triangles per quad, longitude wraparound, open polar holes),
 * with all months resident on the GPU in one R32F atlas texture. The vertex
 * shader lerps between two month slices and computes displacement + color,
 * so per frame only a small uniform buffer changes.
 */

const MONTHS_PER_ATLAS_ROW = 16;

export class CO2Globe {
  private model: Model;
  private uniforms: Record<string, unknown>;
  private texture: Texture;
  private positionBuffer: Buffer;
  private gridIndexBuffer: Buffer;
  private indexBuffer: Buffer;

  /**
   * Faceted-lighting mix. 0 = flat unlit vertex colors, matching the original
   * (GL_LIGHTING was never enabled); the smooth look comes from Gouraud color
   * interpolation, not shading. 'l' toggles the faceted relief view.
   */
  lightMix = 0;
  /**
   * Original CO2Mesh: radius = 200 + 5*(co2 - 375), i.e. 5 units per ppm.
   *
   * The base is larger than the original's 200 because this record is longer:
   * its mean spans ~50 ppm, so at 5 units/ppm the trend alone swings the
   * radius by +-125. On a base of 200 the globe would grow threefold and the
   * early years would shrink to a third of the frame; 360 keeps the growth
   * near the original's ~2x, which is what the framing was tuned around.
   */
  radiusBase = 360;
  perPpm = 5;
  /** ppm value at which the globe equals radiusBase (record midpoint). */
  refMid: number;
  /**
   * Soft cap (ppm) on a cell's deviation from the monthly mean, standing in
   * for the original's hard [360,400] outlier clamp so extreme surface cells
   * do not become quills.
   */
  texLimit = 7;
  /** ppm mapped to the green (low) and red (high) ends of the color ramp. */
  colorMin: number;
  colorMax: number;
  /** 0 = classic green->red ramp, 1 = extended green->violet ramp. */
  paletteMix = 1;

  constructor(device: Device, private dataset: CO2Dataset) {
    const means = dataset.months.map((m) => m.mean);
    this.refMid = (Math.min(...means) + Math.max(...means)) / 2;
    this.colorMin = dataset.colorMin;
    this.colorMax = dataset.colorMax;
    const {unitDirs, gridIndices} = buildVertices(dataset);
    const indices = buildIndices(dataset);

    this.positionBuffer = device.createBuffer({data: unitDirs, usage: Buffer.VERTEX});
    this.gridIndexBuffer = device.createBuffer({data: gridIndices, usage: Buffer.VERTEX});
    this.indexBuffer = device.createBuffer({data: indices, usage: Buffer.INDEX});
    this.texture = createAtlasTexture(device, dataset);

    // Plain WebGL uniforms (mutated in place each frame). Avoids a uniform
    // block shared across stages, which luma reconciles awkwardly.
    this.uniforms = {
      uViewProj: new Float32Array(16),
      uMonthA: 0,
      uMonthB: 0,
      uT: 0,
      uVmin: this.colorMin,
      uVmax: this.colorMax,
      uRadiusBase: this.radiusBase,
      uPerPpm: this.perPpm,
      uLightMix: this.lightMix,
      uGridRows: dataset.rows,
      uGridCols: dataset.cols,
      uMonthsPerAtlasRow: MONTHS_PER_ATLAS_ROW,
      uMonthMean: this.refMid,
      uRefMid: this.refMid,
      uTexLimit: this.texLimit,
      uPaletteMix: this.paletteMix
    };

    this.model = new Model(device, {
      id: 'co2-globe',
      vs,
      fs,
      topology: 'triangle-list',
      bufferLayout: [
        {name: 'unitDir', format: 'float32x3'},
        {name: 'gridIndex', format: 'float32x2'}
      ],
      attributes: {
        unitDir: this.positionBuffer,
        gridIndex: this.gridIndexBuffer
      },
      indexBuffer: this.indexBuffer,
      vertexCount: indices.length,
      bindings: {
        co2Texture: this.texture
      },
      uniforms: this.uniforms,
      parameters: {
        depthWriteEnabled: true,
        depthCompare: 'less-equal',
        cullMode: 'none'
      }
    });
  }

  /**
   * Largest radius any month can reach with the current settings - the trend
   * term at the record's highest monthly mean, plus a fully saturated local
   * deviation. Used to frame the camera so the globe never outgrows the view.
   */
  /**
   * World-space radius of one grid cell for the frame on screen - the same
   * arithmetic the vertex shader does, so anything anchored to the surface
   * (the city labels) sits exactly on it as the globe breathes.
   */
  radiusAtCell(row: number, col: number, monthA: number, monthB: number, t: number): number {
    const {rows, cols, values, months} = this.dataset;
    const cell = row * cols + col;
    const a = values[monthA * rows * cols + cell];
    const b = values[monthB * rows * cols + cell];
    const ppm = a + (b - a) * t;

    const monthMean = months[monthA].mean + (months[monthB].mean - months[monthA].mean) * t;
    const deviation = this.texLimit * Math.tanh((ppm - monthMean) / this.texLimit);
    return this.radiusBase + this.perPpm * (monthMean - this.refMid) + this.perPpm * deviation;
  }

  get maxRadius(): number {
    const maxMean = Math.max(...this.dataset.months.map((m) => m.mean));
    return this.radiusBase + this.perPpm * (maxMean - this.refMid) + this.perPpm * this.texLimit;
  }

  render(
    renderPass: RenderPass,
    viewProj: Float32Array,
    monthA: number,
    monthB: number,
    t: number
  ): void {
    const months = this.dataset.months;
    const meanA = months[monthA].mean;
    const meanB = months[monthB].mean;

    const u = this.uniforms;
    (u.uViewProj as Float32Array).set(viewProj);
    u.uMonthA = monthA;
    u.uMonthB = monthB;
    u.uT = t;
    u.uVmin = this.colorMin;
    u.uVmax = this.colorMax;
    u.uRadiusBase = this.radiusBase;
    u.uPerPpm = this.perPpm;
    u.uLightMix = this.lightMix;
    u.uMonthMean = meanA + (meanB - meanA) * t;
    u.uRefMid = this.refMid;
    u.uTexLimit = this.texLimit;
    u.uPaletteMix = this.paletteMix;

    this.model.draw(renderPass);
  }

  destroy(): void {
    this.model.destroy();
    this.texture.destroy();
    this.positionBuffer.destroy();
    this.gridIndexBuffer.destroy();
    this.indexBuffer.destroy();
  }
}

/** Same sphere mapping as CO2Mesh's constructor (theta from lat, phi from lon). */
function buildVertices(dataset: CO2Dataset): {unitDirs: Float32Array; gridIndices: Float32Array} {
  const {rows, cols, lat, lon} = dataset;
  const unitDirs = new Float32Array(rows * cols * 3);
  const gridIndices = new Float32Array(rows * cols * 2);
  for (let r = 0; r < rows; r++) {
    const theta = ((90 - lat[r]) * Math.PI) / 180;
    for (let c = 0; c < cols; c++) {
      const phi = ((180 - lon[c]) * Math.PI) / 180;
      const i = r * cols + c;
      unitDirs[i * 3 + 0] = Math.sin(theta) * Math.cos(phi);
      unitDirs[i * 3 + 1] = Math.cos(theta);
      unitDirs[i * 3 + 2] = Math.sin(theta) * Math.sin(phi);
      gridIndices[i * 2 + 0] = r;
      gridIndices[i * 2 + 1] = c;
    }
  }
  return {unitDirs, gridIndices};
}

/** Same topology as CO2Mesh::initMesh: quads between adjacent lat rows, wrapping in longitude. */
function buildIndices(dataset: CO2Dataset): Uint32Array {
  const {rows, cols} = dataset;
  const indices = new Uint32Array((rows - 1) * cols * 6);
  let i = 0;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols; c++) {
      const rNext = r + 1;
      const cNext = (c + 1) % cols;
      indices[i++] = r * cols + c;
      indices[i++] = r * cols + cNext;
      indices[i++] = rNext * cols + c;
      indices[i++] = rNext * cols + c;
      indices[i++] = r * cols + cNext;
      indices[i++] = rNext * cols + cNext;
    }
  }
  return indices;
}

/** Pack every month into one R32F 2D texture, MONTHS_PER_ATLAS_ROW slices per atlas row. */
function createAtlasTexture(device: Device, dataset: CO2Dataset): Texture {
  const {rows, cols, months, values} = dataset;
  const atlasCols = MONTHS_PER_ATLAS_ROW;
  const atlasRows = Math.ceil(months.length / atlasCols);
  const width = atlasCols * cols;
  const height = atlasRows * rows;

  const data = new Float32Array(width * height);
  for (let m = 0; m < months.length; m++) {
    const originX = (m % atlasCols) * cols;
    const originY = Math.floor(m / atlasCols) * rows;
    for (let r = 0; r < rows; r++) {
      const src = m * rows * cols + r * cols;
      const dst = (originY + r) * width + originX;
      data.set(values.subarray(src, src + cols), dst);
    }
  }

  return device.createTexture({
    dimension: '2d',
    format: 'r32float',
    width,
    height,
    data,
    mipLevels: 1,
    sampler: {
      minFilter: 'nearest',
      magFilter: 'nearest',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge'
    }
  });
}
