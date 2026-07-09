import type { Texture } from 'pixi.js';
import { FrameCache } from './frame-cache';
import { type MediabunnyDemux, MediabunnyVideoDecoder, type VideoInput } from './mediabunny-decoder';
import { type SourceMetadata, VisualSource } from './media-source';
import type { DecodedFrame, VideoDecoderBackend } from './video-decoder';
import { TextureManager } from '../texture/texture-manager';

let nextSourceId = 0;

export interface VideoSourceOptions {
  /** Source URL, an already-fetched buffer, or a Blob/File. */
  src: VideoInput;
  /** How many frames to keep decoded in the ring buffer. */
  cacheFrames?: number;
  /** How many frames to read ahead in the playback direction. */
  lookahead?: number;
  /**
   * Decode backend. Defaults to {@link MediabunnyVideoDecoder}. Injectable for
   * tests or an alternative decoder (e.g. an `ffmpeg.wasm` fallback).
   */
  backend?: VideoDecoderBackend;
  /**
   * Shared GPU texture pool. Defaults to a private one; a Compositor injects
   * (or adopts) its own so all sources share one VRAM budget (contract #4).
   */
  textureManager?: TextureManager;
}

/**
 * Hardware-accelerated video decode via WebCodecs, driven by Mediabunny.
 *
 * Pipeline: {@link VideoDecoderBackend} (Mediabunny `Input` + `VideoSampleSink`)
 * → {@link FrameCache} (ring + LRU) → {@link TextureManager} (VRAM budget).
 * `prepare(t)` decodes the frame at `t` into the cache and kicks off directional
 * lookahead; `getTextureAt(t)` reads the cache synchronously and uploads/reuses
 * a `Texture` keyed by `sourceId:frameIdx` (miss → `null`, preview reuses the
 * last frame). The async `prepare` / sync `getTextureAt` split is contract #1.
 *
 * Frame indices assume constant frame rate; the cache keys a requested time `t`
 * to `round(t * fps)`. (VFR-accurate keying is a later refinement.)
 */
export class VideoSource extends VisualSource {
  private readonly id = nextSourceId++;
  private readonly backend: VideoDecoderBackend;
  private readonly cache: FrameCache<DecodedFrame>;
  /** In-flight decodes by frame index → their promise, so callers can await them. */
  private readonly inFlight = new Map<number, Promise<void>>();
  private lookahead: number;
  private textures: TextureManager;
  private ownsTextures: boolean;
  private fps = 30;
  private lastSec: number | null = null;
  /**
   * Serializes decode dispatch AND lets a newer seek shed a stale backlog: a
   * fast scrub fires many `prepare`s, and without this every intermediate
   * position (plus its look-ahead) would queue a decode, so the decoder keeps
   * chewing through frames nobody wants long after the drag ends. Each queued
   * decode re-checks {@link wanted} at the head of the lane and skips itself if
   * a later seek has moved the playhead far away — so scrubbing settles on the
   * final frame instead of piling up.
   */
  private decodeLane: Promise<unknown> = Promise.resolve();
  /** Frame index of the most recent {@link prepare} target (the live playhead). */
  private currentIdx = 0;
  /** How far a queued decode may fall behind the playhead before it's dropped. */
  private dropHorizon: number;
  /** In-flight reverse batch decode, so a fast reverse scrub coalesces onto it. */
  private reverseInFlight: Promise<void> | null = null;

  constructor(private readonly options: VideoSourceOptions) {
    super();
    this.backend = options.backend ?? new MediabunnyVideoDecoder(options.src);
    this.lookahead = options.lookahead ?? 3;
    // Keep the whole look-ahead window (and a little slack for playback drift)
    // decodable; only genuine seek jumps beyond it get shed.
    this.dropHorizon = this.lookahead + 8;
    this.textures = options.textureManager ?? new TextureManager();
    this.ownsTextures = options.textureManager === undefined;
    // When a frame leaves the decode cache, release its GPU texture so VRAM
    // tracks decoder memory.
    this.cache = new FrameCache<DecodedFrame>(options.cacheFrames ?? 60, (idx) => {
      this.textures.release(this.textureKey(idx));
    });
  }

  async load(): Promise<SourceMetadata> {
    const meta = await this.backend.load();
    this.metadata = meta;
    if (meta.fps && meta.fps > 0) this.fps = meta.fps;
    return meta;
  }

  /**
   * Resize the decode cache (and directional look-ahead) in place. Cache sizing
   * depends on the source resolution, which is only known after {@link load};
   * this lets a caller size the ring to the resolution WITHOUT disposing and
   * re-`load()`ing the source (which would re-demux and, for a URL, re-fetch the
   * container header + packet stats). {@link fork} inherits the new values so an
   * export stays bounded too. No-op below 1 frame.
   */
  configureCache(cacheFrames: number, lookahead?: number): void {
    this.cache.setBudget(cacheFrames);
    this.options.cacheFrames = Math.max(1, cacheFrames);
    if (lookahead !== undefined) {
      this.lookahead = Math.max(1, lookahead);
      this.options.lookahead = this.lookahead;
      this.dropHorizon = this.lookahead + 8;
    }
  }

  /**
   * A second `VideoSource` over the SAME demuxed input (no re-parse) but with its
   * own decoder + frame cache, so a preview and an export can decode the source
   * in parallel without contending on one decoder. The fork starts with a private
   * texture pool (a compositor adopts a shared one on `prepare`); `await` its
   * `load()` before use and `dispose()` it when done — that won't tear down the
   * shared demux. Throws if the backend can't fork.
   */
  fork(): VideoSource {
    if (!this.backend.fork) throw new Error('this VideoSource cannot be forked (backend has no fork())');
    return new VideoSource({ ...this.options, backend: this.backend.fork(), textureManager: undefined });
  }

  /**
   * The opened mediabunny demux (Input + audio track), if the default backend is
   * in use — so an {@link AudioSource} can decode this source's audio from the
   * SAME Input rather than re-opening (and re-fetching) the file. Returns `null`
   * for a custom backend or before {@link load}.
   */
  getMediabunnyDemux(): MediabunnyDemux | null {
    return this.backend instanceof MediabunnyVideoDecoder ? this.backend.getDemux() : null;
  }

  /** Adopt a shared texture pool (unless one was explicitly injected). */
  adoptTextureManager(manager: TextureManager): void {
    if (!this.ownsTextures || this.textures === manager) return;
    this.textures.dispose(); // the private default is still empty at adoption time
    this.textures = manager;
    this.ownsTextures = false;
  }

  /** Map a source time (seconds) to a constant-frame-rate frame index. */
  frameIndexAt(sec: number): number {
    return Math.max(0, Math.round(sec * this.fps));
  }

  async prepare(sourceTime: number): Promise<void> {
    if (!this.metadata) throw new Error('VideoSource.prepare before load()');
    const idx = this.frameIndexAt(sourceTime);
    const dir = this.lastSec === null || sourceTime >= this.lastSec ? 1 : -1;
    this.lastSec = sourceTime;
    this.currentIdx = idx; // move the playhead so stale queued decodes shed themselves

    // Reverse playback (倒放): decoding backward one frame at a time re-seeks to
    // the GOP keyframe and re-decodes the prefix EVERY frame (O(GOP²), the source
    // of the "倒放解码很慢" stutter). If the backend can range-decode, fill a whole
    // cache batch by decoding a window FORWARD once and serve it in reverse.
    if (dir < 0 && this.backend.decodeRange) {
      await this.ensureReverseWindow(idx);
      return;
    }

    await this.ensure(idx, sourceTime);

    // Directional lookahead: fire-and-forget so preview never blocks on it.
    for (let i = 1; i <= this.lookahead; i++) {
      const j = idx + dir * i;
      if (j < 0) continue;
      void this.ensure(j, j / this.fps);
    }
  }

  /**
   * Ensure frame `idx` is cached for reverse playback. When it's missing we've
   * dropped below the last decoded batch, so decode `[idx-batch+1 .. idx]`
   * FORWARD in one sweep (each frame decoded once) and cache the lot; the next
   * `batch-1` backward steps are then cache hits — the O(GOP²)→O(GOP) win.
   * Concurrent callers (a fast reverse scrub) coalesce onto the running batch.
   */
  private async ensureReverseWindow(idx: number): Promise<void> {
    if (this.cache.has(idx)) return;
    if (this.reverseInFlight) {
      await this.reverseInFlight;
      return this.ensureReverseWindow(idx); // re-check for THIS idx post-batch
    }
    const p = this.decodeReverseBatch(idx).finally(() => {
      this.reverseInFlight = null;
    });
    this.reverseInFlight = p;
    return p;
  }

  /** Decode a forward window ending at `idx` into the cache (reverse batch fill). */
  private async decodeReverseBatch(idx: number): Promise<void> {
    const range = this.backend.decodeRange?.bind(this.backend);
    if (!range) return this.ensure(idx, idx / this.fps); // no fast path → single frame
    // Batch the whole cache budget: bigger batch → the per-GOP keyframe seek is
    // amortised over more served frames. Bounded by the budget, so reverse holds
    // no more decoder memory than forward (contract #4). Frames decoded here are
    // fresher than any leftover, so an over-budget fill evicts the leftovers, not
    // this batch (FrameCache is LRU-oldest-first).
    const batch = Math.max(1, this.options.cacheFrames ?? 60);
    const lo = Math.max(0, idx - batch + 1);
    const fromSec = lo / this.fps;
    const toSec = (idx + 0.5) / this.fps; // half a frame past idx (end is exclusive)
    for await (const frame of range(fromSec, toSec)) {
      const i = this.frameIndexAt(frame.timestamp);
      if (this.cache.has(i)) frame.close();
      else this.cache.put(i, frame);
    }
  }

  getTextureAt(sourceTime: number): Texture | null {
    if (!this.metadata) return null;
    const idx = this.frameIndexAt(sourceTime);
    const frame = this.cache.get(idx);
    if (!frame) return null; // miss → preview keeps the last frame
    return this.textures.acquireOrUpload(this.textureKey(idx), frame.image);
  }

  /** Number of decoded frames currently resident (test/diagnostic hook). */
  get cachedFrameCount(): number {
    return this.cache.size;
  }

  private textureKey(frameIdx: number): string {
    return `v${this.id}:${frameIdx}`;
  }

  /**
   * Decode `idx` (frame at `sec`) into the cache. Resolves once the frame is
   * resident. If a decode for `idx` is already in flight (e.g. a prior prewarm),
   * this **awaits that same decode** rather than returning early — so an awaited
   * `prepare(t)` truly guarantees the frame before render (no dropped/black
   * frames on export). Concurrent callers share one decode.
   */
  private ensure(idx: number, sec: number): Promise<void> {
    if (this.cache.has(idx)) return Promise.resolve();
    const pending = this.inFlight.get(idx);
    if (pending) return pending;
    const p = (async () => {
      try {
        // Take a turn in the single decode lane; when we reach the head, skip
        // the decode if a newer seek has left this frame far behind the playhead
        // (drop-stale). This keeps a fast scrub from backing up the decoder.
        const run = this.decodeLane.then(() => (this.wanted(idx) ? this.backend.decode(sec) : null));
        this.decodeLane = run.then(
          () => undefined,
          () => undefined,
        );
        const frame = await run;
        if (frame) this.cache.put(idx, frame);
      } finally {
        this.inFlight.delete(idx);
      }
    })();
    this.inFlight.set(idx, p);
    return p;
  }

  /** Whether frame `idx` is still close enough to the live playhead to decode. */
  private wanted(idx: number): boolean {
    return Math.abs(idx - this.currentIdx) <= this.dropHorizon;
  }

  dispose(): void {
    this.cache.dispose(); // closes frames; onEvict releases their textures
    this.inFlight.clear();
    if (this.ownsTextures) this.textures.dispose();
    this.backend.dispose();
    this.metadata = null;
  }
}
