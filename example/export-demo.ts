/**
 * Interactive playground for milestone 08 — the Exporter.
 *
 * An animated timeline (a gradient A→B crossfade on one track + a rotating,
 * moving square on another) plays in a live preview. Hit **Export** to render it
 * to a real MP4/WebM file with a progress bar; the result plays back inline and
 * can be downloaded. Preview and export share the same render core, so what you
 * see is what you get (contract #3).
 */
import { Texture } from 'pixi.js';
import {
  AudioEngine,
  Compositor,
  CrossfadeTransition,
  Exporter,
  ImageClip,
  RealtimeClock,
  ShapeClip,
  Timebase,
  VisualClip,
  VisualSource,
  VisualTrack,
  type SourceMetadata,
} from '../src/index';

const W = 480;
const H = 270;
const FPS = 30;
const DUR = 3.5;
const SS = globalThis.devicePixelRatio || 1;

/** A canvas-backed source drawn at SS× (HiDPI), scaled back by 1/SS on the clip. */
class DrawnSource extends VisualSource {
  readonly ss = SS;
  private texture: Texture | null = null;
  constructor(private readonly draw: (ctx: CanvasRenderingContext2D) => void) {
    super();
  }
  async load(): Promise<SourceMetadata> {
    const c = document.createElement('canvas');
    c.width = Math.round(W * this.ss);
    c.height = Math.round(H * this.ss);
    const ctx = c.getContext('2d')!;
    ctx.scale(this.ss, this.ss);
    this.draw(ctx);
    this.texture = Texture.from(c);
    this.metadata = { width: c.width, height: c.height, duration: Infinity, hasAudio: false };
    return this.metadata;
  }
  async prepare(): Promise<void> {}
  getTextureAt(): Texture | null {
    return this.texture;
  }
  dispose(): void {
    this.texture?.destroy(true);
    this.texture = null;
    this.metadata = null;
  }
}

function gradient(a: string, b: string, label: string) {
  return (ctx: CanvasRenderingContext2D): void => {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, a);
    g.addColorStop(1, b);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.font = 'bold 160px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, W / 2, H / 2);
  };
}

function fillFrame(clip: VisualClip, ss: number): void {
  clip.transform.anchor.setStatic([0.5, 0.5]);
  clip.transform.position.setStatic([W / 2, H / 2]);
  clip.transform.scale.setStatic([1 / ss, 1 / ss]);
}

async function pickCodec(pref: string): Promise<{ container: 'mp4' | 'webm'; videoCodec: string } | null> {
  const { canEncodeVideo } = await import('mediabunny');
  const mp4 = async () => ((await canEncodeVideo('avc')) ? { container: 'mp4' as const, videoCodec: 'avc' } : null);
  const webm = async () =>
    (await canEncodeVideo('vp9'))
      ? { container: 'webm' as const, videoCodec: 'vp9' }
      : (await canEncodeVideo('vp8'))
        ? { container: 'webm' as const, videoCodec: 'vp8' }
        : null;
  if (pref === 'mp4') return (await mp4()) ?? (await webm());
  if (pref === 'webm') return (await webm()) ?? (await mp4());
  return (await mp4()) ?? (await webm());
}

async function main(): Promise<void> {
  const compositor = new Compositor({
    width: W,
    height: H,
    timebase: new Timebase(FPS),
    background: 0x101014,
    preferWebGPU: false,
  });
  await compositor.init();
  document.getElementById('stage')!.append(compositor.view);

  // Track 1: gradient A → B crossfade over their overlap.
  const bgTrack = new VisualTrack();
  const srcA = new DrawnSource(gradient('#ff5d73', '#ffd166', 'A'));
  const srcB = new DrawnSource(gradient('#2b6cff', '#7c4dff', 'B'));
  await srcA.load();
  await srcB.load();
  const bgA = new ImageClip(srcA);
  bgA.start = 0;
  bgA.end = 2.2;
  fillFrame(bgA, srcA.ss);
  const bgB = new ImageClip(srcB);
  bgB.start = 1.3;
  bgB.end = DUR;
  fillFrame(bgB, srcB.ss);
  bgTrack.add(bgA);
  bgTrack.add(bgB);
  bgTrack.addTransition(new CrossfadeTransition().between(bgA, bgB)); // overlap [1.3, 2.2)

  // Track 2: a rotating square that sweeps across the frame.
  const fgTrack = new VisualTrack();
  fgTrack.zIndex = 1;
  const box = new ShapeClip({ kind: 'rect', width: 96, height: 96, fill: 0x06d6a0 });
  box.start = 0;
  box.end = DUR;
  box.transform.anchor.setStatic([0.5, 0.5]);
  box.transform.position.setKeyframes([
    { time: 0, value: [80, H - 70] },
    { time: DUR, value: [W - 80, 70] },
  ]);
  box.transform.rotation.setKeyframes([
    { time: 0, value: 0 },
    { time: DUR, value: Math.PI * 3 },
  ]);
  fgTrack.add(box);

  compositor.addTrack(bgTrack);
  compositor.addTrack(fgTrack);

  // ── Preview transport ─────────────────────────────────────────────────────
  const clock = new RealtimeClock();
  clock.duration = DUR;
  const scrub = document.getElementById('scrub') as HTMLInputElement;
  const playBtn = document.getElementById('play') as HTMLButtonElement;
  const timeLbl = document.getElementById('time') as HTMLSpanElement;
  scrub.max = String(DUR);

  function paint(t: number): void {
    compositor.renderPreview(t);
    scrub.value = String(t);
    timeLbl.textContent = `${t.toFixed(2)} / ${DUR.toFixed(2)}s`;
  }
  clock.onTick(paint);
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
  scrub.addEventListener('input', () => {
    clock.pause();
    playBtn.textContent = '▶ Play';
    paint(Number(scrub.value));
  });
  paint(0);

  // ── Export ────────────────────────────────────────────────────────────────
  const exportBtn = document.getElementById('export') as HTMLButtonElement;
  const containerSel = document.getElementById('container') as HTMLSelectElement;
  const bar = document.getElementById('bar') as HTMLDivElement;
  const status = document.getElementById('status') as HTMLSpanElement;
  const result = document.getElementById('result') as HTMLDivElement;
  let lastUrl: string | null = null;

  exportBtn.addEventListener('click', async () => {
    clock.pause();
    playBtn.textContent = '▶ Play';
    exportBtn.disabled = true;
    result.innerHTML = '';
    bar.style.width = '0%';

    const codec = await pickCodec(containerSel.value);
    if (!codec) {
      status.textContent = 'No encodable codec in this browser.';
      exportBtn.disabled = false;
      return;
    }
    status.textContent = `Encoding ${codec.container} / ${codec.videoCodec}…`;

    const exporter = new Exporter(compositor, new AudioEngine(new Timebase(FPS)));
    try {
      const t0 = performance.now();
      const blob = await exporter.export(
        { fps: FPS, range: [0, DUR], audio: false, bitrate: 4_000_000, ...codec },
        (p) => {
          bar.style.width = `${(p * 100).toFixed(0)}%`;
        },
      );
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      if (lastUrl) URL.revokeObjectURL(lastUrl);
      lastUrl = URL.createObjectURL(blob);
      status.textContent = `Done — ${(blob.size / 1024).toFixed(0)} KB in ${secs}s (${codec.container}/${codec.videoCodec})`;

      const video = document.createElement('video');
      video.src = lastUrl;
      video.controls = true;
      video.loop = true;
      video.autoplay = true;
      video.muted = true;
      video.style.width = `${W}px`;
      video.style.borderRadius = '10px';
      const dl = document.createElement('a');
      dl.href = lastUrl;
      dl.download = `export.${codec.container}`;
      dl.textContent = `⬇ download export.${codec.container}`;
      dl.style.display = 'block';
      dl.style.marginTop = '8px';
      result.append(video, dl);
    } catch (err) {
      status.textContent = `Export failed: ${String(err)}`;
    } finally {
      exportBtn.disabled = false;
      paint(Number(scrub.value)); // restore the preview frame
    }
  });

  (window as unknown as { __EXPORT_DEMO_READY__: unknown }).__EXPORT_DEMO_READY__ = { ok: true };
}

main().catch((err) => {
  console.error(err);
  document.getElementById('stage')!.textContent = String(err);
  (window as unknown as { __EXPORT_DEMO_READY__: unknown }).__EXPORT_DEMO_READY__ = { ok: false, error: String(err) };
});
