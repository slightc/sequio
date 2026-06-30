import type { Container } from 'pixi.js';
import type { VisualClip } from './clip';
import type { Track } from './track';
import { VisualTrack } from './track';

/**
 * Diffs the set of active clips at time `t` against the live PixiJS display
 * tree: mounts newly-active clips, unmounts expired ones, reuses the rest.
 *
 * Internal. Incremental add/remove keeps per-frame allocations near zero. A
 * Reconciler manages one display container; {@link GroupClip} owns a nested
 * Reconciler for its own sub-tree, which is how grouping recurses.
 */
export class Reconciler {
  /** clip → its mounted pixi object, for reuse across frames. */
  private readonly mounted = new Map<VisualClip, Container>();

  /** Reconcile multi-lane, z-ordered tracks into `stage`. */
  reconcile(tracks: Track[], t: number, stage: Container): void {
    // Tracks are composited bottom-to-top by zIndex; flatten to one ordered
    // list of active clips, then diff against the mounted set.
    const ordered: VisualClip[] = [];
    const visualTracks = tracks
      .filter((tr): tr is VisualTrack => tr instanceof VisualTrack && tr.enabled)
      .sort((a, b) => a.zIndex - b.zIndex);
    for (const track of visualTracks) {
      for (const clip of track.activeAt(t)) ordered.push(clip);
    }
    this.reconcileClips(ordered, t, stage);
  }

  /**
   * Reconcile a pre-filtered, ordered list of **active** visual clips into
   * `stage`: mount new ones (list order = bottom-to-top), reuse mounted ones,
   * unmount everything else. A {@link GroupClip} recurses into its own children
   * from inside its `update(t)`, so this stays a flat diff at each level.
   */
  reconcileClips(activeClips: VisualClip[], t: number, stage: Container): void {
    const active = new Set(activeClips);
    for (const clip of activeClips) {
      let obj = this.mounted.get(clip);
      if (!obj) {
        obj = clip.mount();
        this.mounted.set(clip, obj);
        stage.addChild(obj);
      }
      clip.update(t);
    }

    // Unmount clips that are no longer active.
    for (const [clip, obj] of this.mounted) {
      if (active.has(clip)) continue;
      stage.removeChild(obj);
      clip.unmount();
      this.mounted.delete(clip);
    }
  }

  /** Unmount everything (used on dispose / full rebuild). */
  clear(stage: Container): void {
    for (const [clip, obj] of this.mounted) {
      stage.removeChild(obj);
      clip.unmount();
    }
    this.mounted.clear();
  }
}
