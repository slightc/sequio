import type { BLEND_MODES, Container } from 'pixi.js';
import { AnimatableProperty } from '../animation/animatable-property';
import { Transform2D } from '../animation/transform2d';
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

  isActiveAt(t: number): boolean {
    return t >= this.start && t < this.end;
  }

  /** Map a timeline time to the corresponding source time. */
  protected mapToSource(t: number): number {
    return this.sourceIn + (t - this.start) * this.speed;
  }
}

/** A clip that renders into the PixiJS scene graph. */
export abstract class VisualClip extends Clip {
  transform = new Transform2D();
  opacity = new AnimatableProperty<number>(1);
  blendMode: BLEND_MODES = 'normal';
  effects: Effect[] = [];

  /** Create the backing pixi object (called when the clip becomes active). */
  abstract mount(): Container;
  /** Update texture / transform / effects for time `t` using ready frames. */
  abstract update(t: number): void;
  /** Tear down the backing pixi object (called when the clip goes inactive). */
  abstract unmount(): void;

  /** Apply transform, opacity, blend mode and effects onto `obj` at time `t`. */
  protected applyCommon(obj: Container, t: number): void {
    this.transform.applyTo(obj, t);
    obj.alpha = this.opacity.valueAt(t);
    obj.blendMode = this.blendMode;
    for (const effect of this.effects) effect.updateAt(t);
  }
}

/** A clip contributing audio (no visual scene-graph object). */
export class AudioClip extends Clip {
  gain = new AnimatableProperty<number>(1);
  /** Fade durations in seconds. */
  fadeIn = 0;
  fadeOut = 0;

  /** Resolve the source time for the audio engine to schedule. */
  sourceTimeAt(t: number): number {
    return this.mapToSource(t);
  }
}
