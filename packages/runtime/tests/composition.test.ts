import { describe, expect, it } from 'vitest';
import { COMPOSITION_TAG, defineComposition, isComposition, isTimelineSpec } from '../src/composition';
import type { TimelineSpec } from '@video-editor-canvas/server';

const validSpec: TimelineSpec = {
  width: 640,
  height: 360,
  fps: 30,
  tracks: [{ clips: [{ type: 'text', text: 'hi', start: 0, end: 1 }] }],
};

describe('defineComposition', () => {
  it('wraps a valid spec with the composition tag', () => {
    const comp = defineComposition(validSpec);
    expect(comp.__tag).toBe(COMPOSITION_TAG);
    expect(comp.spec).toBe(validSpec);
    expect(isComposition(comp)).toBe(true);
  });

  it('rejects a non-spec value', () => {
    expect(() => defineComposition({} as TimelineSpec)).toThrow(/width, height and fps/);
  });

  it('rejects non-positive dimensions and fps', () => {
    expect(() => defineComposition({ ...validSpec, width: 0 })).toThrow(/positive/);
    expect(() => defineComposition({ ...validSpec, fps: 0 })).toThrow(/fps/);
  });
});

describe('isComposition / isTimelineSpec', () => {
  it('distinguishes compositions from plain specs and junk', () => {
    expect(isComposition(defineComposition(validSpec))).toBe(true);
    expect(isComposition(validSpec)).toBe(false);
    expect(isComposition(null)).toBe(false);
    expect(isTimelineSpec(validSpec)).toBe(true);
    expect(isTimelineSpec({ width: 1 })).toBe(false);
    expect(isTimelineSpec('nope')).toBe(false);
  });
});
