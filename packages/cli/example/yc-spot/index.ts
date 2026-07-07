import { Compositor, VisualTrack, fonts } from '@sequio/engine';
import { defineComposition } from '@sequio/runtime';
import { DURATION, FONT_SPECS, H, PAPER, W } from './theme';
import { rect } from './kit';
import { act1, act2, act3, act4 } from './scenes';

// An editorial motion-graphic study for the CLI — a four-act Y Combinator spot
// rebuilt from the engine's own object graph (shapes, text, groups + keyframed
// transforms/opacity). Run it either way, same render core (contract #3):
//   sequio preview example/index.ts --watch
//   sequio render  example/index.ts --out yc.mp4 --scale 2
export default defineComposition(async () => {
  const compositor = new Compositor({ width: W, height: H, fps: 30, background: PAPER });
  await compositor.init();

  // Load the display serif, caption sans and heavy grotesque up front. Failures
  // degrade to the fallback stacks in `theme.ts` rather than breaking the build,
  // and the same `fonts.*` calls feed both the browser preview (document.fonts)
  // and the Node render (@napi-rs/canvas, via Route B's font bridge) — contract #3.
  for (const spec of FONT_SPECS) void fonts.loadGoogleFont(spec).catch(() => {});
  await fonts.ready();

  // Warm-paper backdrop for the whole piece; the acts cut over it.
  const bg = new VisualTrack();
  bg.zIndex = 0;
  const paper = rect(W, H, PAPER, { anchor: [0, 0] });
  paper.transform.position.setStatic([0, 0]);
  paper.start = 0;
  paper.end = DURATION;
  bg.add(paper);
  compositor.addTrack(bg);

  // One content lane; within an act, insertion order is the z-order.
  const content = new VisualTrack();
  content.zIndex = 10;
  act1(content);
  act2(content);
  act3(content);
  act4(content);
  compositor.addTrack(content);

  return { compositor, duration: DURATION };
});
