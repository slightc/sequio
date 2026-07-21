import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FixedStepClock, RealtimeClock } from '../src/time/clock';
import { Timebase } from '../src/time/timebase';

const tb = new Timebase(30);

describe('Clock (video-element control surface)', () => {
  it('starts paused at time 0', () => {
    const c = new FixedStepClock(tb);
    expect(c.paused).toBe(true);
    expect(c.currentTime).toBe(0);
    expect(c.ended).toBe(false);
  });

  it('play() unpauses and pause() retains currentTime', () => {
    const c = new FixedStepClock(tb);
    c.play();
    expect(c.paused).toBe(false);
    c.tick();
    c.tick();
    c.pause();
    expect(c.paused).toBe(true);
    expect(c.currentTime).toBeCloseTo(2 / 30);
  });

  it('seek() jumps to a frame boundary and emits', () => {
    const c = new FixedStepClock(tb);
    const ticks: number[] = [];
    c.onTick((t) => ticks.push(t));
    c.seek(0.5);
    // 0.5s @30fps = frame 15 exactly.
    expect(c.currentTime).toBeCloseTo(0.5);
    expect(ticks).toEqual([0.5]);
  });

  it('seek() clamps to [0, duration]', () => {
    const c = new FixedStepClock(tb);
    c.duration = 1;
    c.seek(-5);
    expect(c.currentTime).toBe(0);
    c.seek(99);
    expect(c.currentTime).toBeCloseTo(1);
  });

  it('auto-stops at duration and fires onEnded once', () => {
    const c = new FixedStepClock(tb);
    c.duration = 2 / 30; // end after two frames
    const ended = vi.fn();
    c.onEnded(ended);
    c.play();
    c.tick(); // frame 1
    expect(c.ended).toBe(false);
    c.tick(); // frame 2 -> reaches duration
    expect(c.currentTime).toBeCloseTo(2 / 30);
    expect(c.ended).toBe(true);
    expect(c.paused).toBe(true);
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it('play() after ended rewinds to 0', () => {
    const c = new FixedStepClock(tb);
    c.duration = 1 / 30;
    c.play();
    c.tick();
    expect(c.ended).toBe(true);
    c.play();
    expect(c.currentTime).toBe(0);
    expect(c.paused).toBe(false);
    expect(c.ended).toBe(false);
  });

  it('open-ended by default never auto-stops', () => {
    const c = new FixedStepClock(tb);
    c.play();
    for (let i = 0; i < 1000; i++) c.tick();
    expect(c.ended).toBe(false);
    expect(c.paused).toBe(false);
  });

  it('render(t) inputs are idempotent: same frame time after re-seek', () => {
    const c = new FixedStepClock(tb);
    c.seek(0.4);
    const a = c.currentTime;
    c.seek(0.4);
    expect(c.currentTime).toBe(a);
  });
});

describe('RealtimeClock (frame-gated preview)', () => {
  // Drive requestAnimationFrame by hand: capture the pending callback and fire
  // it with a chosen high-res timestamp so we control how "fast" the display
  // refreshes relative to the timebase fps.
  let pending: FrameRequestCallback | null = null;
  let nextId = 0;

  beforeEach(() => {
    pending = null;
    nextId = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      pending = cb;
      return ++nextId;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {
      pending = null;
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  /** Fire the currently-scheduled rAF callback with a timestamp (ms). */
  function refresh(ts: number): void {
    const cb = pending;
    pending = null;
    cb?.(ts);
  }

  it('snaps seeks to the nearest frame boundary', () => {
    const c = new RealtimeClock(tb); // 30fps → frames every 1/30s
    c.seek(0.51); // 0.51*30 = 15.3 → frame 15 → 0.5s
    expect(c.currentTime).toBeCloseTo(0.5);
    c.seek(0.44); // 0.44*30 = 13.2 → frame 13 → 0.4333s
    expect(c.currentTime).toBeCloseTo(13 / 30);
  });

  it('emits once per frame even when the display refreshes faster', () => {
    const c = new RealtimeClock(tb);
    const ticks: number[] = [];
    c.onTick((t) => ticks.push(t));
    c.play();
    // ~125Hz refresh (8ms apart), 30fps timeline → most refreshes land on the
    // same frame and must be coalesced. Frame index = round(t*30).
    refresh(100); // t=0     → frame 0  → emit
    refresh(108); // +8ms    → frame 0  → skip
    refresh(116); // +16ms   → frame 0  → skip
    refresh(124); // +24ms   → frame 1  → emit
    refresh(132); // +32ms   → frame 1  → skip
    refresh(160); // +60ms   → frame 2  → emit
    c.pause();
    // Six display refreshes collapsed to three frame ticks.
    expect(ticks.length).toBe(3);
  });

  it('without a timebase, ticks every refresh (backwards compatible)', () => {
    const c = new RealtimeClock(); // no timebase
    let ticks = 0;
    c.onTick(() => ticks++);
    c.play();
    refresh(100);
    refresh(108);
    refresh(116);
    c.pause();
    expect(ticks).toBe(3);
  });

  it('a seek before play does not double-render the first frame', () => {
    const c = new RealtimeClock(tb);
    const ticks: number[] = [];
    c.seek(0.5); // frame 15
    c.onTick((t) => ticks.push(t));
    c.play();
    refresh(100); // still frame 15, but a fresh play run always paints once
    refresh(108); // +8ms → still frame 15 → skip
    c.pause();
    expect(ticks.length).toBe(1);
    expect(ticks[0]).toBeCloseTo(0.5);
  });
});
