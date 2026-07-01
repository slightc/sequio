/**
 * Puppeteer-driven render test for milestone 04: two VisualTracks stacked by
 * zIndex, verifying opacity blending and blendMode compositing in real pixels.
 * Uses generated solid-color textures (no decode), so it needs only WebGL.
 *
 * Publishes the result on `window.__RENDER_TEST__`.
 */
import { Texture } from 'pixi.js';
import {
  Compositor,
  ImageClip,
  Timebase,
  VisualSource,
  VisualTrack,
  type SourceMetadata,
} from '../src/index';

const W = 200;
const H = 200;

/** A source that is one full-frame solid color. */
class SolidSource extends VisualSource {
  private texture: Texture | null = null;
  constructor(private readonly css: string) {
    super();
  }
  async load(): Promise<SourceMetadata> {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = this.css;
    ctx.fillRect(0, 0, W, H);
    this.texture = Texture.from(canvas);
    this.metadata = { width: W, height: H, duration: Infinity, hasAudio: false };
    return this.metadata;
  }
  async prepare(): Promise<void> {}
  getTextureAt(): Texture | null {
    return this.texture;
  }
  dispose(): void {
    this.texture?.destroy(true);
    this.texture = null;
  }
}

function readCenter(view: HTMLCanvasElement): { r: number; g: number; b: number } {
  const off = document.createElement('canvas');
  off.width = view.width;
  off.height = view.height;
  const ctx = off.getContext('2d')!;
  ctx.drawImage(view, 0, 0);
  const d = ctx.getImageData(view.width >> 1, view.height >> 1, 1, 1).data;
  return { r: d[0]!, g: d[1]!, b: d[2]! };
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

  // Bottom track: opaque red. Top track: blue, stacked above by zIndex.
  const red = new SolidSource('#ff0000');
  const blue = new SolidSource('#0000ff');
  await Promise.all([red.load(), blue.load()]);

  const bottom = new VisualTrack();
  bottom.zIndex = 0;
  const redClip = new ImageClip(red);
  redClip.start = 0;
  redClip.end = 100;
  redClip.transform.anchor.setStatic([0, 0]);
  bottom.add(redClip);

  const top = new VisualTrack();
  top.zIndex = 10;
  const blueClip = new ImageClip(blue);
  blueClip.start = 0;
  blueClip.end = 100;
  blueClip.transform.anchor.setStatic([0, 0]);
  top.add(blueClip);

  compositor.addTrack(top); // add out of z-order; reconcile sorts
  compositor.addTrack(bottom);

  // Phase A — top at 50% opacity over red → purple (both channels present).
  blueClip.opacity.setStatic(0.5);
  compositor.renderSync(0);
  const blend = readCenter(compositor.view);

  // Phase B — top fully opaque, additive blend → bright magenta.
  blueClip.opacity.setStatic(1);
  blueClip.blendMode = 'add';
  compositor.renderSync(0);
  const additive = readCenter(compositor.view);

  const okBlend = blend.r > 70 && blend.b > 70 && blend.g < 70 && Math.abs(blend.r - blend.b) < 100;
  const okAdditive = additive.r > 180 && additive.b > 180 && additive.g < 80;

  (window as unknown as { __RENDER_TEST__: unknown }).__RENDER_TEST__ = {
    ok: okBlend && okAdditive,
    blend,
    additive,
  };
}

run().catch((err) => {
  (window as unknown as { __RENDER_TEST__: unknown }).__RENDER_TEST__ = {
    ok: false,
    error: String(err),
  };
});
