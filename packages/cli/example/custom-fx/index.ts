import {
  Compositor,
  ShapeClip,
  TextClip,
  VisualClip,
  VisualTrack,
  easeInOutCubic,
  easeOutCubic,
  fonts,
} from '@sequio/engine';
import { defineComposition } from '@sequio/runtime';
import { EasedCrossfade, PopEffect } from './fx';

// A display family loaded from Google Fonts (same pattern as the other CLI
// showcases). If the fetch fails the text degrades to the fallback stack rather
// than breaking the render, and the same call feeds both the browser preview
// (document.fonts) and the Node render (@napi-rs/canvas, via Route B).
const FONT = "'Poppins', 'Inter', system-ui, sans-serif";

// A CLI showcase for *authoring your own* effect + transition (see ./fx.ts) and
// choreographing them by hand. Four full-bleed colour "cards" dissolve into one
// another with a custom `EasedCrossfade`, and each incoming card carries a custom
// `PopEffect` that flashes on entry — a bespoke "effect × transition" beat.
//   sequio preview example/custom-fx/index.ts --watch
//   sequio render  example/custom-fx/index.ts --out custom-fx.mp4
const W = 1280;
const H = 720;
const FPS = 30;

// Timeline geometry: each card holds ~2s, consecutive cards overlap by `OVERLAP`
// seconds, and that overlap *is* the transition window (the engine derives it
// live from the two clips — see Transition.windowAt).
const HOLD = 2.0;
const OVERLAP = 0.8;
const CARDS = [
  { fill: 0x1b1035, ink: 0xf5c8ff, kicker: 'bring your own', title: 'CUSTOM FX' },
  { fill: 0x06313a, ink: 0x8ef0d8, kicker: 'a ColorEffect subclass', title: 'PopEffect' },
  { fill: 0x3a0a1e, ink: 0xff9ab4, kicker: 'a CrossfadeTransition subclass', title: 'EasedCrossfade' },
  { fill: 0x0c0c12, ink: 0xffffff, kicker: 'preview · frame · render', title: 'sequio' },
];

// Per-card timeline window. Card i lands every HOLD seconds and runs long enough
// to overlap the next one by OVERLAP — that overlap is the transition window.
function windowFor(i: number): { start: number; end: number } {
  const start = i * HOLD;
  return { start, end: start + HOLD + OVERLAP };
}

const DURATION = windowFor(CARDS.length - 1).end;

/** A full-bleed colour card with a `PopEffect` that flashes as it enters. */
function card(fill: number, w: { start: number; end: number }): ShapeClip {
  const clip = new ShapeClip({ kind: 'rect', width: W, height: H, fill });
  clip.start = w.start;
  clip.end = w.end;
  clip.transform.anchor.setStatic([0, 0]);
  clip.transform.position.setStatic([0, 0]);

  // Author the custom effect's single `pop` knob on the global timeline: rise to
  // a peak just after the card lands, then settle. Because updateAt(t) sees
  // global time, the flash lines up with the transition that reveals the card.
  const pop = new PopEffect();
  pop.pop.setKeyframes([
    { time: w.start, value: 0 },
    { time: w.start + 0.35, value: 1, easing: easeOutCubic },
    { time: w.start + 1.1, value: 0, easing: easeInOutCubic },
  ]);
  clip.effects.push(pop);
  return clip;
}

/** A card's title + kicker, sliding up and fading in over its solo window. */
function label(text: string, kicker: string, ink: number, solo: { start: number; end: number }): VisualClip[] {
  const cy = H / 2;
  const title = new TextClip({ text, fontFamily: FONT, fontSize: 92, fontWeight: '800', fill: ink, align: 'center' });
  const sub = new TextClip({ text: kicker, fontFamily: FONT, fontSize: 24, fontWeight: '600', fill: 0xffffff, align: 'center' });

  for (const [clip, y, from] of [
    [title, cy - 8, 44],
    [sub, cy + 62, 24],
  ] as const) {
    clip.start = solo.start;
    clip.end = solo.end;
    clip.transform.anchor.setStatic([0.5, 0.5]);
    clip.transform.position.setKeyframes([
      { time: solo.start, value: [W / 2, y + from] },
      { time: solo.start + 0.5, value: [W / 2, y], easing: easeOutCubic },
    ]);
    clip.opacity.setKeyframes([
      { time: solo.start, value: 0 },
      { time: solo.start + 0.3, value: 1, easing: easeOutCubic },
      { time: solo.end - 0.25, value: 1 },
      { time: solo.end, value: 0 },
    ]);
  }
  // The kicker is dimmer than the title.
  sub.opacity.setKeyframes([
    { time: solo.start, value: 0 },
    { time: solo.start + 0.3, value: 0.7, easing: easeOutCubic },
    { time: solo.end - 0.25, value: 0.7 },
    { time: solo.end, value: 0 },
  ]);
  return [title, sub];
}

export default defineComposition(async () => {
  const compositor = new Compositor({ width: W, height: H, fps: FPS, background: 0x05050a });
  await compositor.init();

  void fonts.loadGoogleFont({ family: 'Poppins', weights: [600, 800] }).catch(() => {});
  await fonts.ready();

  const windows = CARDS.map((_, i) => windowFor(i));

  // The cards all live on ONE track: transitions blend consecutive clips on the
  // same lane over their overlap. Each `EasedCrossfade` is bound `from → to`.
  const stage = new VisualTrack();
  stage.zIndex = 0;
  const cards = CARDS.map((c, i) => card(c.fill, windows[i]));
  cards.forEach((c) => stage.add(c));
  for (let i = 0; i < cards.length - 1; i++) {
    stage.addTransition(new EasedCrossfade(Math.round(OVERLAP * FPS)).between(cards[i], cards[i + 1]));
  }
  compositor.addTrack(stage);

  // Titles sit above, each timed to its card's *solo* window (the gap between the
  // incoming and outgoing dissolves) so they cut cleanly under the crossfades.
  const type = new VisualTrack();
  type.zIndex = 10;
  CARDS.forEach((c, i) => {
    const w = windows[i];
    const solo = {
      start: i === 0 ? w.start : w.start + OVERLAP,
      end: i === CARDS.length - 1 ? w.end : w.end - OVERLAP,
    };
    for (const clip of label(c.title, c.kicker, c.ink, solo)) type.add(clip);
  });
  compositor.addTrack(type);

  return { compositor, duration: DURATION };
});
