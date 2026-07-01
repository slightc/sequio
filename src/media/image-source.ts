import { Texture } from 'pixi.js';
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
    const bitmap = await this.toBitmap(this.options.src);
    this.texture = Texture.from(bitmap);
    this.metadata = {
      width: bitmap.width,
      height: bitmap.height,
      duration: Infinity,
      hasAudio: false,
    };
    return this.metadata;
  }

  private async toBitmap(src: string | Blob | ImageBitmap): Promise<ImageBitmap> {
    if (typeof src === 'string') {
      const res = await fetch(src);
      return createImageBitmap(await res.blob());
    }
    if (src instanceof Blob) return createImageBitmap(src);
    return src; // already an ImageBitmap
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
