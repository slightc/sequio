/**
 * Server-side (Route B) export: drive the SDK's render core frame-by-frame in
 * Node and encode to a file — **no browser, no canvas readback trick**. Each
 * frame is rendered to a PixiJS `RenderTexture`, its GPU texture is copied into a
 * mappable buffer (`copyTextureToBuffer`), de-padded and BGRA→RGBA swapped, then
 * fed to a Mediabunny `VideoSampleSource` writing an MP4 via `FilePathTarget`.
 *
 * This mirrors {@link Exporter} (await prepare → render → add frame, contract #1)
 * but reads pixels off the GPU instead of a `<canvas>`, because in Node there is
 * no presentable canvas. Requires a WebGPU renderer (see `env.ts`).
 */
import type { Renderer } from 'pixi.js';
import { type AudioEngine, Compositor, exportFrameTimes } from '../../src/index';

export interface NodeExportOptions {
  fps: number;
  range: [number, number];
  /** Output file path (`.mp4`). */
  out: string;
  videoCodec?: string;
  bitrate?: number;
  /** Mux the {@link AudioEngine}'s offline mix as an audio track. */
  audio?: { engine: AudioEngine; codec?: string; bitrate?: number };
  onProgress?: (p: number) => void;
}

/** Minimal shape of the PixiJS WebGPU renderer internals we read frames from. */
interface GpuRendererLike {
  gpu: { device: GPUDevice };
  texture: { getGpuSource(source: unknown): GPUTexture };
}

/** Read one rendered frame off the GPU as tightly-packed RGBA bytes. */
async function readFrameRGBA(renderer: GpuRendererLike, rtSource: { pixelWidth: number; pixelHeight: number }): Promise<Uint8Array> {
  const device = renderer.gpu.device;
  const gpuTex = renderer.texture.getGpuSource(rtSource);
  const W = rtSource.pixelWidth;
  const H = rtSource.pixelHeight;
  const G = globalThis as unknown as { GPUBufferUsage: { COPY_DST: number; MAP_READ: number }; GPUMapMode: { READ: number } };
  const bytesPerRow = Math.ceil((W * 4) / 256) * 256; // WebGPU requires 256-byte row alignment
  const buffer = device.createBuffer({ size: bytesPerRow * H, usage: G.GPUBufferUsage.COPY_DST | G.GPUBufferUsage.MAP_READ });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer(
    { texture: gpuTex },
    { buffer, bytesPerRow, rowsPerImage: H },
    { width: W, height: H, depthOrArrayLayers: 1 },
  );
  device.queue.submit([encoder.finish()]);
  await buffer.mapAsync(G.GPUMapMode.READ);
  const padded = new Uint8Array(buffer.getMappedRange());
  const rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const row = y * bytesPerRow;
    for (let x = 0; x < W; x++) {
      const s = row + x * 4;
      const d = (y * W + x) * 4;
      rgba[d] = padded[s + 2]!; // B→R  (Pixi renders BGRA)
      rgba[d + 1] = padded[s + 1]!; // G
      rgba[d + 2] = padded[s]!; // R→B
      rgba[d + 3] = padded[s + 3]!; // A
    }
  }
  buffer.unmap();
  buffer.destroy();
  return rgba;
}

/**
 * Render `compositor`'s timeline over `range` at `fps` and write an MP4 to
 * `out`. The `renderer` must be the WebGPU renderer backing the compositor (the
 * one your `createRenderer` factory returned), since we read frames off its GPU.
 */
export async function renderTimelineToFile(
  compositor: Compositor,
  renderer: Renderer,
  opts: NodeExportOptions,
): Promise<{ frames: number; bytes: number }> {
  const { Output, Mp4OutputFormat, FilePathTarget, VideoSampleSource, VideoSample, AudioBufferSource } = await import('mediabunny');
  const fs = await import('node:fs');

  const times = exportFrameTimes(opts.range, opts.fps);
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new FilePathTarget(opts.out) });
  const video = new VideoSampleSource({ codec: (opts.videoCodec ?? 'avc') as 'avc', bitrate: opts.bitrate ?? 5_000_000 });
  output.addVideoTrack(video);
  const audioSource = opts.audio
    ? new AudioBufferSource({ codec: (opts.audio.codec ?? 'aac') as 'aac', bitrate: opts.audio.bitrate ?? 128_000 })
    : null;
  if (audioSource) output.addAudioTrack(audioSource);
  await output.start();

  const gpu = renderer as unknown as GpuRendererLike;
  for (let i = 0; i < times.length; i++) {
    const t = times[i]!;
    await compositor.prepare(t); // await → never drop a frame (contract #1)
    const rt = compositor.renderToTexture(t);
    try {
      const rgba = await readFrameRGBA(gpu, rt.source as unknown as { pixelWidth: number; pixelHeight: number });
      const sample = new VideoSample(rgba, {
        format: 'RGBA',
        codedWidth: (rt.source as unknown as { pixelWidth: number }).pixelWidth,
        codedHeight: (rt.source as unknown as { pixelHeight: number }).pixelHeight,
        timestamp: t,
        duration: 1 / opts.fps,
      });
      await video.add(sample);
      sample.close();
    } finally {
      rt.destroy(true);
    }
    opts.onProgress?.((i + 1) / times.length);
  }

  // Audio: one offline mix over the export range (contract #3 — same graph as preview).
  if (audioSource && opts.audio) {
    const buffer = await opts.audio.engine.renderOffline(Math.max(0, opts.range[1] - opts.range[0]));
    await audioSource.add(buffer);
  }

  await output.finalize();
  return { frames: times.length, bytes: fs.statSync(opts.out).size };
}
