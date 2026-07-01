/**
 * Pure radial-distortion math shared by {@link BulgeEffect} and its shader —
 * kept GPU-free so it can be unit-tested and stays the single source of truth
 * for what the fragment shader computes.
 */
import type { Vec2 } from './homography';

/**
 * Given an output UV in `[0,1]` over the object's bounds, return the **source**
 * UV to sample for a radial bulge (`strength > 0`) / pinch (`strength < 0`)
 * around `center` within `radius`. `aspect = width/height` keeps the affected
 * region circular. Points outside `radius` are returned unchanged.
 *
 * The magnitude is scaled down toward the edge (`(1-rn)²`) so the distortion
 * fades smoothly to identity at `r = radius`.
 */
export function bulgeSourceUv(
  uv: Vec2,
  center: Vec2,
  radius: number,
  strength: number,
  aspect: number,
): Vec2 {
  let dx = (uv[0] - center[0]) * aspect;
  const dy = uv[1] - center[1];
  const r = Math.hypot(dx, dy);
  if (r === 0 || r >= radius || radius <= 0) return uv;

  const rn = r / radius;
  const s = 1 - strength * (1 - rn) * (1 - rn);
  const scaled = r * s;
  dx = (dx / r) * scaled;
  const ndy = (dy / r) * scaled;
  return [center[0] + dx / aspect, center[1] + ndy];
}
