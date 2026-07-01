/**
 * Milestone 01 + 02 playground: single-clip preview wired to a RealtimeClock.
 *
 * Demonstrates the core contract #1/#2 loop end-to-end:
 *   clock.onTick(t) → compositor.renderPreview(t) → reconcile + draw.
 *
 * Two sources:
 *   - default: a generated gradient (no decode) — verifies play/pause/seek.
 *   - "Load video": a real file decoded via VideoSource (Mediabunny + WebCodecs)
 *     — verifies the milestone 02 decode path in a WebCodecs-capable browser.
 */
import { Texture } from 'pixi.js';
import {
  Compositor,
  ImageClip,
  RealtimeClock,
  Timebase,
  VideoClip,
  VideoSource,
  VisualClip,
  VisualSource,
  VisualTrack,
  type SourceMetadata,
} from '../src/index';
import { applyCover } from './cover';

const WIDTH = 640;
const HEIGHT = 360;
const FPS = 30;

/** A placeholder source: one generated gradient texture for all times. */
class TestTextureSource extends VisualSource {
  private texture: Texture | null = null;

  async load(): Promise<SourceMetadata> {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 256, 256);
    grad.addColorStop(0, '#ff4d6d');
    grad.addColorStop(1, '#4d9dff');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = 'white';
    ctx.font = 'bold 40px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('SDK', 128, 140);
    this.texture = Texture.from(canvas);
    this.metadata = { width: 256, height: 256, duration: Infinity, hasAudio: false };
    return this.metadata;
  }

  async prepare(): Promise<void> {
    /* already resident after load() */
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

async function main(): Promise<void> {
  const timebase = new Timebase(FPS);
  const compositor = new Compositor({
    width: WIDTH,
    height: HEIGHT,
    timebase,
    background: 0x101014,
    preferWebGPU: true,
  });
  await compositor.init();
  document.getElementById('stage')!.append(compositor.view);

  const clock = new RealtimeClock();
  const track = new VisualTrack();
  compositor.addTrack(track);

  const scrub = document.getElementById('scrub') as HTMLInputElement;
  const playBtn = document.getElementById('play') as HTMLButtonElement;
  const label = document.getElementById('time') as HTMLSpanElement;
  const file = document.getElementById('file') as HTMLInputElement;

  let current: VisualClip | null = null;
  let currentSource: { dispose(): void } | null = null;

  /** Swap the single clip on the track and reset the clock to its duration. */
  function setClip(clip: VisualClip, source: { dispose(): void }, duration: number): void {
    clock.pause();
    if (current) track.remove(current);
    currentSource?.dispose();
    current = clip;
    currentSource = source;
    track.add(clip);
    clock.duration = duration;
    scrub.max = String(duration);
    playBtn.textContent = '▶ Play';
    clock.seek(0);
  }

  // Clips are active on [start, end); at exactly t=duration every clip has ended
  // → a black frame. Like a video player, hold the *render* at the last frame
  // while the clock still reports the full duration (so the scrubber reaches the
  // end). Same pattern as example/multitrack-demo.ts and example/av-player.ts.
  const renderAt = (t: number) => compositor.renderPreview(Math.min(t, clock.duration - 1 / FPS));

  clock.onTick((t) => {
    renderAt(t);
    scrub.value = String(t);
    label.textContent = `${t.toFixed(2)}s / ${clock.duration.toFixed(2)}s`;
  });
  clock.onEnded(() => {
    playBtn.textContent = '▶ Play';
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

  // Default demo: gradient sprite sliding + rotating across the frame.
  {
    const duration = 4;
    const source = new TestTextureSource();
    await source.load();
    const clip = new ImageClip(source);
    clip.start = 0;
    clip.end = duration;
    clip.transform.position.setKeyframes([
      { time: 0, value: [80, HEIGHT / 2] },
      { time: duration, value: [WIDTH - 80, HEIGHT / 2] },
    ]);
    clip.transform.rotation.setKeyframes([
      { time: 0, value: 0 },
      { time: duration, value: Math.PI * 2 },
    ]);
    setClip(clip, source, duration);
  }

  // Real decode path: load a user-picked video via Mediabunny + WebCodecs.
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    const source = new VideoSource({ src: f });
    const meta = await source.load();
    const clip = new VideoClip(source);
    clip.start = 0;
    clip.end = meta.duration;
    applyCover(clip, meta.width, meta.height, WIDTH, HEIGHT); // fill canvas, cover
    setClip(clip, source, meta.duration);
  });
}

main().catch((err) => {
  console.error(err);
  document.getElementById('stage')!.textContent = String(err);
});
