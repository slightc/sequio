import { Compositor, VisualTrack, fonts } from '@sequio/engine';
import { defineComposition } from '@sequio/runtime';
import { CREAM, DURATION, FONT_SPECS, FPS, H, W } from './theme';
import { buildLookbook } from './scenes';

/**
 * A 9:16 "2023 Summer Collection" fashion-lookbook promo for the CLI, rebuilt
 * from the engine's own object graph — framed photos (`GroupClip` = mat +
 * `ImageClip`), accent bands and a vector globe (`ShapeClip`), and every title a
 * `TextClip`, including an arced wordmark stitched glyph-by-glyph. Photos are
 * public Unsplash URLs (referenced, never committed — like the `media-network`
 * demo); motion is keyframes + seek-driven GSAP. Same render core either way
 * (contract #3):
 *
 *   sequio preview example/summer-lookbook/index.ts --watch
 *   sequio render  example/summer-lookbook/index.ts --out summer.mp4 --scale 2
 *
 * `render` / `frame` need a WebGPU host (a GPU or the Mesa lavapipe driver) and,
 * like `media-network`, network access to pull the imagery and web fonts.
 */
export default defineComposition(async () => {
  const compositor = new Compositor({ width: W, height: H, fps: FPS, background: CREAM });
  await compositor.init();

  // Load the four cuts up front (one weight each). Failures degrade to the
  // fallback stacks in `theme.ts`; the same calls feed the browser preview
  // (document.fonts) and the Node render (@napi-rs/canvas via Route B).
  for (const spec of FONT_SPECS) void fonts.loadGoogleFont(spec).catch(() => {});
  await fonts.ready();

  const bg = new VisualTrack();
  bg.zIndex = 0;
  const content = new VisualTrack();
  content.zIndex = 10;
  const overlay = new VisualTrack();
  overlay.zIndex = 20;

  await buildLookbook(bg, content, overlay);

  compositor.addTrack(bg);
  compositor.addTrack(content);
  compositor.addTrack(overlay);

  return { compositor, duration: DURATION };
});
