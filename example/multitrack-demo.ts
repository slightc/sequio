/**
 * Interactive multi-track playground (milestone 04).
 *
 * Live canvas + per-track controls (enable / opacity / blendMode / z-order) and
 * a transport (play / pause / seek / loop). One track carries an animated,
 * rotating sprite so playback visibly drives render(t); another can be swapped
 * for a decoded video (object-fit: cover). Mutations don't auto-repaint (SDK
 * contract #5), so every control change calls renderPreview explicitly.
 */
import { Texture } from 'pixi.js';
import type { BLEND_MODES } from 'pixi.js';
import {
  Compositor,
  ImageClip,
  RealtimeClock,
  Timebase,
  VisualClip,
  VisualSource,
  VisualTrack,
  type SourceMetadata,
} from '../src/index';

const W = 480;
const H = 270;
const FPS = 30;
const DURATION = 6;

const BLEND_MODES_LIST: BLEND_MODES[] = [
  'normal',
  'add',
  'multiply',
  'screen',
  'overlay',
  'difference',
  'lighten',
  'darken',
];

/** A source wrapping a single, pre-generated texture. */
class CanvasSource extends VisualSource {
  private texture: Texture | null = null;
  constructor(private readonly draw: (ctx: CanvasRenderingContext2D) => void, private readonly w = W, private readonly h = H) {
    super();
  }
  async load(): Promise<SourceMetadata> {
    const canvas = document.createElement('canvas');
    canvas.width = this.w;
    canvas.height = this.h;
    this.draw(canvas.getContext('2d')!);
    this.texture = Texture.from(canvas);
    this.metadata = { width: this.w, height: this.h, duration: Infinity, hasAudio: false };
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

interface TrackDef {
  name: string;
  track: VisualTrack;
  clip: VisualClip;
  source: VisualSource;
}

async function main(): Promise<void> {
  const compositor = new Compositor({
    width: W,
    height: H,
    timebase: new Timebase(FPS),
    background: 0x0b0b0e,
    preferWebGPU: true,
  });
  await compositor.init();
  document.getElementById('stage')!.append(compositor.view);

  const clock = new RealtimeClock();
  clock.duration = DURATION;
  const render = () => compositor.renderPreview(clock.currentTime);

  // ── Build three tracks, bottom → top ──────────────────────────────────────
  const bgSource = new CanvasSource((ctx) => {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#ff8a00');
    g.addColorStop(1, '#2b6cff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  });
  const circleSource = new CanvasSource((ctx) => {
    ctx.clearRect(0, 0, 120, 120);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(60, 60, 52, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e11d48';
    ctx.fillRect(52, 4, 16, 112);
  }, 120, 120);
  const tintSource = new CanvasSource((ctx) => {
    ctx.fillStyle = '#12b3a8';
    ctx.fillRect(0, 0, W, H);
  });
  await Promise.all([bgSource.load(), circleSource.load(), tintSource.load()]);

  const defs: TrackDef[] = [];

  const bgTrack = new VisualTrack();
  bgTrack.zIndex = 0;
  const bgClip = new ImageClip(bgSource);
  bgClip.start = 0;
  bgClip.end = DURATION;
  bgClip.transform.anchor.setStatic([0, 0]);
  bgTrack.add(bgClip);
  defs.push({ name: 'Background (gradient)', track: bgTrack, clip: bgClip, source: bgSource });

  const circleTrack = new VisualTrack();
  circleTrack.zIndex = 1;
  const circleClip = new ImageClip(circleSource);
  circleClip.start = 0;
  circleClip.end = DURATION;
  circleClip.transform.position.setKeyframes([
    { time: 0, value: [70, H / 2] },
    { time: DURATION, value: [W - 70, H / 2] },
  ]);
  circleClip.transform.rotation.setKeyframes([
    { time: 0, value: 0 },
    { time: DURATION, value: Math.PI * 2 },
  ]);
  circleTrack.add(circleClip);
  defs.push({ name: 'Circle (animated)', track: circleTrack, clip: circleClip, source: circleSource });

  const tintTrack = new VisualTrack();
  tintTrack.zIndex = 2;
  const tintClip = new ImageClip(tintSource);
  tintClip.start = 0;
  tintClip.end = DURATION;
  tintClip.transform.anchor.setStatic([0, 0]);
  tintClip.opacity.setStatic(0.4);
  tintClip.blendMode = 'screen';
  tintTrack.add(tintClip);
  defs.push({ name: 'Tint (screen 40%)', track: tintTrack, clip: tintClip, source: tintSource });

  for (const d of defs) compositor.addTrack(d.track);

  // ── Transport ─────────────────────────────────────────────────────────────
  const playBtn = document.getElementById('play') as HTMLButtonElement;
  const scrub = document.getElementById('scrub') as HTMLInputElement;
  const timeLabel = document.getElementById('time') as HTMLSpanElement;
  const loopBox = document.getElementById('loop') as HTMLInputElement;
  scrub.max = String(DURATION);

  clock.onTick((t) => {
    compositor.renderPreview(t);
    scrub.value = String(t);
    timeLabel.textContent = `${t.toFixed(2)} / ${DURATION.toFixed(2)}s`;
  });
  clock.onEnded(() => {
    if (loopBox.checked) {
      clock.play(); // restarts from 0
    } else {
      playBtn.textContent = '▶ Play';
    }
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
  scrub.addEventListener('input', () => {
    clock.pause();
    playBtn.textContent = '▶ Play';
    clock.seek(Number(scrub.value));
  });

  // ── Per-track controls ─────────────────────────────────────────────────────
  const panel = document.getElementById('tracks')!;
  // Render top-of-stack first so the UI order matches what's on top.
  [...defs].reverse().forEach((d) => panel.append(buildTrackCard(d, render, compositor)));

  clock.seek(0); // paint first frame
}

function buildTrackCard(d: TrackDef, render: () => void, compositor: Compositor): HTMLElement {
  const card = document.createElement('div');
  card.className = 'card';

  const head = document.createElement('div');
  head.className = 'card-head';
  const enabled = checkbox(d.track.enabled, (on) => {
    d.track.enabled = on;
    render();
  });
  const title = document.createElement('span');
  title.className = 'card-title';
  title.textContent = d.name;
  head.append(enabled, title);

  const opacity = labeledRange('opacity', 0, 1, 0.01, (d.clip as ImageClip).opacity.valueAt(0), (v) => {
    (d.clip as ImageClip).opacity.setStatic(v);
    render();
  });

  const blend = labeledSelect('blend', BLEND_MODES_LIST, (d.clip as ImageClip).blendMode, (v) => {
    (d.clip as ImageClip).blendMode = v as BLEND_MODES;
    render();
  });

  const z = labeledNumber('z-index', d.track.zIndex, (v) => {
    compositor.moveTrack(d.track, v);
    render();
  });

  card.append(head, opacity, blend, z);
  return card;
}

// ── tiny DOM helpers ─────────────────────────────────────────────────────────
function checkbox(checked: boolean, on: (v: boolean) => void): HTMLInputElement {
  const el = document.createElement('input');
  el.type = 'checkbox';
  el.checked = checked;
  el.addEventListener('change', () => on(el.checked));
  return el;
}

function labeledRange(label: string, min: number, max: number, step: number, value: number, on: (v: number) => void): HTMLElement {
  const row = fieldRow(label);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  const out = document.createElement('span');
  out.className = 'val';
  out.textContent = value.toFixed(2);
  input.addEventListener('input', () => {
    out.textContent = Number(input.value).toFixed(2);
    on(Number(input.value));
  });
  row.append(input, out);
  return row;
}

function labeledSelect(label: string, options: string[], value: string, on: (v: string) => void): HTMLElement {
  const row = fieldRow(label);
  const sel = document.createElement('select');
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o;
    opt.textContent = o;
    if (o === value) opt.selected = true;
    sel.append(opt);
  }
  sel.addEventListener('change', () => on(sel.value));
  row.append(sel);
  return row;
}

function labeledNumber(label: string, value: number, on: (v: number) => void): HTMLElement {
  const row = fieldRow(label);
  const input = document.createElement('input');
  input.type = 'number';
  input.value = String(value);
  input.step = '1';
  input.addEventListener('change', () => on(Number(input.value)));
  row.append(input);
  return row;
}

function fieldRow(label: string): HTMLElement {
  const row = document.createElement('label');
  row.className = 'field';
  const l = document.createElement('span');
  l.className = 'lbl';
  l.textContent = label;
  row.append(l);
  return row;
}

main().catch((err) => {
  console.error(err);
  const stage = document.getElementById('stage');
  if (stage) stage.textContent = String(err);
});
