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
 * Hardware-accelerated video decode via WebCodecs.
 *
 * Pipeline (to be implemented in the decode milestone):
 *   demux (mp4box.js) → VideoDecoder → FrameCache (ring + LRU + directional
 *   lookahead). Seek = find nearest keyframe → decode forward to target.
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
    // TODO(decode): demux container, read track config, populate metadata.
    throw new Error('VideoSource.load not implemented — see todo/02-video-source.md');
  }

  async prepare(_sourceTime: number): Promise<void> {
    // TODO(decode): ensure frame at sourceTime decoded into `this.cache`,
    // kicking off directional lookahead.
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
