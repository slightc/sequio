import type { RenderTexture, Texture } from 'pixi.js';
import type { Disposable } from '../core/disposable';

/**
 * A transition mixes two textures by a progress value into one output:
 *   (from, to, progress ∈ [0,1]) → RenderTexture.
 *
 * Implementations (crossfade, wipe, …) run a shader against both inputs.
 */
export abstract class Transition implements Disposable {
  /** Transition length, in frames. */
  abstract readonly durationFrames: number;

  abstract render(from: Texture, to: Texture, progress: number): RenderTexture;

  abstract dispose(): void;
}
