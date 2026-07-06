/**
 * Server-side (Route B) export: drive the SDK's render core frame-by-frame in
 * Node and encode to a file — **no browser, no canvas readback trick**. Each
 * frame is rendered to a PixiJS `RenderTexture`, its GPU texture is copied into a
 * mappable buffer (`copyTextureToBuffer`), de-padded and BGRA→RGBA swapped, then
 * fed to a Mediabunny `VideoSampleSource`.
 *
 * This mirrors {@link Exporter} (await prepare → render → add frame, contract #1)
 * but reads pixels off the GPU instead of a `<canvas>`, because in Node there is
 * no presentable canvas. Requires a WebGPU renderer (see `env.ts`).
 *
 * **Codec fallback.** Route B encodes through `@mediabunny/server` (node-av /
 * FFmpeg). If the requested codec isn't in that build (H.264/avc is often absent
 * — GPL x264), Mediabunny silently falls back to the browser WebCodecs encoder,
 * which needs a `VideoFrame` that doesn't exist in Node → `VideoFrame is not
 * defined`. `canEncodeVideo` can't be trusted (the server's `supports()`
 * over-reports), so we can't reliably pre-check. Instead we **try the real
 * encode and fall back to the next codec on failure** — the failure surfaces on
 * the very first frame, so a rejected codec costs one wasted frame, then we retry
 * with VP9/WebM (which node-av reliably has).
 */
import type { Renderer } from 'pixi.js';
import { type AudioEngine, Compositor, exportFrameTimes } from '@video-editor-canvas/engine';
import { getMediabunny } from './env';

export interface NodeExportOptions {
  fps: number;
  range: [number, number];
  /** Output file path. The extension is corrected to match the encoded container. */
  out: string;
  /** Preferred container; falls back to what node-av can encode. */
  container?: 'mp4' | 'webm';
  videoCodec?: string;
  bitrate?: number;
  /** Mux the {@link AudioEngine}'s offline mix as an audio track. */
  audio?: { engine: AudioEngine; codec?: string; bitrate?: number };
  onProgress?: (p: number) => void;
}

const isWebmCodec = (c?: string) => c === 'vp8' || c === 'vp9' || c === 'av1';

/** Ordered, de-duplicated container+codec candidates to try, preferring the request. */
function videoCandidates(want: { container?: 'mp4' | 'webm'; codec?: string }): Array<{ container: 'mp4' | 'webm'; codec: string }> {
  const list: Array<{ container: 'mp4' | 'webm'; codec: string }> = [];
  if (want.codec) list.push({ container: want.container ?? (isWebmCodec(want.codec) ? 'webm' : 'mp4'), codec: want.codec });
  else if (want.container === 'webm') list.push({ container: 'webm', codec: 'vp9' });
  // node-av reliably has libvpx (vp8/vp9, BSD); avc/av1 depend on the build.
  list.push(
    { container: 'mp4', codec: 'avc' },
    { container: 'webm', codec: 'vp9' },
    { container: 'webm', codec: 'vp8' },
    { container: 'mp4', codec: 'av1' },
  );
  const seen = new Set<string>();
  return list.filter((c) => (seen.has(c.codec) ? false : (seen.add(c.codec), true)));
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

/** True for errors we recover from by trying another codec: a missing server
 *  encoder (WebCodecs fallback in Node) or an unknown/unsupported codec name. */
function isEncoderUnavailable(err: unknown): boolean {
  return /VideoFrame is not defined|not supported by this browser|VideoEncoder is not|Invalid (video|audio) codec|Unknown codec/.test(String(err));
}

/**
 * Render `compositor`'s timeline over `range` at `fps` and write a video file to
 * `out` (extension corrected to the container actually encoded). The `renderer`
 * must be the WebGPU renderer backing the compositor, since we read frames off
 * its GPU. Tries the preferred codec first, falling back through VP9/VP8/WebM if
 * node-av can't encode it.
 */
export async function renderTimelineToFile(
  compositor: Compositor,
  renderer: Renderer,
  opts: NodeExportOptions,
): Promise<{ frames: number; bytes: number; out: string; container: string; videoCodec: string; audio: boolean }> {
  const { Output, Mp4OutputFormat, WebMOutputFormat, FilePathTarget, VideoSampleSource, VideoSample, AudioBufferSource } = getMediabunny();
  const fs = await import('node:fs');
  const path = await import('node:path');

  const times = exportFrameTimes(opts.range, opts.fps);
  const gpu = renderer as unknown as GpuRendererLike;
  const candidates = videoCandidates({ container: opts.container, codec: opts.videoCodec });
  let lastErr: unknown = null;

  for (const cand of candidates) {
    const out = path.format({ ...path.parse(opts.out), base: undefined, ext: `.${cand.container}` });
    const format = cand.container === 'webm' ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: 'in-memory' });
    const output = new Output({ format, target: new FilePathTarget(out) });
    let audioSource: InstanceType<typeof AudioBufferSource> | null = null;

    try {
      // Construction can throw on an unknown codec — inside the try so it falls back.
      const video = new VideoSampleSource({ codec: cand.codec as 'avc', bitrate: opts.bitrate ?? 5_000_000 });
      output.addVideoTrack(video);
      // Audio codec must fit the container (aac→mp4, opus→webm).
      if (opts.audio) {
        const aCodec = cand.container === 'webm' ? 'opus' : (opts.audio.codec ?? 'aac');
        audioSource = new AudioBufferSource({ codec: aCodec as 'aac', bitrate: opts.audio.bitrate ?? 128_000 });
        output.addAudioTrack(audioSource);
      }
      await output.start();
      for (let i = 0; i < times.length; i++) {
        const t = times[i]!;
        await compositor.prepare(t); // await → never drop a frame (contract #1)
        const rt = compositor.renderToTexture(t);
        try {
          const src = rt.source as unknown as { pixelWidth: number; pixelHeight: number };
          const rgba = await readFrameRGBA(gpu, src);
          const sample = new VideoSample(rgba, { format: 'RGBA', codedWidth: src.pixelWidth, codedHeight: src.pixelHeight, timestamp: t, duration: 1 / opts.fps });
          await video.add(sample); // first frame here is where an unusable codec fails
          sample.close();
        } finally {
          rt.destroy(true);
        }
        opts.onProgress?.((i + 1) / times.length);
      }
      if (audioSource && opts.audio) {
        const buffer = await opts.audio.engine.renderOffline(Math.max(0, opts.range[1] - opts.range[0]));
        await audioSource.add(buffer);
      }
      await output.finalize();
      return { frames: times.length, bytes: fs.statSync(out).size, out, container: cand.container, videoCodec: cand.codec, audio: !!audioSource };
    } catch (err) {
      lastErr = err;
      await output.cancel().catch(() => {});
      try {
        fs.unlinkSync(out);
      } catch {
        /* nothing written yet */
      }
      if (isEncoderUnavailable(err)) {
        console.warn(`⚠ node-av can't encode ${cand.container}/${cand.codec} here — trying the next codec…`);
        continue; // fall back to the next codec
      }
      throw err; // a real error (not a missing encoder) — don't mask it
    }
  }

  throw new Error(
    'No server-side video encoder available (tried ' + candidates.map((c) => c.codec).join(', ') + '). ' +
      'Route B encodes through @mediabunny/server (node-av / FFmpeg); ensure its native binary is built (`pnpm rebuild node-av`). ' +
      'Last error: ' + String(lastErr),
  );
}
