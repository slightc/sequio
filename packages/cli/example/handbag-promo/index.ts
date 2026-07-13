import { Compositor, ImageSource, VisualTrack, fonts } from '@sequio/engine';
import { defineComposition } from '@sequio/runtime';
import { DURATION, FPS, H, INK, W } from './theme';
import { COND_600_DATA_URL, COND_700_DATA_URL, COND_FAMILY, DISPLAY_DATA_URL, DISPLAY_FAMILY } from './font';
import { type Assets, filmGrain, scene1, scene2, scene3, scene4, transitions } from './scenes';
import { type Loaded, loadImg } from './kit';
import { PHOTOS, type Photo, loadPhoto } from './photos';

/**
 * A recreation of a 15s vertical retro fashion spot (a burnt-orange handbag
 * promo), rebuilt from the engine's object graph over **real studio photography**
 * (Pexels, referenced by URL — see `photos.ts`) plus a few procedural design
 * textures (sunburst, stripes, grain, light-leak). Same render core both ways
 * (contract #3):
 *
 *   sequio preview example/handbag-promo/index.ts --watch
 *   sequio render  example/handbag-promo/index.ts --out handbag.mp4 --scale 2
 *
 * Four chapters — FASHIONABLE HANDBAG · MINIMALIST/RETRO-STYLE · LUXURIOUS ·
 * GET IT NOW — with the heavy condensed headline pulsing solid↔hollow, film /
 * polaroid framing, punch-in + push-in camera moves, and torn-paper sunburst +
 * whip-spin cuts. Needs network access (the photos are fetched by URL).
 */

/** A 4×4 grey placeholder so a failed photo fetch degrades instead of crashing. */
const FALLBACK =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAEUlEQVR42mNkYGD4z0AEYBxVSFQFAG3vBABFxvJ+AAAAAElFTkSuQmCC';

export default defineComposition(async () => {
  const compositor = new Compositor({ width: W, height: H, fps: FPS, background: INK });
  await compositor.init();

  // Fonts up front — embedded Anton (display) + Oswald (condensed) subsets.
  await fonts.load({ family: DISPLAY_FAMILY, src: DISPLAY_DATA_URL });
  await fonts.load({ family: COND_FAMILY, src: COND_600_DATA_URL, weight: '600' });
  await fonts.load({ family: COND_FAMILY, src: COND_700_DATA_URL, weight: '700' });

  // A loaded grey stand-in for any photo that fails to fetch.
  const fallback: Loaded = await (async () => {
    const source = new ImageSource({ src: FALLBACK });
    const m = await source.load();
    return { source, w: m.width, h: m.height };
  })();
  const ok = (p: Photo | null): Loaded => p ?? fallback;

  // Real photos (network) + procedural design textures (local files).
  const [hero, modelFull, waist, portrait, ...rest] = await Promise.all([
    loadPhoto(PHOTOS.hero),
    loadPhoto(PHOTOS.modelFull),
    loadPhoto(PHOTOS.waist),
    loadPhoto(PHOTOS.portrait),
    ...PHOTOS.grid.map(loadPhoto),
    ...PHOTOS.bags.map(loadPhoto),
  ]);
  const grid = rest.slice(0, PHOTOS.grid.length).map(ok);
  const bags = rest.slice(PHOTOS.grid.length).map(ok);

  const assets: Assets = {
    sunburst: await loadImg('./assets/sunburst.png'),
    burstTorn: await loadImg('./assets/burst-torn.png'),
    stripes: await loadImg('./assets/stripes.png'),
    grain: await loadImg('./assets/grain.png'),
    leak: await loadImg('./assets/lightleak.png'),
    hero: ok(hero),
    modelFull: ok(modelFull),
    waist: ok(waist),
    portrait: ok(portrait),
    grid,
    bags,
  };

  // Two lanes: the stage (each chapter is one self-contained group, in insertion
  // order) and an overlay for the sunburst/torn-paper + light-leak cuts.
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
  const grainTrack = new VisualTrack();
  grainTrack.zIndex = 30;
  filmGrain(grainTrack, assets, DURATION);

  compositor.addTrack(stage);
  compositor.addTrack(overlay);
  compositor.addTrack(grainTrack);

  return { compositor, duration: DURATION };
});
