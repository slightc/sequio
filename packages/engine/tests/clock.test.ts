import { describe, expect, it, vi } from 'vitest';
import { FixedStepClock } from '../src/time/clock';
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
