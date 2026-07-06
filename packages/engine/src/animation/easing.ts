/** Easing maps a normalized progress k ∈ [0,1] to an eased progress. */
export type Easing = (k: number) => number;

export const linear: Easing = (k) => k;

export const easeInQuad: Easing = (k) => k * k;
export const easeOutQuad: Easing = (k) => k * (2 - k);
export const easeInOutQuad: Easing = (k) =>
  k < 0.5 ? 2 * k * k : -1 + (4 - 2 * k) * k;

export const easeInCubic: Easing = (k) => k * k * k;
export const easeOutCubic: Easing = (k) => {
  const f = k - 1;
  return f * f * f + 1;
};
export const easeInOutCubic: Easing = (k) =>
  k < 0.5 ? 4 * k * k * k : (k - 1) * (2 * k - 2) * (2 * k - 2) + 1;

/** Hold the start value until the very end (step interpolation). */
export const hold: Easing = (k) => (k >= 1 ? 1 : 0);

/**
 * Cubic-bezier easing (CSS-style) using Newton's method to invert x(t).
 * Returns an {@link Easing} sampling the curve defined by (x1,y1),(x2,y2).
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Easing {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  const solveT = (x: number): number => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const xt = sampleX(t) - x;
      if (Math.abs(xt) < 1e-6) return t;
      const d = sampleDX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= xt / d;
    }
    return t;
  };

  return (k) => {
    if (k <= 0) return 0;
    if (k >= 1) return 1;
    return sampleY(solveT(k));
  };
}
