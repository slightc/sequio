import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Runtime } from '@sequio/runtime';
import { readBundle } from '../src/bundle';

/**
 * Smoke-links the shipped example compositions: snapshot each into a bundle and
 * run it through the runtime up to (not including) the async builder. This
 * resolves every import — the engine classes, `defineComposition`, and the
 * `loadAsset` hook the media demos use — so a typo or a bad import in an example
 * fails here rather than only when a user runs `sequio preview/render`. It does
 * NOT call `compositor.init()` (that's inside the builder), so no GPU is needed.
 */
const DEMOS = [
  'example/index.ts',
  'example/yc-spot/index.ts',
  'example/media-network/index.ts',
  'example/media-local/index.ts',
];

describe('example demos link', () => {
  for (const rel of DEMOS) {
    it(`links ${rel}`, () => {
      const bundle = readBundle(resolve(__dirname, '..', rel));
      const rt = new Runtime({
        ...bundle,
        externals: { gsap: {} }, // yc-spot / index.ts import gsap at module load
        loadAsset: async () => new Blob([new Uint8Array([0])]),
      });
      const composition = rt.runToComposition();
      expect(typeof composition.build).toBe('function');
    });
  }
});
