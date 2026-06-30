import type { Container } from 'pixi.js';
import type { VisualClip } from './clip';
import type { Track } from './track';
import { VisualTrack } from './track';

/**
 * Diffs the set of active clips at time `t` against the live PixiJS display
 * tree: mounts newly-active clips, unmounts expired ones, reuses the rest.
 *
 * Internal. Incremental add/remove keeps per-frame allocations near zero.
 */
export class Reconciler {
  /** clip → its mounted pixi object, for reuse across frames. */
  private readonly mounted = new Map<VisualClip, Container>();

  reconcile(tracks: Track[], t: number, stage: Container): void {
    const active = new Set<VisualClip>();

    // Tracks are composited bottom-to-top by zIndex.
    const visualTracks = tracks
      .filter((tr): tr is VisualTrack => tr instanceof VisualTrack && tr.enabled)
      .sort((a, b) => a.zIndex - b.zIndex);

    for (const track of visualTracks) {
      for (const clip of track.activeAt(t)) {
        active.add(clip);
        let obj = this.mounted.get(clip);
        if (!obj) {
          obj = clip.mount();
          this.mounted.set(clip, obj);
          stage.addChild(obj);
        }
        clip.update(t);
      }
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
