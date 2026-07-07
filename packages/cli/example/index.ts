import { Compositor, ShapeClip, TextClip, VisualTrack, fonts, gsapClipAnimator } from '@sequio/engine';
import { defineComposition } from '@sequio/runtime';
import gsap from 'gsap';
import { W, H, DURATION, ball } from './scene';
import { POPPINS_FAMILY, POPPINS_DATA_URL } from './font';

// A tiny sample composition for the CLI:
//   sequio preview example/index.ts --watch
//   sequio render  example/index.ts --out demo.mp4
// Its default export is a defineComposition(builder) — exactly like the demos.
export default defineComposition(async () => {
  const compositor = new Compositor({ width: W, height: H, fps: 30, background: 0x0b0b0e });
  await compositor.init();

  // Load the title font (embedded as a data: URL — see ./font). The same call
  // feeds the browser preview (document.fonts) and the Node render
  // (@napi-rs/canvas, via Route B's font bridge), so the title renders with the
  // identical typeface in both — a system-default family would otherwise resolve
  // to different fonts per platform/renderer.
  await fonts.load({ family: POPPINS_FAMILY, src: POPPINS_DATA_URL });

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
  const title = new TextClip({ text: 'sequio', fontFamily: POPPINS_FAMILY, fontSize: 56, fill: 0xffffff });
  title.start = 0;
  title.end = DURATION;
  title.transform.anchor.setStatic([0.5, 0.5]);
  title.transform.position.setStatic([W / 2, 72]);
  // Drive the title's entrance with a real GSAP timeline. `gsap` is resolved by
  // the CLI (which injects it as a runtime external) — no per-project install —
  // and the engine's binding keeps it deterministic by seeking a paused timeline.
  title.animator = gsapClipAnimator(gsap, (tl, o) => {
    tl.from(o, { y: -60, alpha: 0, duration: 0.8, ease: 'back.out(1.7)' });
  });
  text.add(title);
  compositor.addTrack(text);

  return { compositor, duration: DURATION };
});
