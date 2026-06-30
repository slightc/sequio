import { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { Compositor } from '../src/compositor/compositor';
import { VisualClip } from '../src/compositor/clip';
import { Reconciler } from '../src/compositor/reconciler';
import { VisualTrack } from '../src/compositor/track';
import { Timebase } from '../src/time/timebase';

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
});
