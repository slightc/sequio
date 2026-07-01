/**
 * Interactive playground for milestone 07 — Effects & Transitions.
 *
 * Two panels:
 *
 *   A) Live clip effects. A colourful clip carries a {@link ColorEffect} +
 *      {@link BlurEffect}; the sliders drive their AnimatableProperties and the
 *      canvas repaints on every change (contract #5 — the SDK never auto-repaints,
 *      the UI schedules `renderPreview`). "Animate" instead keyframes the params
 *      so play(t) sweeps them, showing `updateAt(t)` on the render clock.
 *
 *   B) Crossfade transition. Two textures (warm A / cool B) are blended by a
 *      {@link CrossfadeTransition}; the progress slider scrubs the mix and Play
 *      ping-pongs it. `out = A*(1-p) + B*p`.
 */
import { Texture } from 'pixi.js';
import {
  BlurEffect,
  BulgeEffect,
  ColorEffect,
  Compositor,
  CrossfadeTransition,
  DisplacementEffect,
  ImageClip,
  PerspectiveEffect,
  RealtimeClock,
  ShapeClip,
  Timebase,
  VisualClip,
  VisualSource,
  VisualTrack,
  type SourceMetadata,
} from '../src/index';

const WIDTH = 560;
const HEIGHT = 315;
const FPS = 30;
const DURATION = 3; // seconds, for the "Animate" sweep

// HiDPI: draw generated raster art at `SS`× so it stays crisp on retina screens.
// (The Compositor already renders vectors at devicePixelRatio; only our canvas
// textures need supersampling.) A clip then scales the texture back by 1/SS.
const SS = globalThis.devicePixelRatio || 1;

// ── Panel A: a rich still image to show colour/blur on ──────────────────────

/**
 * A canvas-backed source drawn at `SS`× and tagged with that factor, so the clip
 * can scale it down by `1/SS` to occupy its logical `w×h` while carrying enough
 * texels to be sharp on HiDPI. `draw` receives a context already scaled to
 * logical coordinates.
 */
class DrawnSource extends VisualSource {
  readonly ss = SS;
  private texture: Texture | null = null;

  constructor(
    private readonly draw: (ctx: CanvasRenderingContext2D) => void,
    private readonly w = WIDTH,
    private readonly h = HEIGHT,
  ) {
    super();
  }

  async load(): Promise<SourceMetadata> {
    const c = document.createElement('canvas');
    c.width = Math.round(this.w * this.ss);
    c.height = Math.round(this.h * this.ss);
    const ctx = c.getContext('2d')!;
    ctx.scale(this.ss, this.ss); // draw in logical coordinates
    this.draw(ctx);
    this.texture = Texture.from(c);
    this.metadata = { width: c.width, height: c.height, duration: Infinity, hasAudio: false };
    return this.metadata;
  }

  async prepare(): Promise<void> {
    /* resident after load() */
  }

  getTextureAt(): Texture | null {
    return this.texture;
  }

  dispose(): void {
    this.texture?.destroy(true);
    this.texture = null;
    this.metadata = null;
  }
}

/** Fill a `w×h` frame with an `SS`×-supersampled clip: center it, scale by 1/SS. */
function fillFrame(clip: VisualClip, ss: number, w = WIDTH, h = HEIGHT): void {
  clip.transform.anchor.setStatic([0.5, 0.5]);
  clip.transform.position.setStatic([w / 2, h / 2]);
  clip.transform.scale.setStatic([1 / ss, 1 / ss]);
}

/** The poster artwork (gradient + saturated discs + label), in logical coords. */
function drawPoster(ctx: CanvasRenderingContext2D): void {
  const grad = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  grad.addColorStop(0, '#ff5d73');
  grad.addColorStop(0.5, '#ffd166');
  grad.addColorStop(1, '#2b6cff');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const discs: [number, number, number, string][] = [
    [130, 98, 50, '#00e5a8'],
    [440, 78, 42, '#ff3d81'],
    [330, 230, 60, '#7c4dff'],
  ];
  for (const [x, y, r, fill] of discs) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.font = 'bold 48px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('EFFECTS', WIDTH / 2, HEIGHT / 2);
}

function bind(id: string): HTMLInputElement {
  return document.getElementById(id) as HTMLInputElement;
}

async function setupEffects(): Promise<void> {
  const compositor = new Compositor({
    width: WIDTH,
    height: HEIGHT,
    timebase: new Timebase(FPS),
    background: 0x101014,
    preferWebGPU: false,
  });
  await compositor.init();
  document.getElementById('fx-stage')!.append(compositor.view);

  const track = new VisualTrack();
  compositor.addTrack(track);

  const source = new DrawnSource(drawPoster);
  await source.load();
  const clip = new ImageClip(source);
  clip.start = 0;
  clip.end = DURATION;
  fillFrame(clip, source.ss); // HiDPI: SS×-supersampled poster, scaled to fill

  // A small badge clip with NO per-clip effect — only the global pass reaches it,
  // so it makes the clip-scope vs. global-scope difference visible.
  const badge = new ShapeClip({ kind: 'rect', width: 96, height: 96, fill: 0x00e5a8 });
  badge.start = 0;
  badge.end = DURATION;
  badge.transform.anchor.setStatic([0.5, 0.5]);
  badge.transform.position.setStatic([WIDTH - 74, HEIGHT - 74]);

  const color = new ColorEffect();
  const blur = new BlurEffect();
  blur.strength.setStatic(0);
  clip.effects.push(color, blur);
  track.add(clip);
  track.add(badge);

  const bright = bind('fx-bright');
  const contrast = bind('fx-contrast');
  const sat = bind('fx-sat');
  const strength = bind('fx-blur');
  const animate = bind('fx-animate');
  const globalBox = bind('fx-global');
  const playBtn = document.getElementById('fx-play') as HTMLButtonElement;
  const readouts = {
    bright: document.getElementById('fx-bright-v')!,
    contrast: document.getElementById('fx-contrast-v')!,
    sat: document.getElementById('fx-sat-v')!,
    blur: document.getElementById('fx-blur-v')!,
  };

  const clock = new RealtimeClock();
  clock.duration = DURATION;

  /** Manual mode: sliders → static values, repaint one frame. */
  function applyStatic(): void {
    color.brightness.setStatic(Number(bright.value));
    color.contrast.setStatic(Number(contrast.value));
    color.saturation.setStatic(Number(sat.value));
    blur.strength.setStatic(Number(strength.value));
    readouts.bright.textContent = Number(bright.value).toFixed(2);
    readouts.contrast.textContent = Number(contrast.value).toFixed(2);
    readouts.sat.textContent = Number(sat.value).toFixed(2);
    readouts.blur.textContent = Number(strength.value).toFixed(0);
    compositor.renderPreview(0);
  }

  /** Animate mode: keyframe the params so play(t) sweeps them. */
  function applyKeyframes(): void {
    color.brightness.setKeyframes([
      { time: 0, value: 1 },
      { time: DURATION / 2, value: 1.6 },
      { time: DURATION, value: 1 },
    ]);
    color.saturation.setKeyframes([
      { time: 0, value: 0 }, // grayscale
      { time: DURATION, value: 2 }, // oversaturated
    ]);
    color.contrast.setStatic(1);
    blur.strength.setKeyframes([
      { time: 0, value: 12 },
      { time: DURATION / 2, value: 0 },
      { time: DURATION, value: 12 },
    ]);
  }

  const sliders = [bright, contrast, sat, strength];
  for (const s of sliders) s.addEventListener('input', applyStatic);

  clock.onTick((t) => compositor.renderPreview(t));
  clock.onEnded(() => {
    clock.play(); // loop the sweep
  });

  function setAnimating(on: boolean): void {
    for (const s of sliders) s.disabled = on;
    if (on) {
      applyKeyframes();
      clock.seek(0);
      clock.play();
      playBtn.disabled = false;
      playBtn.textContent = '⏸ Pause';
    } else {
      clock.pause();
      applyStatic(); // setStatic clears the keyframes → back to slider values
      playBtn.disabled = true;
      playBtn.textContent = '▶ Play';
    }
  }

  /** Move the color+blur effects between the single clip and the whole composite. */
  function relocate(): void {
    clip.effects.length = 0;
    compositor.effects.length = 0;
    (globalBox.checked ? compositor.effects : clip.effects).push(color, blur);
    if (!animate.checked) applyStatic(); // repaint now; while animating the clock does
  }

  animate.addEventListener('change', () => setAnimating(animate.checked));
  globalBox.addEventListener('change', relocate);
  playBtn.addEventListener('click', () => {
    if (clock.paused) {
      clock.play();
      playBtn.textContent = '⏸ Pause';
    } else {
      clock.pause();
      playBtn.textContent = '▶ Play';
    }
  });

  applyStatic(); // initial paint (manual mode, clip-scoped)
  playBtn.disabled = true;
  playBtn.textContent = '▶ Play';
}

// ── Panel B: crossfade transition ───────────────────────────────────────────

const XF_W = 320;
const XF_H = 180;
const XF_DUR = 3; // A on [0,2), B on [1,3) → crossfade over the overlap [1,2)

/** A warm/cool gradient + big label, drawn in logical coords (for a clip source). */
function gradientDraw(label: string, a: string, b: string) {
  return (ctx: CanvasRenderingContext2D): void => {
    const g = ctx.createLinearGradient(0, 0, XF_W, XF_H);
    g.addColorStop(0, a);
    g.addColorStop(1, b);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, XF_W, XF_H);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = 'bold 96px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, XF_W / 2, XF_H / 2);
  };
}

async function setupCrossfade(): Promise<void> {
  // Real track-driven transition: two overlapping clips on one track with a
  // CrossfadeTransition bound between them; the compositor blends them over the
  // overlap. The Compositor is HiDPI by default; DrawnSource supersamples art.
  const compositor = new Compositor({
    width: XF_W,
    height: XF_H,
    timebase: new Timebase(FPS),
    background: 0x101014,
    preferWebGPU: false,
  });
  await compositor.init();
  document.getElementById('xf-stage')!.append(compositor.view);

  const track = new VisualTrack();
  compositor.addTrack(track);

  const srcA = new DrawnSource(gradientDraw('A', '#ff5d73', '#ff9e2c'), XF_W, XF_H);
  const srcB = new DrawnSource(gradientDraw('B', '#2b6cff', '#7c4dff'), XF_W, XF_H);
  await srcA.load();
  await srcB.load();

  const clipA = new ImageClip(srcA);
  clipA.start = 0;
  clipA.end = 2;
  fillFrame(clipA, srcA.ss, XF_W, XF_H);
  const clipB = new ImageClip(srcB);
  clipB.start = 1;
  clipB.end = 3;
  fillFrame(clipB, srcB.ss, XF_W, XF_H);
  track.add(clipA);
  track.add(clipB);
  track.addTransition(new CrossfadeTransition().between(clipA, clipB));

  const scrub = bind('xf-progress');
  scrub.max = String(XF_DUR);
  const readout = document.getElementById('xf-progress-v')!;
  const playBtn = document.getElementById('xf-play') as HTMLButtonElement;

  function paint(t: number): void {
    scrub.value = String(t);
    readout.textContent = `${t.toFixed(2)}s`;
    compositor.renderPreview(t);
  }

  const clock = new RealtimeClock();
  clock.duration = XF_DUR;
  clock.onTick((t) => paint(t));
  clock.onEnded(() => clock.play());

  scrub.addEventListener('input', () => {
    clock.pause();
    playBtn.textContent = '▶ Play';
    paint(Number(scrub.value));
  });

  playBtn.addEventListener('click', () => {
    if (clock.paused) {
      clock.play();
      playBtn.textContent = '⏸ Pause';
    } else {
      clock.pause();
      playBtn.textContent = '▶ Play';
    }
  });

  paint(1.5); // start mid-crossfade (the overlap [1,2) midpoint)
}

// ── Panel C: warps (perspective / bulge / displacement) ──────────────────────

/** A full-frame grid + colour blocks so warps read clearly (logical coords). */
function drawGrid(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#f4f4f8';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const blocks: [number, number, number, number, string][] = [
    [0, 0, WIDTH / 2, HEIGHT / 2, '#ff5d73'],
    [WIDTH / 2, 0, WIDTH / 2, HEIGHT / 2, '#ffd166'],
    [0, HEIGHT / 2, WIDTH / 2, HEIGHT / 2, '#2b6cff'],
    [WIDTH / 2, HEIGHT / 2, WIDTH / 2, HEIGHT / 2, '#06d6a0'],
  ];
  for (const [x, y, w, h, fill] of blocks) {
    ctx.fillStyle = fill;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(x, y, w, h);
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= WIDTH; x += 28) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, HEIGHT);
    ctx.stroke();
  }
  for (let y = 0; y <= HEIGHT; y += 28) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(WIDTH, y + 0.5);
    ctx.stroke();
  }
}

/** A concentric ripple displacement map (R/G = horizontal/vertical offset). */
function rippleMap(): Texture {
  const c = document.createElement('canvas');
  c.width = WIDTH;
  c.height = HEIGHT;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(WIDTH, HEIGHT);
  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const r = Math.hypot(x - cx, y - cy);
      const a = r * 0.18;
      const i = (y * WIDTH + x) * 4;
      img.data[i] = 128 + 90 * Math.sin(a);
      img.data[i + 1] = 128 + 90 * Math.cos(a);
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return Texture.from(c);
}

async function setupWarp(): Promise<void> {
  const compositor = new Compositor({
    width: WIDTH,
    height: HEIGHT,
    timebase: new Timebase(FPS),
    background: 0x101014,
    preferWebGPU: false,
  });
  await compositor.init();
  document.getElementById('warp-stage')!.append(compositor.view);

  const track = new VisualTrack();
  compositor.addTrack(track);

  const source = new DrawnSource(drawGrid);
  await source.load();
  const clip = new ImageClip(source);
  clip.start = 0;
  clip.end = DURATION;
  fillFrame(clip, source.ss); // HiDPI: SS×-supersampled grid, scaled to fill

  const bulge = new BulgeEffect();
  const persp = new PerspectiveEffect();
  const disp = new DisplacementEffect({ map: rippleMap(), strength: 0 });
  clip.effects.push(bulge, persp, disp);
  track.add(clip);

  const sel = document.getElementById('warp-type') as HTMLSelectElement;
  const amount = bind('warp-amount');
  const amountV = document.getElementById('warp-amount-v')!;
  const playBtn = document.getElementById('warp-play') as HTMLButtonElement;

  /** Reset every warp to identity (so only the selected one is active). */
  function identity(): void {
    bulge.strength.setStatic(0);
    persp.topLeft.setStatic([0, 0]);
    persp.topRight.setStatic([1, 0]);
    persp.bottomRight.setStatic([1, 1]);
    persp.bottomLeft.setStatic([0, 1]);
    disp.strength.setStatic(0);
  }

  /** Apply the selected warp at signed intensity `a ∈ [-1,1]`, then repaint. */
  function applyAmount(a: number): void {
    identity();
    if (sel.value === 'bulge') {
      bulge.strength.setStatic(a); // + bulge, − pinch
    } else if (sel.value === 'perspective') {
      const k = Math.abs(a) * 0.4; // pull the top edge in
      persp.topLeft.setStatic([k, 0]);
      persp.topRight.setStatic([1 - k, 0]);
    } else {
      disp.strength.setStatic(a * 60);
    }
    compositor.renderPreview(0);
  }

  amount.addEventListener('input', () => {
    amountV.textContent = Number(amount.value).toFixed(2);
    applyAmount(Number(amount.value));
  });
  sel.addEventListener('change', () => applyAmount(Number(amount.value)));

  const clock = new RealtimeClock();
  clock.duration = DURATION;
  clock.onTick((t) => {
    const phase = Math.sin((t / clock.duration) * Math.PI * 2); // −1 … 1
    amount.value = String(phase);
    amountV.textContent = phase.toFixed(2);
    applyAmount(phase);
  });
  clock.onEnded(() => clock.play());
  playBtn.addEventListener('click', () => {
    if (clock.paused) {
      clock.play();
      playBtn.textContent = '⏸ Pause';
    } else {
      clock.pause();
      playBtn.textContent = '▶ Play';
    }
  });

  applyAmount(Number(amount.value)); // initial paint
}

async function main(): Promise<void> {
  await setupEffects();
  await setupCrossfade();
  await setupWarp();
  // Readiness flag: lets `scripts/verify-page.cjs` smoke-test that the panels
  // wire up and paint without throwing (pixel correctness is covered by
  // `pnpm verify:effects`). Also reports HiDPI backing sizes for verification.
  const backing = (id: string) => {
    const cv = document.getElementById(id)?.querySelector('canvas');
    return cv ? { w: cv.width, h: cv.height } : null;
  };
  (window as unknown as { __EFFECTS_DEMO_READY__: unknown }).__EFFECTS_DEMO_READY__ = {
    ok: true,
    ss: SS,
    fx: backing('fx-stage'),
    xf: backing('xf-stage'),
    warp: backing('warp-stage'),
  };
}

main().catch((err) => {
  console.error(err);
  document.getElementById('fx-stage')!.textContent = String(err);
  (window as unknown as { __EFFECTS_DEMO_READY__: unknown }).__EFFECTS_DEMO_READY__ = {
    ok: false,
    error: String(err),
  };
});
