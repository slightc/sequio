import type { Effect } from '../effects/effect';
import { AudioClip, type Clip, VisualClip } from './clip';

/**
 * A track is an ordered, z-stacked lane of clips. Track-level effects act as
 * an adjustment layer over everything beneath the track.
 */
export abstract class Track<C extends Clip = Clip> {
  enabled = true;
  zIndex = 0;
  /** Track-level effects (adjustment layer). */
  effects: Effect[] = [];
  readonly clips: C[] = [];

  add(clip: C): void {
    this.clips.push(clip);
  }

  remove(clip: C): void {
    const i = this.clips.indexOf(clip);
    if (i >= 0) this.clips.splice(i, 1);
  }

  /** Clips active at time `t` (seconds). */
  activeAt(t: number): C[] {
    if (!this.enabled) return [];
    return this.clips.filter((c) => c.isActiveAt(t));
  }
}

/** Maps to a single PIXI.Container in the scene graph. */
export class VisualTrack extends Track<VisualClip> {}

/** Carries audio clips; consumed by the audio engine, not the scene graph. */
export class AudioTrack extends Track<AudioClip> {}
