import { describe, expect, it } from 'vitest';
import { AudioClip } from '../src/compositor/clip';
import {
  clipPlaybackAt,
  effectiveGain,
  fadeFactor,
  gainEventsAt,
} from '../src/audio/scheduling';

function clip(props: Partial<AudioClip>): AudioClip {
  const c = new AudioClip();
  Object.assign(c, props);
  return c;
}

describe('clipPlaybackAt', () => {
  it('schedules a clip that starts after the playhead', () => {
    const c = clip({ start: 2, end: 5, sourceIn: 0 });
    expect(clipPlaybackAt(c, 0)).toEqual({
      when: 2,
      offset: 0,
      duration: 3,
      playbackRate: 1,
      reversed: false,
    });
  });

  it('starts mid-clip when the playhead is inside it', () => {
    const c = clip({ start: 2, end: 5, sourceIn: 1 });
    // playhead 3 → play from timeline 3 (0.5s in? no, offset = sourceIn + (3-2)*1 = 2)
    expect(clipPlaybackAt(c, 3)).toEqual({
      when: 0,
      offset: 2,
      duration: 2,
      playbackRate: 1,
      reversed: false,
    });
  });

  it('maps speed to buffer seconds (offset, duration and rate)', () => {
    const c = clip({ start: 0, end: 4, sourceIn: 0, speed: 2 });
    // playhead 1 → span 3 real seconds, consumes 6 buffer seconds from offset 2
    expect(clipPlaybackAt(c, 1)).toEqual({
      when: 0,
      offset: 2,
      duration: 6,
      playbackRate: 2,
      reversed: false,
    });
  });

  it('returns null once the clip has finished', () => {
    const c = clip({ start: 0, end: 3 });
    expect(clipPlaybackAt(c, 3)).toBeNull();
    expect(clipPlaybackAt(c, 4)).toBeNull();
  });

  it('倒放: offsets into the reversed buffer so source time counts down', () => {
    // clip plays timeline [0,4) reversed over a 10s buffer, sourceIn 0.
    // Forward would consume buffer [0,4); reversed walks it down from 4 → 0, i.e.
    // reversed-copy positions (10-4)=6 → 10.
    const c = clip({ start: 0, end: 4, sourceIn: 0, reversed: true });
    expect(clipPlaybackAt(c, 0, 10)).toEqual({
      when: 0,
      offset: 6,
      duration: 4,
      playbackRate: 1,
      reversed: true,
    });
  });

  it('倒放: mid-clip playhead flips the remaining window into the reversed buffer', () => {
    // Same clip, entering at playhead 1: source starts at (end-1)=3 and counts
    // down to 0 (reversed positions 7 → 10), consuming 3s from reversed offset 7.
    const c = clip({ start: 0, end: 4, sourceIn: 0, reversed: true });
    expect(clipPlaybackAt(c, 1, 10)).toEqual({
      when: 0,
      offset: 7,
      duration: 3,
      playbackRate: 1,
      reversed: true,
    });
  });

  it('倒放: honours sourceIn and speed when flipping the offset', () => {
    // sourceIn 2, speed 2, timeline [0,3): forward window is [2, 2+6)=[2,8);
    // reversed highest source time = 2 + 3*2 = 8 → reversed offset 20-8 = 12.
    const c = clip({ start: 0, end: 3, sourceIn: 2, speed: 2, reversed: true });
    expect(clipPlaybackAt(c, 0, 20)).toEqual({
      when: 0,
      offset: 12,
      duration: 6,
      playbackRate: 2,
      reversed: true,
    });
  });
});

describe('AudioClip.sourceTimeAt (time remap)', () => {
  it('walks the source window up for forward playback', () => {
    const c = clip({ start: 1, end: 5, sourceIn: 2, speed: 2 });
    expect(c.sourceTimeAt(1)).toBe(2); // at start → sourceIn
    expect(c.sourceTimeAt(3)).toBe(6); // sourceIn + (3-1)*2
    expect(c.sourceTimeAt(5)).toBe(10); // end of window
  });

  it('倒放: walks the SAME window down to sourceIn', () => {
    const c = clip({ start: 1, end: 5, sourceIn: 2, speed: 2, reversed: true });
    expect(c.sourceTimeAt(1)).toBe(10); // at start → far end of the window
    expect(c.sourceTimeAt(3)).toBe(6); // mirrors the forward frame
    expect(c.sourceTimeAt(5)).toBe(2); // at end → sourceIn
  });
});

describe('fadeFactor / effectiveGain', () => {
  it('ramps in over fadeIn and out over fadeOut', () => {
    const c = clip({ start: 0, end: 10, fadeIn: 2, fadeOut: 2 });
    expect(fadeFactor(c, 0)).toBe(0);
    expect(fadeFactor(c, 1)).toBeCloseTo(0.5);
    expect(fadeFactor(c, 2)).toBe(1);
    expect(fadeFactor(c, 5)).toBe(1); // full in the middle
    expect(fadeFactor(c, 9)).toBeCloseTo(0.5);
    expect(fadeFactor(c, 10)).toBe(0);
  });

  it('multiplies gain automation by the fade envelope', () => {
    const c = clip({ start: 0, end: 4, fadeIn: 2 });
    c.gain.setStatic(0.5);
    expect(effectiveGain(c, 1)).toBeCloseTo(0.5 * 0.5); // half gain, half faded-in
    expect(effectiveGain(c, 3)).toBeCloseTo(0.5); // fully in
  });
});

describe('gainEventsAt', () => {
  it('emits the fade corners for a static gain', () => {
    const c = clip({ start: 0, end: 10, fadeIn: 2, fadeOut: 2 });
    c.gain.setStatic(1);
    const events = gainEventsAt(c, 0);
    // corners: 0, 2, 8, 10
    expect(events.map((e) => e.when)).toEqual([0, 2, 8, 10]);
    expect(events.map((e) => Number(e.value.toFixed(3)))).toEqual([0, 1, 1, 0]);
  });

  it('samples a keyframed gain across the clip', () => {
    const c = clip({ start: 0, end: 1 });
    c.gain.setKeyframes([
      { time: 0, value: 0 },
      { time: 1, value: 1 },
    ]);
    const events = gainEventsAt(c, 0, 0.25);
    expect(events.length).toBeGreaterThan(2); // sampled, not just corners
    expect(events[0]!.value).toBeCloseTo(0);
    expect(events[events.length - 1]!.value).toBeCloseTo(1);
  });

  it('is empty for a clip already finished at the playhead', () => {
    const c = clip({ start: 0, end: 2 });
    expect(gainEventsAt(c, 2)).toEqual([]);
  });
});
