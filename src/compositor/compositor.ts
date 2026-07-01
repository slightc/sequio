import { autoDetectRenderer, Container, type Renderer, RenderTexture } from 'pixi.js';
import type { Disposable } from '../core/disposable';
import type { Effect } from '../effects/effect';
import type { Timebase } from '../time/timebase';
import { Reconciler, type RenderContext } from './reconciler';
import type { Track } from './track';
import type { VisualClip } from './clip';
import { GroupClip } from './group-clip';
import { VisualSource } from '../media/media-source';
import { VisualTrack } from './track';
import { TextureManager } from '../texture/texture-manager';

/** A source that can adopt the compositor's shared GPU texture pool. */
interface TextureManagerAware {
  adoptTextureManager(manager: TextureManager): void;
}

function isTextureManagerAware(source: unknown): source is TextureManagerAware {
  return typeof (source as TextureManagerAware).adoptTextureManager === 'function';
}

export interface CompositorOptions {
  width: number;
  height: number;
  timebase: Timebase;
  background?: number;
  /** Prefer the PixiJS v8 WebGPU backend when available. */
  preferWebGPU?: boolean;
  colorSpace?: 'srgb' | 'display-p3';
  /** GPU texture-pool budget in bytes (default 256 MiB). Ignored if {@link textures} is given. */
  textureBudgetBytes?: number;
  /**
   * Share an existing {@link TextureManager} (and thus the decoded/uploaded
   * frames behind it) instead of creating a private one — e.g. an offscreen
   * export compositor reusing the preview's pool so nothing is decoded twice.
   * A shared pool is not disposed when this compositor is disposed.
   */
  textures?: TextureManager;
  /**
   * Backing-store scale for crisp output on HiDPI screens (default
   * `devicePixelRatio`). The canvas draws at `width*resolution` internally while
   * staying `width` CSS px (`autoDensity`).
   */
  resolution?: number;
  /**
   * Look-ahead window (seconds) for cross-clip pre-warming: `prepare(t)` also
   * decodes the first frame of clips that become active within `t + this`, so a
   * clip transition doesn't miss on its first frame in preview. `0` disables it.
   * Default `0.5`.
   */
  prewarmSeconds?: number;
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
  /**
   * Global effects (an adjustment layer over the whole composite). Applied to
   * the root stage, so they affect every track's pixels together — a master
   * colour grade, blur or warp. Preview and export share this pass (contract #3).
   * Mutate freely; the change repaints on the next {@link renderSync}.
   */
  readonly effects: Effect[] = [];
  private readonly attachedEffects = new Set<Effect>();
  /** Shared GPU texture pool; every video source under this compositor uses it. */
  readonly textures: TextureManager;
  /** Whether we own {@link textures} (created it) vs. share an injected one. */
  private readonly ownsTextures: boolean;
  /** Backing-store scale (HiDPI). */
  readonly resolution: number;
  /** Cross-clip pre-warm look-ahead in seconds (mutable at runtime; `0` = off). */
  prewarmSeconds: number;
  private renderer: Renderer | null = null;
  private initPromise: Promise<void> | null = null;
  private dirty = true;
  /** Bumped on every renderPreview so a stale post-decode repaint can be skipped. */
  private previewToken = 0;
  private destroyed = false;

  constructor(readonly options: CompositorOptions) {
    // Hold a (possibly detached) canvas synchronously so the object graph can
    // be built and unit-tested before any GPU context exists. `init()` adopts
    // this canvas as the renderer's output surface.
    this.view = (globalThis.document?.createElement?.('canvas') ??
      ({ width: options.width, height: options.height } as HTMLCanvasElement)) as HTMLCanvasElement;
    this.view.width = options.width;
    this.view.height = options.height;
    this.resolution = options.resolution ?? (globalThis.devicePixelRatio || 1);
    this.prewarmSeconds = options.prewarmSeconds ?? 0.5;
    this.ownsTextures = options.textures === undefined;
    this.textures = options.textures ?? new TextureManager(options.textureBudgetBytes);
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
      resolution: this.resolution,
      autoDensity: true,
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
    // Unmount now (not on the next reconcile) so the track can be safely moved
    // to another compositor without leaving its clips double-mounted.
    this.reconciler.unmountTrack(track, this.stage);
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
  /**
   * Ensure every visual source active at `t` has its frame decoded, plus — for
   * cross-clip pre-warming — the first frame of clips that become active within
   * `t + prewarmSeconds`, so a clip transition doesn't miss on its first frame.
   */
  async prepare(t: number): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const track of this.tracks) {
      if (track instanceof VisualTrack && track.enabled) {
        this.collectPrepareJobs(track.clips, t, this.prewarmSeconds, jobs);
      }
    }
    await Promise.all(jobs);
  }

  /**
   * Walk clips at local time `localT`, prepping the sources of active clips (at
   * their current source time) and of clips upcoming within `warmAhead` (at their
   * first frame). Recurses into {@link GroupClip} children at the group's local
   * time, mirroring how the reconciler renders the same subtree.
   */
  private collectPrepareJobs(
    clips: readonly VisualClip[],
    localT: number,
    warmAhead: number,
    jobs: Promise<void>[],
  ): void {
    for (const clip of clips) {
      const active = clip.isActiveAt(localT);
      // Upcoming: not active yet but starts within the look-ahead window.
      const upcoming = !active && clip.start > localT && clip.start <= localT + warmAhead;
      if (!active && !upcoming) continue;

      if (clip instanceof GroupClip) {
        // Active → recurse at the group's local time; upcoming → at its start (0).
        const childLocal = active ? clip.localTime(localT) : 0;
        this.collectPrepareJobs(clip.children, childLocal, warmAhead, jobs);
        continue;
      }
      const source = (clip as { source?: VisualSource }).source;
      if (source instanceof VisualSource) {
        // Route every source's texture uploads through one VRAM budget.
        if (isTextureManagerAware(source)) source.adoptTextureManager(this.textures);
        // Active → current source time; upcoming → the clip's first frame.
        const sourceTime = active ? localT - clip.start + clip.sourceIn : clip.sourceIn;
        jobs.push(source.prepare(sourceTime));
      }
    }
  }

  /**
   * Synchronously reconcile the scene graph for time `t` and draw one frame
   * using already-ready frames. `render(t)` is a pure function of (graph, t):
   * calling it twice for the same graph and `t` produces the same display tree
   * (SDK contract #2). Draws pixels only once {@link init} has resolved.
   */
  renderSync(t: number): void {
    // Any render supersedes a pending post-decode preview repaint (so a stale
    // seek — or an export driving this same compositor — can't be clobbered).
    this.previewToken++;
    this.reconciler.reconcile(this.tracks, t, this.stage, this.renderContext());
    this.syncStageEffects(t);
    this.renderer?.render({ container: this.stage });
    this.dirty = false;
  }

  /** The GPU context transitions need for offscreen passes (null before init). */
  private renderContext(): RenderContext | undefined {
    if (!this.renderer) return undefined;
    return {
      renderer: this.renderer,
      width: this.options.width,
      height: this.options.height,
      resolution: this.resolution,
    };
  }

  /**
   * Render to an offscreen texture (export / pre-composition). Caller owns the
   * returned {@link RenderTexture} and must `destroy()` it. Requires {@link init}.
   */
  renderToTexture(t: number): RenderTexture {
    if (!this.renderer) {
      throw new Error('Compositor.renderToTexture requires init() first — see todo/01-skeleton.md');
    }
    this.previewToken++; // an offscreen/export render also supersedes a pending repaint
    this.reconciler.reconcile(this.tracks, t, this.stage, this.renderContext());
    this.syncStageEffects(t);
    const target = RenderTexture.create({
      width: this.options.width,
      height: this.options.height,
      resolution: this.resolution,
    });
    this.renderer.render({ container: this.stage, target });
    return target;
  }

  /** Attach newly-added global effects to the stage, update all, detach removed. */
  private syncStageEffects(t: number): void {
    for (const effect of this.effects) {
      if (!this.attachedEffects.has(effect)) {
        effect.attach(this.stage);
        this.attachedEffects.add(effect);
      }
      effect.updateAt(t);
    }
    for (const effect of [...this.attachedEffects]) {
      if (!this.effects.includes(effect)) {
        effect.detach(this.stage);
        this.attachedEffects.delete(effect);
      }
    }
  }

  /**
   * Preview: best-effort prepare + immediate renderSync (may drop frames), then
   * a single repaint of the SAME frame once its async decode resolves. Without
   * that follow-up, seeking (while paused) to a not-yet-decoded position would
   * render a miss and **stay black forever**, since the SDK never repaints on its
   * own. The repaint is skipped if a newer `renderPreview` (seek / playback tick)
   * superseded this one, so smooth playback pays nothing.
   */
  renderPreview(t: number): void {
    const ready = this.prepare(t); // kick off decodes first
    this.renderSync(t); // immediate best-effort (a miss shows the last/empty frame); bumps the token
    const token = this.previewToken; // this render's generation
    void ready.then(() => {
      // Repaint the same frame now that it's decoded — unless a newer render
      // (another seek, a playback tick, or an export) superseded us, or we were
      // disposed. So continuous seeking can't race, and export is untouched.
      if (token === this.previewToken && !this.destroyed) this.renderSync(t);
    });
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
    this.destroyed = true; // stop any pending post-decode repaint
    for (const effect of this.attachedEffects) effect.detach(this.stage);
    this.attachedEffects.clear();
    this.reconciler.clear(this.stage);
    this.tracks.length = 0;
    if (this.ownsTextures) this.textures.dispose(); // keep a shared/injected pool alive
    this.renderer?.destroy();
    this.renderer = null;
    this.initPromise = null;
    this.stage.destroy();
  }
}
