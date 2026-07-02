/**
 * Puppeteer e2e for CompositorOptions.origin.
 *
 * A clip at position [0,0] with a centre origin ([0.5,0.5]) must render in the
 * middle of the canvas; with the default origin ([0,0]) the same clip centres on
 * the top-left corner. Renders both, reads pixels back, and checks the red rect
 * lands where the origin says it should. Result on `window.__ORIGIN_TEST__`.
 */
import { Compositor, ShapeClip, Timebase, VisualTrack } from '../src/index';

const W = 120;
const H = 80;

function px(data: Uint8ClampedArray, x: number, y: number): [number, number, number] {
  const i = (y * W + x) * 4;
  return [data[i]!, data[i + 1]!, data[i + 2]!];
}
const isRed = (p: [number, number, number]) => p[0] > 150 && p[1] < 80 && p[2] < 80;

async function renderRectAtZero(origin: [number, number] | undefined): Promise<Uint8ClampedArray> {
  const compositor = new Compositor({
    width: W,
    height: H,
    timebase: new Timebase(30),
    background: 0x000000,
    preferWebGPU: false,
    ...(origin ? { origin } : {}),
  });
  await compositor.init();
  document.getElementById('stage')!.append(compositor.view);
  const track = new VisualTrack();
  const rect = new ShapeClip({ kind: 'rect', width: 24, height: 24, fill: 0xff0000 });
  rect.start = 0;
  rect.end = 1;
  rect.transform.anchor.setStatic([0.5, 0.5]);
  rect.transform.position.setStatic([0, 0]); // origin-relative
  track.add(rect);
  compositor.addTrack(track);
  compositor.renderSync(0);

  const off = document.createElement('canvas');
  off.width = W;
  off.height = H;
  const octx = off.getContext('2d')!;
  octx.drawImage(compositor.view, 0, 0);
  const data = octx.getImageData(0, 0, W, H).data;
  compositor.dispose();
  return data;
}

async function run(): Promise<void> {
  const centre = await renderRectAtZero([0.5, 0.5]);
  const topLeft = await renderRectAtZero(undefined);

  const centreMid = isRed(px(centre, W / 2, H / 2)); // rect sits at the middle
  const centreCorner = isRed(px(centre, 4, 4)); // …not at the corner
  const defaultMid = isRed(px(topLeft, W / 2, H / 2)); // default: nothing at middle
  const defaultCorner = isRed(px(topLeft, 4, 4)); // …rect centred on the corner

  const ok = centreMid && !centreCorner && !defaultMid && defaultCorner;
  (window as unknown as { __ORIGIN_TEST__: unknown }).__ORIGIN_TEST__ = {
    ok,
    centreMid,
    centreCorner,
    defaultMid,
    defaultCorner,
  };
}

run().catch((err) => {
  (window as unknown as { __ORIGIN_TEST__: unknown }).__ORIGIN_TEST__ = { ok: false, error: String(err) };
});
