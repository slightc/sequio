import { Container, Sprite, Texture, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { VisualClip } from '../src/compositor/clip';
import { GroupClip } from '../src/compositor/group-clip';
import { Reconciler } from '../src/compositor/reconciler';

/** Minimal leaf clip that records lifecycle and exposes its pixi object. */
class TestClip extends VisualClip {
  mountCount = 0;
  unmountCount = 0;
  obj: Container | null = null;

  constructor(start: number, end: number) {
    super();
    this.start = start;
    this.end = end;
  }

  override mount(): Container {
    this.mountCount++;
    this.obj = new Container();
    return this.obj;
  }

  override update(t: number): void {
    if (this.obj) this.applyCommon(this.obj, t);
  }

  override unmount(): void {
    this.unmountCount++;
    this.obj?.destroy();
    this.obj = null;
  }
}

/** Reconcile a single active group into a fresh stage, return the stage. */
function mountGroup(group: GroupClip, t: number): Container {
  const stage = new Container();
  const r = new Reconciler();
  r.reconcileClips([group], t, stage);
  return stage;
}

describe('GroupClip', () => {
  it('mounts children into the group container, not the stage', () => {
    const group = new GroupClip();
    group.start = 0;
    group.end = 10;
    const child = new TestClip(0, 5);
    group.add(child);

    const stage = mountGroup(group, 1);

    expect(stage.children.length).toBe(1); // only the group container
    const groupContainer = stage.children[0] as Container;
    expect(groupContainer.children.length).toBe(1); // child lives under the group
    expect(groupContainer.children[0]).toBe(child.obj);
  });

  it('treats child time as relative to the group start (offset model)', () => {
    const group = new GroupClip();
    group.start = 2;
    group.end = 10;
    const child = new TestClip(0, 1); // local [0,1) -> timeline [2,3)
    group.add(child);

    expect(group.activeChildrenAt(2)).toContain(child); // lt = 0
    expect(group.activeChildrenAt(2.5)).toContain(child); // lt = 0.5
    expect(group.activeChildrenAt(3)).not.toContain(child); // lt = 1, end exclusive
    expect(group.activeChildrenAt(1.5)).not.toContain(child); // lt = -0.5
  });

  it('mounts/unmounts children as local time crosses their interval', () => {
    const group = new GroupClip();
    group.start = 2;
    group.end = 10;
    const child = new TestClip(0, 1);
    group.add(child);

    const stage = new Container();
    const r = new Reconciler();

    r.reconcileClips([group], 2.5, stage); // lt 0.5 -> child active
    const groupContainer = stage.children[0] as Container;
    expect(groupContainer.children.length).toBe(1);
    expect(child.mountCount).toBe(1);

    r.reconcileClips([group], 3.5, stage); // lt 1.5 -> child inactive, group still active
    expect(child.unmountCount).toBe(1);
    expect(groupContainer.children.length).toBe(0);
  });

  it('unmounting the group tears down its children', () => {
    const group = new GroupClip();
    group.start = 0;
    group.end = 10;
    const child = new TestClip(0, 5);
    group.add(child);

    const stage = new Container();
    const r = new Reconciler();
    r.reconcileClips([group], 1, stage); // group active, child mounted
    expect(child.mountCount).toBe(1);

    r.reconcileClips([], 1, stage); // group no longer active -> unmount cascade
    expect(child.unmountCount).toBe(1);
    expect(stage.children.length).toBe(0);
  });

  it('group transform/opacity is applied to the container (inherited by children)', () => {
    const group = new GroupClip();
    group.start = 0;
    group.end = 10;
    group.transform.position.setStatic([100, 40]);
    group.opacity.setStatic(0.5);
    const child = new TestClip(0, 5);
    child.transform.position.setStatic([10, 0]); // stays local
    group.add(child);

    const stage = mountGroup(group, 1);
    const groupContainer = stage.children[0] as Container;

    expect(groupContainer.position.x).toBe(100);
    expect(groupContainer.position.y).toBe(40);
    expect(groupContainer.alpha).toBe(0.5);
    // Child keeps its own local transform; pixi composes the two at draw time.
    expect(child.obj!.position.x).toBe(10);
  });

  it('render(t) is idempotent: re-reconciling the same t reuses children', () => {
    const group = new GroupClip();
    group.start = 0;
    group.end = 10;
    const child = new TestClip(0, 5);
    group.add(child);

    const stage = new Container();
    const r = new Reconciler();
    r.reconcileClips([group], 1, stage);
    r.reconcileClips([group], 1, stage);

    expect(group.activeChildrenAt(1)).toEqual([child]);
    expect(child.mountCount).toBe(1); // mounted once across both passes
  });

  it('nests groups: offsets compound through the hierarchy', () => {
    const outer = new GroupClip();
    outer.start = 1;
    outer.end = 20;
    const inner = new GroupClip();
    inner.start = 1; // local to outer -> timeline 2
    inner.end = 10;
    const leaf = new TestClip(0, 1); // local to inner -> timeline [2,3)
    inner.add(leaf);
    outer.add(inner);

    const stage = new Container();
    const r = new Reconciler();

    r.reconcileClips([outer], 2.5, stage); // outer lt 1.5, inner lt 0.5 -> leaf active
    const outerC = stage.children[0] as Container;
    const innerC = outerC.children[0] as Container;
    expect(innerC.children[0]).toBe(leaf.obj);
    expect(leaf.mountCount).toBe(1);

    r.reconcileClips([outer], 3.5, stage); // inner lt 1.5 -> leaf inactive
    expect(leaf.unmountCount).toBe(1);
    expect(innerC.children.length).toBe(0);
  });

  it('a masked group measures its pivot on the CLIPPED bounds on the FIRST paint', () => {
    // Regression: applyCommon synced the mask AFTER measuring the transform pivot,
    // so the first paint of a freshly-mounted masked group (e.g. a coverImage /
    // coverVideo panel, anchor [0,0]) measured the pivot on the UNMASKED content —
    // a cover-cropped child that overflows the box has a negative min — and landed
    // the group offset, snapping right only on the next render (the "seek lands the
    // clip in the wrong place until you seek again" bug). Mask must be applied
    // before the measure so the very first paint is already correct.
    class SpriteClip extends VisualClip {
      obj: Container | null = null;
      constructor(private readonly tex: Texture) {
        super();
        this.start = 0;
        this.end = 1e5;
      }
      override mount(): Container {
        const s = new Sprite(this.tex);
        s.anchor.set(0, 0);
        this.obj = s;
        return s;
      }
      override update(t: number): void {
        if (this.obj) this.applyCommon(this.obj, t);
      }
      override unmount(): void {
        this.obj?.destroy();
        this.obj = null;
      }
    }

    const group = new GroupClip();
    group.start = 0;
    group.end = 1e5;
    group.transform.anchor.setStatic([0, 0]);
    group.maskShape = { kind: 'rect', width: 500, height: 400 };
    // A child larger than the box, offset negative (object-fit: cover centering).
    const tex = new Texture({ source: new TextureSource({ width: 600, height: 400, resolution: 1 }) });
    const child = new SpriteClip(tex);
    child.transform.position.setStatic([-50, 0]); // overflows left of the box
    group.add(child);

    const stage = new Container();
    const r = new Reconciler();
    r.reconcileClips([group], 0, stage); // FIRST paint
    const container = stage.children[0] as Container;

    // anchor [0,0] → pivot = bounds.min. Masked bounds start at 0, so pivot is 0
    // on the first paint (was -50, the unmasked child min, before the fix).
    expect(container.pivot.x).toBe(0);
    expect(container.pivot.y).toBe(0);
  });
});
