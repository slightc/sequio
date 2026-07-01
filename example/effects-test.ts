/**
 * Puppeteer render test for milestone 07 — Effects & Transitions actually run
 * on the GPU:
 *
 *   A) A clip-level {@link ColorEffect} (brightness < 1) darkens a white clip,
 *      and a {@link BlurEffect} bleeds a hard-edged rect past its border.
 *   B) A {@link CrossfadeTransition} blends a red and a blue texture: at
 *      progress 0 the output is red, at 1 blue, at 0.5 a purple mix.
 *
 * Publishes the result on `window.__EFFECTS_TEST__` for `pnpm verify:effects`.
 */
import {
  autoDetectRenderer,
  Container,
  Graphics,
  type Renderer,
  RenderTexture,
  type Texture,
} from 'pixi.js';
import {
  BlurEffect,
  ColorEffect,
  Compositor,
  CrossfadeTransition,
  ShapeClip,
  Timebase,
  VisualClip,
  VisualTrack,
} from '../src/index';

const W = 320;
const H = 200;

function place(clip: VisualClip, x: number, y: number): void {
  clip.start = 0;
  clip.end = 100;
  clip.transform.anchor.setStatic([0.5, 0.5]);
  clip.transform.position.setStatic([x, y]);
}

function px(data: Uint8ClampedArray, w: number, x: number, y: number) {
  const i = (y * w + x) * 4;
  return { r: data[i]!, g: data[i + 1]!, b: data[i + 2]!, a: data[i + 3]! };
}

/** Read a Container/Texture back into a 2D canvas for sampling. */
function readback(renderer: Renderer, target: Container | Texture, w: number, h: number): Uint8ClampedArray {
  const src = renderer.extract.canvas({ target });
  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const ctx = off.getContext('2d')!;
  ctx.drawImage(src as CanvasImageSource, 0, 0);
  return ctx.getImageData(0, 0, w, h).data;
}

/** Render a solid-color RenderTexture via `renderer`. */
function solid(renderer: Renderer, w: number, h: number, color: number): RenderTexture {
  const g = new Graphics().rect(0, 0, w, h).fill(color);
  const rt = RenderTexture.create({ width: w, height: h });
  renderer.render({ container: g, target: rt, clear: true });
  g.destroy();
  return rt;
}

/** A) clip-level effects through the Compositor. */
async function runClipEffects(): Promise<Record<string, unknown>> {
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

  // White rect, darkened by a ColorEffect → center pixel clearly below white.
  const dimmed = new ShapeClip({ kind: 'rect', width: 90, height: 90, fill: 0xffffff });
  place(dimmed, 80, 100);
  const color = new ColorEffect();
  color.brightness.setStatic(0.4);
  dimmed.effects.push(color);

  // Red rect on black, blurred → red bleeds past the original border.
  const blurred = new ShapeClip({ kind: 'rect', width: 60, height: 60, fill: 0xff0000 });
  place(blurred, 240, 100);
  const blur = new BlurEffect();
  blur.strength.setStatic(12);
  blurred.effects.push(blur);

  for (const c of [dimmed, blurred]) track.add(c);
  compositor.addTrack(track);
  compositor.renderSync(0);

  const off = document.createElement('canvas');
  off.width = W;
  off.height = H;
  const octx = off.getContext('2d')!;
  octx.drawImage(compositor.view, 0, 0);
  const { data } = octx.getImageData(0, 0, W, H);

  const dimPx = px(data, W, 80, 100); // dimmed rect center
  // Just outside the red rect (rect spans x∈[210,270]); blur should leak red here.
  const bleedPx = px(data, W, 205, 100);

  const okDim = dimPx.r > 60 && dimPx.r < 220 && Math.abs(dimPx.r - dimPx.g) < 20;
  const okBlur = bleedPx.r > 30 && bleedPx.r < 230;

  compositor.dispose();
  return { okDim, dim: dimPx, okBlur, bleed: bleedPx };
}

/** B) crossfade transition on the GPU. */
async function runCrossfade(): Promise<Record<string, unknown>> {
  const renderer = (await autoDetectRenderer({
    width: 64,
    height: 64,
    preference: 'webgl',
    background: 0x000000,
  })) as Renderer;

  const red = solid(renderer, 64, 64, 0xff0000);
  const blue = solid(renderer, 64, 64, 0x0000ff);
  const t = new CrossfadeTransition();

  const sample = (progress: number) => {
    const out = t.render(renderer, red, blue, progress);
    return px(readback(renderer, out, 64, 64), 64, 32, 32);
  };

  const at0 = sample(0);
  const at1 = sample(1);
  const atMid = sample(0.5);

  const okStart = at0.r > 200 && at0.b < 60;
  const okEnd = at1.b > 200 && at1.r < 60;
  const okMid = atMid.r > 90 && atMid.r < 170 && atMid.b > 90 && atMid.b < 170;

  t.dispose();
  red.destroy(true);
  blue.destroy(true);
  renderer.destroy();
  return { okStart, okEnd, okMid, at0, at1, atMid };
}

async function run(): Promise<void> {
  const clip = await runClipEffects();
  const fade = await runCrossfade();
  const ok = Boolean(clip.okDim && clip.okBlur && fade.okStart && fade.okEnd && fade.okMid);
  (window as unknown as { __EFFECTS_TEST__: unknown }).__EFFECTS_TEST__ = { ok, clip, fade };
}

run().catch((err) => {
  (window as unknown as { __EFFECTS_TEST__: unknown }).__EFFECTS_TEST__ = { ok: false, error: String(err) };
});
