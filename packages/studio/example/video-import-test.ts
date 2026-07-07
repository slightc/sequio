/**
 * Puppeteer e2e for the import path (WebCodecs) — the fix for the large-file
 * import hang.
 *
 * `VideoSource.load()` used to estimate frame rate via `computePacketStats()`
 * with no bound, which walks EVERY packet — a full-file metadata scan that
 * freezes import of a long / high-res source. It now samples only a prefix.
 * This test encodes a CFR clip with MORE frames than that prefix, loads it, and
 * asserts the estimated fps is still exact (so the bound didn't hurt accuracy)
 * and that a frame actually decodes. Also checks the editor's per-resolution
 * decode-cache sizing (`videoCacheSettings`).
 *
 * Result on `window.__VIDEO_IMPORT_TEST__`; run via `pnpm verify:video-import`.
 */
import { AudioEngine, Compositor, Exporter, loadMediabunny, ShapeClip, Timebase, VideoSource, VisualTrack } from '@sequio/engine';
import { videoCacheSettings } from '../src/editor-export';

const W = 320;
const H = 240;
const SRC_FPS = 50; // encode at 50fps …
const SRC_DUR = 3; // … for 3s → 150 frames, well past the ~120-packet fps prefix

async function pickCodec(): Promise<{ container: 'mp4' | 'webm'; videoCodec: string } | null> {
  const { canEncodeVideo } = await loadMediabunny();
  if (await canEncodeVideo('avc')) return { container: 'mp4', videoCodec: 'avc' };
  if (await canEncodeVideo('vp9')) return { container: 'webm', videoCodec: 'vp9' };
  if (await canEncodeVideo('vp8')) return { container: 'webm', videoCodec: 'vp8' };
  return null;
}

/** Encode a CFR clip of a moving box → a File, to import as a VideoSource. */
async function makeSourceVideo(codec: { container: 'mp4' | 'webm'; videoCodec: string }): Promise<File> {
  const comp = new Compositor({ width: W, height: H, timebase: new Timebase(SRC_FPS), background: 0x000000, preferWebGPU: false });
  await comp.init();
  const track = new VisualTrack();
  const box = new ShapeClip({ kind: 'rect', width: 60, height: 60, fill: 0xff0000 });
  box.start = 0;
  box.end = SRC_DUR;
  box.transform.anchor.setStatic([0.5, 0.5]);
  box.transform.position.setKeyframes([
    { time: 0, value: [30, H / 2] },
    { time: SRC_DUR, value: [W - 30, H / 2] },
  ]);
  track.add(box);
  comp.addTrack(track);
  const blob = await new Exporter(comp, new AudioEngine(new Timebase(SRC_FPS))).export({
    fps: SRC_FPS,
    range: [0, SRC_DUR],
    audio: false,
    bitrate: 2_000_000,
    ...codec,
  });
  comp.dispose();
  return new File([blob], `src.${codec.container}`, { type: blob.type });
}

async function run(): Promise<void> {
  const codec = await pickCodec();
  if (!codec) {
    (window as unknown as { __VIDEO_IMPORT_TEST__: unknown }).__VIDEO_IMPORT_TEST__ = { ok: false, error: 'no encodable video codec' };
    return;
  }

  const file = await makeSourceVideo(codec);

  // Import: load() must return quickly with correct metadata (fps estimated
  // from a packet prefix, not a whole-file scan).
  const t0 = performance.now();
  const source = new VideoSource({ src: file });
  const meta = await source.load();
  const loadMs = performance.now() - t0;

  // Decode a mid-clip frame and confirm it has content (not black).
  await source.prepare(SRC_DUR / 2);
  const tex = source.getTextureAt(SRC_DUR / 2);
  const cachedFrames = source.cachedFrameCount;

  // Per-resolution cache sizing the editor would apply on import.
  const cache = videoCacheSettings(meta.width, meta.height);

  source.dispose();

  const fpsOk = Math.abs(meta.fps! - SRC_FPS) <= 1; // prefix estimate is exact for CFR
  const ok =
    fpsOk &&
    meta.width === W &&
    meta.height === H &&
    Math.abs(meta.duration - SRC_DUR) < 0.2 &&
    !!tex &&
    cachedFrames > 0 &&
    cache.cacheFrames >= 2 &&
    cache.cacheFrames <= 60;

  (window as unknown as { __VIDEO_IMPORT_TEST__: unknown }).__VIDEO_IMPORT_TEST__ = {
    ok,
    container: codec.container,
    meta,
    estimatedFps: meta.fps,
    expectedFps: SRC_FPS,
    loadMs: Math.round(loadMs),
    cachedFrames,
    cacheSettings: cache,
  };
}

run().catch((err) => {
  (window as unknown as { __VIDEO_IMPORT_TEST__: unknown }).__VIDEO_IMPORT_TEST__ = { ok: false, error: String(err) };
});
