import { linear, type Easing } from './easing';

export interface Keyframe<T> {
  /** Time in seconds on the timeline. */
  time: number;
  value: T;
  /** Easing applied on the segment leading INTO this keyframe. */
  easing?: Easing;
}

/** Values the built-in interpolator can blend. */
type Interpolatable = number | readonly number[];

/**
 * A property that is either static or driven by keyframes. `valueAt(t)` is a
 * pure function of (keyframes, t) — never of wall-clock or previous frames —
 * which is what makes `render(t)` reproducible (SDK contract #2).
 */
export class AnimatableProperty<T> {
  private keyframes: Keyframe<T>[] = [];

  constructor(private staticValue: T) {}

  /** Replace keyframes. They are sorted by time internally. */
  setKeyframes(kfs: Keyframe<T>[]): void {
    this.keyframes = [...kfs].sort((a, b) => a.time - b.time);
  }

  /** Whether this property is animated (has 2+ keyframes). */
  get animated(): boolean {
    return this.keyframes.length > 1;
  }

  /**
   * Make the property a constant `value`. This also **clears any keyframes** —
   * a static value and keyframes are mutually exclusive, and `valueAt` prefers
   * keyframes, so a lingering keyframe set would otherwise shadow the static
   * value (e.g. toggling an animation off would stay stuck on the last curve).
   */
  setStatic(value: T): void {
    this.staticValue = value;
    if (this.keyframes.length > 0) this.keyframes = [];
  }

  /** Drop keyframes and fall back to the current static value. */
  clearKeyframes(): void {
    this.keyframes = [];
  }

  valueAt(t: number): T {
    const kfs = this.keyframes;
    if (kfs.length === 0) return this.staticValue;
    if (kfs.length === 1) return kfs[0]!.value;

    if (t <= kfs[0]!.time) return kfs[0]!.value;
    const last = kfs[kfs.length - 1]!;
    if (t >= last.time) return last.value;

    // Find the segment [a, b] containing t.
    let hi = kfs.length - 1;
    let lo = 0;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (kfs[mid]!.time <= t) lo = mid + 1;
      else hi = mid;
    }
    const b = kfs[lo]!;
    const a = kfs[lo - 1]!;
    const span = b.time - a.time;
    const k = span <= 0 ? 0 : (t - a.time) / span;
    const eased = (b.easing ?? linear)(k);

    return interpolate(a.value, b.value, eased);
  }
}

/**
 * Default interpolator for numbers and numeric tuples (position, scale, …).
 * Non-numeric types fall back to a hold (returns `to` once k crosses 0).
 */
function interpolate<T>(from: T, to: T, k: number): T {
  if (typeof from === 'number' && typeof to === 'number') {
    return (from + (to - from) * k) as T;
  }
  if (Array.isArray(from) && Array.isArray(to)) {
    const a = from as readonly number[];
    const b = to as readonly number[];
    return a.map((v, i) => v + ((b[i] ?? v) - v) * k) as unknown as T;
  }
  return (k <= 0 ? from : to) as T;
}

export type { Interpolatable };
