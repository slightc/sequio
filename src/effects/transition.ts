import type { Renderer, RenderTexture, Texture } from 'pixi.js';
import type { Disposable } from '../core/disposable';

/**
 * A transition mixes two textures by a progress value into one output:
 *   (renderer, from, to, progress ∈ [0,1]) → RenderTexture.
 *
 * Implementations (crossfade, wipe, …) composite both inputs on the GPU. The
 * returned RenderTexture is owned/reused by the transition (disposed on
 * {@link dispose}); the caller must not destroy it.
 */
export abstract class Transition implements Disposable {
  /** Transition length, in frames. */
  abstract readonly durationFrames: number;

  abstract render(renderer: Renderer, from: Texture, to: Texture, progress: number): RenderTexture;

  abstract dispose(): void;
}
