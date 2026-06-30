import type { Texture } from 'pixi.js';
import { type SourceMetadata, VisualSource } from './media-source';

export interface ImageSourceOptions {
  src: string | Blob | ImageBitmap;
}

/**
 * Still image. Decoded once into a single texture; every `getTextureAt`
 * returns the same texture regardless of time.
 */
export class ImageSource extends VisualSource {
  private texture: Texture | null = null;

  constructor(private readonly options: ImageSourceOptions) {
    super();
  }

  async load(): Promise<SourceMetadata> {
    // TODO(media): decode `options.src` to an ImageBitmap → Texture and fill
    // metadata (width/height, duration = Infinity, hasAudio = false).
    throw new Error('ImageSource.load not implemented — see todo/05-image-text-shape.md');
  }

  async prepare(_sourceTime: number): Promise<void> {
    // Already decoded after load(); nothing to await.
  }

  getTextureAt(_sourceTime: number): Texture | null {
    return this.texture;
  }

  dispose(): void {
    this.texture?.destroy(true);
    this.texture = null;
    this.metadata = null;
  }
}
