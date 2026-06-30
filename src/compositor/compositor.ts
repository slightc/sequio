import { autoDetectRenderer, Container, type Renderer, RenderTexture } from 'pixi.js';
import type { Disposable } from '../core/disposable';
import type { Timebase } from '../time/timebase';
import { Reconciler } from './reconciler';
import type { Track } from './track';
import { VisualSource } from '../media/media-source';
import { VisualTrack } from './track';

export interface CompositorOptions {
  width: number;
  height: number;
  timebase: Timebase;
  background?: number;
  /** Prefer the PixiJS v8 WebGPU backend when available. */
  preferWebGPU?: boolean;
  colorSpace?: 'srgb' | 'display-p3';
}

/**
 * Engine root. Owns the PixiJS renderer, the track graph and the reconciler.
 *
 * The two-phase `prepare` / `renderSync` split is the heart of the engine
 * (SDK contract #1): preview does best-effort prepare then renders immediately;
 * export awaits prepare so no frame is ever dropped.
 *
 * Construction is synchronous so the object graph can be built (and unit-tested)
 * without a GPU. The renderer is created lazily by {@link init}; until then
 * `renderSync` still reconciles the scene graph but draws no pixels.
 */
export class Compositor implements Disposable {
  /** The output canvas. Stable across the lifetime of the compositor. */
  readonly view: HTMLCanvasElement;
  /** Root of the PixiJS display tree; reconciled every frame. */
  private readonly stage = new Container();
  private readonly tracks: Track[] = [];
  private readonly reconciler = new Reconciler();
  private renderer: Renderer | null = null;
  private initPromise: Promise<void> | null = null;
  private dirty = true;

  constructor(readonly options: CompositorOptions) {
    // Hold a (possibly detached) canvas synchronously so the object graph can
    // be built and unit-tested before any GPU context exists. `init()` adopts
    // this canvas as the renderer's output surface.
    this.view = (globalThis.document?.createElement?.('canvas') ??
      ({ width: options.width, height: options.height } as HTMLCanvasElement)) as HTMLCanvasElement;
    this.view.width = options.width;
    this.view.height = options.height;
  }

  /**
   * Create the GPU renderer (WebGPU preferred, WebGL fallback) bound to
   * {@link view}. Must be awaited before any pixels are produced. Idempotent:
   * concurrent / repeat calls share one initialization.
   */
  init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = autoDetectRenderer({
      preference: this.options.preferWebGPU === false ? 'webgl' : 'webgpu',
      canvas: this.view,
      width: this.options.width,
      height: this.options.height,
      background: this.options.background ?? 0x000000,
    }).then((renderer) => {
      this.renderer = renderer;
    });
    return this.initPromise;
  }

  /** Whether the GPU renderer has been created. */
  get isInitialized(): boolean {
    return this.renderer !== null;
  }

  // ── Track graph ────────────────────────────────────────────────────────
  addTrack(track: Track): void {
    this.tracks.push(track);
    this.invalidate();
  }

  removeTrack(track: Track): void {
    const i = this.tracks.indexOf(track);
    if (i >= 0) this.tracks.splice(i, 1);
    this.invalidate();
  }

  moveTrack(track: Track, zIndex: number): void {
    track.zIndex = zIndex;
    this.invalidate();
  }

  /** Read-only snapshot of the track list (sorted by z when rendering). */
  getTracks(): readonly Track[] {
    return this.tracks;
  }

  // ── Two-phase render ─────────────────────────────────────────────────────
  /** Ensure every visual source active at `t` has its frame decoded. */
  async prepare(t: number): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const track of this.tracks) {
      if (track instanceof VisualTrack) {
        for (const clip of track.activeAt(t)) {
          const source = (clip as { source?: VisualSource }).source;
          if (source instanceof VisualSource) {
            const sourceTime = t - clip.start + clip.sourceIn;
            jobs.push(source.prepare(sourceTime));
          }
        }
      }
    }
    await Promise.all(jobs);
  }

  /**
   * Synchronously reconcile the scene graph for time `t` and draw one frame
   * using already-ready frames. `render(t)` is a pure function of (graph, t):
   * calling it twice for the same graph and `t` produces the same display tree
   * (SDK contract #2). Draws pixels only once {@link init} has resolved.
   */
  renderSync(t: number): void {
    this.reconciler.reconcile(this.tracks, t, this.stage);
    this.renderer?.render({ container: this.stage });
    this.dirty = false;
  }

  /**
   * Render to an offscreen texture (export / pre-composition). Caller owns the
   * returned {@link RenderTexture} and must `destroy()` it. Requires {@link init}.
   */
  renderToTexture(t: number): RenderTexture {
    if (!this.renderer) {
      throw new Error('Compositor.renderToTexture requires init() first — see todo/01-skeleton.md');
    }
    this.reconciler.reconcile(this.tracks, t, this.stage);
    const target = RenderTexture.create({
      width: this.options.width,
      height: this.options.height,
    });
    this.renderer.render({ container: this.stage, target });
    return target;
  }

  /** Preview: best-effort prepare + immediate renderSync (may drop frames). */
  renderPreview(t: number): void {
    void this.prepare(t); // fire-and-forget; misses fall back to last frame
    this.renderSync(t);
  }

  resize(w: number, h: number): void {
    this.view.width = w;
    this.view.height = h;
    this.renderer?.resize(w, h);
    this.invalidate();
  }

  /** Mark dirty so the upper layer schedules a redraw. */
  invalidate(): void {
    this.dirty = true;
  }

  get isDirty(): boolean {
    return this.dirty;
  }

  dispose(): void {
    this.reconciler.clear(this.stage);
    this.tracks.length = 0;
    this.renderer?.destroy();
    this.renderer = null;
    this.initPromise = null;
    this.stage.destroy();
  }
}
