import type { Renderer, RenderTexture, Texture } from 'pixi.js';
import type { VisualClip } from '../compositor/clip';
import type { Disposable } from '../core/disposable';

/**
 * A transition mixes two textures by a progress value into one output:
 *   (renderer, from, to, progress ∈ [0,1]) → RenderTexture.
 *
 * Bind it to two clips with {@link between}; the compositor drives it over the
 * clips' **overlap** (the transition window). Implementations (crossfade, wipe,
 * …) composite both inputs on the GPU in {@link render}. The returned
 * RenderTexture is owned/reused by the transition (disposed on {@link dispose});
 * the caller must not destroy it.
 */
export abstract class Transition implements Disposable {
  /** Outgoing clip (shown at progress 0). Set via {@link between}. */
  from: VisualClip | null = null;
  /** Incoming clip (shown at progress 1). Set via {@link between}. */
  to: VisualClip | null = null;

  /**
   * Nominal transition length, in frames — informational (the actual window is
   * the clips' overlap). Handy when authoring: overlap the clips by this many
   * frames to get a transition of this length.
   */
  abstract readonly durationFrames: number;

  /** Bind the two clips this transition blends. Order is direction: `from → to`. */
  between(from: VisualClip, to: VisualClip): this {
    this.from = from;
    this.to = to;
    return this;
  }

  /**
   * The transition window in seconds = the overlap of the two clips' timeline
   * intervals, `[max(starts), min(ends))`. **Derived live** from the clips on
   * every call (never cached), so moving/trimming a clip updates the window and
   * `render(t)` stays a pure function of the graph (contract #2). Returns `null`
   * if unbound or the clips don't overlap.
   */
  windowAt(): { start: number; end: number } | null {
    if (!this.from || !this.to) return null;
    const start = Math.max(this.from.start, this.to.start);
    const end = Math.min(this.from.end, this.to.end);
    return end > start ? { start, end } : null;
  }

  /** Whether the transition is mixing at time `t` (t inside the overlap, half-open). */
  activeAt(t: number): boolean {
    const w = this.windowAt();
    return w != null && t >= w.start && t < w.end;
  }

  /** Progress 0→1 across the window at time `t`, clamped. Returns 0 if no window. */
  progressAt(t: number): number {
    const w = this.windowAt();
    if (!w) return 0;
    const p = (t - w.start) / (w.end - w.start);
    return p < 0 ? 0 : p > 1 ? 1 : p;
  }

  abstract render(renderer: Renderer, from: Texture, to: Texture, progress: number): RenderTexture;

  abstract dispose(): void;
}
