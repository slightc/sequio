/**
 * Shared design tokens for the "Summer Collection" CLI example — a 9:16 fashion
 * lookbook promo rebuilt from the engine's own object graph.
 *
 * Every visual is a `Clip`: framed photos are `GroupClip`s (a white mat +
 * `ImageClip`), the accent bands and the little globe are `ShapeClip`s, and all
 * the titles are `TextClip`s — including the arced "Get ready with" wordmark,
 * which is one `TextClip` per glyph laid out on a circle (see `kit.ts`). Photos
 * are public Unsplash URLs referenced at request time (like the `media-network`
 * demo) — nothing is committed to the repo.
 *
 * Imported by `kit.ts` (reusable builders), `scenes.ts` (the storyboard) and
 * `index.ts` (the entry).
 */

// ── Canvas (vertical 9:16, like the source clip) ──────────────────────────────
export const W = 720;
export const H = 1280;
export const FPS = 30;
export const DURATION = 17.2;
export const CX = W / 2;

// ── Palette (warm silk / terracotta editorial) ───────────────────────────────
export const CREAM = 0xece2d3; // silk-fallback backdrop
export const WHITE = 0xffffff; // photo mats + light titles
export const INK = 0x4a3c30; // dark warm-brown serif ink
export const TERRA = 0xb26a48; // terracotta script + labels
export const SAND = 0xd9c9b4; // the "ALL NEW STYLES" band

// ── Type ramp ────────────────────────────────────────────────────────────────
// `TextClip` can't set weight/style, so each family is loaded at a single weight
// (see `FONT_SPECS`) and referenced through a fallback stack that keeps the piece
// legible if a web font fails. Four cuts: an elegant display serif, a formal
// flowing script, a casual handwritten script, and a clean tracked sans.
export const SERIF = "'Playfair Display', Georgia, 'Times New Roman', serif";
export const SCRIPT = "'Great Vibes', 'Segoe Script', cursive";
export const HAND = "'Sacramento', 'Segoe Script', cursive";
export const SANS = "'Montserrat', system-ui, -apple-system, sans-serif";

/** Google-font specs the entry loads up front (one weight each). */
export const FONT_SPECS: Array<{ family: string; weights: number[] }> = [
  { family: 'Playfair Display', weights: [500] },
  { family: 'Great Vibes', weights: [400] },
  { family: 'Sacramento', weights: [400] },
  { family: 'Montserrat', weights: [600] },
];

// ── Scene windows (seconds on the timeline) ──────────────────────────────────
// Hard cuts over a continuous silk backdrop — the same way the source promo
// swaps looks while the drapery stays put.
export interface Scene {
  start: number;
  end: number;
}
// The opening is one continuous beat: the hero photo reveals as a diagonal
// slit that rotates upright while the script titles flow in, then holds.
export const S_OPEN: Scene = { start: 0.0, end: 5.3 };
export const S_STYLES: Scene = { start: 5.3, end: 7.9 };
export const S_ELEGANT: Scene = { start: 7.9, end: 10.4 };
export const S_NAIL: Scene = { start: 10.4, end: 12.9 };
export const S_DUO: Scene = { start: 12.9, end: 14.9 };
export const S_OUTRO: Scene = { start: 14.9, end: 17.2 };

// ── Imagery (public Unsplash photos, fetched by URL — never committed) ────────
// Supersample requests 2× the on-screen box so `--scale 2` renders stay crisp.
export const SS = 2;
const UNSPLASH = 'https://images.unsplash.com/photo-';

/** A cropped Unsplash URL sized to a box (px); `fit=crop` keeps the exact aspect. */
export function imgUrl(id: string, boxW: number, boxH: number): string {
  const w = Math.round(boxW * SS);
  const h = Math.round(boxH * SS);
  return `${UNSPLASH}${id}?w=${w}&h=${h}&fit=crop&crop=faces,center&auto=format&q=80`;
}

/** Warm champagne silk drapery — the continuous backdrop. */
export const SILK_WARM = '1606259457945-67dc66271ee6';
/** Soft cream silk — the outro backdrop. */
export const SILK_SOFT = '1606259458027-54d2a728b6ab';

/** Summer-collection looks (white / light dresses, warm outdoor light). */
export const PHOTOS = {
  stairs: '1515372039744-b8f02a3ae446', // white dress on stairs (hero portrait)
  cream: '1617019114583-affb34d1b3cd', // cream shirt-dress + sunglasses
  floral: '1520026582657-4daf5bb60adb', // floral sundress, arm raised
  rocks: '1519307060515-209ebd006397', // white maxi on the rocks (intro slash)
  scarf: '1638188350702-8d32baf1abfb', // white dress + orange scarf on sand
  hat: '1568381478053-82d1ba959b6c', // sun-hat, holding flowers
  skirt: '1530203139227-6eb21d04550b', // white button skirt
  forest: '1714378963645-0d52e03ea30c', // white dress in a green grove
} as const;
