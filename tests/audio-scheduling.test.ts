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
    expect(clipPlaybackAt(c, 0)).toEqual({ when: 2, offset: 0, duration: 3, playbackRate: 1 });
  });

  it('starts mid-clip when the playhead is inside it', () => {
    const c = clip({ start: 2, end: 5, sourceIn: 1 });
    // playhead 3 → play from timeline 3 (0.5s in? no, offset = sourceIn + (3-2)*1 = 2)
    expect(clipPlaybackAt(c, 3)).toEqual({ when: 0, offset: 2, duration: 2, playbackRate: 1 });
  });

  it('maps speed to buffer seconds (offset, duration and rate)', () => {
    const c = clip({ start: 0, end: 4, sourceIn: 0, speed: 2 });
    // playhead 1 → span 3 real seconds, consumes 6 buffer seconds from offset 2
    expect(clipPlaybackAt(c, 1)).toEqual({ when: 0, offset: 2, duration: 6, playbackRate: 2 });
  });

  it('returns null once the clip has finished', () => {
    const c = clip({ start: 0, end: 3 });
    expect(clipPlaybackAt(c, 3)).toBeNull();
    expect(clipPlaybackAt(c, 4)).toBeNull();
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
