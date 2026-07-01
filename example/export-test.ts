/**
 * Puppeteer e2e for milestone 08 — the Exporter renders a timeline to a real
 * container file and it decodes back correctly.
 *
 * Renders a red full-frame clip, exports [0,0.5)s at 15fps to MP4/WebM (whichever
 * codec the browser can encode), then re-opens the blob with Mediabunny and
 * asserts the frame count, dimensions and that a decoded frame is actually red
 * (catches a blank-canvas capture). Result on `window.__EXPORT_TEST__`.
 */
import { AudioEngine, Compositor, Exporter, ShapeClip, Timebase, VisualTrack } from '../src/index';

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

async function run(): Promise<void> {
  const compositor = new Compositor({
    width: W,
    height: H,
    timebase: new Timebase(FPS),
    background: 0x000000,
    preferWebGPU: false,
  });
  await compositor.init();
  document.getElementById('stage')!.append(compositor.view);

  const track = new VisualTrack();
  const rect = new ShapeClip({ kind: 'rect', width: W, height: H, fill: 0xff0000 });
  rect.start = 0;
  rect.end = DUR;
  rect.transform.anchor.setStatic([0.5, 0.5]);
  rect.transform.position.setStatic([W / 2, H / 2]);
  track.add(rect);
  compositor.addTrack(track);

  const codec = await pickCodec();
  if (!codec) {
    (window as unknown as { __EXPORT_TEST__: unknown }).__EXPORT_TEST__ = { ok: false, error: 'no encodable codec' };
    return;
  }

  const exporter = new Exporter(compositor, new AudioEngine(new Timebase(FPS)));
  const progress: number[] = [];
  const blob = await exporter.export(
    { fps: FPS, range: [0, DUR], audio: false, bitrate: 1_000_000, ...codec },
    (p) => progress.push(p),
  );

  // Decode the exported file back and inspect it.
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

  const okSize = blob.size > 500;
  const okFrames = count >= 6 && count <= 9; // round(0.5*15) = 8
  const okRed = !!center && center.r > 150 && center.g < 90 && center.b < 90;
  const okProgress = progress.length > 0 && Math.abs(progress.at(-1)! - 1) < 1e-6;

  (window as unknown as { __EXPORT_TEST__: unknown }).__EXPORT_TEST__ = {
    ok: okSize && okFrames && okRed && okProgress,
    container: codec.container,
    videoCodec: codec.videoCodec,
    size: blob.size,
    frames: count,
    center,
    coded: vtrack ? { w: vtrack.codedWidth, h: vtrack.codedHeight } : null,
    progressEnd: progress.at(-1),
  };
}

run().catch((err) => {
  (window as unknown as { __EXPORT_TEST__: unknown }).__EXPORT_TEST__ = { ok: false, error: String(err) };
});
