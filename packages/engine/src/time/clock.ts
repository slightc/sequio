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
 *
 * The display refreshes faster than the timeline's fps (60–144Hz vs. e.g.
 * 30fps), so ticking once per `requestAnimationFrame` would repaint the *same*
 * frame several times a second for nothing. Pass a {@link Timebase} and the
 * clock ticks **once per frame boundary** instead — `currentTime` still tracks
 * the wall clock continuously (so playback never drifts), but `onTick` fires
 * only when time crosses into a new frame, cutting `renderPreview` calls to the
 * timeline's fps. Seeks are snapped to the frame grid too. With no timebase the
 * clock ticks every RAF, exactly as before (backwards compatible).
 */
/**
 * Largest wall-clock step a single `requestAnimationFrame` may advance the
 * playhead (seconds). A hidden tab pauses rAF; on resume the timestamp gap spans
 * the ENTIRE hidden period, and advancing `currentTime` by it would teleport the
 * playhead straight to `duration` (auto-ending playback the moment the tab
 * returns). No legitimate single frame takes this long, so a larger gap is a
 * stall: cap the step and resume ~where we left off (preview may drop frames —
 * contract #1 — so losing the hidden interval is correct, not a jump to the end).
 */
const MAX_REALTIME_STEP = 0.25;

export class RealtimeClock extends BaseClock {
  private rafId: number | null = null;
  private lastTs = 0;
  /** Last frame index handed to `emit()`; -1 forces the next tick to fire. */
  private lastEmittedFrame = -1;

  constructor(private readonly timebase?: Timebase) {
    super();
  }

  protected override onPlay(): void {
    this.lastTs = 0;
    // Force the first tick of this playback run so the starting frame repaints
    // promptly (e.g. after a replay-from-end rewind), even if a prior seek
    // already recorded this frame as emitted.
    this.lastEmittedFrame = -1;
    const loop = (ts: number) => {
      if (this._paused) return;
      if (this.lastTs !== 0) {
        // Cap the step so a backgrounded-tab rAF stall doesn't teleport the
        // playhead to the end when the tab returns (see MAX_REALTIME_STEP).
        this._time += Math.min((ts - this.lastTs) / 1000, MAX_REALTIME_STEP);
      }
      this.lastTs = ts;
      if (this._time >= this.duration) {
        this._time = this.duration;
        this.emit();
        this.finish();
        return;
      }
      this.emitOnFrameChange();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  /**
   * Emit only when the wall clock has advanced into a new frame, so preview
   * repaints at the timebase fps rather than the (higher) display refresh rate.
   * Without a timebase, every RAF ticks (original best-effort behaviour).
   */
  private emitOnFrameChange(): void {
    if (!this.timebase) {
      this.emit();
      return;
    }
    const frame = this.timebase.toFrame(this._time);
    if (frame === this.lastEmittedFrame) return;
    this.lastEmittedFrame = frame;
    this.emit();
  }

  /** Snap seeks to the frame grid (when a timebase is set) so a scrub never
   *  lands on — or decodes — a sub-frame time. */
  protected override seekInternal(t: number): void {
    if (!this.timebase) {
      this._time = this.clampToDuration(t);
      return;
    }
    // Clamp into range, snap to the nearest frame, then re-clamp so a timeline
    // whose duration isn't frame-aligned can't be nudged past its end.
    this._time = this.clampToDuration(this.timebase.quantize(this.clampToDuration(t)));
    this.lastEmittedFrame = this.timebase.toFrame(this._time);
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
