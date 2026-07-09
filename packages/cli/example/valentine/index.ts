import { Compositor, ImageSource, VisualTrack, fonts } from '@sequio/engine';
import { defineComposition } from '@sequio/runtime';
import { DURATION, FONT_SPECS, H, PHOTOS, PINK, S1, S2, S3, S4, S5, S6, S7, W } from './theme';
import type { Media, MediaSet } from './scenes';
import { scene1, scene2, scene3, scene4, scene5, scene6, scene7 } from './scenes';
import { rect } from './kit';

// A vertical (9:16) **Valentine's Day Sale** reel for the CLI, rebuilt from the
// engine's own object graph — echoed headlines, arced words, hollow/outlined
// display type and arch-cropped network photos, all `ShapeClip` / `TextClip` /
// `GroupClip` with keyframed transforms. Same render core either way (contract #3):
//   sequio preview example/valentine/index.ts --watch
//   sequio render  example/valentine/index.ts --out valentine.mp4 --scale 2
//   sequio frame   example/valentine/index.ts --time 4 --out shot.png   # quick check
export default defineComposition(async () => {
  const compositor = new Compositor({ width: W, height: H, fps: 30, background: PINK });
  await compositor.init();

  // Load the condensed grotesque + the script face up front, so every headline
  // measures and paints identically in preview and Node render (contract #3).
  for (const spec of FONT_SPECS) void fonts.loadGoogleFont(spec).catch(() => {});
  await fonts.ready();

  // Fetch the photo set over the network, each pre-cropped to its arch region so
  // the mask fits without distortion. A failed load degrades to a solid tint
  // (the scene still composes) rather than breaking the render.
  const media: MediaSet = {};
  await Promise.all(
    Object.entries(PHOTOS).map(async ([key, p]) => {
      const source = new ImageSource({ src: p.url(880, 1560) });
      try {
        const meta = await source.load();
        media[key] = { source, meta } satisfies Media;
      } catch {
        media[key] = { source: null, meta: null } satisfies Media;
      }
    }),
  );

  // Rose backdrop for the whole reel; scenes cut over it.
  const bg = new VisualTrack();
  bg.zIndex = 0;
  const backdrop = rect(0, 0, W, H, { fill: PINK });
  backdrop.start = 0;
  backdrop.end = DURATION;
  bg.add(backdrop);
  compositor.addTrack(bg);

  // One content lane; the six scenes are hard cuts (non-overlapping windows).
  const content = new VisualTrack();
  content.zIndex = 10;
  content.add(scene1(S1));
  content.add(scene2(S2, media));
  content.add(scene3(S3, media));
  content.add(scene4(S4, media));
  content.add(scene5(S5, media));
  content.add(scene6(S6, media));
  content.add(scene7(S7, media));
  compositor.addTrack(content);

  return { compositor, duration: DURATION };
});
