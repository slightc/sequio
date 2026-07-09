/**
 * The storyboard — seven scenes cut over a continuous silk backdrop, rebuilding
 * the source "2023 Summer Collection" promo from clips alone:
 *
 *   1. INTRO    a diagonal photo "slash" grows in; 2023 · Collection · BRANDNAME
 *   2. HERO     a full framed portrait; Summer / Collection script titles
 *   3. STYLES   two photos slide into opposite corners; an "ALL NEW STYLES" band
 *   4. ELEGANT  one photo zooms out of a motion blur; "unique but elegant"
 *   5. NAIL     three photos stack on the left; big vertical "NAIL THE SUMMER STYLE"
 *   6. DUO      two overlapping framed photos drift on silk
 *   7. OUTRO    an arced "Get ready with", the wordmark, and a website pill
 *
 * All imagery is fetched by URL (loaded up front, in parallel); every other mark
 * — mats, bands, the globe, the arced wordmark — is a shape/text clip.
 */
import {
  BlurEffect,
  type ImageSource,
  type SourceMetadata,
  VisualTrack,
  easeInOutCubic,
  easeOutCubic,
} from '@sequio/engine';
import {
  CX,
  H,
  INK,
  PHOTOS,
  S_DUO,
  S_ELEGANT,
  S_NAIL,
  S_OPEN,
  S_OUTRO,
  S_STYLES,
  SAND,
  SERIF,
  SCRIPT,
  SILK_SOFT,
  SILK_WARM,
  HAND,
  SANS,
  TERRA,
  W,
  WHITE,
  imgUrl,
} from './theme';
import { arcText, bareImage, enter, flowIn, framedPhoto, globe, loadImage, rect, slashReveal, text, win } from './kit';

/** Letter-spaced wordmark — `TextClip` can't track type, so we space the glyphs. */
const BRAND = 'B R A N D N A M E';

interface Img {
  source: ImageSource;
  meta: SourceMetadata;
}

/** Load every photo the storyboard needs, at the box size it will be shown at. */
async function loadAll(): Promise<Record<string, Img>> {
  const reqs: Array<[string, string, number, number]> = [
    ['silkWarm', SILK_WARM, W, H],
    ['silkSoft', SILK_SOFT, W, H],
    ['hero', PHOTOS.stairs, 540, 780],
    ['stylesTop', PHOTOS.cream, 430, 300],
    ['stylesBot', PHOTOS.scarf, 430, 300],
    ['elegant', PHOTOS.floral, 500, 700],
    ['nail1', PHOTOS.hat, 300, 220],
    ['nail2', PHOTOS.skirt, 300, 220],
    ['nail3', PHOTOS.forest, 300, 220],
    ['duoBig', PHOTOS.hat, 440, 560],
    ['duoSmall', PHOTOS.scarf, 300, 380],
  ];
  const loaded = await Promise.all(reqs.map(([, id, w, h]) => loadImage(imgUrl(id, w, h))));
  const out: Record<string, Img> = {};
  reqs.forEach(([key], i) => (out[key] = loaded[i]!));
  return out;
}

/**
 * Build the whole lookbook onto three stacked tracks: `bg` (silk), `content`
 * (photos + bands) and `overlay` (titles). Async because the photos load first.
 */
export async function buildLookbook(bg: VisualTrack, content: VisualTrack, overlay: VisualTrack): Promise<void> {
  const P = await loadAll();

  // ── Continuous silk backdrop (warm → soft cream for the outro) ──────────────
  const silk = bareImage(P.silkWarm.source, P.silkWarm.meta, W);
  silk.transform.position.setStatic([CX, H / 2]);
  win(silk, 0, S_OUTRO.start + 0.2);
  bg.add(silk);

  const silk2 = bareImage(P.silkSoft.source, P.silkSoft.meta, W);
  silk2.transform.position.setStatic([CX, H / 2]);
  silk2.opacity.setKeyframes([
    { time: S_OUTRO.start - 0.2, value: 0 },
    { time: S_OUTRO.start + 0.3, value: 1, easing: easeInOutCubic },
  ]);
  win(silk2, S_OUTRO.start - 0.2, S_OUTRO.end);
  bg.add(silk2);

  opening(content, overlay, P);
  styles(content, overlay, P);
  elegant(content, overlay, P);
  nail(content, overlay, P);
  duo(content, overlay, P);
  outro(overlay);
}

// ── 1. OPENING (slash reveal → held hero + flowing titles) ────────────────────
function opening(content: VisualTrack, overlay: VisualTrack, P: Record<string, Img>): void {
  const { start, end } = S_OPEN;

  // The hero portrait IS the intro: it wipes open from a diagonal slit, rotates
  // upright, and holds through the whole opening beat.
  const photo = framedPhoto(P.hero.source, P.hero.meta, { boxW: 540, boxH: 780, border: 16 });
  win(photo, start, end);
  slashReveal(photo, CX, 700, { at: start + 0.05, dur: 0.75 });
  content.add(photo);

  const y2023 = text('2023', SERIF, 30, INK);
  win(y2023, start, end);
  enter(y2023, CX, 104, { at: start + 0.45, rise: 12 });
  overlay.add(y2023);

  // The two script titles flow in glyph-by-glyph, like handwriting.
  const summer = text('Summer', SCRIPT, 92, TERRA);
  win(summer, start, end);
  flowIn(summer, 275, 166, { at: start + 0.6, each: 0.05 });
  overlay.add(summer);

  const coll = text('Collection', SCRIPT, 92, WHITE);
  win(coll, start, end);
  flowIn(coll, 452, 232, { at: start + 0.95, each: 0.05 });
  overlay.add(coll);

  const brand = text(BRAND, SERIF, 40, INK);
  win(brand, start, end);
  enter(brand, CX, 1206, { at: start + 0.7, rise: 16 });
  overlay.add(brand);
}

// ── 3. ALL NEW STYLES ─────────────────────────────────────────────────────────
function styles(content: VisualTrack, overlay: VisualTrack, P: Record<string, Img>): void {
  const { start, end } = S_STYLES;

  const top = framedPhoto(P.stylesTop.source, P.stylesTop.meta, { boxW: 430, boxH: 300, border: 12 });
  win(top, start, end);
  enter(top, 300, 420, { at: start + 0.05, from: -260, dur: 0.7 });
  content.add(top);

  const bot = framedPhoto(P.stylesBot.source, P.stylesBot.meta, { boxW: 430, boxH: 300, border: 12 });
  win(bot, start, end);
  enter(bot, 430, 900, { at: start + 0.2, from: 260, dur: 0.7 });
  content.add(bot);

  // A sand band that draws on horizontally, carrying the label.
  const band = rect(W + 60, 96, SAND);
  band.transform.position.setStatic([CX, 660]);
  band.transform.scale.setKeyframes([
    { time: start, value: [0, 1] },
    { time: start + 0.5, value: [1, 1], easing: easeOutCubic },
  ]);
  win(band, start, end);
  content.add(band);

  const label = text('A L L   N E W   S T Y L E S', SANS, 40, INK);
  win(label, start, end);
  enter(label, CX, 660, { at: start + 0.5, dur: 0.5 });
  overlay.add(label);
}

// ── 4. UNIQUE BUT ELEGANT ─────────────────────────────────────────────────────
function elegant(content: VisualTrack, overlay: VisualTrack, P: Record<string, Img>): void {
  const { start, end } = S_ELEGANT;

  const photo = framedPhoto(P.elegant.source, P.elegant.meta, { boxW: 500, boxH: 700, border: 16 });
  photo.transform.position.setStatic([CX, 620]);
  // Ease out of a motion blur while settling from a slight over-scale.
  photo.transform.scale.setKeyframes([
    { time: start, value: [1.12, 1.12] },
    { time: start + 0.8, value: [1, 1], easing: easeOutCubic },
  ]);
  photo.opacity.setKeyframes([
    { time: start, value: 0 },
    { time: start + 0.3, value: 1 },
  ]);
  const blur = new BlurEffect();
  blur.strength.setKeyframes([
    { time: start, value: 18 },
    { time: start + 0.8, value: 0, easing: easeOutCubic },
  ]);
  photo.effects.push(blur);
  win(photo, start, end);
  content.add(photo);

  const brand = text(BRAND, SERIF, 40, WHITE);
  win(brand, start, end);
  enter(brand, CX, 132, { at: start + 0.1, rise: 14 });
  overlay.add(brand);

  // "unique / but / elegant" — a handwritten stack that flows in per glyph,
  // terracotta accent in the middle.
  const l1 = text('unique', HAND, 70, INK);
  win(l1, start, end);
  flowIn(l1, 300, 1058, { at: start + 0.35, each: 0.05 });
  overlay.add(l1);

  const l2 = text('but', HAND, 70, TERRA);
  win(l2, start, end);
  flowIn(l2, 372, 1112, { at: start + 0.6, each: 0.06 });
  overlay.add(l2);

  const l3 = text('elegant', HAND, 70, INK);
  win(l3, start, end);
  flowIn(l3, 344, 1170, { at: start + 0.8, each: 0.05 });
  overlay.add(l3);
}

// ── 5. NAIL THE SUMMER STYLE ──────────────────────────────────────────────────
function nail(content: VisualTrack, overlay: VisualTrack, P: Record<string, Img>): void {
  const { start, end } = S_NAIL;

  const boxes: Array<[Img, number]> = [
    [P.nail1, 360],
    [P.nail2, 630],
    [P.nail3, 900],
  ];
  boxes.forEach(([img, y], i) => {
    const card = framedPhoto(img.source, img.meta, { boxW: 300, boxH: 220, border: 12 });
    win(card, start, end);
    enter(card, 240, y, { at: start + 0.05 + i * 0.12, from: -280, dur: 0.65 });
    content.add(card);
  });

  // Big vertical wordmark on the right — one line rotated a quarter turn.
  const vtext = text('NAIL THE SUMMER STYLE', SANS, 60, WHITE);
  vtext.transform.rotation.setStatic(Math.PI / 2);
  vtext.opacity.setStatic(0.94);
  win(vtext, start, end);
  enter(vtext, 604, 640, { at: start + 0.25, rise: 120, dur: 0.8 });
  overlay.add(vtext);
}

// ── 6. DUO ────────────────────────────────────────────────────────────────────
function duo(content: VisualTrack, _overlay: VisualTrack, P: Record<string, Img>): void {
  const { start, end } = S_DUO;

  const big = framedPhoto(P.duoBig.source, P.duoBig.meta, { boxW: 440, boxH: 560, border: 16, tilt: -0.03 });
  win(big, start, end);
  enter(big, 300, 560, { at: start + 0.05, pop: 0.94, dur: 0.7 });
  content.add(big);

  const small = framedPhoto(P.duoSmall.source, P.duoSmall.meta, { boxW: 300, boxH: 380, border: 14, tilt: 0.04 });
  win(small, start, end);
  enter(small, 480, 880, { at: start + 0.22, pop: 0.92, dur: 0.7 });
  content.add(small);
}

// ── 7. OUTRO ──────────────────────────────────────────────────────────────────
function outro(overlay: VisualTrack): void {
  const { start, end } = S_OUTRO;

  const arc = arcText({ str: 'Get ready with', family: HAND, size: 54, fill: INK, radius: 540, arc: 0.72 });
  win(arc, start, end);
  enter(arc, CX, 486, { at: start + 0.1, rise: 20, dur: 0.7 });
  overlay.add(arc);

  const brand = text(BRAND, SERIF, 58, INK);
  win(brand, start, end);
  enter(brand, CX, 600, { at: start + 0.3, rise: 16 });
  overlay.add(brand);

  // Website pill: rounded plate + vector globe + url, revealed as one unit.
  const pill = rect(380, 76, WHITE, { radius: 38 });
  pill.transform.position.setStatic([CX, 720]);
  win(pill, start, end);
  enter(pill, CX, 720, { at: start + 0.5, rise: 14, pop: 0.92 });
  overlay.add(pill);

  const gl = globe(30, INK);
  win(gl, start, end);
  enter(gl, CX - 132, 720, { at: start + 0.55 });
  overlay.add(gl);

  const url = text('www.brandname.com', SANS, 28, INK);
  win(url, start, end);
  enter(url, CX + 20, 720, { at: start + 0.55 });
  overlay.add(url);
}
