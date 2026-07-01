import { describe, expect, it } from 'vitest';
import { Transition } from '../src/effects/transition';
import { VisualClip } from '../src/compositor/clip';
import { VisualTrack } from '../src/compositor/track';
import type { Container } from 'pixi.js';

/** A concrete Transition with no real GPU render (we only test the timing logic). */
class TestTransition extends Transition {
  readonly durationFrames = 30;
  render(): never {
    throw new Error('not needed for timing tests');
  }
  dispose(): void {}
}

/** A trivial clip with an interval; mount/update/unmount are unused here. */
class Bar extends VisualClip {
  constructor(start: number, end: number) {
    super();
    this.start = start;
    this.end = end;
  }
  mount(): Container {
    return null as unknown as Container;
  }
  update(): void {}
  unmount(): void {}
}

describe('Transition binding + window', () => {
  it('between() sets from/to (order = direction) and is chainable', () => {
    const a = new Bar(0, 2);
    const b = new Bar(1, 3);
    const tr = new TestTransition();
    expect(tr.between(a, b)).toBe(tr);
    expect(tr.from).toBe(a);
    expect(tr.to).toBe(b);
  });

  it('windowAt() is the overlap of the two clip intervals', () => {
    const tr = new TestTransition().between(new Bar(0, 2), new Bar(1, 3));
    expect(tr.windowAt()).toEqual({ start: 1, end: 2 });
  });

  it('windowAt() is null when unbound or the clips do not overlap', () => {
    expect(new TestTransition().windowAt()).toBeNull(); // unbound
    expect(new TestTransition().between(new Bar(0, 1), new Bar(1, 2)).windowAt()).toBeNull(); // touching, no overlap
    expect(new TestTransition().between(new Bar(0, 1), new Bar(2, 3)).windowAt()).toBeNull(); // gap
  });

  it('recomputes the window live when a clip moves (not cached)', () => {
    const a = new Bar(0, 2);
    const b = new Bar(1, 3);
    const tr = new TestTransition().between(a, b);
    expect(tr.windowAt()).toEqual({ start: 1, end: 2 });
    b.start = 0.5; // trim the incoming clip earlier
    expect(tr.windowAt()).toEqual({ start: 0.5, end: 2 });
  });

  it('activeAt() is half-open over the window', () => {
    const tr = new TestTransition().between(new Bar(0, 2), new Bar(1, 3));
    expect(tr.activeAt(0.5)).toBe(false); // before overlap (only A)
    expect(tr.activeAt(1)).toBe(true); // window start
    expect(tr.activeAt(1.5)).toBe(true);
    expect(tr.activeAt(2)).toBe(false); // window end is exclusive (only B)
  });

  it('progressAt() maps the window to 0→1 and clamps outside', () => {
    const tr = new TestTransition().between(new Bar(0, 2), new Bar(1, 3)); // window [1,2)
    expect(tr.progressAt(1)).toBe(0);
    expect(tr.progressAt(1.5)).toBeCloseTo(0.5);
    expect(tr.progressAt(0)).toBe(0); // before → clamped to 0
    expect(tr.progressAt(5)).toBe(1); // after → clamped to 1
    expect(new TestTransition().progressAt(1)).toBe(0); // no window → 0
  });
});

describe('VisualTrack.transitions', () => {
  it('addTransition / removeTransition maintain the list', () => {
    const track = new VisualTrack();
    const tr = new TestTransition();
    track.addTransition(tr);
    expect(track.transitions).toContain(tr);
    track.removeTransition(tr);
    expect(track.transitions).not.toContain(tr);
  });
});
