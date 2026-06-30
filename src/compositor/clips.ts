import { Container, Sprite } from 'pixi.js';
import type { VisualSource } from '../media/media-source';
import { VisualClip } from './clip';

/** Plays frames from a {@link VisualSource} (video). */
export class VideoClip extends VisualClip {
  private sprite: Sprite | null = null;

  constructor(public source: VisualSource) {
    super();
  }

  override mount(): Container {
    this.sprite = new Sprite();
    return this.sprite;
  }

  override update(t: number): void {
    if (!this.sprite) return;
    const sourceTime = this.mapToSource(t);
    const tex = this.source.getTextureAt(sourceTime);
    if (tex) this.sprite.texture = tex; // miss → keep last frame (preview)
    this.applyCommon(this.sprite, t);
  }

  override unmount(): void {
    this.sprite?.destroy();
    this.sprite = null;
  }
}

/** Shows a single still image for the clip's whole duration. */
export class ImageClip extends VisualClip {
  private sprite: Sprite | null = null;

  constructor(public source: VisualSource) {
    super();
  }

  override mount(): Container {
    this.sprite = new Sprite();
    return this.sprite;
  }

  override update(t: number): void {
    if (!this.sprite) return;
    const tex = this.source.getTextureAt(0);
    if (tex) this.sprite.texture = tex;
    this.applyCommon(this.sprite, t);
  }

  override unmount(): void {
    this.sprite?.destroy();
    this.sprite = null;
  }
}

export interface TextStyleLike {
  text: string;
  fontFamily?: string;
  fontSize?: number;
  fill?: number | string;
}

/** Renders styled text. Backed by a PIXI.Text in the implementation phase. */
export class TextClip extends VisualClip {
  private container: Container | null = null;

  constructor(public style: TextStyleLike) {
    super();
  }

  override mount(): Container {
    // TODO(clips): build a PIXI.Text from `this.style`.
    this.container = new Container();
    return this.container;
  }

  override update(t: number): void {
    if (!this.container) return;
    this.applyCommon(this.container, t);
  }

  override unmount(): void {
    this.container?.destroy({ children: true });
    this.container = null;
  }
}

/** Renders a vector shape (rect / ellipse / path) via PIXI.Graphics. */
export class ShapeClip extends VisualClip {
  private container: Container | null = null;

  override mount(): Container {
    // TODO(clips): build a PIXI.Graphics shape.
    this.container = new Container();
    return this.container;
  }

  override update(t: number): void {
    if (!this.container) return;
    this.applyCommon(this.container, t);
  }

  override unmount(): void {
    this.container?.destroy({ children: true });
    this.container = null;
  }
}
