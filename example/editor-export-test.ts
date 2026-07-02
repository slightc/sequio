/**
 * Puppeteer e2e for the editor's **forked** export (WebCodecs).
 *
 * Verifies the exact path the mini-editor uses (`editor-export.ts`): a timeline
 * that mixes a VideoClip (whose source is fork()ed for export), a TextClip and a
 * ShapeClip is rendered to a real MP4/WebM on an offscreen compositor, then
 * decoded back and checked (frame count, dimensions, non-black frames). It also
 * asserts the live preview's VideoSource still decodes AFTER the fork is
 * disposed — i.e. export never disturbs the preview's decoder.
 *
 * Result is published on `window.__EDITOR_EXPORT_TEST__`; run via
 * `pnpm verify:editor-export` (needs Chrome-for-Testing, which ships WebCodecs).
 */
import {
  AudioEngine,
  Compositor,
  Exporter,
  ShapeClip,
  TextClip,
  Timebase,
  VideoClip,
  VideoSource,
  VisualTrack,
} from '../src/index';
import { applyCover } from './cover';
import { type ExportTrackLike, exportTimeline } from './editor-export';

const W = 160;
const H = 120;
const FPS = 15;

async function pickCodec(): Promise<{ container: 'mp4' | 'webm'; videoCodec: string } | null> {
  const { canEncodeVideo } = await import('mediabunny');
  if (await canEncodeVideo('avc')) return { container: 'mp4', videoCodec: 'avc' };
  if (await canEncodeVideo('vp9')) return { container: 'webm', videoCodec: 'vp9' };
  if (await canEncodeVideo('vp8')) return { container: 'webm', videoCodec: 'vp8' };
  return null;
}

/** Encode a 1s clip of a moving red box → a File, to load back as a VideoSource. */
async function makeSourceVideo(codec: { container: 'mp4' | 'webm'; videoCodec: string }): Promise<File> {
  const comp = new Compositor({ width: W, height: H, timebase: new Timebase(FPS), background: 0x000000, preferWebGPU: false });
  await comp.init();
  const track = new VisualTrack();
  const box = new ShapeClip({ kind: 'rect', width: 50, height: 50, fill: 0xff0000 });
  box.start = 0;
  box.end = 1;
  box.transform.anchor.setStatic([0.5, 0.5]);
  box.transform.position.setKeyframes([
    { time: 0, value: [25, H / 2] },
    { time: 1, value: [W - 25, H / 2] },
  ]);
  track.add(box);
  comp.addTrack(track);
  const blob = await new Exporter(comp, new AudioEngine(new Timebase(FPS))).export({
    fps: FPS,
    range: [0, 1],
    audio: false,
    bitrate: 1_000_000,
    ...codec,
  });
  comp.dispose();
  return new File([blob], `src.${codec.container}`, { type: blob.type });
}

/** Count decoded frames of a blob and how many have visible (non-black) pixels. */
async function decodeAndInspect(blob: Blob, end: number): Promise<{ frames: number; lit: number; w: number; h: number }> {
  const { Input, ALL_FORMATS, BlobSource, VideoSampleSink } = await import('mediabunny');
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const vtrack = await input.getPrimaryVideoTrack();
  let frames = 0;
  let lit = 0;
  let w = 0;
  let h = 0;
  if (vtrack) {
    w = vtrack.displayWidth;
    h = vtrack.displayHeight;
    const sink = new VideoSampleSink(vtrack);
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const cx = cv.getContext('2d')!;
    for await (const sample of sink.samples(0, end)) {
      frames++;
      sample.draw(cx, 0, 0, W, H);
      const d = cx.getImageData(0, 0, W, H).data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i]! > 40 || d[i + 1]! > 40 || d[i + 2]! > 40) {
          lit++;
          break;
        }
      }
      sample.close();
    }
  }
  return { frames, lit, w, h };
}

async function run(): Promise<void> {
  const codec = await pickCodec();
  if (!codec) {
    (window as unknown as { __EDITOR_EXPORT_TEST__: unknown }).__EDITOR_EXPORT_TEST__ = {
      ok: false,
      error: 'no encodable video codec',
    };
    return;
  }

  const END = 0.6; // export window (9 frames at 15fps)

  // 1. A real video source for the timeline's video track.
  const file = await makeSourceVideo(codec);
  const source = new VideoSource({ src: file });
  const meta = await source.load();

  // A "preview" compositor holding that source — the thing export must NOT touch.
  const preview = new Compositor({ width: W, height: H, timebase: new Timebase(FPS), background: 0x101014, preferWebGPU: false });
  await preview.init();
  document.getElementById('stage')?.append(preview.view);
  const pTrack = new VisualTrack();
  const pClip = new VideoClip(source);
  pClip.start = 0;
  pClip.end = meta.duration;
  applyCover(pClip, meta.width, meta.height, W, H);
  pTrack.add(pClip);
  preview.addTrack(pTrack);
  await preview.prepare(0);
  preview.renderSync(0);

  // 2. The editor timeline: video (forked on export) + text + shape.
  const videoClip = new VideoClip(source);
  videoClip.start = 0;
  videoClip.end = meta.duration;
  applyCover(videoClip, meta.width, meta.height, W, H);

  const text = new TextClip({ text: 'Hi', fontSize: 40, fill: 0xffffff });
  text.start = 0;
  text.end = 1;
  text.transform.anchor.setStatic([0.5, 0.5]);
  text.transform.position.setStatic([W / 2, H / 2]);

  const shape = new ShapeClip({ kind: 'ellipse', width: 40, height: 40, fill: 0x2b6cff });
  shape.start = 0;
  shape.end = 1;
  shape.transform.anchor.setStatic([0.5, 0.5]);
  shape.transform.position.setStatic([40, 30]);

  const tracks: ExportTrackLike[] = [
    { zIndex: 0, clips: [{ kind: 'video', clip: videoClip, source }] },
    {
      zIndex: 1,
      clips: [
        { kind: 'shape', clip: shape, source: null },
        { kind: 'text', clip: text, source: null },
      ],
    },
  ];

  // 3. Run the editor's forked export.
  const progress: number[] = [];
  let sawExporter = false;
  const blob = await exportTimeline(tracks, new AudioEngine(new Timebase(FPS)), {
    width: W,
    height: H,
    timebase: new Timebase(FPS),
    fps: FPS,
    container: codec.container,
    videoCodec: codec.videoCodec,
    range: [0, END],
    bitrate: 1_000_000,
    onProgress: (p) => progress.push(p),
    onExporter: (e) => {
      sawExporter = e instanceof Exporter;
    },
  });

  const decoded = await decodeAndInspect(blob, END);

  // 4. The preview's source must STILL decode after the fork was disposed:
  //    read two frames at different times and confirm they differ (it advances).
  const readPreview = async (t: number): Promise<Uint8ClampedArray> => {
    await preview.prepare(t);
    preview.renderSync(t);
    const oc = document.createElement('canvas');
    oc.width = W;
    oc.height = H;
    const octx = oc.getContext('2d')!;
    octx.drawImage(preview.view, 0, 0);
    return octx.getImageData(0, 0, W, H).data;
  };
  const a = await readPreview(0);
  const b = await readPreview(0.9);
  let previewDiff = 0;
  let previewLit = false;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i]! > 40 || a[i + 1]! > 40 || a[i + 2]! > 40) previewLit = true;
    if (Math.abs(a[i]! - b[i]!) > 40) previewDiff++;
  }
  const previewOk = previewLit && previewDiff > 20;

  preview.dispose();
  source.dispose();

  const expectedFrames = Math.round(END * FPS); // 9
  const ok =
    blob.size > 500 &&
    decoded.w === W &&
    decoded.h === H &&
    decoded.frames >= expectedFrames - 1 &&
    decoded.frames <= expectedFrames + 1 &&
    decoded.lit >= decoded.frames - 1 && // essentially every frame has content (no black)
    progress.length > 0 &&
    Math.abs(progress.at(-1)! - 1) < 1e-6 &&
    sawExporter &&
    previewOk;

  (window as unknown as { __EDITOR_EXPORT_TEST__: unknown }).__EDITOR_EXPORT_TEST__ = {
    ok,
    container: codec.container,
    videoCodec: codec.videoCodec,
    size: blob.size,
    decoded,
    expectedFrames,
    progressEnd: progress.at(-1),
    sawExporter,
    previewLit,
    previewDiff,
  };
}

run().catch((err) => {
  (window as unknown as { __EDITOR_EXPORT_TEST__: unknown }).__EDITOR_EXPORT_TEST__ = { ok: false, error: String(err) };
});
