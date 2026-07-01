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
import { Container, Sprite, Texture, type Renderer, type RenderTexture, autoDetectRenderer } from 'pixi.js';
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
  RealtimeClock,
  Timebase,
  VisualSource,
  VisualTrack,
  type SourceMetadata,
} from '../src/index';

const WIDTH = 560;
const HEIGHT = 315;
const FPS = 30;
const DURATION = 3; // seconds, for the "Animate" sweep

// ── Panel A: a rich still image to show colour/blur on ──────────────────────

/** A generated poster texture (gradient + shapes + label) for one still clip. */
class PosterSource extends VisualSource {
  private texture: Texture | null = null;

  async load(): Promise<SourceMetadata> {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 288;
    const ctx = c.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 512, 288);
    grad.addColorStop(0, '#ff5d73');
    grad.addColorStop(0.5, '#ffd166');
    grad.addColorStop(1, '#2b6cff');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 288);

    // A few saturated discs so saturation/contrast are obvious.
    const discs: [number, number, number, string][] = [
      [120, 90, 46, '#00e5a8'],
      [400, 70, 38, '#ff3d81'],
      [300, 210, 54, '#7c4dff'],
    ];
    for (const [x, y, r, fill] of discs) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
    }

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.font = 'bold 44px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('EFFECTS', 256, 160);

    this.texture = Texture.from(c);
    this.metadata = { width: 512, height: 288, duration: Infinity, hasAudio: false };
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

  const source = new PosterSource();
  await source.load();
  const clip = new ImageClip(source);
  clip.start = 0;
  clip.end = DURATION;
  clip.transform.anchor.setStatic([0.5, 0.5]);
  clip.transform.position.setStatic([WIDTH / 2, HEIGHT / 2]);
  // Fit the 512×288 poster into the 560×315 frame.
  clip.transform.scale.setStatic([WIDTH / 512, WIDTH / 512]);

  const color = new ColorEffect();
  const blur = new BlurEffect();
  blur.strength.setStatic(0);
  clip.effects.push(color, blur);
  track.add(clip);

  const bright = bind('fx-bright');
  const contrast = bind('fx-contrast');
  const sat = bind('fx-sat');
  const strength = bind('fx-blur');
  const animate = bind('fx-animate');
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
    } else {
      clock.pause();
      applyStatic();
      playBtn.disabled = true;
    }
  }

  animate.addEventListener('change', () => setAnimating(animate.checked));
  playBtn.addEventListener('click', () => {
    if (clock.paused) {
      clock.play();
      playBtn.textContent = '⏸ Pause';
    } else {
      clock.pause();
      playBtn.textContent = '▶ Play';
    }
  });

  applyStatic(); // initial paint
  playBtn.disabled = true;
}

// ── Panel B: crossfade transition ───────────────────────────────────────────

/** A warm/cool gradient texture labelled A / B. */
function gradientTexture(label: string, a: string, b: string): Texture {
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 180;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 320, 180);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 320, 180);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = 'bold 96px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 160, 96);
  return Texture.from(c);
}

async function setupCrossfade(): Promise<void> {
  const renderer = (await autoDetectRenderer({
    width: 320,
    height: 180,
    preference: 'webgl',
    background: 0x101014,
  })) as Renderer;
  document.getElementById('xf-stage')!.append(renderer.canvas as HTMLCanvasElement);

  const texA = gradientTexture('A', '#ff5d73', '#ff9e2c');
  const texB = gradientTexture('B', '#2b6cff', '#7c4dff');
  const transition = new CrossfadeTransition();

  // Display the transition's output texture on the visible canvas.
  const screen = new Container();
  const view = new Sprite();
  screen.addChild(view);

  function drawAt(progress: number): void {
    const out: RenderTexture = transition.render(renderer, texA, texB, progress);
    view.texture = out;
    renderer.render({ container: screen });
  }

  const scrub = bind('xf-progress');
  const readout = document.getElementById('xf-progress-v')!;
  const playBtn = document.getElementById('xf-play') as HTMLButtonElement;

  function paint(p: number): void {
    scrub.value = String(p);
    readout.textContent = p.toFixed(2);
    drawAt(p);
  }

  scrub.addEventListener('input', () => paint(Number(scrub.value)));

  // Ping-pong the progress on play via a looping clock (0→1→0).
  const clock = new RealtimeClock();
  clock.duration = 2;
  clock.onTick((t) => {
    const half = clock.duration / 2;
    const p = t <= half ? t / half : 1 - (t - half) / half;
    paint(p);
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

  paint(0.5); // initial mix
}

// ── Panel C: warps (perspective / bulge / displacement) ──────────────────────

/** A full-frame grid + colour blocks so warps read clearly. */
async function gridBitmap(): Promise<ImageBitmap> {
  const c = document.createElement('canvas');
  c.width = WIDTH;
  c.height = HEIGHT;
  const ctx = c.getContext('2d')!;
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
  return createImageBitmap(c);
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

  const source = new ImageSource({ src: await gridBitmap() });
  await source.load();
  const clip = new ImageClip(source);
  clip.start = 0;
  clip.end = DURATION;
  clip.transform.anchor.setStatic([0.5, 0.5]);
  clip.transform.position.setStatic([WIDTH / 2, HEIGHT / 2]); // fills the frame at scale 1

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
  // Readiness flag: lets `scripts/verify-page.cjs` smoke-test that both panels
  // wire up and paint without throwing (pixel correctness is covered by
  // `pnpm verify:effects`).
  (window as unknown as { __EFFECTS_DEMO_READY__: unknown }).__EFFECTS_DEMO_READY__ = { ok: true };
}

main().catch((err) => {
  console.error(err);
  document.getElementById('fx-stage')!.textContent = String(err);
  (window as unknown as { __EFFECTS_DEMO_READY__: unknown }).__EFFECTS_DEMO_READY__ = {
    ok: false,
    error: String(err),
  };
});
