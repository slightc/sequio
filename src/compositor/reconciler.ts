import { Container } from 'pixi.js';
import type { Effect } from '../effects/effect';
import type { VisualClip } from './clip';
import type { Track } from './track';
import { VisualTrack } from './track';

/** Per-track scene-graph state: one container + a nested reconciler for its clips. */
interface TrackEntry {
  container: Container;
  clips: Reconciler;
  /** Track-level effects currently attached to `container` (adjustment layer). */
  attached: Set<Effect>;
}

/**
 * Diffs the object graph at time `t` against the live PixiJS display tree.
 *
 * Two levels, same class:
 * - `reconcile(tracks, …)` maps each enabled {@link VisualTrack} to its own
 *   `Container` (z-ordered), applies track-level effects as an adjustment layer,
 *   and reconciles that track's clips into it via a nested Reconciler.
 * - `reconcileClips(clips, …)` mounts/reuses/unmounts a flat, ordered list of
 *   clips into a container. {@link GroupClip} drives its own sub-tree through it.
 *
 * Incremental add/remove keeps per-frame allocations near zero; z-order is
 * re-asserted every frame so it stays stable regardless of mount history.
 */
export class Reconciler {
  /** clip → mounted pixi object (clip level). */
  private readonly mounted = new Map<VisualClip, Container>();
  /** track → its container/clips/effects (track level). */
  private readonly trackEntries = new Map<VisualTrack, TrackEntry>();

  reconcile(tracks: Track[], t: number, stage: Container): void {
    const active = tracks
      .filter((tr): tr is VisualTrack => tr instanceof VisualTrack && tr.enabled)
      .sort((a, b) => a.zIndex - b.zIndex);
    const activeSet = new Set(active);

    // Drop containers for tracks that were removed or disabled.
    for (const [track, entry] of [...this.trackEntries]) {
      if (!activeSet.has(track)) this.disposeTrackEntry(track, entry, stage);
    }

    // Mount / update each active track (adjustment layer + its clips).
    for (const track of active) {
      let entry = this.trackEntries.get(track);
      if (!entry) {
        entry = { container: new Container(), clips: new Reconciler(), attached: new Set() };
        this.trackEntries.set(track, entry);
        stage.addChild(entry.container);
      }
      this.syncTrackEffects(track, entry, t);
      entry.clips.reconcileClips(track.activeAt(t), t, entry.container);
    }

    // Re-assert bottom-to-top z-order once every container is present.
    active.forEach((track, i) => {
      const c = this.trackEntries.get(track)!.container;
      if (stage.getChildIndex(c) !== i) stage.setChildIndex(c, i);
    });
  }

  /**
   * Reconcile a pre-filtered, ordered list of **active** clips into `stage`:
   * mount new ones, reuse mounted ones, unmount the rest, then re-assert z-order
   * to match `activeClips` (list order = bottom-to-top).
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

    // Keep z-order stable = activeClips order, regardless of mount history.
    for (let i = 0; i < activeClips.length; i++) {
      const obj = this.mounted.get(activeClips[i]!)!;
      if (stage.getChildIndex(obj) !== i) stage.setChildIndex(obj, i);
    }
  }

  /** Unmount everything (used on dispose / full rebuild). */
  clear(stage: Container): void {
    for (const [clip, obj] of this.mounted) {
      stage.removeChild(obj);
      clip.unmount();
    }
    this.mounted.clear();
    for (const [track, entry] of [...this.trackEntries]) {
      this.disposeTrackEntry(track, entry, stage);
    }
  }

  /** Attach newly-added track effects, update all, detach removed ones. */
  private syncTrackEffects(track: VisualTrack, entry: TrackEntry, t: number): void {
    for (const effect of track.effects) {
      if (!entry.attached.has(effect)) {
        effect.attach(entry.container);
        entry.attached.add(effect);
      }
      effect.updateAt(t);
    }
    for (const effect of [...entry.attached]) {
      if (!track.effects.includes(effect)) {
        effect.detach(entry.container);
        entry.attached.delete(effect);
      }
    }
  }

  private disposeTrackEntry(track: VisualTrack, entry: TrackEntry, stage: Container): void {
    for (const effect of entry.attached) effect.detach(entry.container);
    entry.attached.clear();
    entry.clips.clear(entry.container);
    stage.removeChild(entry.container);
    entry.container.destroy();
    this.trackEntries.delete(track);
  }
}
