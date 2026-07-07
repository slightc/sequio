import { Compositor, ShapeClip, TextClip, VisualTrack } from '@sequio/engine';
import { defineComposition } from '@sequio/runtime';
import { W, H, DURATION, ball } from './scene';

// A tiny sample composition for the CLI:
//   sequio preview example/index.ts --watch
//   sequio render  example/index.ts --out demo.mp4
// Its default export is a defineComposition(builder) — exactly like the demos.
export default defineComposition(async () => {
  const compositor = new Compositor({ width: W, height: H, fps: 30, background: 0x0b0b0e });
  await compositor.init();

  const bg = new VisualTrack();
  const backdrop = new ShapeClip({ kind: 'rect', width: W, height: H, fill: 0x0f172a });
  backdrop.start = 0;
  backdrop.end = DURATION;
  backdrop.transform.anchor.setStatic([0, 0]);
  backdrop.transform.position.setStatic([0, 0]);
  bg.add(backdrop);
  compositor.addTrack(bg);

  const balls = new VisualTrack();
  balls.zIndex = 1;
  balls.add(ball(0x38bdf8, 180));
  balls.add(ball(0xf472b6, 240));
  compositor.addTrack(balls);

  const text = new VisualTrack();
  text.zIndex = 2;
  const title = new TextClip({ text: 'sequio', fontSize: 56, fill: 0xffffff });
  title.start = 0;
  title.end = DURATION;
  title.transform.anchor.setStatic([0.5, 0.5]);
  title.transform.position.setStatic([W / 2, 72]);
  text.add(title);
  compositor.addTrack(text);

  return { compositor, duration: DURATION };
});
