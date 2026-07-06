/**
 * Deterministic export frame timing — pure, so it's unit-testable without a
 * renderer or encoder. Export drives the render core with a fixed step (one
 * frame at a time), never wall-clock, so the output is reproducible (contract #1).
 */

/**
 * The timestamps (seconds) of every frame in `[start, end)` at `fps`. The frame
 * count is `round((end - start) * fps)` and frame `i` is at `start + i / fps` —
 * a half-open range, matching clip intervals. Returns `[]` for an empty/negative
 * span.
 */
export function exportFrameTimes(range: [number, number], fps: number): number[] {
  const [start, end] = range;
  const count = Math.max(0, Math.round((end - start) * fps));
  const times: number[] = new Array(count);
  for (let i = 0; i < count; i++) times[i] = start + i / fps;
  return times;
}
