import { Compositor, VisualTrack, fonts } from '@sequio/engine';
import { defineComposition } from '@sequio/runtime';
import { DURATION, FPS, H, INK, W } from './theme';
import { COND_600_DATA_URL, COND_700_DATA_URL, COND_FAMILY, DISPLAY_DATA_URL, DISPLAY_FAMILY } from './font';
import { type Assets, filmGrain, scene1, scene2, scene3, scene4, transitions } from './scenes';
import { loadImg } from './kit';

/**
 * A recreation of a 15s vertical retro fashion spot (a burnt-orange handbag
 * promo), rebuilt entirely from the engine's object graph over original,
 * procedurally-drawn illustration panels (see `assets/`). Same render core both
 * ways (contract #3):
 *
 *   sequio preview example/handbag-promo/index.ts --watch
 *   sequio render  example/handbag-promo/index.ts --out handbag.mp4 --scale 2
 *
 * Four chapters — FASHIONABLE HANDBAG · MINIMALIST/RETRO-STYLE · LUXURIOUS ·
 * GET IT NOW — each with the heavy condensed headline pulsing solid↔hollow,
 * film/polaroid framing, sunburst backdrops and light-leak flashes over the cuts.
 */
export default defineComposition(async () => {
  const compositor = new Compositor({ width: W, height: H, fps: FPS, background: INK });
  await compositor.init();

  // Fonts up front — the embedded Anton (display) + Oswald (condensed) subsets,
  // registered for both the browser preview (FontFace) and the Node render
  // (@napi-rs/canvas, via Route B's font bridge) so glyphs match in both.
  await fonts.load({ family: DISPLAY_FAMILY, src: DISPLAY_DATA_URL });
  await fonts.load({ family: COND_FAMILY, src: COND_600_DATA_URL, weight: '600' });
  await fonts.load({ family: COND_FAMILY, src: COND_700_DATA_URL, weight: '700' });

  // Original illustration panels drawn in the orange retro palette (no
  // copyrighted imagery — these are self-contained stand-ins).
  const assets: Assets = {
    sunburst: await loadImg('./assets/sunburst.png'),
    bagHero: await loadImg('./assets/bag-hero.png'),
    model: await loadImg('./assets/model.png'),
    bags: [
      await loadImg('./assets/bag1.png'),
      await loadImg('./assets/bag2.png'),
      await loadImg('./assets/bag3.png'),
      await loadImg('./assets/bag4.png'),
    ],
    leak: await loadImg('./assets/lightleak.png'),
    stripes: await loadImg('./assets/stripes.png'),
    grain: await loadImg('./assets/grain.png'),
  };

  // Two lanes: the stage (each chapter is one self-contained group, in insertion
  // order) and an overlay for the light-leak flashes + sunburst iris that cover
  // the cuts.
  const stage = new VisualTrack();
  stage.zIndex = 10;
  const overlay = new VisualTrack();
  overlay.zIndex = 20;

  scene1(stage, assets);
  scene2(stage, assets);
  scene3(stage, assets);
  scene4(stage, assets);
  transitions(overlay, assets);

  // Film-grain wash on top of everything.
  const grain = new VisualTrack();
  grain.zIndex = 30;
  filmGrain(grain, assets, DURATION);

  compositor.addTrack(stage);
  compositor.addTrack(overlay);
  compositor.addTrack(grain);

  return { compositor, duration: DURATION };
});
