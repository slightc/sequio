/**
 * Shared design tokens for the CLI example — an editorial motion-graphic study
 * (a Y Combinator brand piece) built entirely from the engine's own primitives:
 * `ShapeClip` / `TextClip` / `GroupClip`, keyframed transforms + opacity.
 *
 * Everything a scene needs to look consistent lives here: the warm-paper
 * palette, the type ramp, and the four-act timeline. Imported by `kit.ts`
 * (reusable builders), `scenes.ts` (the acts) and `index.ts` (the entry).
 */

// ── Canvas ──────────────────────────────────────────────────────────────────
export const W = 1920;
export const H = 1080;
export const FPS = 30;
export const DURATION = 15;

// ── Palette (warm editorial paper) ───────────────────────────────────────────
export const PAPER = 0xf3f1e7; // background
export const INK = 0x1a1917; // near-black headline ink
export const INK_SOFT = 0x3b3a35; // body copy
export const MUTE = 0x8c8677; // eyebrows / captions
export const FAINT = 0xe4e0d2; // watermark / hairlines on paper
export const CARD = 0xfcfbf7; // photo mat / card fill
export const SHADOW = 0x000000; // drop shadow (used at low opacity)
export const ORANGE = 0xf26a21; // YC accent

// Solid "photo" placeholder tints (no copyrighted imagery — these stand in for
// the founder / IPO photos, keeping the layout while staying original).
export const TINTS = {
  openai: 0x121110,
  airbnb: 0xf15a47,
  stripe: 0x6e56cf,
  coinbase: 0x1652f0,
  dropbox: 0x0061fe,
  reddit: 0xff4a2b,
  gitlab: 0x7a45e5,
  slate: 0x2b2a45,
  teal: 0x0f766e,
} as const;

// ── Type ramp ────────────────────────────────────────────────────────────────
// Three families, each loaded at a single weight so `TextClip` (which can't set
// weight/style) renders the intended cut: an elegant display serif, a clean
// sans for captions, and a heavy grotesque for numbers + kinetic headlines.
// Fallback stacks keep the piece legible if the web fonts fail to load.
export const SERIF = "'Playfair Display', Georgia, 'Times New Roman', serif";
export const SANS = "'Inter', system-ui, -apple-system, sans-serif";
export const HEAVY = "'Archivo', 'Inter', system-ui, sans-serif";

/** Google-font specs the entry loads up front (see `index.ts`). */
export const FONT_SPECS: Array<{ family: string; weights: number[] }> = [
  { family: 'Playfair Display', weights: [500] },
  { family: 'Inter', weights: [500] },
  { family: 'Archivo', weights: [800] },
];

// ── Timeline (four acts, with brief paper "breaths" between them) ─────────────
export interface Act {
  start: number;
  end: number;
}
export const ACT1: Act = { start: 0.15, end: 3.4 };
export const ACT2: Act = { start: 3.6, end: 8.5 };
export const ACT3: Act = { start: 8.7, end: 12.6 };
export const ACT4: Act = { start: 12.8, end: 15.0 };
