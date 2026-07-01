/**
 * Puppeteer render test for milestone 07 — Effects & Transitions actually run
 * on the GPU:
 *
 *   A) A clip-level {@link ColorEffect} (brightness < 1) darkens a white clip,
 *      and a {@link BlurEffect} bleeds a hard-edged rect past its border.
 *   B) A {@link CrossfadeTransition} blends a red and a blue texture: at
 *      progress 0 the output is red, at 1 blue, at 0.5 a purple mix.
 *   C) Warps: a {@link BulgeEffect} magnifies a disc past its border, a
 *      {@link PerspectiveEffect} clips the corners of a full-frame rect, and a
 *      {@link DisplacementEffect} shifts a two-tone image.
 *
 * Publishes the result on `window.__EFFECTS_TEST__` for `pnpm verify:effects`.
 */
import {
  autoDetectRenderer,
  Container,
  Graphics,
  type Renderer,
  RenderTexture,
  Texture,
} from 'pixi.js';
import {
  BlurEffect,
  BulgeEffect,
  ColorEffect,
  Compositor,
  CrossfadeTransition,
  DisplacementEffect,
  ImageClip,
  ImageSource,
  PerspectiveEffect,
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

/** A2) global effect over the whole composite (Compositor.effects). */
async function runGlobalEffect(): Promise<Record<string, unknown>> {
  const compositor = new Compositor({
    width: W,
    height: H,
    timebase: new Timebase(30),
    background: 0x000000,
    preferWebGPU: false,
  });
  await compositor.init();

  const track = new VisualTrack();
  const red = new ShapeClip({ kind: 'rect', width: 120, height: 120, fill: 0xff0000 });
  place(red, 80, 100);
  const blue = new ShapeClip({ kind: 'rect', width: 120, height: 120, fill: 0x0000ff });
  place(blue, 240, 100);
  for (const c of [red, blue]) track.add(c);
  compositor.addTrack(track);

  // One global desaturate → BOTH clips lose their hue (proves it hits the whole
  // composite, not a single clip).
  const gray = new ColorEffect();
  gray.saturation.setStatic(0);
  compositor.effects.push(gray);
  compositor.renderSync(0);

  const off = document.createElement('canvas');
  off.width = W;
  off.height = H;
  const octx = off.getContext('2d')!;
  octx.drawImage(compositor.view, 0, 0);
  const { data } = octx.getImageData(0, 0, W, H);

  const redPx = px(data, W, 80, 100);
  const bluePx = px(data, W, 240, 100);
  const isGray = (p: { r: number; g: number; b: number }) =>
    Math.abs(p.r - p.g) < 45 && Math.abs(p.g - p.b) < 45 && Math.abs(p.r - p.b) < 45;
  const okGlobal = isGray(redPx) && isGray(bluePx);

  compositor.dispose();
  return { okGlobal, red: redPx, blue: bluePx };
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

// ── C) warps: bulge / perspective / displacement ────────────────────────────

const WW = 240; // square so the bulge stays circular (aspect 1)

/** Render one clip (+ its effect) full-frame on a fresh compositor and read back. */
async function renderWarp(build: (track: VisualTrack) => Promise<void> | void): Promise<Uint8ClampedArray> {
  const compositor = new Compositor({
    width: WW,
    height: WW,
    timebase: new Timebase(30),
    background: 0x000000,
    preferWebGPU: false,
  });
  await compositor.init();
  const track = new VisualTrack();
  await build(track);
  compositor.addTrack(track);
  compositor.renderSync(0);

  const off = document.createElement('canvas');
  off.width = WW;
  off.height = WW;
  const ctx = off.getContext('2d')!;
  ctx.drawImage(compositor.view, 0, 0);
  const data = ctx.getImageData(0, 0, WW, WW).data;
  compositor.dispose();
  return data;
}

/** A full-frame white disc (radius `r`) on black — for the bulge test. */
async function discBitmap(r: number): Promise<ImageBitmap> {
  const c = document.createElement('canvas');
  c.width = WW;
  c.height = WW;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, WW, WW);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(WW / 2, WW / 2, r, 0, Math.PI * 2);
  ctx.fill();
  return createImageBitmap(c);
}

/** A left-red / right-blue ImageBitmap for the displacement test. */
async function twoToneBitmap(): Promise<ImageBitmap> {
  const c = document.createElement('canvas');
  c.width = WW;
  c.height = WW;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(0, 0, WW / 2, WW);
  ctx.fillStyle = '#0000ff';
  ctx.fillRect(WW / 2, 0, WW / 2, WW);
  return createImageBitmap(c);
}

/** A constant displacement map (red=1, green=0.5) → uniform horizontal shift. */
function shiftMap(): Texture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 4;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgb(255,128,128)';
  ctx.fillRect(0, 0, 4, 4);
  return Texture.from(c);
}

async function runWarps(): Promise<Record<string, unknown>> {
  // Bulge: a full-frame image with a white disc (radius 36px); magnifying it
  // turns a formerly-black pixel 46px from center white. The disc lives on a
  // full-frame clip so the filter region is the whole frame (uv center = disc
  // center), unlike a tight-fitting shape whose bounds would clip the warp.
  const discSrc = new ImageSource({ src: await discBitmap(36) });
  await discSrc.load();
  const bulgeData = await renderWarp((track) => {
    const disc = new ImageClip(discSrc);
    place(disc, WW / 2, WW / 2);
    const b = new BulgeEffect();
    b.strength.setStatic(0.9);
    b.radius.setStatic(0.5);
    disc.effects.push(b);
    track.add(disc);
  });
  const bulgeOutside = px(bulgeData, WW, WW / 2, WW / 2 - 46); // was black, now magnified
  const okBulge = bulgeOutside.r > 150 && bulgeOutside.g > 150 && bulgeOutside.b > 150;

  // Perspective: a full-frame white rect with the top edge pulled inward →
  // the top-left corner falls outside the quad (black); the center stays white.
  const perspData = await renderWarp((track) => {
    const rect = new ShapeClip({ kind: 'rect', width: WW, height: WW, fill: 0xffffff });
    place(rect, WW / 2, WW / 2);
    const p = new PerspectiveEffect();
    p.topLeft.setStatic([0.3, 0]);
    p.topRight.setStatic([0.7, 0]);
    rect.effects.push(p);
    track.add(rect);
  });
  const corner = px(perspData, WW, 12, 12);
  const middle = px(perspData, WW, WW / 2, WW / 2);
  const okPerspective = corner.r < 40 && middle.r > 200;

  // Displacement: shift a two-tone image; the red/blue boundary moves, so some
  // pixels along the middle row differ from the un-shifted baseline.
  const bmp = await twoToneBitmap();
  const src0 = new ImageSource({ src: bmp });
  await src0.load();
  const baseData = await renderWarp(async (track) => {
    const img = new ImageClip(src0);
    place(img, WW / 2, WW / 2);
    track.add(img);
  });
  const src1 = new ImageSource({ src: bmp });
  await src1.load();
  const dispData = await renderWarp(async (track) => {
    const img = new ImageClip(src1);
    place(img, WW / 2, WW / 2);
    const d = new DisplacementEffect({ map: shiftMap(), strength: 48 });
    img.effects.push(d);
    track.add(img);
  });
  let changed = 0;
  const y = WW / 2;
  for (let x = 0; x < WW; x++) {
    const a = px(baseData, WW, x, y);
    const b = px(dispData, WW, x, y);
    if (Math.abs(a.r - b.r) + Math.abs(a.b - b.b) > 120) changed++;
  }
  const okDisplacement = changed > 4; // the boundary band moved

  return {
    okBulge,
    bulgeOutside,
    okPerspective,
    corner,
    middle,
    okDisplacement,
    changed,
  };
}

/** B2) a CrossfadeTransition driven by the compositor over two overlapping clips. */
async function runTrackTransition(): Promise<Record<string, unknown>> {
  // Red A on [0,2), blue B on [1,3) → overlap [1,2). A fresh compositor per
  // sample (WebGL readback is only reliable on the just-rendered frame).
  const sampleAt = async (t: number) => {
    const compositor = new Compositor({
      width: W,
      height: H,
      timebase: new Timebase(30),
      background: 0x000000,
      preferWebGPU: false,
    });
    await compositor.init();
    const track = new VisualTrack();
    const a = new ShapeClip({ kind: 'rect', width: W, height: H, fill: 0xff0000 });
    place(a, W / 2, H / 2); // NOTE: place() sets start/end, so override them after
    a.start = 0;
    a.end = 2;
    const b = new ShapeClip({ kind: 'rect', width: W, height: H, fill: 0x0000ff });
    place(b, W / 2, H / 2);
    b.start = 1;
    b.end = 3;
    track.add(a);
    track.add(b);
    track.addTransition(new CrossfadeTransition().between(a, b)); // overlap [1,2)
    compositor.addTrack(track);

    compositor.renderSync(t);
    const off = document.createElement('canvas');
    off.width = W;
    off.height = H;
    const ctx = off.getContext('2d')!;
    ctx.drawImage(compositor.view, 0, 0);
    const p = px(ctx.getImageData(0, 0, W, H).data, W, W / 2, H / 2);
    compositor.dispose();
    return p;
  };

  const before = await sampleAt(0.5); // only A → red
  const mid = await sampleAt(1.5); // overlap midpoint, progress 0.5 → purple
  const after = await sampleAt(2.5); // only B → blue

  const okBefore = before.r > 200 && before.b < 60;
  const okMid = mid.r > 90 && mid.r < 170 && mid.b > 90 && mid.b < 170;
  const okAfter = after.b > 200 && after.r < 60;

  return { okBefore, okMid, okAfter, before, mid, after };
}

async function run(): Promise<void> {
  const clip = await runClipEffects();
  const global = await runGlobalEffect();
  const fade = await runCrossfade();
  const trackTr = await runTrackTransition();
  const warp = await runWarps();
  const ok = Boolean(
    clip.okDim &&
      clip.okBlur &&
      global.okGlobal &&
      fade.okStart &&
      fade.okEnd &&
      fade.okMid &&
      trackTr.okBefore &&
      trackTr.okMid &&
      trackTr.okAfter &&
      warp.okBulge &&
      warp.okPerspective &&
      warp.okDisplacement,
  );
  (window as unknown as { __EFFECTS_TEST__: unknown }).__EFFECTS_TEST__ = {
    ok,
    clip,
    global,
    fade,
    trackTr,
    warp,
  };
}

run().catch((err) => {
  (window as unknown as { __EFFECTS_TEST__: unknown }).__EFFECTS_TEST__ = { ok: false, error: String(err) };
});
