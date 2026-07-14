import { autoDetectRenderer, type AutoDetectOptions, Container, type Renderer, RenderTexture } from 'pixi.js';
import type { Disposable } from '../core/disposable';
import type { Effect } from '../effects/effect';
import { Timebase } from '../time/timebase';
import { Reconciler, type RenderContext } from './reconciler';
import type { Track } from './track';
import type { VisualClip } from './clip';
import { GroupClip } from './group-clip';
import { VisualSource } from '../media/media-source';
import { VisualTrack } from './track';
import { TextureManager } from '../texture/texture-manager';
import { AudioEngine } from '../audio/audio-engine';

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
  /**
   * Frame reference. Times are quantized to its frame grid (contract: seconds at
   * the boundary, frames internally). Optional — pass a {@link Timebase} for full
   * control, or the simpler {@link fps} shortcut, or neither. If both are given
   * `timebase` wins. Read the resolved value back via {@link Compositor.timebase}.
   */
  timebase?: Timebase;
  /**
   * Shorthand for `timebase: new Timebase(fps)`. Ignored if {@link timebase} is
   * given. Defaults to `30` when neither is set, so `new Compositor({ width,
   * height })` just works.
   */
  fps?: number;
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
   * Multisample anti-aliasing (MSAA) for shape/graphics/text edges (default
   * `true`). Rotated or otherwise non-axis-aligned geometry shows stair-step
   * ("jaggy") edges without it. Applied to the on-screen renderer **and** to the
   * offscreen `RenderTexture`s used by export/pre-composition and transitions —
   * in PixiJS v8 MSAA on a render target is a property of that target, not the
   * renderer, so both must opt in for preview and export to match (contract #3).
   * Set `false` to trade edge quality for fill-rate on very large frames.
   */
  antialias?: boolean;
  /**
   * Look-ahead window (seconds) for cross-clip pre-warming: `prepare(t)` also
   * decodes the first frame of clips that become active within `t + this`, so a
   * clip transition doesn't miss on its first frame in preview. `0` disables it.
   * Default `0.5`.
   */
  prewarmSeconds?: number;
  /**
   * Hold the last frame at the timeline's end (default `true`). Clips are active
   * on `[start, end)`, so rendering exactly at the timeline end (the maximum clip
   * end) would show an empty/black frame. With this on, the render time is
   * clamped to the last real frame (`end - 1/fps`) once `t` reaches/passes the
   * end — like a video player freezing on its final frame — so callers can drive
   * the clock all the way to `duration` without the preview going black. Only the
   * very end is affected: any `t` strictly before it (leading black, gaps between
   * clips, clean cuts where another clip starts) renders unchanged. Turn off for
   * a timeline that intends trailing black past its content.
   */
  holdLastFrameAtEnd?: boolean;
  /**
   * Normalized origin of the coordinate frame, `[x, y]` in `0..1` of the canvas.
   * A clip at `transform.position = [0, 0]` renders at `origin · (width, height)`.
   * Default `[0, 0]` (top-left, the PixiJS convention). Set `[0.5, 0.5]` to put
   * the origin at the canvas centre — positions become centre-relative, which is
   * what most editor UIs want. Applied as a translation on the render root, so
   * preview, `renderToTexture`/export and transitions all share it (contract #3).
   */
  origin?: [number, number];
  /**
   * Override how the GPU renderer is created in {@link Compositor.init}. By
   * default {@link init} calls PixiJS `autoDetectRenderer` (WebGPU preferred,
   * WebGL fallback) bound to {@link Compositor.view}. A custom factory lets the
   * SDK run outside a browser — e.g. server-side rendering in Node with a
   * WebGPU binding (Dawn) or a Canvas renderer — by returning any initialized
   * PixiJS `Renderer`. It receives the same options `autoDetectRenderer` would
   * get (including the compositor's `canvas`, `width`, `height`, `resolution`
   * and `background`); the returned renderer must already be `init`ed. The rest
   * of the engine (reconcile, `renderSync`, `renderToTexture`, transitions) is
   * renderer-agnostic, so nothing else changes.
   */
  createRenderer?: (options: Partial<AutoDetectOptions>) => Promise<Renderer>;
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
  /** MSAA for shape/text edges, on the renderer and every offscreen target. */
  readonly antialias: boolean;
  /** Cross-clip pre-warm look-ahead in seconds (mutable at runtime; `0` = off). */
  prewarmSeconds: number;
  /** Freeze the final frame at the timeline end instead of showing black. */
  holdLastFrameAtEnd: boolean;
  /** Normalized coordinate-frame origin (`0..1` of the canvas); default `[0,0]`. */
  readonly origin: readonly [number, number];
  /** Resolved frame reference (from `options.timebase`, else `options.fps`, else 30fps). */
  readonly timebase: Timebase;
  /**
   * The compositor's own audio engine — one per compositor, sharing its
   * {@link timebase}. Schedule audio onto it (`compositor.audioEngine.schedule(
   * clip, source)`); preview drives it alongside the visual clock and export
   * muxes its offline mix, so a composition never has to create or thread its own.
   */
  readonly audioEngine: AudioEngine;
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
    // Resolve the frame reference: explicit timebase wins, else the fps shortcut,
    // else 30fps — so `new Compositor({ width, height })` works with no time setup.
    this.timebase = options.timebase ?? new Timebase(options.fps ?? 30);
    this.audioEngine = new AudioEngine(this.timebase);
    this.resolution = options.resolution ?? (globalThis.devicePixelRatio || 1);
    this.antialias = options.antialias ?? true;
    this.prewarmSeconds = options.prewarmSeconds ?? 0.5;
    this.holdLastFrameAtEnd = options.holdLastFrameAtEnd ?? true;
    this.ownsTextures = options.textures === undefined;
    this.textures = options.textures ?? new TextureManager(options.textureBudgetBytes);
    // Translate the render root so a clip at position [0,0] lands on the origin.
    this.origin = options.origin ?? [0, 0];
    this.applyOrigin(options.width, options.height);
  }

  /** Offset the stage so `[0,0]` maps to `origin · (width, height)`. */
  private applyOrigin(width: number, height: number): void {
    this.stage.position.set(this.origin[0] * width, this.origin[1] * height);
  }

  /** The origin in canvas pixels: `origin · (width, height)`. */
  originPixels(): [number, number] {
    return [this.origin[0] * this.options.width, this.origin[1] * this.options.height];
  }

  /**
   * Create the GPU renderer (WebGPU preferred, WebGL fallback) bound to
   * {@link view}. Must be awaited before any pixels are produced. Idempotent:
   * concurrent / repeat calls share one initialization.
   */
  init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    const options: Partial<AutoDetectOptions> = {
      preference: this.options.preferWebGPU === false ? 'webgl' : 'webgpu',
      canvas: this.view,
      width: this.options.width,
      height: this.options.height,
      background: this.options.background ?? 0x000000,
      resolution: this.resolution,
      antialias: this.antialias,
      autoDensity: true,
    };
    // A custom factory (e.g. server-side WebGPU in Node) can replace autoDetect.
    const create = this.options.createRenderer ?? autoDetectRenderer;
    this.initPromise = create(options).then((renderer) => {
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
    const rt = this.resolveRenderTime(t);
    const jobs: Promise<void>[] = [];
    for (const track of this.tracks) {
      if (track instanceof VisualTrack && track.enabled) {
        this.collectPrepareJobs(track.clips, rt, this.prewarmSeconds, jobs);
      }
    }
    await Promise.all(jobs);
  }

  /** The timeline's end in seconds: the largest clip end across visual tracks
   *  (`0` if there are none). This is the exclusive edge of `[0, end)`. */
  private timelineEnd(): number {
    let end = 0;
    for (const track of this.tracks) {
      if (track instanceof VisualTrack) {
        for (const clip of track.clips) if (clip.end > end) end = clip.end;
      }
    }
    return end;
  }

  /**
   * Map a requested time to the time actually rendered. Normally the identity;
   * with {@link holdLastFrameAtEnd} (default), a `t` at or past the timeline end
   * is pulled back to the **last real frame** so the final frame isn't the empty
   * `[start, end)` boundary. `t` strictly before the end (leading black, gaps,
   * cuts) is untouched — so only the very end freezes, not gaps.
   *
   * The held time is the last frame *boundary* — `toSeconds(toFrame(end) - 1)` —
   * not `end - ε`. This is a frame-quantized engine: the last frame that exists
   * is `N-1` (`N = toFrame(end)`), which is exactly what `exportFrameTimes` emits
   * as its final frame (contract #3). Rendering closer to `end` wouldn't gain a
   * "more final" frame — for video it would round *up* to the non-existent frame
   * `N` (`frameIndexAt = round(t·fps)`) and miss.
   */
  private resolveRenderTime(t: number): number {
    if (!this.holdLastFrameAtEnd) return t;
    const end = this.timelineEnd();
    if (!(end > 0) || !Number.isFinite(end) || t < end) return t;
    const tb = this.timebase;
    const last = tb.toSeconds(tb.toFrame(end) - 1); // last real frame = export's final frame
    return last > 0 ? last : 0;
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
        // Decode the frame the clip will actually SHOW — via the clip's own
        // source-time mapping, so `speed` and `reversed` (倒放) are honoured and
        // prepare (decode) stays in lockstep with update (render). Active → the
        // current source time; upcoming → the clip's first shown frame (at start).
        const sourceTime = clip.sourceTimeAt(active ? localT : clip.start);
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
    const rt = this.resolveRenderTime(t); // hold the last frame at the very end
    this.reconciler.reconcile(this.tracks, rt, this.stage, this.renderContext());
    this.syncStageEffects(rt);
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
      antialias: this.antialias,
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
    const rt = this.resolveRenderTime(t); // hold the last frame at the very end
    this.reconciler.reconcile(this.tracks, rt, this.stage, this.renderContext());
    this.syncStageEffects(rt);
    const target = RenderTexture.create({
      width: this.options.width,
      height: this.options.height,
      resolution: this.resolution,
      antialias: this.antialias,
    });
    // Clear to the compositor's background (opaque), matching what `renderSync`
    // draws to the on-screen canvas — otherwise the offscreen frame keeps the
    // RenderTexture's transparent default, and an alpha-unaware encoder (e.g. the
    // Node export's H.264/VP9) turns transparency into a white matte / fringe
    // around opaque content. Preview and export must share the background (#3).
    const bg = this.options.background ?? 0x000000;
    const clearColor: [number, number, number, number] = [
      ((bg >> 16) & 0xff) / 255,
      ((bg >> 8) & 0xff) / 255,
      (bg & 0xff) / 255,
      1,
    ];
    this.renderer.render({ container: this.stage, target, clear: true, clearColor });
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
    this.applyOrigin(w, h); // keep the origin at the same normalized point
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
    this.audioEngine.dispose();
    if (this.ownsTextures) this.textures.dispose(); // keep a shared/injected pool alive
    this.renderer?.destroy();
    this.renderer = null;
    this.initPromise = null;
    this.stage.destroy();
  }
}
