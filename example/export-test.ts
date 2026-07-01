/**
 * Puppeteer e2e for milestone 08 — the Exporter renders a timeline to a real
 * container file and it decodes back correctly.
 *
 * Renders a red full-frame clip, exports [0,0.5)s at 15fps to MP4/WebM (whichever
 * codec the browser can encode), then re-opens the blob with Mediabunny and
 * asserts the frame count, dimensions and that a decoded frame is actually red
 * (catches a blank-canvas capture). Result on `window.__EXPORT_TEST__`.
 */
import {
  AudioClip,
  AudioEngine,
  type AudioSource,
  Compositor,
  Exporter,
  ShapeClip,
  Timebase,
  VisualTrack,
} from '../src/index';

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

async function run(): Promise<void> {
  const video = await runVideoExport();
  const audio = await runAudioExport();
  const ok = Boolean(video.okVideo && audio.okAudio);
  (window as unknown as { __EXPORT_TEST__: unknown }).__EXPORT_TEST__ = { ok, video, audio };
}

run().catch((err) => {
  (window as unknown as { __EXPORT_TEST__: unknown }).__EXPORT_TEST__ = { ok: false, error: String(err) };
});
