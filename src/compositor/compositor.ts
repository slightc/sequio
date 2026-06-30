import type { RenderTexture } from 'pixi.js';
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
 */
export class Compositor implements Disposable {
  readonly view: HTMLCanvasElement;
  private readonly tracks: Track[] = [];
  private readonly reconciler = new Reconciler();
  private dirty = true;

  constructor(readonly options: CompositorOptions) {
    // TODO(compositor): create a PIXI.Application / Renderer (WebGPU→WebGL
    // fallback), a root stage Container, and size the canvas. For now we hold
    // a detached canvas so the object graph can be built and unit-tested.
    this.view = (globalThis.document?.createElement?.('canvas') ??
      ({ width: options.width, height: options.height } as HTMLCanvasElement)) as HTMLCanvasElement;
    this.view.width = options.width;
    this.view.height = options.height;
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

  /** Synchronously reconcile + draw one frame using already-ready frames. */
  renderSync(_t: number): void {
    // TODO(compositor): this.reconciler.reconcile(...); this.renderer.render(stage)
    throw new Error('Compositor.renderSync not implemented — see todo/01-skeleton.md');
  }

  /** Render to an offscreen texture (export / pre-composition). */
  renderToTexture(_t: number): RenderTexture {
    throw new Error('Compositor.renderToTexture not implemented — see todo/07-exporter.md');
  }

  /** Preview: best-effort prepare + immediate renderSync (may drop frames). */
  renderPreview(t: number): void {
    void this.prepare(t); // fire-and-forget; misses fall back to last frame
    this.renderSync(t);
  }

  resize(w: number, h: number): void {
    this.view.width = w;
    this.view.height = h;
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
    // reconciler.clear(stage); renderer.destroy(); etc.
    this.tracks.length = 0;
  }
}
