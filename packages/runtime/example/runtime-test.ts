/**
 * Puppeteer e2e for `@video-editor-canvas/runtime`.
 *
 * Compiles + runs a **two-file TypeScript program** (an `index.ts` importing a
 * `scene.ts` helper, using `defineComposition` from the injected runtime module)
 * into a `Composer`, then drives that one Composer three ways:
 *   1. preview  — mount + render a frame, read pixels back (non-black, right colour);
 *   2. export   — render to a real video Blob, decode it back and check frames/colour;
 *   3. toSpec   — the serializable spec the server-render routes would consume.
 *
 * Result on `window.__RUNTIME_TEST__`.
 */
import { loadMediabunny } from '@video-editor-canvas/engine';
import { runComposition } from '../src/index';

const W = 160;
const H = 120;
const FPS = 15;
const DUR = 0.5;

// A multi-file program the runtime will compile + link. `scene.ts` exports typed
// clip specs; `index.ts` assembles them with `defineComposition`. Teal fills the
// frame; the title sits at the top so the centre pixel stays teal.
const FILES: Record<string, string> = {
  '/scene.ts': `
    import type { ShapeClipSpec, TextClipSpec } from '@video-editor-canvas/runtime';
    export const W = ${W};
    export const H = ${H};
    export const background: ShapeClipSpec = {
      type: 'shape',
      shape: { kind: 'rect', width: W, height: H, fill: 0x0f766e },
      start: 0, end: ${DUR},
      transform: { anchor: [0, 0], position: [0, 0] },
    };
    export const title: TextClipSpec = {
      type: 'text', text: 'Code Mode', fontSize: 20, fill: 0xffd60a,
      start: 0, end: ${DUR},
      transform: { anchor: [0.5, 0.5], position: [W / 2, 16] },
    };
  `,
  '/index.ts': `
    import { defineComposition } from '@video-editor-canvas/runtime';
    import { W, H, background, title } from './scene';
    export default defineComposition({
      width: W, height: H, fps: ${FPS},
      background: 0x000000,
      range: [0, ${DUR}],
      tracks: [
        { zIndex: 0, clips: [background] },
        { zIndex: 1, clips: [title] },
      ],
      export: { container: 'mp4', videoCodec: 'avc', bitrate: 1_000_000 },
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
  // 1. Compile + run the program → a Composer (no GPU touched yet).
  const composer = await runComposition(FILES, { entry: '/index.ts' });

  // toSpec round-trips the timeline for server render.
  const spec = composer.toSpec();
  const specOk =
    spec.width === W &&
    spec.height === H &&
    spec.fps === FPS &&
    spec.tracks?.length === 2 &&
    spec.tracks?.[1]?.clips[0]?.type === 'text';

  // 2. Preview: build the live graph, render a frame, read pixels back.
  const stage = document.getElementById('stage')!;
  const preview = await composer.preview(stage);
  preview.seek(DUR / 2);
  const view = preview.view;
  const off = document.createElement('canvas');
  off.width = W;
  off.height = H;
  const octx = off.getContext('2d')!;
  octx.drawImage(view, 0, 0);
  const center = octx.getImageData(W / 2, H / 2, 1, 1).data;
  const previewOk = isTeal(center[0]!, center[1]!, center[2]!);
  preview.dispose();

  // 3. Export the same Composer to a video Blob, decode it back.
  const codec = await pickCodec();
  let exportOk = false;
  let exportInfo: Record<string, unknown> = { skipped: 'no encodable video codec' };
  if (codec) {
    const progress: number[] = [];
    const blob = await composer.export({ ...codec, audio: false }, (p) => progress.push(p));
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

  const ok = Boolean(specOk && previewOk && exportOk);
  (window as unknown as { __RUNTIME_TEST__: unknown }).__RUNTIME_TEST__ = {
    ok,
    specOk,
    previewOk,
    exportOk,
    files: Object.keys(FILES),
    export: exportInfo,
    center: [center[0], center[1], center[2]],
  };
}

run().catch((err) => {
  (window as unknown as { __RUNTIME_TEST__: unknown }).__RUNTIME_TEST__ = { ok: false, error: String(err) };
});
