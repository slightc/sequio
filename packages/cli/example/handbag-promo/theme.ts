/**
 * Shared design tokens for the handbag-promo recreation — a 15s vertical (9:16)
 * retro fashion spot rebuilt from the engine's own object graph plus a handful
 * of original, procedurally-drawn stand-in graphics (see `assets/`). The look is
 * a warm burnt-orange editorial: sunburst backdrops, film/polaroid framing, a
 * heavy condensed display face pulsing between solid and hollow, and light-leak
 * flashes between the four "chapters".
 *
 * Imported by `kit.ts` (reusable builders), `scenes.ts` (the chapters) and
 * `index.ts` (the entry). No copyrighted imagery is used: every "photo" is an
 * original flat illustration, so the piece is self-contained and reproducible in
 * both `sequio preview` and `sequio render`.
 */

// ── Canvas (portrait, matches the source's 9:16) ─────────────────────────────
export const W = 720;
export const H = 1280;
export const FPS = 30;
export const DURATION = 15;

// ── Palette (burnt-orange retro) ─────────────────────────────────────────────
export const ORANGE = 0xc6461a; // dominant burnt orange
export const ORANGE_D = 0x8f300c; // shadowed orange
export const ORANGE_L = 0xe06c34; // lit orange
export const CREAM = 0xf2ede3; // paper / sunburst light wedge
export const CREAM_D = 0xe6dfce; // paper shade
export const INK = 0x1a1512; // near-black film frame
export const WHITE = 0xffffff;
export const GRAY = 0xb3aca6; // studio backdrop (scenes 3–4)

// ── Type ─────────────────────────────────────────────────────────────────────
// "Anton" — one heavy condensed weight — carries every headline; "Oswald" the
// smaller condensed labels. Fallback stacks keep the piece legible if the
// embedded fonts somehow fail to register.
export const DISPLAY = "'Anton', 'Arial Narrow', Impact, system-ui, sans-serif";
export const COND = "'Oswald', 'Arial Narrow', system-ui, sans-serif";

/** A fully-transparent fill, so `TextClip.stroke` renders hollow outline type. */
export const HOLLOW = 'rgba(255,255,255,0)';

// ── Timeline (four chapters + the light-leak flashes that cut between them) ───
export interface Chapter {
  start: number;
  end: number;
}
export const S1: Chapter = { start: 0.0, end: 4.8 }; // FASHIONABLE HANDBAG
export const S2: Chapter = { start: 4.8, end: 7.9 }; // MINIMALIST · RETRO-STYLE
export const S3: Chapter = { start: 7.9, end: 10.5 }; // LUXURIOUS
export const S4: Chapter = { start: 10.5, end: 15.0 }; // GET IT NOW
