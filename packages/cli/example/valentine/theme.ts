/**
 * Shared design tokens for the CLI's **Valentine's Day Sale** example — a
 * vertical (9:16) social-promo reel recreated entirely from the engine's own
 * primitives: `ShapeClip` / `TextClip` / `GroupClip`, keyframed transforms +
 * opacity, plus two small engine features this piece leans on — `TextClip`
 * style pass-through (weight / italic / letter-spacing / stroke) for the display
 * type, and `VisualClip.maskShape` for the arch-cropped photos.
 *
 * Everything a scene needs to look consistent lives here: the rose palette, the
 * condensed type ramp, the six-scene timeline, and the (network) photo set.
 * Imported by `kit.ts` (reusable builders), `scenes.ts` (the six scenes) and
 * `index.ts` (the entry).
 */

// ── Canvas (vertical 9:16 story / reel) ──────────────────────────────────────
export const W = 1080;
export const H = 1920;
export const FPS = 30;
export const DURATION = 11;

// ── Palette (soft rose Valentine) ────────────────────────────────────────────
export const PINK = 0xf7cfcf; // background wash
export const CRIMSON = 0xa5120f; // deep red — headlines, arches, dots
export const ROSE = 0xeb9c99; // dusty rose — secondary blobs
export const WHITE = 0xffffff;

// ── Type ramp ────────────────────────────────────────────────────────────────
// One condensed grotesque (Oswald) carries every headline — weight, italic and
// letter-spacing now flow straight into the `TextClip`, so a single family does
// the bold / outline / italic cuts the template needs. An elegant script
// (Dancing Script) draws the one cursive word ("Sale"). Fallback stacks keep the
// piece legible if the web fonts fail to load.
export const DISPLAY = "'Oswald', 'Arial Narrow', system-ui, sans-serif";
export const SCRIPT = "'Dancing Script', 'Segoe Script', cursive";

/** Google-font specs the entry loads up front (see `index.ts`). */
export const FONT_SPECS: Array<{ family: string; weights: number[] }> = [
  { family: 'Oswald', weights: [400, 500, 600, 700] },
  { family: 'Dancing Script', weights: [700] },
];

// ── Timeline (seven scenes, hard cuts like the source reel) ───────────────────
export interface Scene {
  start: number;
  end: number;
}
export const S1: Scene = { start: 0.0, end: 1.9 }; // Valentine's Day Sale
export const S2: Scene = { start: 1.9, end: 3.5 }; // Casual Look
export const S3: Scene = { start: 3.5, end: 5.2 }; // Comfortable
export const S4: Scene = { start: 5.2, end: 7.0 }; // Super / Promo
export const S5: Scene = { start: 7.0, end: 8.3 }; // Discount
export const S6: Scene = { start: 8.3, end: 9.6 }; // 50% OFF (echo stack)
export const S7: Scene = { start: 9.6, end: 11.0 }; // Brandname / Make it yours

// ── Photo set (network, free-licence placeholders) ───────────────────────────
// Cropped server-side to each region's aspect via Unsplash's `w/h/fit=crop`
// params, so the arch mask fits without distortion. These stand in for the
// loungewear model in the source — swap in your own URLs (or local assets via
// runtime's `loadAsset`). Nothing is committed to the repo.
const U = 'https://images.unsplash.com/photo-';
export interface Photo {
  url: (w: number, h: number) => string;
}
const photo = (id: string): Photo => ({ url: (w, h) => `${U}${id}?w=${w}&h=${h}&fit=crop&crop=faces,center` });

export const PHOTOS = {
  casual: photo('1544005313-94ddf0286df2'),
  comfortable: photo('1534528741775-53994a69daeb'),
  superLook: photo('1524504388940-b1c1722653e1'),
  promo: photo('1438761681033-6461ffad8d80'),
  discount: photo('1487412720507-e7ab37603c6f'),
} as const;
