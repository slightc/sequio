import { type BLEND_MODES, type Container, Graphics } from 'pixi.js';
import { AnimatableProperty } from '../animation/animatable-property';
import { Transform2D } from '../animation/transform2d';
import type { AnimationSample, ClipAnimator } from '../animation/clip-animator';
import type { Effect } from '../effects/effect';

/**
 * Base timeline clip. Holds the timeline interval and the source-trim window;
 * all times are quantized to frames internally by the owning compositor.
 */
export abstract class Clip {
  /** Timeline interval, in seconds. */
  start = 0;
  end = 0;
  /** Source trim window, in seconds. */
  sourceIn = 0;
  sourceOut = 0;
  /** Playback speed (time remap). 1 = realtime. */
  speed = 1;
  /**
   * Play the source backwards (倒放). The clip still occupies `[start, end)` on
   * the timeline, but source time runs from the end of the played window back to
   * `sourceIn`: at `start` it shows the frame at `sourceIn + (end-start)·speed`,
   * at `end` it shows `sourceIn`. `speed` still scales the rate (so `speed` > 1
   * is a fast reverse). For video this simply feeds a decreasing source time to
   * the decoder (its look-ahead already runs backwards); for audio the engine
   * plays a reversed copy of the buffer. Default `false`.
   */
  reversed = false;

  isActiveAt(t: number): boolean {
    return t >= this.start && t < this.end;
  }

  /**
   * The source time this clip shows at timeline time `t`, honouring `speed` and
   * {@link reversed}. This is the **single source of truth** for both the render
   * path (`VideoClip.update` reads the frame here) and the decode-prep path (the
   * Compositor pre-decodes the frame here) — so a reversed / sped clip decodes
   * exactly the frame it will display. Public wrapper over {@link mapToSource}.
   */
  sourceTimeAt(t: number): number {
    return this.mapToSource(t);
  }

  /**
   * Map a timeline time to the corresponding source time. Forward playback walks
   * the source window `[sourceIn, sourceIn + (end-start)·speed]` up from
   * `sourceIn`; {@link reversed} playback walks the SAME window down to `sourceIn`
   * (so the reversed and forward frames mirror around the window's midpoint).
   */
  protected mapToSource(t: number): number {
    if (this.reversed) return this.sourceIn + (this.end - t) * this.speed;
    return this.sourceIn + (t - this.start) * this.speed;
  }
}

/**
 * Clips the visible region of a {@link VisualClip} to a rounded rectangle or an
 * ellipse — an editorial "arch" / rounded-photo / circle-crop, built from the
 * graph instead of a pre-masked asset. The mask is a shape in the clip's local
 * space (pre-transform), so it moves, scales and rotates with the clip. Sizes
 * are given explicitly (`width`/`height`, optional `x`/`y` top-left offset), so
 * the crop is deterministic and independent of when texture bounds settle.
 *
 * Apply it to a container-backed clip — a {@link GroupClip} wrapping the content
 * (a Sprite cannot be masked by its own child). The group's origin is the mask's
 * coordinate space, so lay the content out from `(0, 0)` and size the mask to the
 * region you want revealed.
 */
export interface MaskSpec {
  kind: 'rect' | 'ellipse';
  /** Reveal-region width in local px. */
  width: number;
  /** Reveal-region height in local px. */
  height: number;
  /** Top-left x of the region in local space (default `0`). */
  x?: number;
  /** Top-left y of the region in local space (default `0`). */
  y?: number;
  /** Corner radius in px for `rect` (a large value → arch/stadium). */
  radius?: number;
  /** Shrink the mask inward on every side (px). */
  inset?: number;
}

/** A clip that renders into the PixiJS scene graph. */
export abstract class VisualClip extends Clip {
  transform = new Transform2D();
  opacity = new AnimatableProperty<number>(1);
  blendMode: BLEND_MODES = 'normal';
  effects: Effect[] = [];
  /**
   * Clip the content to a rounded-rect / ellipse fitted to its bounds, or
   * `null` (default) for no clipping. See {@link MaskSpec}.
   */
  maskShape: MaskSpec | null = null;
  private maskGraphics: Graphics | null = null;
  /**
   * Optional whole-clip animator, sampled at the clip's local time
   * (`t - start`) and composed over the base transform/opacity. Assign a
   * built-in {@link TweenAnimator} or bind GSAP via `gsapClipAnimator`. `null`
   * (default) leaves the clip driven by its keyframes alone.
   */
  animator: ClipAnimator | null = null;
  private readonly attachedEffects = new Set<Effect>();
  private lastObj: Container | null = null;

  /** Create the backing pixi object (called when the clip becomes active). */
  abstract mount(): Container;
  /** Update texture / transform / effects for time `t` using ready frames. */
  abstract update(t: number): void;
  /** Tear down the backing pixi object (called when the clip goes inactive). */
  abstract unmount(): void;

  /** Apply transform, opacity, blend mode and effects onto `obj` at time `t`. */
  protected applyCommon(obj: Container, t: number): void {
    const sample = this.sampleAnimator(t);
    // Attach/update the clip mask BEFORE measuring the transform pivot. For a
    // Container/Group the pivot maps a normalized anchor onto `getLocalBounds()`,
    // and a mask clips those bounds to the (fixed) mask region. If the mask were
    // added afterwards, the FIRST paint of a freshly-mounted clip would measure
    // the pivot on the UNMASKED bounds (e.g. a cover-cropped image that overflows
    // its box) and land the group offset, snapping into place only on the next
    // render — the "seek lands the clip wrong until you seek again" bug. Filters
    // (blur, etc.) still sync AFTER, so their padding never shifts the pivot.
    this.syncMask(obj);
    this.transform.applyTo(obj, t, sample);
    const alpha = this.opacity.valueAt(t);
    obj.alpha = sample?.alpha != null ? alpha * sample.alpha : alpha;
    obj.blendMode = this.blendMode;
    this.syncEffects(obj, t);
  }

  /**
   * Fit the {@link maskShape} to the object's current local bounds and assign it
   * as a child mask (or tear the mask down when cleared / on re-mount). The mask
   * is a child, so it inherits the clip's transform — an empty first-frame draw
   * means it never feeds back into the bounds it is measured from.
   */
  private syncMask(obj: Container): void {
    if (this.maskGraphics && this.maskGraphics.destroyed) this.maskGraphics = null;
    if (!this.maskShape) {
      if (this.maskGraphics) {
        obj.mask = null;
        this.maskGraphics.parent?.removeChild(this.maskGraphics);
        this.maskGraphics.destroy();
        this.maskGraphics = null;
      }
      return;
    }
    let g = this.maskGraphics;
    if (!g) {
      g = new Graphics();
      this.maskGraphics = g;
    }
    if (g.parent !== obj) {
      g.parent?.removeChild(g);
      obj.addChild(g);
      obj.mask = g;
    }
    const inset = this.maskShape.inset ?? 0;
    const x = (this.maskShape.x ?? 0) + inset;
    const y = (this.maskShape.y ?? 0) + inset;
    const w = Math.max(0, this.maskShape.width - inset * 2);
    const h = Math.max(0, this.maskShape.height - inset * 2);
    g.clear();
    if (this.maskShape.kind === 'ellipse') {
      g.ellipse(x + w / 2, y + h / 2, w / 2, h / 2);
    } else if (this.maskShape.radius) {
      g.roundRect(x, y, w, h, Math.min(this.maskShape.radius, w / 2, h / 2));
    } else {
      g.rect(x, y, w, h);
    }
    g.fill(0xffffff);
  }

  /** Sample the whole-clip {@link animator} at local time (`undefined` if none). */
  protected sampleAnimator(t: number): AnimationSample | undefined {
    return this.animator ? this.animator.sampleAt(t - this.start) : undefined;
  }

  /** Attach newly-added effects to `obj`, update all, detach removed ones. */
  private syncEffects(obj: Container, t: number): void {
    // A fresh pixi object (re-mount) needs its effects re-attached.
    if (obj !== this.lastObj) {
      this.attachedEffects.clear();
      this.lastObj = obj;
    }
    for (const effect of this.effects) {
      if (!this.attachedEffects.has(effect)) {
        effect.attach(obj);
        this.attachedEffects.add(effect);
      }
      effect.updateAt(t);
    }
    for (const effect of [...this.attachedEffects]) {
      if (!this.effects.includes(effect)) {
        effect.detach(obj);
        this.attachedEffects.delete(effect);
      }
    }
  }
}

/** A clip contributing audio (no visual scene-graph object). */
export class AudioClip extends Clip {
  gain = new AnimatableProperty<number>(1);
  /** Fade durations in seconds. */
  fadeIn = 0;
  fadeOut = 0;
  // Source-time mapping (incl. `reversed` / `speed`) is `Clip.sourceTimeAt`.
}
