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
  /** Output file path. The extension is corrected to match the encoded container. */
  out: string;
  /** Preferred container; negotiation may switch it to what node-av can encode. */
  container?: 'mp4' | 'webm';
  videoCodec?: string;
  bitrate?: number;
  /** Mux the {@link AudioEngine}'s offline mix as an audio track. */
  audio?: { engine: AudioEngine; codec?: string; bitrate?: number };
  onProgress?: (p: number) => void;
}

const isWebmCodec = (c?: string) => c === 'vp8' || c === 'vp9' || c === 'av1';

/**
 * Actually encode one frame with a codec to see if node-av can — the reliable
 * test. `canEncodeVideo` is NOT reliable here: `@mediabunny/server`'s
 * `supports()` returns `true` for avc/hevc/… unconditionally, without checking
 * that the FFmpeg build has that encoder. So on a host whose node-av lacks
 * H.264 (GPL x264 is often omitted), `canEncodeVideo('avc')` says yes but the
 * real encode falls back to the browser WebCodecs path and throws
 * `VideoFrame is not defined`. A throwaway one-frame encode catches that.
 */
async function canReallyEncode(codec: string, width: number, height: number): Promise<boolean> {
  const { Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, VideoSampleSource, VideoSample } = await import('mediabunny');
  let output: InstanceType<typeof Output> | null = null;
  try {
    const format = isWebmCodec(codec) ? new WebMOutputFormat() : new Mp4OutputFormat();
    output = new Output({ format, target: new BufferTarget() });
    const src = new VideoSampleSource({ codec: codec as 'avc', bitrate: 1_000_000 });
    output.addVideoTrack(src);
    await output.start();
    const sample = new VideoSample(new Uint8Array(width * height * 4), { format: 'RGBA', codedWidth: width, codedHeight: height, timestamp: 0, duration: 1 / 30 });
    await src.add(sample);
    sample.close();
    await output.finalize();
    return true;
  } catch {
    await output?.cancel().catch(() => {});
    return false;
  }
}

/** Actually encode one silent audio buffer to see if node-av can — same
 *  reliability caveat as {@link canReallyEncode}. Needs the Web Audio globals
 *  (see env.ts). */
async function canReallyEncodeAudio(codec: string, container: 'mp4' | 'webm'): Promise<boolean> {
  const { Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, AudioBufferSource } = await import('mediabunny');
  const AudioBufferCtor = (globalThis as unknown as { AudioBuffer?: new (o: { length: number; numberOfChannels: number; sampleRate: number }) => AudioBuffer }).AudioBuffer;
  if (!AudioBufferCtor) return false;
  let output: InstanceType<typeof Output> | null = null;
  try {
    const format = container === 'webm' ? new WebMOutputFormat() : new Mp4OutputFormat();
    output = new Output({ format, target: new BufferTarget() });
    const src = new AudioBufferSource({ codec: codec as 'aac', bitrate: 128_000 });
    output.addAudioTrack(src);
    await output.start();
    await src.add(new AudioBufferCtor({ length: 2048, numberOfChannels: 2, sampleRate: 48000 }));
    await output.finalize();
    return true;
  } catch {
    await output?.cancel().catch(() => {});
    return false;
  }
}

/** Pick a container + video codec node-av can actually encode, preferring the
 *  request, by probe-encoding a frame at the real dimensions (even-aligned, as
 *  H.264/VP9 require). Returns null if none work. */
async function negotiateVideoCodec(
  want: { container?: 'mp4' | 'webm'; codec?: string },
  width: number,
  height: number,
): Promise<{ container: 'mp4' | 'webm'; codec: string } | null> {
  const w = width + (width % 2);
  const h = height + (height % 2);
  const candidates: Array<{ container: 'mp4' | 'webm'; codec: string }> = [];
  if (want.codec) candidates.push({ container: want.container ?? (isWebmCodec(want.codec) ? 'webm' : 'mp4'), codec: want.codec });
  else if (want.container === 'webm') candidates.push({ container: 'webm', codec: 'vp9' });
  candidates.push(
    { container: 'mp4', codec: 'avc' },
    { container: 'webm', codec: 'vp9' },
    { container: 'webm', codec: 'vp8' },
    { container: 'mp4', codec: 'av1' },
  );
  const tried = new Set<string>();
  for (const c of candidates) {
    if (tried.has(c.codec)) continue;
    tried.add(c.codec);
    if (await canReallyEncode(c.codec, w, h)) return c;
  }
  return null;
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
): Promise<{ frames: number; bytes: number; out: string; container: string; videoCodec: string; audio: boolean }> {
  const mb = await import('mediabunny');
  const { Output, Mp4OutputFormat, WebMOutputFormat, FilePathTarget, VideoSampleSource, VideoSample, AudioBufferSource } = mb;
  const fs = await import('node:fs');
  const path = await import('node:path');

  const width = compositor.options.width;
  const height = compositor.options.height;
  const codec = await negotiateVideoCodec({ container: opts.container, codec: opts.videoCodec }, width, height);
  if (!codec) {
    throw new Error(
      'No server-side video encoder available. Route B encodes through @mediabunny/server (node-av / FFmpeg). ' +
        'Make sure its native binary is built: `pnpm rebuild node-av`. ' +
        '(H.264/avc is often missing from node-av builds — VP9/WebM usually works.)',
    );
  }
  // Correct the output extension to the container actually being written.
  const out = path.format({ ...path.parse(opts.out), base: undefined, ext: `.${codec.container}` });

  const times = exportFrameTimes(opts.range, opts.fps);
  const format = codec.container === 'webm' ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: 'in-memory' });
  const output = new Output({ format, target: new FilePathTarget(out) });
  const video = new VideoSampleSource({ codec: codec.codec as 'avc', bitrate: opts.bitrate ?? 5_000_000 });
  output.addVideoTrack(video);

  // Audio codec must fit the container (aac→mp4, opus→webm) and be encodable.
  let audioSource: InstanceType<typeof AudioBufferSource> | null = null;
  if (opts.audio) {
    const aCodec = codec.container === 'webm' ? 'opus' : (opts.audio.codec ?? 'aac');
    if (await canReallyEncodeAudio(aCodec, codec.container)) {
      audioSource = new AudioBufferSource({ codec: aCodec as 'aac', bitrate: opts.audio.bitrate ?? 128_000 });
      output.addAudioTrack(audioSource);
    } else {
      console.warn(`⚠ skipping audio: node-av can't encode ${aCodec} (run pnpm rebuild node-av).`);
    }
  }
  try {
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
  } catch (err) {
    await output.cancel().catch(() => {});
    // Mediabunny falls back to the browser WebCodecs encoder (which needs a
    // `VideoFrame` that doesn't exist in Node) when no server encoder handled the
    // codec. Turn that cryptic ReferenceError into an actionable message.
    if (/VideoFrame is not defined/.test(String(err))) {
      throw new Error(
        `Encoding fell back to WebCodecs (${codec.container}/${codec.codec}) — node-av has no server encoder for it in this build. ` +
          'Run `pnpm rebuild node-av`, or pick a codec it supports (VP9/WebM). Original: ' + String(err),
      );
    }
    throw err;
  }
  return { frames: times.length, bytes: fs.statSync(out).size, out, container: codec.container, videoCodec: codec.codec, audio: !!audioSource };
}
