import type { Effect } from '../effects/effect';
import type { Transition } from '../effects/transition';
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
export class VisualTrack extends Track<VisualClip> {
  /**
   * Transitions between overlapping clips on this track. Each is bound to two
   * clips (`transition.between(a, b)`) and mixes them over their overlap; the
   * reconciler renders the pair to textures and blends them in that window.
   */
  readonly transitions: Transition[] = [];

  addTransition(transition: Transition): void {
    this.transitions.push(transition);
  }

  removeTransition(transition: Transition): void {
    const i = this.transitions.indexOf(transition);
    if (i >= 0) this.transitions.splice(i, 1);
  }
}

/** Carries audio clips; consumed by the audio engine, not the scene graph. */
export class AudioTrack extends Track<AudioClip> {}
