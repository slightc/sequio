import { Texture as PixiTexture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import * as engine from '../src/index';

/**
 * The engine is the single gateway to PixiJS / Mediabunny (see AGENT.md): a
 * consumer builds a custom `VisualSource` (`getTextureAt(): Texture`) or loads
 * the muxer without importing `pixi.js` / `mediabunny` directly. These guard
 * that the barrel keeps re-exporting the peer surface consumers rely on, so the
 * boundary can't silently regress.
 */
describe('public barrel re-exports the peer surface', () => {
  it('re-exports the PixiJS `Texture` value (identical to the peer)', () => {
    expect(engine.Texture).toBe(PixiTexture);
  });

  it('re-exports the Mediabunny gateway so consumers never `import("mediabunny")`', () => {
    expect(typeof engine.loadMediabunny).toBe('function');
    expect(typeof engine.setMediabunnyModule).toBe('function');
  });
});
