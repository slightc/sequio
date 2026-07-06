import { createSubscription, type Subscription } from '../core/disposable';
import type { Timebase } from './timebase';

/**
 * A clock only answers "what time is it now". It is decoupled from rendering:
 * the upper layer wires `clock.onTick(t => compositor.renderPreview(t))`.
 *
 * The control surface mirrors an `HTMLMediaElement`: `play()` starts,
 * `pause()` halts, `seek()` jumps. Playback runs over `[0, duration]`; reaching
 * `duration` auto-pauses and fires `onEnded` (like the media `ended` event).
 *
 * Switching between preview and export is just swapping the clock — the
 * render core never changes (SDK contract #3).
 */
export interface Clock {
  /** Current time in seconds. */
  readonly currentTime: number;
  /**
   * Playback end in seconds. Reaching it auto-pauses and fires `onEnded`.
   * `Infinity` (the default) means open-ended — playback never auto-stops.
   * Seeks are clamped to `[0, duration]`.
   */
  duration: number;
  /** Whether playback is paused (mirrors `HTMLMediaElement.paused`). */
  readonly paused: boolean;
  /** Whether playback has reached `duration` (mirrors `HTMLMediaElement.ended`). */
  readonly ended: boolean;
  /** Subscribe to ticks. */
  onTick(cb: (t: number) => void): Subscription;
  /** Fired once each time playback reaches `duration` and auto-pauses. */
  onEnded(cb: () => void): Subscription;
  /** Begin playback. If currently `ended`, restarts from 0. */
  play(): void;
  /** Pause playback; `currentTime` is retained. */
  pause(): void;
  /** Jump to an absolute time (seconds), clamped to `[0, duration]`. */
  seek(t: number): void;
}

abstract class BaseClock implements Clock {
  protected _time = 0;
  protected _paused = true;
  duration = Infinity;
  private readonly tickListeners = new Set<(t: number) => void>();
  private readonly endedListeners = new Set<() => void>();

  get currentTime(): number {
    return this._time;
  }

  get paused(): boolean {
    return this._paused;
  }

  get ended(): boolean {
    return this._time >= this.duration;
  }

  onTick(cb: (t: number) => void): Subscription {
    this.tickListeners.add(cb);
    return createSubscription(() => this.tickListeners.delete(cb));
  }

  onEnded(cb: () => void): Subscription {
    this.endedListeners.add(cb);
    return createSubscription(() => this.endedListeners.delete(cb));
  }

  play(): void {
    if (!this._paused) return;
    // Restarting after the end behaves like a media element: rewind to 0.
    if (this.ended) this.seekInternal(0);
    this._paused = false;
    this.onPlay();
  }

  pause(): void {
    if (this._paused) return;
    this._paused = true;
    this.onPause();
  }

  seek(t: number): void {
    this.seekInternal(t);
    this.emit();
  }

  /** Clamp + apply a time without emitting (subclasses override to track frames). */
  protected seekInternal(t: number): void {
    this._time = this.clampToDuration(t);
  }

  protected clampToDuration(t: number): number {
    if (!(t > 0)) return 0;
    return t > this.duration ? this.duration : t;
  }

  /** Auto-pause + notify when playback reaches `duration`. */
  protected finish(): void {
    this._paused = true;
    this.onPause();
    for (const cb of this.endedListeners) cb();
  }

  protected emit(): void {
    for (const cb of this.tickListeners) cb(this._time);
  }

  protected abstract onPlay(): void;
  protected abstract onPause(): void;
}

/**
 * Wall-clock driven via requestAnimationFrame. Used for preview: it may drop
 * frames to stay responsive (best-effort prepare + immediate renderSync).
 */
export class RealtimeClock extends BaseClock {
  private rafId: number | null = null;
  private lastTs = 0;

  protected override onPlay(): void {
    this.lastTs = 0;
    const loop = (ts: number) => {
      if (this._paused) return;
      if (this.lastTs !== 0) {
        this._time += (ts - this.lastTs) / 1000;
      }
      this.lastTs = ts;
      if (this._time >= this.duration) {
        this._time = this.duration;
        this.emit();
        this.finish();
        return;
      }
      this.emit();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  protected override onPause(): void {
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

  /**
   * Advance exactly one frame and emit. If the new time reaches `duration`,
   * it clamps there, auto-pauses and fires `onEnded`. Returns the new time
   * (seconds).
   */
  tick(): number {
    this.frame += 1;
    this._time = this.timebase.toSeconds(this.frame);
    if (this._time >= this.duration) {
      this._time = this.duration;
      this.frame = this.timebase.toFrame(this._time);
      this.emit();
      this.finish();
      return this._time;
    }
    this.emit();
    return this._time;
  }

  protected override seekInternal(t: number): void {
    this.frame = this.timebase.toFrame(this.clampToDuration(t));
    this._time = this.timebase.toSeconds(this.frame);
  }

  protected override onPlay(): void {
    // Export is driven externally via tick(); keep the frame cursor in sync
    // with currentTime (e.g. after a play()-from-ended rewind to 0).
    this.frame = this.timebase.toFrame(this._time);
  }

  protected override onPause(): void {
    // No timer to tear down — ticking is caller-driven.
  }
}
