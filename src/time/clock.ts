import { createSubscription, type Subscription } from '../core/disposable';
import type { Timebase } from './timebase';

/**
 * A clock only answers "what time is it now". It is decoupled from rendering:
 * the upper layer wires `clock.onTick(t => compositor.renderPreview(t))`.
 *
 * Switching between preview and export is just swapping the clock — the
 * render core never changes (SDK contract #3).
 */
export interface Clock {
  /** Current time in seconds. */
  readonly currentTime: number;
  /** Whether the clock is currently running. */
  readonly running: boolean;
  /** Subscribe to ticks. */
  onTick(cb: (t: number) => void): Subscription;
  start(): void;
  stop(): void;
  /** Jump to an absolute time (seconds). */
  seek(t: number): void;
}

abstract class BaseClock implements Clock {
  protected _time = 0;
  protected _running = false;
  private readonly listeners = new Set<(t: number) => void>();

  get currentTime(): number {
    return this._time;
  }

  get running(): boolean {
    return this._running;
  }

  onTick(cb: (t: number) => void): Subscription {
    this.listeners.add(cb);
    return createSubscription(() => this.listeners.delete(cb));
  }

  seek(t: number): void {
    this._time = t;
    this.emit();
  }

  protected emit(): void {
    for (const cb of this.listeners) cb(this._time);
  }

  abstract start(): void;
  abstract stop(): void;
}

/**
 * Wall-clock driven via requestAnimationFrame. Used for preview: it may drop
 * frames to stay responsive (best-effort prepare + immediate renderSync).
 */
export class RealtimeClock extends BaseClock {
  private rafId: number | null = null;
  private lastTs = 0;

  override start(): void {
    if (this._running) return;
    this._running = true;
    this.lastTs = 0;
    const loop = (ts: number) => {
      if (!this._running) return;
      if (this.lastTs !== 0) {
        this._time += (ts - this.lastTs) / 1000;
      }
      this.lastTs = ts;
      this.emit();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  override stop(): void {
    this._running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}

/**
 * Deterministic fixed-step clock. Used for export: advances exactly one frame
 * per {@link tick}, so every render is reproducible (SDK contract #2).
 */
export class FixedStepClock extends BaseClock {
  private frame = 0;

  constructor(private readonly timebase: Timebase) {
    super();
  }

  /** Advance exactly one frame and emit. Returns the new time (seconds). */
  tick(): number {
    this.frame += 1;
    this._time = this.timebase.toSeconds(this.frame);
    this.emit();
    return this._time;
  }

  override seek(t: number): void {
    this.frame = this.timebase.toFrame(t);
    this._time = this.timebase.toSeconds(this.frame);
    this.emit();
  }

  override start(): void {
    this._running = true;
  }

  override stop(): void {
    this._running = false;
  }
}
