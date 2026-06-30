import type { Texture } from 'pixi.js';
import { FrameCache } from './frame-cache';
import { type SourceMetadata, VisualSource } from './media-source';

export interface VideoSourceOptions {
  /** Source URL or an already-fetched buffer. */
  src: string | ArrayBuffer | Blob;
  /** How many frames to keep decoded in the ring buffer. */
  cacheFrames?: number;
  /** How many frames to read ahead in the playback direction. */
  lookahead?: number;
}

/**
 * Hardware-accelerated video decode via WebCodecs, driven by Mediabunny.
 *
 * Pipeline (to be implemented in the decode milestone):
 *   Mediabunny Input + VideoSampleSink → FrameCache (ring + LRU + directional
 *   lookahead). getSample(t) returns the nearest frame at-or-before t (the sink
 *   handles keyframe seeking + WebCodecs decode); samples() pre-reads ahead.
 *
 * Until implemented, methods throw so callers fail loudly rather than render
 * silent black frames.
 */
export class VideoSource extends VisualSource {
  protected readonly cache: FrameCache;

  constructor(protected readonly options: VideoSourceOptions) {
    super();
    this.cache = new FrameCache(options.cacheFrames ?? 60);
  }

  async load(): Promise<SourceMetadata> {
    // TODO(decode): open a Mediabunny Input, read the primary video track's
    // config, populate metadata (width/height/duration/fps).
    throw new Error('VideoSource.load not implemented — see todo/02-video-source.md');
  }

  async prepare(_sourceTime: number): Promise<void> {
    // TODO(decode): VideoSampleSink.getSample(sourceTime) → cache the frame,
    // kicking off directional lookahead via samples().
    throw new Error('VideoSource.prepare not implemented — see todo/02-video-source.md');
  }

  getTextureAt(_sourceTime: number): Texture | null {
    // TODO(decode): map sourceTime → frame index, read cache, upload via
    // TextureManager. Return null on miss so preview can reuse the last frame.
    return null;
  }

  dispose(): void {
    this.cache.dispose();
    this.metadata = null;
  }
}
