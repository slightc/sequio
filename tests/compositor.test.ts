import { Container, type Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { Compositor } from '../src/compositor/compositor';
import { VisualClip } from '../src/compositor/clip';
import { GroupClip } from '../src/compositor/group-clip';
import { Reconciler } from '../src/compositor/reconciler';
import { VisualTrack } from '../src/compositor/track';
import { VisualSource, type SourceMetadata } from '../src/media/media-source';
import type { TextureManager } from '../src/texture/texture-manager';
import { Timebase } from '../src/time/timebase';

/** A visual source that records adoption of the shared texture pool + prepares. */
class SpySource extends VisualSource {
  adopted: TextureManager | null = null;
  prepared: number[] = [];
  async load(): Promise<SourceMetadata> {
    return { width: 1, height: 1, duration: 5, hasAudio: false };
  }
  async prepare(t: number): Promise<void> {
    this.prepared.push(t);
  }
  getTextureAt(): Texture | null {
    return null;
  }
  dispose(): void {}
  adoptTextureManager(manager: TextureManager): void {
    this.adopted = manager;
  }
}

/** A clip backed by a source, so Compositor.prepare reaches `clip.source`. */
class SourceClip extends VisualClip {
  constructor(public source: VisualSource) {
    super();
  }
  override mount(): Container {
    return new Container();
  }
  override update(): void {}
  override unmount(): void {}
}

/** Minimal visual clip that records mount/update/unmount for assertions. */
class TestClip extends VisualClip {
  mountCount = 0;
  unmountCount = 0;
  updates: number[] = [];
  obj: Container | null = null;

  constructor(start: number, end: number, readonly tag = '') {
    super();
    this.start = start;
    this.end = end;
  }

  override mount(): Container {
    this.mountCount++;
    this.obj = new Container();
    (this.obj as Container & { label: string }).label = this.tag;
    return this.obj;
  }

  override update(t: number): void {
    this.updates.push(t);
    if (this.obj) this.applyCommon(this.obj, t);
  }

  override unmount(): void {
    this.unmountCount++;
    this.obj?.destroy();
    this.obj = null;
  }
}

function makeCompositor(): Compositor {
  return new Compositor({ width: 320, height: 240, timebase: new Timebase(30) });
}

describe('Reconciler', () => {
  it('mounts active clips and reuses them across frames (idempotent)', () => {
    const r = new Reconciler();
    const stage = new Container();
    const clip = new TestClip(0, 1);
    const track = new VisualTrack();
    track.add(clip);

    r.reconcile([track], 0.5, stage);
    r.reconcile([track], 0.5, stage);

    expect(clip.mountCount).toBe(1); // mounted once, reused on second pass
    expect(stage.children.length).toBe(1);
    expect(clip.updates).toEqual([0.5, 0.5]); // update runs every frame
  });

  it('unmounts clips once they fall outside their interval', () => {
    const r = new Reconciler();
    const stage = new Container();
    const clip = new TestClip(0, 1);
    const track = new VisualTrack();
    track.add(clip);

    r.reconcile([track], 0.5, stage);
    expect(stage.children.length).toBe(1);
    r.reconcile([track], 2, stage);

    expect(clip.unmountCount).toBe(1);
    expect(stage.children.length).toBe(0);
  });

  it('composites tracks bottom-to-top by zIndex', () => {
    const r = new Reconciler();
    const stage = new Container();
    const bottom = new VisualTrack();
    bottom.zIndex = 0;
    bottom.add(new TestClip(0, 1, 'bottom'));
    const top = new VisualTrack();
    top.zIndex = 10;
    top.add(new TestClip(0, 1, 'top'));

    // Pass tracks out of z-order; reconcile must sort them.
    r.reconcile([top, bottom], 0.5, stage);

    const labels = stage.children.map((c) => (c as Container & { label: string }).label);
    expect(labels).toEqual(['bottom', 'top']);
  });

  it('skips disabled tracks', () => {
    const r = new Reconciler();
    const stage = new Container();
    const track = new VisualTrack();
    track.enabled = false;
    const clip = new TestClip(0, 1);
    track.add(clip);

    r.reconcile([track], 0.5, stage);
    expect(clip.mountCount).toBe(0);
    expect(stage.children.length).toBe(0);
  });
});

describe('Compositor', () => {
  it('is not GPU-initialized until init() resolves', () => {
    const c = makeCompositor();
    expect(c.isInitialized).toBe(false);
    expect(c.view.width).toBe(320);
    expect(c.view.height).toBe(240);
  });

  it('renderSync reconciles the graph without a renderer and is idempotent', () => {
    const c = makeCompositor();
    const track = new VisualTrack();
    const clip = new TestClip(0, 1);
    track.add(clip);
    c.addTrack(track);

    c.renderSync(0.5);
    c.renderSync(0.5);

    expect(clip.mountCount).toBe(1); // same graph + t → same display tree
    expect(c.isDirty).toBe(false); // a draw clears the dirty flag
  });

  it('mutations mark the compositor dirty (contract #5)', () => {
    const c = makeCompositor();
    c.renderSync(0); // clears dirty
    expect(c.isDirty).toBe(false);
    c.addTrack(new VisualTrack());
    expect(c.isDirty).toBe(true);
  });

  it('renderToTexture throws before init()', () => {
    const c = makeCompositor();
    expect(() => c.renderToTexture(0)).toThrow(/init\(\)/);
  });

  it('dispose unmounts clips and clears tracks', () => {
    const c = makeCompositor();
    const track = new VisualTrack();
    const clip = new TestClip(0, 1);
    track.add(clip);
    c.addTrack(track);
    c.renderSync(0.5);
    expect(clip.mountCount).toBe(1);

    c.dispose();
    expect(clip.unmountCount).toBe(1);
    expect(c.getTracks().length).toBe(0);
  });

  it('exposes a shared texture pool with the configured budget', () => {
    const c = new Compositor({
      width: 320,
      height: 240,
      timebase: new Timebase(30),
      textureBudgetBytes: 1234,
    });
    expect(c.textures.usage.budgetBytes).toBe(1234);
  });

  it('routes active sources onto its shared texture pool during prepare', async () => {
    const c = makeCompositor();
    const source = new SpySource();
    const clip = new SourceClip(source);
    clip.start = 0;
    clip.end = 5;
    const track = new VisualTrack();
    track.add(clip);
    c.addTrack(track);

    await c.prepare(1);
    expect(source.adopted).toBe(c.textures); // shared VRAM budget across sources
    expect(source.prepared).toContain(1);
  });

  it('recurses into groups: nested sources are prepared at local time', async () => {
    const c = makeCompositor();
    const inner = new SpySource();
    const clip = new SourceClip(inner);
    clip.start = 1; // local to the group
    clip.end = 5;
    const group = new GroupClip();
    group.start = 2; // group localTime(t) = t - 2
    group.end = 20;
    group.add(clip);
    const track = new VisualTrack();
    track.add(group);
    c.addTrack(track);

    // timeline 4 → group local 2 → clip active [1,5) → sourceTime 2-1 = 1
    await c.prepare(4);
    expect(inner.adopted).toBe(c.textures);
    expect(inner.prepared).toEqual([1]);

    // group inactive at timeline 0 → nested source untouched
    await c.prepare(0);
    expect(inner.prepared).toEqual([1]);
  });
});
