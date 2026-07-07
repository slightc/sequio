/**
 * Puppeteer e2e for `@video-editor-canvas/runtime`.
 *
 * Compiles + runs a **two-file TypeScript program** that builds the composition
 * **imperatively** with the engine's own classes (`new Compositor()`,
 * `new VisualTrack()`, `new ShapeClip()`, `track.add(...)`) inside
 * `defineComposition(builder)` — the same style as the `example/` demos. The
 * resulting `Composer` is then driven three ways:
 *   1. preview   — mount + render a frame, read pixels back (non-black, right colour);
 *   2. export    — render to a real video Blob, decode it back and check frames/colour;
 *   3. toBundle  — the portable source files + entry a server runtime would re-run.
 *
 * Result on `window.__RUNTIME_TEST__`.
 */
import { loadMediabunny } from '@video-editor-canvas/engine';
import { runComposition } from '../src/index';

const W = 160;
const H = 120;
const FPS = 15;
const DUR = 0.5;

// A multi-file program the runtime compiles + links. `scene.ts` exports a factory
// that builds engine clips; `index.ts` assembles a Compositor from them. Teal
// fills the frame; the title sits at the top so the centre pixel stays teal.
const FILES: Record<string, string> = {
  '/scene.ts': `
    import { ShapeClip, TextClip, VisualTrack } from '@video-editor-canvas/engine';
    export const W = ${W};
    export const H = ${H};
    export function buildTrack() {
      const track = new VisualTrack();
      const bg = new ShapeClip({ kind: 'rect', width: W, height: H, fill: 0x0f766e });
      bg.start = 0; bg.end = ${DUR};
      bg.transform.anchor.setStatic([0, 0]);
      bg.transform.position.setStatic([0, 0]);
      track.add(bg);
      const title = new TextClip({ text: 'Code Mode', fontSize: 20, fill: 0xffd60a });
      title.start = 0; title.end = ${DUR};
      title.transform.anchor.setStatic([0.5, 0.5]);
      title.transform.position.setStatic([W / 2, 16]);
      track.add(title);
      return track;
    }
  `,
  '/index.ts': `
    import { Compositor } from '@video-editor-canvas/engine';
    import { defineComposition } from '@video-editor-canvas/runtime';
    import { W, H, buildTrack } from './scene';
    export default defineComposition(async () => {
      const compositor = new Compositor({
        width: W, height: H, fps: ${FPS},
        background: 0x000000, preferWebGPU: false,
      });
      await compositor.init();
      compositor.addTrack(buildTrack());
      return { compositor, duration: ${DUR} };
    });
  `,
};

const isTeal = (r: number, g: number, b: number) => r < 90 && g > 80 && b > 70 && b < 160;

async function pickCodec(): Promise<{ container: 'mp4' | 'webm'; videoCodec: string } | null> {
  const { canEncodeVideo } = await loadMediabunny();
  if (await canEncodeVideo('avc')) return { container: 'mp4', videoCodec: 'avc' };
  if (await canEncodeVideo('vp9')) return { container: 'webm', videoCodec: 'vp9' };
  if (await canEncodeVideo('vp8')) return { container: 'webm', videoCodec: 'vp8' };
  return null;
}

async function run(): Promise<void> {
  // 1. Compile + run the program → a Composer.
  const composer = await runComposition(FILES, { entry: '/index.ts' });

  // toBundle round-trips the portable code (what ships to server render).
  const bundle = composer.toBundle();
  const bundleOk =
    bundle.entry === '/index.ts' &&
    !!bundle.files['/scene.ts'] &&
    bundle.files['/index.ts'].includes('defineComposition');

  // 2. Preview: build the live graph, render a frame, read pixels back.
  const stage = document.getElementById('stage')!;
  const preview = await composer.preview(stage);
  preview.seek(DUR / 2);
  const off = document.createElement('canvas');
  off.width = W;
  off.height = H;
  const octx = off.getContext('2d')!;
  octx.drawImage(preview.view, 0, 0);
  const center = octx.getImageData(W / 2, H / 2, 1, 1).data;
  const previewOk = isTeal(center[0]!, center[1]!, center[2]!);
  preview.dispose();

  // Implicit injection: the program's `new Compositor({...})` sets no resolution,
  // yet building with env.compositorOptions={resolution:2} must reach it — the
  // backing store is then W*2 wide. Proves env is injected without user plumbing.
  const scaled = await composer.build({ compositorOptions: { resolution: 2 }, target: 'export' });
  const injectionOk = scaled.compositor.view.width === W * 2;
  scaled.dispose();

  // 3. Export the same Composer to a video Blob, decode it back.
  const codec = await pickCodec();
  let exportOk = false;
  let exportInfo: Record<string, unknown> = { skipped: 'no encodable video codec' };
  if (codec) {
    const progress: number[] = [];
    const blob = await composer.export({ ...codec, fps: FPS, audio: false }, (p) => progress.push(p));
    const { Input, ALL_FORMATS, BlobSource, VideoSampleSink } = await loadMediabunny();
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const vtrack = await input.getPrimaryVideoTrack();
    let count = 0;
    let decodedTeal = false;
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
          decodedTeal = isTeal(d[0]!, d[1]!, d[2]!);
        }
        count++;
        sample.close();
      }
    }
    exportOk =
      blob.size > 500 &&
      count >= 6 &&
      count <= 9 &&
      decodedTeal &&
      progress.length > 0 &&
      Math.abs(progress.at(-1)! - 1) < 1e-6;
    exportInfo = { size: blob.size, frames: count, decodedTeal, ...codec };
  } else {
    exportOk = true; // can't encode here → don't fail the suite on codec support
  }

  const ok = Boolean(bundleOk && previewOk && injectionOk && exportOk);
  (window as unknown as { __RUNTIME_TEST__: unknown }).__RUNTIME_TEST__ = {
    ok,
    bundleOk,
    previewOk,
    injectionOk,
    exportOk,
    files: Object.keys(FILES),
    export: exportInfo,
    center: [center[0], center[1], center[2]],
  };
}

run().catch((err) => {
  (window as unknown as { __RUNTIME_TEST__: unknown }).__RUNTIME_TEST__ = { ok: false, error: String(err) };
});
