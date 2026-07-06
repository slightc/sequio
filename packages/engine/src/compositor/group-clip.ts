import { Container } from 'pixi.js';
import { VisualClip } from './clip';
import { Reconciler } from './reconciler';

/**
 * A clip that groups other visual clips into a sub-composition.
 *
 * `GroupClip` is itself a {@link VisualClip}, so it lives on a track (or inside
 * another group) and carries its own `transform` / `opacity` / `blendMode` /
 * `effects` / animation — these apply to the whole subtree, because children
 * mount into the group's PixiJS `Container` and inherit its transform, alpha,
 * blend mode and filter chain natively.
 *
 * Time is **relative by offset**: a child active at the group's local time
 * `lt = t - group.start` is active at timeline time `t`. The group evaluates
 * its own animation at the timeline `t`; children evaluate at `lt`. Nesting
 * compounds offsets, so groups inside groups just work.
 *
 * A clip has a single parent (one track or one group) — do not add the same
 * clip instance to two parents.
 */
export class GroupClip extends VisualClip {
  /** Child clips, composited bottom-to-top in array order. */
  readonly children: VisualClip[] = [];
  private container: Container | null = null;
  private readonly reconciler = new Reconciler();

  add(clip: VisualClip): void {
    this.children.push(clip);
  }

  remove(clip: VisualClip): void {
    const i = this.children.indexOf(clip);
    if (i >= 0) this.children.splice(i, 1);
  }

  /** Map a timeline time (seconds) to this group's local time (offset model). */
  localTime(t: number): number {
    return t - this.start;
  }

  /** Children active at timeline time `t`, in composite (array) order. */
  activeChildrenAt(t: number): VisualClip[] {
    const lt = this.localTime(t);
    return this.children.filter((c) => c.isActiveAt(lt));
  }

  override mount(): Container {
    this.container = new Container();
    return this.container;
  }

  override update(t: number): void {
    if (!this.container) return;
    // Reconcile children first so the group's local bounds are current, then
    // apply the group transform (its anchor maps against those bounds). Group
    // props are evaluated on the main timeline `t`; children at local time.
    const lt = this.localTime(t);
    this.reconciler.reconcileClips(
      this.children.filter((c) => c.isActiveAt(lt)),
      lt,
      this.container,
    );
    this.applyCommon(this.container, t);
  }

  override unmount(): void {
    if (this.container) this.reconciler.clear(this.container);
    this.container?.destroy({ children: true });
    this.container = null;
  }
}
