import { easeOutCubic, linear, type Easing } from './easing';

/**
 * An animated **override** composed on top of a clip's base transform/opacity.
 *
 * Offsets are *additive* (`x`, `y`, `rotation`) and factors are *multiplicative*
 * (`scaleX`, `scaleY`, `alpha`) so an animator layers over whatever keyframes the
 * clip's {@link Transform2D} already defines instead of replacing them. Every
 * field is optional; an omitted field is the identity (offset `0`, factor `1`).
 * Units are engine-native: pixels for `x`/`y`, radians for `rotation`.
 */
export interface AnimationSample {
  /** Additive x offset in px. */
  x?: number;
  /** Additive y offset in px. */
  y?: number;
  /** Multiplicative x scale. */
  scaleX?: number;
  /** Multiplicative y scale. */
  scaleY?: number;
  /** Additive rotation in radians. */
  rotation?: number;
  /** Multiplicative opacity (0..1). */
  alpha?: number;
}

/** The identity sample: contributes nothing when composed. */
export const IDENTITY_SAMPLE: AnimationSample = {};

/**
 * A per-clip animator sampled at the clip's **local time** (`t - clip.start`).
 * `sampleAt` must be a pure function of `localT` (SDK contract #2) — the same
 * `localT` always yields the same sample — so it composes into a reproducible
 * `render(t)`. A GSAP-backed implementation satisfies this by *seeking* a paused
 * timeline rather than letting it play (see `gsap-animator.ts`).
 */
export interface ClipAnimator {
  sampleAt(localT: number): AnimationSample;
}

/**
 * One animatable unit of a split {@link TextClip} (a line, a word or a
 * character), with its laid-out geometry. `x`/`y` are the unit's **center** in
 * the clip's local space; animators pivot scale/rotation around it.
 */
export interface TextPart {
  /** The unit's text. */
  text: string;
  /** Split granularity this part belongs to. */
  unit: TextSplit;
  /** 0-based order across all parts (drives stagger). */
  index: number;
  /** Total number of parts (so an animator can reverse / normalize). */
  count: number;
  /** 0-based source line the part sits on. */
  lineIndex: number;
  /** Center x of the part in the clip's local space (px). */
  x: number;
  /** Center y of the part in the clip's local space (px). */
  y: number;
  /** Laid-out width of the part (px). */
  width: number;
  /** Laid-out height of the part (px), = line height. */
  height: number;
}

/** How a {@link TextClip} is broken into independently-animatable parts. */
export type TextSplit = 'none' | 'char' | 'word' | 'line';

/**
 * A per-part animator for split text, sampled at the clip's local time. Given a
 * part (which carries its index / count / geometry) it returns that part's
 * override at `localT`. Pure in `(part, localT)`, same contract as
 * {@link ClipAnimator}.
 */
export interface TextAnimator {
  sampleForPart(part: TextPart, localT: number): AnimationSample;
}

/** Direction the stagger sweeps across parts. */
export type StaggerOrder = 'forward' | 'reverse' | 'center' | 'edges';

export interface StaggerTextOptions {
  /**
   * The starting override each part animates *from*, toward identity. For a
   * drop-in: `{ y: -40, alpha: 0 }` (starts 40px above, invisible). For a
   * pop-in: `{ scaleX: 0, scaleY: 0, alpha: 0 }`.
   */
  from: AnimationSample;
  /** Per-part animation duration in seconds (default `0.4`). */
  duration?: number;
  /** Delay between consecutive parts in seconds (default `0.05`). */
  stagger?: number;
  /** Global start delay in seconds (default `0`). */
  delay?: number;
  /** Easing for each part's 0→1 progress (default {@link easeOutCubic}). */
  easing?: Easing;
  /** Which part animates first (default `'forward'`). */
  order?: StaggerOrder;
}

/**
 * A dependency-free {@link TextAnimator} that eases every part from a shared
 * `from` override to identity, offset in time by a per-part stagger. This is the
 * built-in behind line-by-line / word-by-word / character-by-character reveals
 * (逐行 / 逐词 / 逐字) — pair it with a {@link TextClip} whose `split` matches the
 * granularity you want.
 *
 * Purely a function of `(part, localT)`, so it renders reproducibly in preview
 * and export alike. Needs no GSAP; for arbitrary GSAP tweens use
 * `gsapTextAnimator` instead.
 */
export class StaggerTextAnimator implements TextAnimator {
  private readonly from: AnimationSample;
  private readonly duration: number;
  private readonly stagger: number;
  private readonly delay: number;
  private readonly easing: Easing;
  private readonly order: StaggerOrder;

  constructor(options: StaggerTextOptions) {
    this.from = options.from;
    this.duration = options.duration ?? 0.4;
    this.stagger = options.stagger ?? 0.05;
    this.delay = options.delay ?? 0;
    this.easing = options.easing ?? easeOutCubic;
    this.order = options.order ?? 'forward';
  }

  sampleForPart(part: TextPart, localT: number): AnimationSample {
    const slot = this.staggerSlot(part.index, part.count);
    const startT = this.delay + slot * this.stagger;
    const raw = this.duration <= 0 ? 1 : (localT - startT) / this.duration;
    const k = raw <= 0 ? 0 : raw >= 1 ? 1 : this.easing(raw);
    // Ease from `from` toward identity: at k=0 → full `from`, at k=1 → identity.
    return lerpSample(this.from, IDENTITY_SAMPLE, k);
  }

  /** Map a part's natural index to its position in the stagger sweep. */
  private staggerSlot(index: number, count: number): number {
    switch (this.order) {
      case 'reverse':
        return count - 1 - index;
      case 'center': {
        // Middle parts first, ends last.
        const mid = (count - 1) / 2;
        return Math.abs(index - mid);
      }
      case 'edges': {
        // Ends first, middle last (the inverse of `center`).
        const mid = (count - 1) / 2;
        return mid - Math.abs(index - mid);
      }
      default:
        return index;
    }
  }
}

/** Blend two samples field-by-field (numeric lerp; missing = identity). */
export function lerpSample(from: AnimationSample, to: AnimationSample, k: number): AnimationSample {
  return {
    x: lerp(from.x ?? 0, to.x ?? 0, k),
    y: lerp(from.y ?? 0, to.y ?? 0, k),
    scaleX: lerp(from.scaleX ?? 1, to.scaleX ?? 1, k),
    scaleY: lerp(from.scaleY ?? 1, to.scaleY ?? 1, k),
    rotation: lerp(from.rotation ?? 0, to.rotation ?? 0, k),
    alpha: lerp(from.alpha ?? 1, to.alpha ?? 1, k),
  };
}

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}

export interface TweenAnimatorOptions {
  /** Starting override (default identity). */
  from?: AnimationSample;
  /** Ending override (default identity). */
  to?: AnimationSample;
  /** Start time in seconds (local, default `0`). */
  delay?: number;
  /** Duration in seconds (default `0.5`). */
  duration?: number;
  /** Easing for the 0→1 progress (default {@link linear}). */
  easing?: Easing;
}

/**
 * A minimal dependency-free {@link ClipAnimator}: eases a whole clip from `from`
 * to `to` over `[delay, delay + duration]`, holding the endpoints outside. Useful
 * as an entrance/exit without pulling in GSAP; for richer sequencing bind GSAP
 * via `gsapClipAnimator`.
 */
export class TweenAnimator implements ClipAnimator {
  private readonly from: AnimationSample;
  private readonly to: AnimationSample;
  private readonly delay: number;
  private readonly duration: number;
  private readonly easing: Easing;

  constructor(options: TweenAnimatorOptions = {}) {
    this.from = options.from ?? IDENTITY_SAMPLE;
    this.to = options.to ?? IDENTITY_SAMPLE;
    this.delay = options.delay ?? 0;
    this.duration = options.duration ?? 0.5;
    this.easing = options.easing ?? linear;
  }

  sampleAt(localT: number): AnimationSample {
    const raw = this.duration <= 0 ? 1 : (localT - this.delay) / this.duration;
    const k = raw <= 0 ? 0 : raw >= 1 ? 1 : this.easing(raw);
    return lerpSample(this.from, this.to, k);
  }
}
