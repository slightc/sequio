/**
 * Milestone 01 playground: single-clip preview wired to a RealtimeClock.
 *
 * Demonstrates the core contract #1/#2 loop end-to-end:
 *   clock.onTick(t) → compositor.renderPreview(t) → reconcile + draw.
 *
 * The SDK's real decoders (VideoSource / ImageSource) land in later
 * milestones, so this example supplies its own placeholder VisualSource that
 * returns a generated gradient texture — enough to verify play / pause / seek
 * and auto-stop on the screen.
 */
import { Texture } from 'pixi.js';
import {
  Compositor,
  ImageClip,
  RealtimeClock,
  Timebase,
  VisualSource,
  VisualTrack,
  type SourceMetadata,
} from '../src/index';

const WIDTH = 640;
const HEIGHT = 360;
const FPS = 30;
const DURATION = 4; // seconds

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

  // Build the object graph: one image clip that slides across the frame so the
  // motion makes the clock visibly drive render(t).
  const source = new TestTextureSource();
  await source.load();

  const clip = new ImageClip(source);
  clip.start = 0;
  clip.end = DURATION;
  clip.transform.position.setKeyframes([
    { time: 0, value: [80, HEIGHT / 2] },
    { time: DURATION, value: [WIDTH - 80, HEIGHT / 2] },
  ]);
  clip.transform.rotation.setKeyframes([
    { time: 0, value: 0 },
    { time: DURATION, value: Math.PI * 2 },
  ]);

  const track = new VisualTrack();
  track.add(clip);
  compositor.addTrack(track);

  // Drive preview off a realtime clock. Auto-stops at DURATION (contract:
  // video-element-style play/pause/seek + ended).
  const clock = new RealtimeClock();
  clock.duration = DURATION;

  const scrub = document.getElementById('scrub') as HTMLInputElement;
  const playBtn = document.getElementById('play') as HTMLButtonElement;
  const label = document.getElementById('time') as HTMLSpanElement;

  clock.onTick((t) => {
    compositor.renderPreview(t);
    scrub.value = String(t);
    label.textContent = `${t.toFixed(2)}s / ${DURATION}s`;
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

  // Paint the first frame.
  clock.seek(0);
}

main().catch((err) => {
  console.error(err);
  document.getElementById('stage')!.textContent = String(err);
});
