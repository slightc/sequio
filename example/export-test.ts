/**
 * Puppeteer e2e for milestone 08 — the Exporter renders a timeline to a real
 * container file and it decodes back correctly.
 *
 * Renders a red full-frame clip, exports [0,0.5)s at 15fps to MP4/WebM (whichever
 * codec the browser can encode), then re-opens the blob with Mediabunny and
 * asserts the frame count, dimensions and that a decoded frame is actually red
 * (catches a blank-canvas capture). Result on `window.__EXPORT_TEST__`.
 */
import { Texture } from 'pixi.js';
import {
  AudioClip,
  AudioEngine,
  type AudioSource,
  Compositor,
  Exporter,
  ShapeClip,
  Timebase,
  VideoClip,
  VideoSource,
  type VisualSource,
  VisualTrack,
} from '../src/index';
import { applyCover } from './cover';

const W = 160;
const H = 120;
const FPS = 15;
const DUR = 0.5;

/** Pick a container + codec the browser can actually encode. */
async function pickCodec(): Promise<{ container: 'mp4' | 'webm'; videoCodec: string } | null> {
  const { canEncodeVideo } = await import('mediabunny');
  if (await canEncodeVideo('avc')) return { container: 'mp4', videoCodec: 'avc' };
  if (await canEncodeVideo('vp9')) return { container: 'webm', videoCodec: 'vp9' };
  if (await canEncodeVideo('vp8')) return { container: 'webm', videoCodec: 'vp8' };
  return null;
}

function makeCompositor(): Compositor {
  return new Compositor({ width: W, height: H, timebase: new Timebase(FPS), background: 0x000000, preferWebGPU: false });
}

function fullFrameRect(track: VisualTrack, fill: number): void {
  const rect = new ShapeClip({ kind: 'rect', width: W, height: H, fill });
  rect.start = 0;
  rect.end = DUR;
  rect.transform.anchor.setStatic([0.5, 0.5]);
  rect.transform.position.setStatic([W / 2, H / 2]);
  track.add(rect);
}

/** Video-only export → decode back: frame count, dims, and a red pixel. */
async function runVideoExport(): Promise<Record<string, unknown>> {
  const compositor = makeCompositor();
  await compositor.init();
  document.getElementById('stage')!.append(compositor.view);
  const track = new VisualTrack();
  fullFrameRect(track, 0xff0000);
  compositor.addTrack(track);

  const codec = await pickCodec();
  if (!codec) return { okVideo: false, error: 'no encodable video codec' };

  const exporter = new Exporter(compositor, new AudioEngine(new Timebase(FPS)));
  const progress: number[] = [];
  const blob = await exporter.export(
    { fps: FPS, range: [0, DUR], audio: false, bitrate: 1_000_000, ...codec },
    (p) => progress.push(p),
  );

  const { Input, ALL_FORMATS, BlobSource, VideoSampleSink } = await import('mediabunny');
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const vtrack = await input.getPrimaryVideoTrack();

  let count = 0;
  let center: { r: number; g: number; b: number } | null = null;
  if (vtrack) {
    const sink = new VideoSampleSink(vtrack);
    for await (const sample of sink.samples(0, DUR)) {
      if (count === 0) {
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        const ctx = c.getContext('2d')!;
        sample.draw(ctx, 0, 0, W, H);
        const d = ctx.getImageData(W / 2, H / 2, 1, 1).data;
        center = { r: d[0]!, g: d[1]!, b: d[2]! };
      }
      count++;
      sample.close();
    }
  }

  const okVideo =
    blob.size > 500 &&
    count >= 6 &&
    count <= 9 && // round(0.5*15) = 8
    !!center &&
    center.r > 150 &&
    center.g < 90 &&
    center.b < 90 &&
    progress.length > 0 &&
    Math.abs(progress.at(-1)! - 1) < 1e-6;

  compositor.dispose();
  return { okVideo, container: codec.container, videoCodec: codec.videoCodec, size: blob.size, frames: count, center };
}

/** A/V export (audio scheduled via AudioEngine) → decode back: both tracks present. */
async function runAudioExport(): Promise<Record<string, unknown>> {
  const { canEncodeVideo, canEncodeAudio } = await import('mediabunny');
  const combos = [
    { container: 'webm' as const, videoCodec: 'vp8', audioCodec: 'opus' },
    { container: 'webm' as const, videoCodec: 'vp9', audioCodec: 'opus' },
    { container: 'mp4' as const, videoCodec: 'avc', audioCodec: 'aac' },
  ];
  let combo: (typeof combos)[number] | null = null;
  for (const c of combos) {
    if ((await canEncodeVideo(c.videoCodec as 'vp8')) && (await canEncodeAudio(c.audioCodec as 'opus'))) {
      combo = c;
      break;
    }
  }
  if (!combo) return { okAudio: true, skipped: 'no encodable a/v combo' };

  const compositor = makeCompositor();
  await compositor.init();
  const track = new VisualTrack();
  fullFrameRect(track, 0x00ff00);
  compositor.addTrack(track);

  // Schedule a sine tone into the AudioEngine so the export has audio to mux.
  const sr = 48000;
  const buffer = new AudioBuffer({ length: Math.floor(DUR * sr), numberOfChannels: 1, sampleRate: sr });
  const ch = buffer.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = Math.sin((2 * Math.PI * 440 * i) / sr) * 0.3;
  const source = { getBuffer: () => buffer, dispose() {} } as unknown as AudioSource;
  const clip = new AudioClip();
  clip.start = 0;
  clip.end = DUR;
  const audio = new AudioEngine(new Timebase(FPS));
  audio.schedule(clip, source);

  const exporter = new Exporter(compositor, audio);
  const blob = await exporter.export({
    fps: FPS,
    range: [0, DUR],
    audio: true,
    bitrate: 1_000_000,
    audioBitrate: 96_000,
    ...combo,
  });

  const { Input, ALL_FORMATS, BlobSource } = await import('mediabunny');
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const vtrack = await input.getPrimaryVideoTrack();
  const atrack = await input.getPrimaryAudioTrack();

  const okAudio = blob.size > 500 && !!vtrack && !!atrack;
  compositor.dispose();
  return { okAudio, container: combo.container, audioCodec: combo.audioCodec, hasVideo: !!vtrack, hasAudio: !!atrack, size: blob.size };
}

/** Export a clip to a video, re-load it as a VideoSource, and export THAT
 *  (i.e. "load video → export"). Reproduces the destroyed-texture crash. */
async function runVideoRoundTrip(): Promise<Record<string, unknown>> {
  const codec = await pickCodec();
  if (!codec) return { okRoundTrip: true, skipped: 'no encodable video codec' };

  // 1. Make a source video with motion so frames differ.
  const c1 = makeCompositor();
  await c1.init();
  const t1 = new VisualTrack();
  const box = new ShapeClip({ kind: 'rect', width: 60, height: 60, fill: 0xff0000 });
  box.start = 0;
  box.end = 1;
  box.transform.anchor.setStatic([0.5, 0.5]);
  box.transform.position.setKeyframes([
    { time: 0, value: [30, H / 2] },
    { time: 1, value: [W - 30, H / 2] },
  ]);
  t1.add(box);
  c1.addTrack(t1);
  const blob = await new Exporter(c1, new AudioEngine(new Timebase(FPS))).export({
    fps: FPS,
    range: [0, 1],
    audio: false,
    bitrate: 1_000_000,
    ...codec,
  });
  c1.dispose();

  // 2. Load it back as a VideoSource on a "preview" compositor (c2), render a
  //    frame there, then FORK an offscreen export compositor (c3) that SHARES
  //    c2's texture pool + the source (no re-decode) and export from it — leaving
  //    c2 untouched (the fork pattern the demo uses).
  const file = new File([blob], `src.${codec.container}`, { type: blob.type });
  const source = new VideoSource({ src: file });
  const meta = await source.load();
  const c2 = makeCompositor();
  await c2.init();
  const track = new VisualTrack();
  const clip = new VideoClip(source);
  clip.start = 0;
  clip.end = meta.duration;
  applyCover(clip, meta.width, meta.height, W, H);
  track.add(clip);
  c2.addTrack(track);
  await c2.prepare(0);
  c2.renderSync(0); // c2 (preview) uploads a texture from the shared pool

  const c3 = new Compositor({
    width: W,
    height: H,
    timebase: new Timebase(FPS),
    background: 0x000000,
    preferWebGPU: false,
    textures: c2.textures, // share the pool → no second decode/upload
  });
  await c3.init();
  c2.removeTrack(track); // move the scene to the fork for export
  c3.addTrack(track);

  let error: string | null = null;
  let size = 0;
  let litFrames = 0;
  let frames = 0;
  try {
    const out = await new Exporter(c3, new AudioEngine(new Timebase(FPS))).export({
      fps: FPS,
      range: [0, Math.min(meta.duration, 1)],
      audio: false,
      bitrate: 1_000_000,
      ...codec,
    });
    size = out.size;

    // Decode the re-exported video and count NON-black frames — frame-sync bugs
    // (prepare not awaiting an in-flight decode) show up as dropped/black frames.
    const { Input, ALL_FORMATS, BlobSource, VideoSampleSink } = await import('mediabunny');
    const input = new Input({ source: new BlobSource(out), formats: ALL_FORMATS });
    const vtrack = await input.getPrimaryVideoTrack();
    if (vtrack) {
      const sink = new VideoSampleSink(vtrack);
      const cv = document.createElement('canvas');
      cv.width = W;
      cv.height = H;
      const cx = cv.getContext('2d')!;
      for await (const sample of sink.samples(0, Math.min(meta.duration, 1))) {
        frames++;
        sample.draw(cx, 0, 0, W, H);
        const d = cx.getImageData(0, 0, W, H).data;
        let lit = false;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i]! > 40 || d[i + 1]! > 40 || d[i + 2]! > 40) {
            lit = true;
            break;
          }
        }
        if (lit) litFrames++;
        sample.close();
      }
    }
  } catch (e) {
    error = String(e);
  }

  // Move the scene back and confirm the "preview" compositor still *animates* the
  // shared video (fork didn't break it). Rendering two different times must give
  // different frames — a broken move-back would freeze on a stale/dead sprite.
  c3.removeTrack(track);
  c2.addTrack(track);
  const readAt = async (t: number) => {
    await c2.prepare(t);
    c2.renderSync(t);
    const oc = document.createElement('canvas');
    oc.width = W;
    oc.height = H;
    const octx = oc.getContext('2d')!;
    octx.drawImage(c2.view, 0, 0);
    return octx.getImageData(0, 0, W, H).data;
  };
  const f0 = await readAt(0);
  const f1 = await readAt(Math.min(meta.duration, 1) * 0.9);
  let previewLit = false;
  let previewDiff = 0;
  for (let i = 0; i < f0.length; i += 4) {
    if (f0[i]! > 40 || f0[i + 1]! > 40 || f0[i + 2]! > 40) previewLit = true;
    if (Math.abs(f0[i]! - f1[i]!) > 40) previewDiff++;
  }
  const previewOk = previewLit && previewDiff > 20; // shows content AND advances

  c3.dispose();
  c2.dispose();
  source.dispose();
  // Most frames must have visible content (the moving red box), not be black.
  const okRoundTrip = !error && size > 500 && frames > 0 && litFrames >= frames - 1 && previewOk;
  return { okRoundTrip, error, size, frames, litFrames, previewLit, previewDiff, duration: meta.duration };
}

/** A VideoClip whose pooled texture gets evicted (destroyed) while a later frame
 *  misses must not crash the renderer (the "load video → export" TypeError). */
async function runDestroyedTextureGuard(): Promise<Record<string, unknown>> {
  const compositor = makeCompositor();
  await compositor.init();

  // A fake video source: yields `tex` until we set it to null (a decode miss).
  let tex: Texture | null = null;
  const source = {
    getTextureAt: () => tex,
    async prepare() {},
    async load() {
      return { width: W, height: H, duration: 1, hasAudio: false };
    },
    getBuffer: () => null,
    dispose() {},
  } as unknown as VisualSource;

  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#00ff00';
  ctx.fillRect(0, 0, W, H);
  tex = Texture.from(c);

  const track = new VisualTrack();
  const clip = new VideoClip(source);
  clip.start = 0;
  clip.end = 1;
  clip.transform.anchor.setStatic([0.5, 0.5]);
  clip.transform.position.setStatic([W / 2, H / 2]);
  track.add(clip);
  compositor.addTrack(track);

  compositor.renderSync(0); // sprite now holds `tex`

  // Evict it: destroy the texture (as the VRAM budget / cache would) and miss.
  tex.destroy(true);
  tex = null;

  let error: string | null = null;
  try {
    compositor.renderSync(0.2); // must not read addressModeU off a null source
  } catch (e) {
    error = String(e);
  }
  compositor.dispose();
  return { okGuard: !error, error };
}

async function run(): Promise<void> {
  const video = await runVideoExport();
  const audio = await runAudioExport();
  const roundTrip = await runVideoRoundTrip();
  const guard = await runDestroyedTextureGuard();
  const ok = Boolean(video.okVideo && audio.okAudio && roundTrip.okRoundTrip && guard.okGuard);
  (window as unknown as { __EXPORT_TEST__: unknown }).__EXPORT_TEST__ = { ok, video, audio, roundTrip, guard };
}

run().catch((err) => {
  (window as unknown as { __EXPORT_TEST__: unknown }).__EXPORT_TEST__ = { ok: false, error: String(err) };
});
