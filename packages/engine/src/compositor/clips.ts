import {
  CanvasTextMetrics,
  Container,
  Graphics,
  Sprite,
  Text,
  TextStyle,
  type TextStyleOptions,
  Texture,
} from 'pixi.js';
import { AnimatableProperty } from '../animation/animatable-property';
import type { TextAnimator, TextPart, TextSplit } from '../animation/clip-animator';
import { computeTextParts } from '../text/text-layout';
import type { VisualSource } from '../media/media-source';
import { VisualClip } from './clip';

/** Plays frames from a {@link VisualSource} (video). */
export class VideoClip extends VisualClip {
  private sprite: Sprite | null = null;

  constructor(public source: VisualSource) {
    super();
  }

  override mount(): Container {
    this.sprite = new Sprite(Texture.EMPTY);
    return this.sprite;
  }

  override update(t: number): void {
    if (!this.sprite) return;
    const sourceTime = this.mapToSource(t);
    const tex = this.source.getTextureAt(sourceTime);
    if (tex) {
      this.sprite.texture = tex; // fresh frame
    } else if (this.sprite.texture.destroyed) {
      // Miss, and the last frame's pooled texture was evicted/destroyed (VRAM
      // budget / cache eviction). Rendering a destroyed texture crashes the
      // renderer (null source), so fall back to a valid empty texture instead.
      this.sprite.texture = Texture.EMPTY;
    } // else: miss but last texture still live → keep showing it (preview)
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

/** An outline drawn around the glyphs (maps onto Pixi's `TextStyle.stroke`). */
export interface TextStrokeLike {
  color: number | string;
  width: number;
}

export interface TextStyleLike {
  text: string;
  fontFamily?: string;
  fontSize?: number;
  fill?: number | string;
  /** CSS font-weight (`'400'`, `'700'`, `'bold'`, …). Default `'normal'`. */
  fontWeight?: TextStyleOptions['fontWeight'];
  /** `'normal'` | `'italic'` | `'oblique'`. Default `'normal'`. */
  fontStyle?: TextStyleOptions['fontStyle'];
  /** Extra tracking between glyphs in px (affects split layout too). */
  letterSpacing?: number;
  /** Multi-line alignment. Default `'left'`. */
  align?: TextStyleOptions['align'];
  /** Line height in px (defaults to the font's natural line height). */
  lineHeight?: number;
  /**
   * Outline drawn around the glyphs. For **hollow / outlined** display type pair
   * it with a transparent `fill` (a color string carrying alpha 0, e.g.
   * `'rgba(255,255,255,0)'` or `'#ffffff00'`), so only the outline shows.
   */
  stroke?: TextStrokeLike;
}

/**
 * Renders styled text via `PIXI.Text`. `text`, `fontFamily` and `fill` are
 * plain settable fields; `fontSize` is an {@link AnimatableProperty} so it can
 * be keyframed. Re-layout only happens when a value actually changes.
 *
 * **Text motion effects.** Set {@link split} to `'char'`, `'word'` or `'line'`
 * and the clip renders one `PIXI.Text` per unit inside a container, each
 * animatable on its own. Assign a {@link TextAnimator} (the built-in
 * {@link StaggerTextAnimator} for逐字/逐词/逐行 reveals, or bind GSAP via
 * `gsapTextAnimator`) to drive them; it's sampled per part at the clip's local
 * time and composed over each part's laid-out position. Split layout uses the
 * **base** font size (`fontSize.valueAt(0)`) — animate a part's size through the
 * animator's `scaleX`/`scaleY`, not `fontSize`. `split` must be chosen before the
 * clip mounts when crossing the `'none'` boundary (the backing object differs:
 * `Text` vs `Container`); switching among `char`/`word`/`line`, or changing
 * `text`, re-lays out in place.
 *
 * Custom/web fonts must be loaded **before** rendering (Pixi measures glyphs via
 * Canvas, and `render(t)` must be reproducible — contract #2). Load them up
 * front with the `fonts` registry, then reference the family here:
 * `await fonts.load({ family: 'Inter', src: '/Inter.woff2' })`.
 */
export class TextClip extends VisualClip {
  text: string;
  fontFamily: string;
  /** Font size in px; animatable (only when {@link split} is `'none'`). */
  fontSize = new AnimatableProperty<number>(32);
  fill: number | string;
  /** CSS font-weight (`'400'`, `'700'`, `'bold'`, …). */
  fontWeight: TextStyleOptions['fontWeight'];
  /** Glyph style — `'normal'` | `'italic'` | `'oblique'`. */
  fontStyle: TextStyleOptions['fontStyle'];
  /** Extra tracking between glyphs in px (also widens split layout). */
  letterSpacing: number;
  /** Multi-line alignment. */
  align: TextStyleOptions['align'];
  /** Line height in px, or `0` to use the font's natural line height. */
  lineHeight: number;
  /** Outline drawn around the glyphs (hollow / outlined text), or `null` for none. */
  stroke: TextStrokeLike | null;
  /** Break the text into per-unit objects for motion effects (default `'none'`). */
  split: TextSplit = 'none';
  /** Per-part animator, sampled at local time when {@link split} != `'none'`. */
  textAnimator: TextAnimator | null = null;

  private textObj: Text | null = null;
  private root: Container | null = null;
  private partObjs: Text[] = [];
  private parts: TextPart[] = [];
  /** Snapshot of what the split children were last built from. */
  private builtFrom: { text: string; split: TextSplit } | null = null;

  constructor(style: TextStyleLike) {
    super();
    this.text = style.text;
    this.fontFamily = style.fontFamily ?? 'sans-serif';
    this.fontSize.setStatic(style.fontSize ?? 32);
    this.fill = style.fill ?? 0xffffff;
    this.fontWeight = style.fontWeight ?? 'normal';
    this.fontStyle = style.fontStyle ?? 'normal';
    this.letterSpacing = style.letterSpacing ?? 0;
    this.align = style.align ?? 'left';
    this.lineHeight = style.lineHeight ?? 0;
    this.stroke = style.stroke ?? null;
  }

  /**
   * The `TextStyle` options for the current fields, at the given time (only
   * `fontSize` is time-varying). One source of truth for both measurement
   * (`layout`) and rendering (`mount` / `rebuildParts`) so a stroke/weight/
   * letter-spacing change lays out and paints consistently.
   */
  private styleOptions(t: number): TextStyleOptions {
    const opts: TextStyleOptions = {
      fontFamily: this.fontFamily,
      fontSize: this.fontSize.valueAt(t),
      fill: this.fill,
      fontWeight: this.fontWeight,
      fontStyle: this.fontStyle,
      letterSpacing: this.letterSpacing,
      align: this.align,
    };
    if (this.lineHeight > 0) opts.lineHeight = this.lineHeight;
    if (this.stroke) opts.stroke = { color: this.stroke.color, width: this.stroke.width };
    return opts;
  }

  /**
   * Number of animatable parts for the current text + {@link split}. Reads the
   * measured layout, so call it after the font is loaded (needed to size
   * `gsapTextAnimator`). `0` when `split` is `'none'`.
   */
  get partCount(): number {
    if (this.split === 'none') return 0;
    return this.layout().length;
  }

  /** Read-only snapshot of the current laid-out parts (empty when not split). */
  getParts(): readonly TextPart[] {
    return this.split === 'none' ? [] : this.layout();
  }

  override mount(): Container {
    if (this.split === 'none') {
      this.textObj = new Text({ text: this.text, style: this.styleOptions(0) });
      return this.textObj;
    }
    this.root = new Container();
    this.rebuildParts();
    return this.root;
  }

  override update(t: number): void {
    if (this.split === 'none') {
      if (!this.textObj) return;
      if (this.textObj.text !== this.text) this.textObj.text = this.text;
      const size = this.fontSize.valueAt(t);
      if (this.textObj.style.fontSize !== size) this.textObj.style.fontSize = size;
      if (this.textObj.style.fill !== this.fill) this.textObj.style.fill = this.fill;
      this.applyCommon(this.textObj, t);
      return;
    }

    if (!this.root) return;
    // Re-lay-out if the text or split granularity changed since the last build.
    if (!this.builtFrom || this.builtFrom.text !== this.text || this.builtFrom.split !== this.split) {
      this.rebuildParts();
    }
    // Settle every part to its base layout first so the block's bounds — and thus
    // the clip-level anchor pivot computed in applyCommon — stay stable while the
    // parts animate away from it.
    for (let i = 0; i < this.partObjs.length; i++) {
      const p = this.parts[i]!;
      const o = this.partObjs[i]!;
      o.position.set(p.x, p.y);
      o.scale.set(1, 1);
      o.rotation = 0;
      o.alpha = 1;
    }
    // Clip-level transform / opacity / effects / whole-clip animator on the block.
    this.applyCommon(this.root, t);
    // Per-part override on top.
    if (this.textAnimator) {
      const localT = t - this.start;
      for (let i = 0; i < this.partObjs.length; i++) {
        const p = this.parts[i]!;
        const o = this.partObjs[i]!;
        const s = this.textAnimator.sampleForPart(p, localT);
        o.position.set(p.x + (s.x ?? 0), p.y + (s.y ?? 0));
        o.scale.set(s.scaleX ?? 1, s.scaleY ?? 1);
        o.rotation = s.rotation ?? 0;
        o.alpha = s.alpha ?? 1;
      }
    }
  }

  override unmount(): void {
    this.textObj?.destroy();
    this.textObj = null;
    for (const o of this.partObjs) o.destroy();
    this.partObjs = [];
    this.root?.destroy();
    this.root = null;
    this.builtFrom = null;
  }

  /** Build the `TextStyle` used for both rendering and measurement. */
  private buildStyle(): TextStyle {
    return new TextStyle(this.styleOptions(0));
  }

  /** Measure and split the text into parts using Pixi's canvas metrics. */
  private layout(): TextPart[] {
    const style = this.buildStyle(); // wordWrap defaults off → measures raw advance
    const metrics = CanvasTextMetrics.measureText(this.text, style);
    const measure = (s: string): number =>
      s.length === 0 ? 0 : CanvasTextMetrics.measureText(s, style).width;
    return computeTextParts(this.text, this.split, measure, metrics.lineHeight);
  }

  /** (Re)create the per-part Text objects under the shared root container. */
  private rebuildParts(): void {
    if (!this.root) return;
    for (const o of this.partObjs) o.destroy();
    this.partObjs = [];
    this.parts = this.layout();
    const style = this.styleOptions(0);
    for (const p of this.parts) {
      const o = new Text({ text: p.text, style });
      o.anchor.set(0.5, 0.5); // pivot each glyph around its center for scale/rotate
      o.position.set(p.x, p.y);
      this.partObjs.push(o);
      this.root.addChild(o);
    }
    this.builtFrom = { text: this.text, split: this.split };
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
