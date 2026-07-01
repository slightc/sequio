import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { AnimatableProperty } from '../animation/animatable-property';
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

/**
 * Renders styled text via `PIXI.Text`. `text`, `fontFamily` and `fill` are
 * plain settable fields; `fontSize` is an {@link AnimatableProperty} so it can
 * be keyframed. Re-layout only happens when a value actually changes.
 *
 * Custom/web fonts must be loaded **before** rendering (Pixi measures glyphs via
 * Canvas, and `render(t)` must be reproducible — contract #2). Load them up
 * front with the `fonts` registry, then reference the family here:
 * `await fonts.load({ family: 'Inter', src: '/Inter.woff2' })`.
 */
export class TextClip extends VisualClip {
  text: string;
  fontFamily: string;
  /** Font size in px; animatable. */
  fontSize = new AnimatableProperty<number>(32);
  fill: number | string;
  private textObj: Text | null = null;

  constructor(style: TextStyleLike) {
    super();
    this.text = style.text;
    this.fontFamily = style.fontFamily ?? 'sans-serif';
    this.fontSize.setStatic(style.fontSize ?? 32);
    this.fill = style.fill ?? 0xffffff;
  }

  override mount(): Container {
    this.textObj = new Text({
      text: this.text,
      style: { fontFamily: this.fontFamily, fontSize: this.fontSize.valueAt(0), fill: this.fill },
    });
    return this.textObj;
  }

  override update(t: number): void {
    if (!this.textObj) return;
    if (this.textObj.text !== this.text) this.textObj.text = this.text;
    const size = this.fontSize.valueAt(t);
    if (this.textObj.style.fontSize !== size) this.textObj.style.fontSize = size;
    if (this.textObj.style.fill !== this.fill) this.textObj.style.fill = this.fill;
    this.applyCommon(this.textObj, t);
  }

  override unmount(): void {
    this.textObj?.destroy();
    this.textObj = null;
  }
}

export type ShapeKind = 'rect' | 'ellipse';

export interface ShapeSpec {
  kind: ShapeKind;
  width: number;
  height: number;
  fill?: number | string;
  /** Corner radius for `rect` (rounded rectangle). */
  radius?: number;
  stroke?: { color: number | string; width: number };
}

/** Renders a vector shape (rect / rounded-rect / ellipse) via `PIXI.Graphics`. */
export class ShapeClip extends VisualClip {
  private graphics: Graphics | null = null;

  constructor(public spec: ShapeSpec) {
    super();
  }

  override mount(): Container {
    this.graphics = this.draw(new Graphics());
    return this.graphics;
  }

  override update(t: number): void {
    if (!this.graphics) return;
    this.applyCommon(this.graphics, t);
  }

  override unmount(): void {
    this.graphics?.destroy();
    this.graphics = null;
  }

  private draw(g: Graphics): Graphics {
    const { kind, width, height, fill = 0xffffff, radius, stroke } = this.spec;
    if (kind === 'ellipse') {
      g.ellipse(width / 2, height / 2, width / 2, height / 2);
    } else if (radius) {
      g.roundRect(0, 0, width, height, radius);
    } else {
      g.rect(0, 0, width, height);
    }
    g.fill(fill);
    if (stroke) g.stroke({ color: stroke.color, width: stroke.width });
    return g;
  }
}
