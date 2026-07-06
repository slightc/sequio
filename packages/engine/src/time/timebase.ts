/**
 * Unified frame reference. All seeks are quantized to frame boundaries so
 * floating-point drift never accumulates across long timelines.
 *
 * The SDK owns low-level time — the upper layer must not push raw float
 * seconds around without going through a {@link Timebase}.
 */
export class Timebase {
  constructor(readonly fps: number) {
    if (!(fps > 0) || !Number.isFinite(fps)) {
      throw new RangeError(`Timebase fps must be a positive finite number, got ${fps}`);
    }
  }

  /** Seconds → frame index (rounded to the nearest frame). */
  toFrame(sec: number): number {
    return Math.round(sec * this.fps);
  }

  /** Frame index → seconds. */
  toSeconds(frame: number): number {
    return frame / this.fps;
  }

  /** Snap an arbitrary time (seconds) to the nearest frame boundary. */
  quantize(sec: number): number {
    return this.toSeconds(this.toFrame(sec));
  }

  /** Duration of a single frame in seconds. */
  get frameDuration(): number {
    return 1 / this.fps;
  }
}
