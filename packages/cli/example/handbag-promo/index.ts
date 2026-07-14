import { AudioClip, AudioSource, Compositor, ImageSource, VideoSource, VisualTrack, fonts } from '@sequio/engine';
import { defineComposition, loadAsset } from '@sequio/runtime';
import { DURATION, FPS, H, INK, W } from './theme';
import { type Assets, type VidLoaded, filmGrain, scene1, scene2, scene3, scene4, transitions } from './scenes';
import { type Loaded, loadImg } from './kit';
import { PHOTOS, type Photo, loadPhoto } from './photos';

/**
 * A recreation of a 15s vertical retro fashion spot (a burnt-orange handbag
 * promo), rebuilt from the engine's object graph over **real footage** — short
 * local video clips for the moving hero shots (chapters 1 & 4) plus studio
 * photography (Pexels, by URL — see `photos.ts`) and a few procedural design
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

/**
 * A 2×2 studio-grey placeholder so a failed photo fetch degrades instead of
 * crashing. This exact PNG is verified to decode via the browser's
 * `createImageBitmap` (the preview path) — an earlier base64 here decoded in
 * Node but was rejected by Chrome ("source image could not be decoded"), which
 * silently broke `sequio preview` while `sequio render` still worked.
 */
const FALLBACK =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGPcvGYZAwMDEwMDAwMDAwAYcwIJ/XiVjQAAAABJRU5ErkJggg==';

export default defineComposition(async () => {
  const compositor = new Compositor({ width: W, height: H, fps: FPS, background: INK });
  await compositor.init();

  // Fonts up front — Anton (display) + Oswald (condensed) from Google Fonts. Both
  // the browser preview and the Node render fetch the woff2 over the network (the
  // same call feeds document.fonts and Route B's @napi-rs/canvas bridge); failures
  // degrade to the fallback stacks in theme.ts. Needs network access.
  await fonts.loadGoogleFont({ family: 'Anton', weights: [400] });
  await fonts.loadGoogleFont({ family: 'Oswald', weights: [600, 700] });
  await fonts.ready();

  // A loaded grey stand-in for any photo that fails to fetch.
  const fallback: Loaded = await (async () => {
    const source = new ImageSource({ src: FALLBACK });
    const m = await source.load();
    return { source, w: m.width, h: m.height };
  })();
  const ok = (p: Photo | null): Loaded => p ?? fallback;

  // The moving hero shots — short local video clips (transcoded from free Pexels
  // footage of the same burnt-orange shoot). Loaded once; each plays over its
  // chapter so the hand / bag / model keep moving rather than sitting as a still.
  const loadVid = async (path: string): Promise<VidLoaded> => {
    const source = new VideoSource({ src: await loadAsset(path) });
    const m = await source.load();
    return { source, w: m.width, h: m.height };
  };

  // Real photos (network) + procedural design textures (local files).
  const [modelFull, portrait, ...rest] = await Promise.all([
    loadPhoto(PHOTOS.modelFull),
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
    heroVid: await loadVid('./assets/clip-model.mp4'),
    waistVid: await loadVid('./assets/clip-hold.mp4'),
    modelFull: ok(modelFull),
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

  // Soundtrack — an original upbeat retro-house instrumental (122 BPM), scheduled
  // onto the compositor's own audio engine. It fades in at the top and out under
  // the last beat; `sequio render` muxes the compositor's mix automatically.
  // Opus-in-WebM (royalty-free) so the browser preview decodes it via WebCodecs on
  // ANY browser — AAC/m4a only decodes on Chrome/Edge builds that ship the licensed
  // AAC decoder (open-source Chromium / Firefox throw a WebCodecs "Decoding error").
  const musicSource = new AudioSource({ src: await loadAsset('./assets/music.webm') });
  await musicSource.load();
  const music = new AudioClip();
  music.start = 0;
  music.end = DURATION;
  music.fadeIn = 0.3;
  music.fadeOut = 1.2;
  music.gain.setStatic(0.72);
  compositor.audioEngine.schedule(music, musicSource);

  return { compositor, duration: DURATION };
});
