import type { Texture } from 'pixi.js';
import { FrameCache } from './frame-cache';
import { MediabunnyVideoDecoder, type VideoInput } from './mediabunny-decoder';
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
  private readonly lookahead: number;
  private textures: TextureManager;
  private ownsTextures: boolean;
  private fps = 30;
  private lastSec: number | null = null;

  constructor(private readonly options: VideoSourceOptions) {
    super();
    this.backend = options.backend ?? new MediabunnyVideoDecoder(options.src);
    this.lookahead = options.lookahead ?? 3;
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

    await this.ensure(idx, sourceTime);

    // Directional lookahead: fire-and-forget so preview never blocks on it.
    for (let i = 1; i <= this.lookahead; i++) {
      const j = idx + dir * i;
      if (j < 0) continue;
      void this.ensure(j, j / this.fps);
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
        const frame = await this.backend.decode(sec);
        if (frame) this.cache.put(idx, frame);
      } finally {
        this.inFlight.delete(idx);
      }
    })();
    this.inFlight.set(idx, p);
    return p;
  }

  dispose(): void {
    this.cache.dispose(); // closes frames; onEvict releases their textures
    this.inFlight.clear();
    if (this.ownsTextures) this.textures.dispose();
    this.backend.dispose();
    this.metadata = null;
  }
}
