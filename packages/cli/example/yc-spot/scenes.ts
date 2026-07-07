/**
 * The storyboard — four acts of a Y Combinator editorial spot, rebuilt with the
 * engine's object graph. Each act adds its clips to the shared `content` track
 * (draw order = insertion order) inside its own slice of the timeline; between
 * acts the paper background shows through for a beat, matching the source cut.
 *
 * No bitmaps are used: every "photo" is a solid tinted card, so the piece is
 * self-contained and reproducible in both `sequio preview` and `sequio render`.
 */
import { GroupClip, ShapeClip, VisualClip, VisualTrack, gsapClipAnimator, gsapTextAnimator } from '@sequio/engine';
import gsap from 'gsap';
import {
  ACT1,
  ACT2,
  ACT3,
  ACT4,
  FAINT,
  H,
  HEAVY,
  INK,
  INK_SOFT,
  MUTE,
  ORANGE,
  PAPER,
  SANS,
  SERIF,
  TINTS,
  W,
} from './theme';
import { badge, circle, drawLine, photoCard, rect, reveal, statChip, text, window as win } from './kit';

/** Add a clip to `track` with its active window set to the act. */
function place(track: VisualTrack, clip: VisualClip, a: { start: number; end: number }): void {
  win(clip, a.start, a.end);
  track.add(clip);
}

// ── Act 1 — "YC turns builders into formidable founders" ──────────────────────
export function act1(track: VisualTrack): void {
  const A = ACT1;
  const t = (o: number) => A.start + o;

  // Big faded serif watermark behind the headline.
  const mark = text('BUILDERS\nFOUNDERS', SERIF, 150, FAINT, [0, 0.5]);
  place(track, mark, A);
  reveal(mark, 120, 470, { at: t(0.0), rise: 0, until: A.end });

  // Header: black Y badge + kicker.
  const yb = badge(64, INK, 'Y', PAPER);
  place(track, yb, A);
  reveal(yb, 150, 124, { at: t(0.05), until: A.end });
  const kicker = text('Y COMBINATOR  /  2005—NOW', SANS, 24, MUTE, [0, 0.5]);
  place(track, kicker, A);
  reveal(kicker, 205, 124, { at: t(0.12), until: A.end });

  // Kinetic headline — one split-by-line TextClip whose parts stagger in on a
  // paused GSAP timeline (gsapTextAnimator), then fade out together at the cut.
  const head = text('YC turns\nbuilders into\nformidable\nfounders', HEAVY, 90, INK, [0, 0]);
  head.split = 'line';
  place(track, head, A);
  head.transform.position.setStatic([140, 322]);
  const inAt = 0.35;
  const outAt = A.end - A.start - 0.3;
  head.textAnimator = gsapTextAnimator(gsap, head.partCount, (tl, parts) => {
    tl.set(parts, { y: 44, alpha: 0 }, 0);
    tl.to(parts, { y: 0, alpha: 1, duration: 0.7, ease: 'power3.out', stagger: 0.13 }, inAt);
    tl.to(parts, { alpha: 0, duration: 0.3, ease: 'power1.in' }, outAt);
  });

  // Drawn underline that finishes in a connected arrowhead (shaft + two
  // strokes fanning back from the same tip, matched weight + colour).
  const ay = 792;
  const shaftLen = 470;
  const tipX = 142 + shaftLen;
  const shaft = rect(shaftLen, 5, INK, { anchor: [0, 0.5] });
  place(track, shaft, A);
  drawLine(shaft, 142, ay, { at: t(1.1), until: A.end });
  for (const sign of [1, -1]) {
    const head = rect(34, 5, INK, { anchor: [1, 0.5] });
    head.transform.rotation.setStatic(sign * 0.62);
    place(track, head, A);
    reveal(head, tipX, ay, { at: t(1.55), rise: 0, until: A.end });
  }

  // Supporting copy.
  const sub = text(
    "The original accelerator, framed like a\nfounder's first serious proof point.",
    SANS,
    30,
    INK_SOFT,
    [0, 0.5],
  );
  place(track, sub, A);
  reveal(sub, 142, 900, { at: t(1.0), until: A.end });
  const foot = text('Warm paper. Real companies. No invented polish.', SANS, 23, MUTE, [0, 0.5]);
  place(track, foot, A);
  reveal(foot, 142, 985, { at: t(1.3), until: A.end });

  // The "Make something people want." quote card on the right.
  const card = quoteCard();
  place(track, card, A);
  reveal(card, 1440, 540, { at: t(0.25), rise: 40, pop: 0.94, ease: 'back.out(1.3)', until: A.end });
}

/** The tilted white card holding YC's motto + a strip of portfolio dots. */
function quoteCard(): GroupClip {
  const w = 660;
  const h = 560;
  const g = new GroupClip();

  const shadow = rect(w, h, 0x000000, { anchor: [0.5, 0.5] });
  shadow.opacity.setStatic(0.16);
  shadow.transform.position.setStatic([14, 20]);
  g.add(shadow);
  g.add(rect(w, h, 0xfcfbf7, { anchor: [0.5, 0.5], stroke: { color: INK, width: 3 } }));

  const yb = badge(56, ORANGE, 'Y', 0xffffff);
  yb.transform.position.setStatic([0, -170]);
  g.add(yb);

  const quote = text('Make something\npeople want.', SERIF, 62, INK, [0.5, 0.5]);
  quote.transform.position.setStatic([0, -20]);
  g.add(quote);

  const dots = [TINTS.dropbox, TINTS.reddit, TINTS.stripe, TINTS.coinbase, TINTS.gitlab, TINTS.airbnb, TINTS.teal];
  dots.forEach((color, i) => {
    const d = circle(56, color);
    d.transform.position.setStatic([-((dots.length - 1) / 2) * 84 + i * 84, 190]);
    g.add(d);
  });

  for (const ch of g.children) {
    ch.start = 0;
    ch.end = 999;
  }
  g.transform.anchor.setStatic([0.5, 0.5]);
  g.transform.rotation.setStatic(-0.028);
  return g;
}

// ── Act 2 — "Three months of founder velocity" ────────────────────────────────
export function act2(track: VisualTrack): void {
  const A = ACT2;
  const t = (o: number) => A.start + o;

  const eyebrow = text('THE BATCH ENGINE', SANS, 24, MUTE, [0, 0.5]);
  place(track, eyebrow, A);
  reveal(eyebrow, 140, 150, { at: t(0.0), until: A.end });

  const head = text('Three\nmonths of\nfounder\nvelocity.', SERIF, 92, INK, [0, 0]);
  place(track, head, A);
  reveal(head, 140, 210, { at: t(0.12), until: A.end });

  // Editorial divider between copy and gallery.
  const divider = rect(2.5, 860, INK, { anchor: [0.5, 0] });
  place(track, divider, A);
  reveal(divider, 720, 110, { at: t(0.2), rise: 0, until: A.end });

  // 2×2 founder gallery.
  const cards: Array<{ x: number; y: number; color: number; label: string; tag: string; tilt: number }> = [
    { x: 1150, y: 300, color: TINTS.openai, label: 'OpenAI', tag: 'S05', tilt: -0.02 },
    { x: 1660, y: 300, color: TINTS.airbnb, label: 'Airbnb', tag: 'W09', tilt: 0.018 },
    { x: 1150, y: 620, color: TINTS.stripe, label: 'Stripe', tag: 'S09', tilt: 0.02 },
    { x: 1660, y: 620, color: TINTS.coinbase, label: 'Coinbase', tag: 'S12', tilt: -0.018 },
  ];
  cards.forEach((c, i) => {
    const card = photoCard({ w: 500, h: 300, color: c.color, label: c.label, tag: c.tag, tilt: c.tilt });
    place(track, card, A);
    reveal(card, c.x, c.y, { at: t(0.5 + i * 0.14), rise: 40, pop: 0.9, ease: 'back.out(1.4)', until: A.end });
  });

  // Stat chips stacked under the headline.
  const stats: Array<{ value: string; label: string; valueW?: number }> = [
    { value: '4×', label: 'new batches every year', valueW: 120 },
    { value: '3 mo', label: 'together in San Francisco', valueW: 150 },
    { value: '$500k', label: 'standard YC investment', valueW: 170 },
  ];
  stats.forEach((s, i) => {
    const chip = statChip({ w: 540, h: 66, value: s.value, label: s.label, valueW: s.valueW });
    place(track, chip, A);
    reveal(chip, 410, 760 + i * 82, { at: t(1.4 + i * 0.16), rise: 28, ease: 'back.out(1.7)', until: A.end });
  });

  const footer = text('San Francisco  →  Demo Day', SANS, 24, MUTE, [0, 0.5]);
  place(track, footer, A);
  reveal(footer, 140, 1005, { at: t(1.9), until: A.end });
}

// ── Act 3 — "The proof is everywhere." ────────────────────────────────────────
export function act3(track: VisualTrack): void {
  const A = ACT3;
  const t = (o: number) => A.start + o;

  // Scattered IPO cards behind everything.
  const scatter: Array<{ x: number; y: number; color: number; label: string; tilt: number; w: number; h: number }> = [
    { x: 470, y: 430, color: TINTS.dropbox, label: 'Dropbox', tilt: -0.05, w: 540, h: 360 },
    { x: 1500, y: 360, color: TINTS.reddit, label: 'Reddit', tilt: 0.05, w: 540, h: 360 },
    { x: 940, y: 740, color: TINTS.gitlab, label: 'GitLab', tilt: 0.02, w: 560, h: 380 },
  ];
  scatter.forEach((s, i) => {
    const card = photoCard({ w: s.w, h: s.h, color: s.color, label: s.label, tilt: s.tilt });
    place(track, card, A);
    reveal(card, s.x, s.y, { at: t(0.0 + i * 0.12), rise: 46, pop: 0.92, ease: 'back.out(1.3)', until: A.end });
  });

  const head = text('The proof is everywhere.', SERIF, 88, INK, [0, 0.5]);
  place(track, head, A);
  reveal(head, 120, 130, { at: t(0.15), until: A.end });

  const eyebrow = text('COMBINED OUTCOME SIGNAL', SANS, 22, MUTE, [1, 0.5]);
  place(track, eyebrow, A);
  reveal(eyebrow, 1800, 150, { at: t(0.3), until: A.end });

  // Bottom logo strip.
  const strip = logoStrip(['Front', 'Stripe', 'Ironclad', 'Stoke', 'Benchling']);
  place(track, strip, A);
  reveal(strip, 960, 940, { at: t(1.4), rise: 40, until: A.end });

  // Count-up valuation box, on top of the cards.
  const box = countBox();
  place(track, box, A);
  reveal(box, 960, 560, { at: t(0.7), rise: 30, pop: 0.9, ease: 'back.out(1.5)', until: A.end });
}

/** White bar split into labelled cells (portfolio logos placeholder). */
function logoStrip(labels: string[]): GroupClip {
  const w = 1760;
  const h = 116;
  const g = new GroupClip();

  const shadow = rect(w, h, 0x000000, { anchor: [0.5, 0.5] });
  shadow.opacity.setStatic(0.1);
  shadow.transform.position.setStatic([6, 10]);
  g.add(shadow);
  g.add(rect(w, h, 0xffffff, { anchor: [0.5, 0.5], stroke: { color: INK, width: 3 } }));

  const cell = w / labels.length;
  labels.forEach((label, i) => {
    const cx = -w / 2 + cell * (i + 0.5);
    if (i > 0) {
      const sep = rect(2, h - 8, FAINT, { anchor: [0.5, 0.5] });
      sep.transform.position.setStatic([-w / 2 + cell * i, 0]);
      g.add(sep);
    }
    const label2 = text(label, HEAVY, 30, INK, [0.5, 0.5]);
    label2.transform.position.setStatic([cx, 0]);
    g.add(label2);
  });

  for (const ch of g.children) {
    ch.start = 0;
    ch.end = 999;
  }
  g.transform.anchor.setStatic([0.5, 0.5]);
  return g;
}

/** The bordered box whose big serif number rolls from $0.0T up to $1.3T. */
function countBox(): GroupClip {
  const w = 760;
  const h = 300;
  const g = new GroupClip();

  const shadow = rect(w, h, 0x000000, { anchor: [0.5, 0.5] });
  shadow.opacity.setStatic(0.14);
  shadow.transform.position.setStatic([8, 12]);
  shadow.start = 0;
  shadow.end = 999;
  g.add(shadow);

  const box = rect(w, h, 0xfcfbf7, { anchor: [0.5, 0.5], stroke: { color: INK, width: 3 } });
  box.start = 0;
  box.end = 999;
  g.add(box);

  const label = text('IN COMBINED VALUATION', SANS, 26, MUTE, [0.5, 0.5]);
  label.transform.position.setStatic([0, 92]);
  label.start = 0;
  label.end = 999;
  g.add(label);

  // Rolling counter: a stack of numbers each visible for one short window.
  const ls = 0.9; // local start (after the box has settled in)
  const step = 0.05;
  const frames = 14; // 0.0 … 1.3
  for (let i = 0; i < frames; i++) {
    const v = (i * 0.1).toFixed(1);
    const num = text(`$${v}T`, SERIF, 150, INK, [0.5, 0.5]);
    num.transform.position.setStatic([0, -18]);
    num.start = ls + i * step;
    num.end = i === frames - 1 ? 999 : ls + (i + 1) * step;
    g.add(num);
  }

  g.transform.anchor.setStatic([0.5, 0.5]);
  return g;
}

// ── Act 4 — "Be in the room." + sign-off ──────────────────────────────────────
export function act4(track: VisualTrack): void {
  const A = ACT4;
  const t = (o: number) => A.start + o;

  const yb = badge(64, INK, 'Y', PAPER);
  place(track, yb, A);
  reveal(yb, 150, 128, { at: t(0.0), until: A.end });
  const brand = text('Y Combinator', HEAVY, 34, INK, [0, 0.5]);
  place(track, brand, A);
  reveal(brand, 205, 112, { at: t(0.06), until: A.end });
  const kicker = text('APPLY THE PRESSURE. KEEP THE STANDARD.', SANS, 22, MUTE, [0, 0.5]);
  place(track, kicker, A);
  reveal(kicker, 205, 150, { at: t(0.12), until: A.end });

  const head = text('Be in the room.', SERIF, 108, INK, [0, 0.5]);
  place(track, head, A);
  reveal(head, 140, 430, { at: t(0.2), until: A.end });

  const sub = text(
    'Founder community, partner pressure, and a\nbar that resets what fast feels like.',
    SANS,
    30,
    INK_SOFT,
    [0, 0.5],
  );
  place(track, sub, A);
  reveal(sub, 142, 570, { at: t(0.4), until: A.end });

  // Two overlapping cards on the right.
  const back = photoCard({ w: 480, h: 300, color: TINTS.slate, tilt: 0.02 });
  place(track, back, A);
  reveal(back, 1440, 350, { at: t(0.3), rise: 40, pop: 0.9, ease: 'back.out(1.4)', until: A.end });
  const front = photoCard({ w: 560, h: 320, color: TINTS.teal, tilt: -0.02 });
  place(track, front, A);
  reveal(front, 1560, 560, { at: t(0.45), rise: 40, pop: 0.9, ease: 'back.out(1.4)', until: A.end });

  // Black sign-off bar sliding up from the bottom (GSAP-driven, rests at H-barH).
  const barH = 200;
  const bar = rect(W, barH, INK, { anchor: [0, 0] });
  place(track, bar, A);
  bar.opacity.setStatic(1);
  bar.transform.position.setStatic([0, H - barH]);
  bar.animator = gsapClipAnimator(gsap, (tl, o) => {
    tl.set(o, { y: barH }, 0);
    tl.to(o, { y: 0, duration: 0.55, ease: 'power4.out' }, 0.9);
  });

  const motto = text('Make something people want.', SERIF, 80, PAPER, [0, 0.5]);
  place(track, motto, A);
  reveal(motto, 140, H - barH / 2, { at: t(1.3), rise: 0 });
  const url = text('YCOMBINATOR.COM', HEAVY, 30, PAPER, [1, 0.5]);
  place(track, url, A);
  reveal(url, W - 120, H - barH / 2, { at: t(1.5), rise: 0 });
}
