/**
 * Puppeteer render test for milestone 05 — ImageClip / TextClip / ShapeClip
 * actually draw on screen, transform and composite. Places four clips at known
 * positions and samples their pixels.
 *
 * Publishes the result on `window.__CLIPS_TEST__` for `pnpm verify:clips`.
 */
import {
  Compositor,
  ImageClip,
  ImageSource,
  ShapeClip,
  TextClip,
  Timebase,
  VisualClip,
  VisualTrack,
} from '../src/index';

const W = 300;
const H = 200;

function place(clip: VisualClip, x: number, y: number): void {
  clip.start = 0;
  clip.end = 100;
  clip.transform.anchor.setStatic([0.5, 0.5]);
  clip.transform.position.setStatic([x, y]);
}

/** A magenta ImageBitmap to back an ImageSource. */
async function magentaBitmap(): Promise<ImageBitmap> {
  const c = document.createElement('canvas');
  c.width = 80;
  c.height = 60;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ff00ff';
  ctx.fillRect(0, 0, 80, 60);
  return createImageBitmap(c);
}

function px(data: Uint8ClampedArray, w: number, x: number, y: number) {
  const i = (y * w + x) * 4;
  return { r: data[i]!, g: data[i + 1]!, b: data[i + 2]! };
}

/** Whether the region has any near-white pixel (text glyphs). */
function hasBright(data: Uint8ClampedArray, w: number, x0: number, y0: number, x1: number, y1: number): boolean {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = px(data, w, x, y);
      if (p.r > 180 && p.g > 180 && p.b > 180) return true;
    }
  }
  return false;
}

async function run(): Promise<void> {
  const compositor = new Compositor({
    width: W,
    height: H,
    timebase: new Timebase(30),
    background: 0x000000,
    preferWebGPU: false,
  });
  await compositor.init();
  document.getElementById('stage')!.append(compositor.view);

  const track = new VisualTrack();

  const rect = new ShapeClip({ kind: 'rect', width: 80, height: 60, fill: 0xff0000 });
  place(rect, 75, 50);

  const ellipse = new ShapeClip({ kind: 'ellipse', width: 80, height: 60, fill: 0x00ff00 });
  place(ellipse, 225, 50);

  const image = new ImageClip(new ImageSource({ src: await magentaBitmap() }));
  await (image.source as ImageSource).load();
  place(image, 75, 150);

  const text = new TextClip({ text: 'Hi', fontSize: 48, fill: 0xffffff });
  place(text, 225, 150);

  for (const c of [rect, ellipse, image, text]) track.add(c);
  compositor.addTrack(track);

  compositor.renderSync(0);

  // Read back and sample each clip.
  const off = document.createElement('canvas');
  off.width = W;
  off.height = H;
  const octx = off.getContext('2d')!;
  octx.drawImage(compositor.view, 0, 0);
  const { data } = octx.getImageData(0, 0, W, H);

  const rectPx = px(data, W, 75, 50);
  const ellipsePx = px(data, W, 225, 50);
  const imagePx = px(data, W, 75, 150);
  const textBright = hasBright(data, W, 195, 125, 255, 175);

  const okRect = rectPx.r > 180 && rectPx.g < 80 && rectPx.b < 80;
  const okEllipse = ellipsePx.g > 180 && ellipsePx.r < 80 && ellipsePx.b < 80;
  const okImage = imagePx.r > 180 && imagePx.b > 180 && imagePx.g < 80;

  (window as unknown as { __CLIPS_TEST__: unknown }).__CLIPS_TEST__ = {
    ok: okRect && okEllipse && okImage && textBright,
    rect: rectPx,
    ellipse: ellipsePx,
    image: imagePx,
    textBright,
  };
}

run().catch((err) => {
  (window as unknown as { __CLIPS_TEST__: unknown }).__CLIPS_TEST__ = { ok: false, error: String(err) };
});
