import { Container, type Renderer, RenderTexture, Sprite } from 'pixi.js';
import type { Effect } from '../effects/effect';
import type { Transition } from '../effects/transition';
import type { VisualClip } from './clip';
import type { Track } from './track';
import { VisualTrack } from './track';

/** GPU context the reconciler needs to composite transitions (offscreen passes). */
export interface RenderContext {
  renderer: Renderer;
  width: number;
  height: number;
  resolution: number;
}

/** A transition's live scene-graph state: the blended sprite + its two input RTs. */
interface TransitionNode {
  sprite: Sprite;
  texA: RenderTexture | null;
  texB: RenderTexture | null;
}

/** Per-track scene-graph state: one container + a nested reconciler for its clips. */
interface TrackEntry {
  container: Container;
  clips: Reconciler;
  /** Track-level effects currently attached to `container` (adjustment layer). */
  attached: Set<Effect>;
  /** Live nodes for the track's transitions. */
  transitions: Map<Transition, TransitionNode>;
}

/**
 * Diffs the object graph at time `t` against the live PixiJS display tree.
 *
 * Two levels, same class:
 * - `reconcile(tracks, …)` maps each enabled {@link VisualTrack} to its own
 *   `Container` (z-ordered), applies track-level effects as an adjustment layer,
 *   reconciles that track's clips into it via a nested Reconciler, and (given a
 *   {@link RenderContext}) composites the track's transitions.
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

  reconcile(tracks: Track[], t: number, stage: Container, ctx?: RenderContext): void {
    const active = tracks
      .filter((tr): tr is VisualTrack => tr instanceof VisualTrack && tr.enabled)
      .sort((a, b) => a.zIndex - b.zIndex);
    const activeSet = new Set(active);

    // Drop containers for tracks that were removed or disabled.
    for (const [track, entry] of [...this.trackEntries]) {
      if (!activeSet.has(track)) this.disposeTrackEntry(track, entry, stage);
    }

    // Mount / update each active track (adjustment layer + its clips + transitions).
    for (const track of active) {
      let entry = this.trackEntries.get(track);
      if (!entry) {
        entry = {
          container: new Container(),
          clips: new Reconciler(),
          attached: new Set(),
          transitions: new Map(),
        };
        this.trackEntries.set(track, entry);
        stage.addChild(entry.container);
      }
      this.syncTrackEffects(track, entry, t);
      entry.clips.reconcileClips(track.activeAt(t), t, entry.container);
      this.syncTransitions(track, entry, t, ctx);
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

  /** The mounted pixi object for a clip (clip level), if currently mounted. */
  getMounted(clip: VisualClip): Container | undefined {
    return this.mounted.get(clip);
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

  /**
   * Composite the track's transitions. In each transition's overlap window the
   * two clips are rendered to offscreen textures and blended (needs `ctx`); the
   * blended sprite replaces the clips (they're hidden) for that window. Outside
   * the window the clips render normally. Without a `ctx` (headless / pre-init)
   * transitions are skipped and both clips just render stacked.
   */
  private syncTransitions(track: VisualTrack, entry: TrackEntry, t: number, ctx?: RenderContext): void {
    if (track.transitions.length === 0 && entry.transitions.size === 0) return;

    // Reset: every mounted clip is visible unless an active transition hides it.
    for (const clip of track.clips) {
      const obj = entry.clips.getMounted(clip);
      if (obj) obj.visible = true;
    }

    for (const transition of track.transitions) {
      let node = entry.transitions.get(transition);
      const cA = transition.from ? entry.clips.getMounted(transition.from) : undefined;
      const cB = transition.to ? entry.clips.getMounted(transition.to) : undefined;
      const active = ctx != null && transition.activeAt(t) && cA != null && cB != null;

      if (!active) {
        if (node) node.sprite.visible = false;
        continue;
      }

      if (!node) {
        node = { sprite: new Sprite(), texA: null, texB: null };
        entry.transitions.set(transition, node);
        entry.container.addChild(node.sprite);
      }
      node.texA = ensureRT(node.texA, ctx!);
      node.texB = ensureRT(node.texB, ctx!);
      ctx!.renderer.render({ container: cA!, target: node.texA, clear: true });
      ctx!.renderer.render({ container: cB!, target: node.texB, clear: true });

      node.sprite.texture = transition.render(ctx!.renderer, node.texA, node.texB, transition.progressAt(t));
      node.sprite.visible = true;
      cA!.visible = false;
      cB!.visible = false;
      // The blended sprite sits on top of the (hidden) clips.
      entry.container.setChildIndex(node.sprite, entry.container.children.length - 1);
    }

    // Tear down nodes for transitions removed from the track.
    for (const [transition, node] of [...entry.transitions]) {
      if (!track.transitions.includes(transition)) {
        disposeTransitionNode(entry.container, node);
        entry.transitions.delete(transition);
      }
    }
  }

  private disposeTrackEntry(track: VisualTrack, entry: TrackEntry, stage: Container): void {
    for (const effect of entry.attached) effect.detach(entry.container);
    entry.attached.clear();
    for (const node of entry.transitions.values()) disposeTransitionNode(entry.container, node);
    entry.transitions.clear();
    entry.clips.clear(entry.container);
    stage.removeChild(entry.container);
    entry.container.destroy();
    this.trackEntries.delete(track);
  }
}

/** Create/reuse a frame-sized RenderTexture matching the render context. */
function ensureRT(rt: RenderTexture | null, ctx: RenderContext): RenderTexture {
  if (rt && rt.width === ctx.width && rt.height === ctx.height) return rt;
  rt?.destroy(true);
  return RenderTexture.create({ width: ctx.width, height: ctx.height, resolution: ctx.resolution });
}

function disposeTransitionNode(container: Container, node: TransitionNode): void {
  container.removeChild(node.sprite);
  node.sprite.destroy();
  node.texA?.destroy(true);
  node.texB?.destroy(true);
}
