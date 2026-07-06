/**
 * Milestone 04 multi-track render check — two VisualTracks stacked by zIndex,
 * verifying opacity blending and blendMode compositing in real pixels.
 *
 * Manual verification: open `/example/multitrack-test.html`. You should see two
 * panels — a purple square (top track at 50% opacity over red) and a magenta
 * square (top track with additive blend) — plus a PASS/FAIL readout.
 *
 * Automated: `pnpm verify:render` reads `window.__RENDER_TEST__`.
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

function centerOf(canvas: HTMLCanvasElement): { r: number; g: number; b: number } {
  const off = document.createElement('canvas');
  off.width = canvas.width;
  off.height = canvas.height;
  const ctx = off.getContext('2d')!;
  ctx.drawImage(canvas, 0, 0);
  const d = ctx.getImageData(canvas.width >> 1, canvas.height >> 1, 1, 1).data;
  return { r: d[0]!, g: d[1]!, b: d[2]! };
}

/** Copy the live compositor canvas into a fresh, displayable snapshot. */
function snapshot(view: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = view.width;
  c.height = view.height;
  c.getContext('2d')!.drawImage(view, 0, 0);
  return c;
}

function panel(title: string, canvas: HTMLCanvasElement, sub: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'panel';
  const h = document.createElement('div');
  h.className = 'title';
  h.textContent = title;
  const s = document.createElement('div');
  s.className = 'sub';
  s.textContent = sub;
  el.append(h, canvas, s);
  return el;
}

const rgb = (c: { r: number; g: number; b: number }) => `rgb(${c.r}, ${c.g}, ${c.b})`;

async function run(): Promise<void> {
  const compositor = new Compositor({
    width: W,
    height: H,
    timebase: new Timebase(30),
    background: 0x000000,
    preferWebGPU: false,
  });
  await compositor.init();

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

  compositor.addTrack(top); // add out of z-order; reconcile sorts by zIndex
  compositor.addTrack(bottom);

  // Phase A — top at 50% opacity over red → purple (both channels present).
  blueClip.opacity.setStatic(0.5);
  compositor.renderSync(0);
  const snapBlend = snapshot(compositor.view);
  const blend = centerOf(snapBlend);

  // Phase B — top fully opaque, additive blend → bright magenta.
  blueClip.opacity.setStatic(1);
  blueClip.blendMode = 'add';
  compositor.renderSync(0);
  const snapAdd = snapshot(compositor.view);
  const additive = centerOf(snapAdd);

  const okBlend = blend.r > 70 && blend.b > 70 && blend.g < 70 && Math.abs(blend.r - blend.b) < 100;
  const okAdditive = additive.r > 180 && additive.b > 180 && additive.g < 80;
  const ok = okBlend && okAdditive;

  // ── Render a human-verifiable report ──────────────────────────────────────
  const stage = document.getElementById('stage')!;
  const row = document.createElement('div');
  row.className = 'row';
  row.append(
    panel('① opacity blend', snapBlend, `top blue @50% over red\ncenter = ${rgb(blend)}  ${okBlend ? '✓ purple' : '✗'}`),
    panel('② blendMode: add', snapAdd, `top blue additive over red\ncenter = ${rgb(additive)}  ${okAdditive ? '✓ magenta' : '✗'}`),
  );
  stage.append(row);

  const verdict = document.getElementById('verdict')!;
  verdict.textContent = ok ? 'PASS — stacking, opacity and blendMode all render' : 'FAIL — see values above';
  verdict.className = ok ? 'pass' : 'fail';

  (window as unknown as { __RENDER_TEST__: unknown }).__RENDER_TEST__ = { ok, blend, additive };
}

run().catch((err) => {
  const verdict = document.getElementById('verdict');
  if (verdict) {
    verdict.textContent = `ERROR — ${String(err)}`;
    verdict.className = 'fail';
  }
  (window as unknown as { __RENDER_TEST__: unknown }).__RENDER_TEST__ = { ok: false, error: String(err) };
});
