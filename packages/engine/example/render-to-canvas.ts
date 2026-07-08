/**
 * Minimal, self-contained "render to a canvas" example (the one in the engine
 * README, runnable). Builds a graph — a moving, rotating box plus a title —
 * mounts the compositor's canvas, and drives a RealtimeClock so every tick
 * renders one frame. No external assets, no network: just the engine.
 *
 * `pnpm dev:engine` then open /example/render-to-canvas.html.
 */
import { Compositor, RealtimeClock, ShapeClip, TextClip, Timebase, VisualTrack } from '../src/index';

const WIDTH = 1280;
const HEIGHT = 720;
const DURATION = 3; // seconds

async function main(): Promise<void> {
  // 1. Create the compositor and its GPU renderer, then mount the <canvas>.
  const compositor = new Compositor({
    width: WIDTH,
    height: HEIGHT,
    timebase: new Timebase(30), // 30 fps
    background: 0x0b0b0e,
    preferWebGPU: false, // WebGL: reliable everywhere (incl. software rasterizers)
  });
  await compositor.init(); // WebGPU preferred, WebGL fallback
  document.getElementById('stage')!.append(compositor.view); // compositor.view is the output canvas

  // 2. Build the object graph: a track carrying a moving box and a title.
  const track = new VisualTrack();

  const box = new ShapeClip({ kind: 'rect', width: 160, height: 160, fill: 0x2b6cff });
  box.start = 0;
  box.end = DURATION;
  box.transform.anchor.setStatic([0.5, 0.5]);
  // Keyframed motion + a full rotation over the clip's life.
  box.transform.position.setKeyframes([
    { time: 0, value: [220, HEIGHT / 2] },
    { time: DURATION, value: [WIDTH - 220, HEIGHT / 2] },
  ]);
  box.transform.rotation.setKeyframes([
    { time: 0, value: 0 },
    { time: DURATION, value: Math.PI * 2 },
  ]);
  track.add(box);

  const title = new TextClip({ text: 'sequio', fontSize: 120, fill: 0xffffff });
  title.start = 0;
  title.end = DURATION;
  title.transform.anchor.setStatic([0.5, 0.5]);
  title.transform.position.setStatic([WIDTH / 2, HEIGHT - 120]);
  track.add(title);

  compositor.addTrack(track);

  // 3. Drive a clock; every tick renders that frame to the canvas.
  const clock = new RealtimeClock();
  clock.duration = DURATION;
  clock.onTick((t) => compositor.renderPreview(t)); // best-effort prepare + render

  // Wire a tiny transport so the example is also interactive.
  const playBtn = document.getElementById('play') as HTMLButtonElement;
  clock.onEnded(() => (playBtn.textContent = '▶ Replay'));
  playBtn.addEventListener('click', () => {
    if (clock.paused) {
      if (clock.ended) clock.seek(0); // replay from the start
      clock.play();
      playBtn.textContent = '⏸ Pause';
    } else {
      clock.pause();
      playBtn.textContent = '▶ Play';
    }
  });

  clock.seek(0); // paint the first frame immediately
  clock.play(); // animate to the end (holds the last frame there)
  playBtn.textContent = '⏸ Pause';
}

main().catch((err) => {
  console.error(err);
  const stage = document.getElementById('stage');
  if (stage) stage.textContent = String(err);
});
