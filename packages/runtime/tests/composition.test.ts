import { describe, expect, it } from 'vitest';
import type { Compositor } from '@video-editor-canvas/engine';
import {
  COMPOSITION_TAG,
  defineComposition,
  deriveDuration,
  isComposition,
} from '../src/composition';

/** A DOM-free stand-in for a Compositor with the fields the runtime reads. */
function fakeCompositor(ends: number[]): Compositor {
  return {
    getTracks: () => [{ clips: ends.map((end) => ({ end })) }],
    dispose() {},
  } as unknown as Compositor;
}

describe('defineComposition', () => {
  it('tags a builder function', () => {
    const build = () => ({ compositor: fakeCompositor([2]), duration: 2 });
    const comp = defineComposition(build);
    expect(comp.__tag).toBe(COMPOSITION_TAG);
    expect(comp.build).toBe(build);
    expect(isComposition(comp)).toBe(true);
  });

  it('rejects a non-function', () => {
    expect(() => defineComposition({} as never)).toThrow(/builder function/);
  });
});

describe('isComposition', () => {
  it('distinguishes compositions from other values', () => {
    expect(isComposition(defineComposition(() => ({ compositor: fakeCompositor([1]) })))).toBe(true);
    expect(isComposition({ __tag: COMPOSITION_TAG })).toBe(false); // no build fn
    expect(isComposition(() => {})).toBe(false);
    expect(isComposition(null)).toBe(false);
  });
});

describe('deriveDuration', () => {
  it('returns the largest clip end across tracks', () => {
    expect(deriveDuration(fakeCompositor([1, 4, 2.5]))).toBe(4);
    expect(deriveDuration(fakeCompositor([]))).toBe(0);
  });
});
