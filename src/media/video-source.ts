import { Texture } from 'pixi.js';
import { FrameCache } from './frame-cache';
import { MediabunnyVideoDecoder, type VideoInput } from './mediabunny-decoder';
import { type SourceMetadata, VisualSource } from './media-source';
import type { DecodedFrame, VideoDecoderBackend } from './video-decoder';

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
}

/**
 * Hardware-accelerated video decode via WebCodecs, driven by Mediabunny.
 *
 * Pipeline: {@link VideoDecoderBackend} (Mediabunny `Input` + `VideoSampleSink`)
 * → {@link FrameCache} (ring + LRU). `prepare(t)` decodes the frame at `t` into
 * the cache and kicks off directional lookahead; `getTextureAt(t)` reads the
 * cache synchronously and returns a `Texture` (miss → `null`, preview reuses the
 * last frame). The async `prepare` / sync `getTextureAt` split is contract #1.
 *
 * Frame indices assume constant frame rate; the cache keys a requested time `t`
 * to `round(t * fps)`. (VFR-accurate keying is a later refinement.)
 */
export class VideoSource extends VisualSource {
  private readonly backend: VideoDecoderBackend;
  private readonly cache: FrameCache<DecodedFrame>;
  private readonly textures = new Map<number, Texture>();
  private readonly inFlight = new Set<number>();
  private readonly lookahead: number;
  private fps = 30;
  private lastSec: number | null = null;

  constructor(private readonly options: VideoSourceOptions) {
    super();
    this.backend = options.backend ?? new MediabunnyVideoDecoder(options.src);
    this.lookahead = options.lookahead ?? 3;
    // When a frame leaves the cache, destroy the texture derived from it so GPU
    // memory tracks decoder memory.
    this.cache = new FrameCache<DecodedFrame>(options.cacheFrames ?? 60, (idx) => {
      const tex = this.textures.get(idx);
      if (tex) {
        tex.destroy(true);
        this.textures.delete(idx);
      }
    });
  }

  async load(): Promise<SourceMetadata> {
    const meta = await this.backend.load();
    this.metadata = meta;
    if (meta.fps && meta.fps > 0) this.fps = meta.fps;
    return meta;
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
    let tex = this.textures.get(idx);
    if (!tex) {
      tex = this.createTexture(frame.image);
      this.textures.set(idx, tex);
    }
    return tex;
  }

  /** Number of decoded frames currently resident (test/diagnostic hook). */
  get cachedFrameCount(): number {
    return this.cache.size;
  }

  /** Build a texture from a decoded image source. Overridable for tests. */
  protected createTexture(image: CanvasImageSource): Texture {
    return Texture.from(image);
  }

  /** Decode `idx` (frame at `sec`) into the cache unless already present/pending. */
  private async ensure(idx: number, sec: number): Promise<void> {
    if (this.cache.has(idx) || this.inFlight.has(idx)) return;
    this.inFlight.add(idx);
    try {
      const frame = await this.backend.decode(sec);
      if (frame) this.cache.put(idx, frame);
    } finally {
      this.inFlight.delete(idx);
    }
  }

  dispose(): void {
    this.cache.dispose(); // closes frames; onEvict destroys their textures
    this.textures.clear();
    this.inFlight.clear();
    this.backend.dispose();
    this.metadata = null;
  }
}
