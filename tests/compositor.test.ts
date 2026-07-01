import { Container, type Texture } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { Compositor } from '../src/compositor/compositor';
import { VisualClip } from '../src/compositor/clip';
import { GroupClip } from '../src/compositor/group-clip';
import { Reconciler } from '../src/compositor/reconciler';
import { Effect } from '../src/effects/effect';
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

/** A source whose `prepare` resolves only when released — models a slow decode. */
class GatedSource extends VisualSource {
  private readonly resolves: Array<() => void> = [];
  async load(): Promise<SourceMetadata> {
    return { width: 1, height: 1, duration: 5, hasAudio: false };
  }
  prepare(): Promise<void> {
    return new Promise((r) => this.resolves.push(r));
  }
  releaseAll(): void {
    this.resolves.splice(0).forEach((r) => r());
  }
  getTextureAt(): Texture | null {
    return null; // always a miss until "decoded"
  }
  dispose(): void {}
  adoptTextureManager(): void {}
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

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

/** Labels of the clips mounted under a track container. */
function clipLabels(container: Container): string[] {
  return container.children.map((c) => (c as Container & { label: string }).label);
}

/** A track effect that records attach/detach/update wiring (no real filter). */
class TestEffect extends Effect {
  params = {} as Effect['params'];
  protected override createFilter() {
    return {} as never;
  }
  updateAt = vi.fn();
}

describe('Reconciler', () => {
  it('mounts active clips into a per-track container and reuses them (idempotent)', () => {
    const r = new Reconciler();
    const stage = new Container();
    const clip = new TestClip(0, 1);
    const track = new VisualTrack();
    track.add(clip);

    r.reconcile([track], 0.5, stage);
    r.reconcile([track], 0.5, stage);

    expect(clip.mountCount).toBe(1); // mounted once, reused on second pass
    expect(stage.children.length).toBe(1); // one track container
    const trackC = stage.children[0] as Container;
    expect(trackC.children.length).toBe(1); // clip lives under the track
    expect(clip.updates).toEqual([0.5, 0.5]); // update runs every frame
  });

  it('unmounts clips but keeps the (empty) track container', () => {
    const r = new Reconciler();
    const stage = new Container();
    const clip = new TestClip(0, 1);
    const track = new VisualTrack();
    track.add(clip);

    r.reconcile([track], 0.5, stage);
    const trackC = stage.children[0] as Container;
    expect(trackC.children.length).toBe(1);

    r.reconcile([track], 2, stage);
    expect(clip.unmountCount).toBe(1);
    expect(stage.children.length).toBe(1); // track still enabled → container stays
    expect(trackC.children.length).toBe(0);
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

    const order = stage.children.map((c) => clipLabels(c as Container)[0]);
    expect(order).toEqual(['bottom', 'top']);
  });

  it('keeps clip z-order stable when a lower clip activates later', () => {
    const r = new Reconciler();
    const stage = new Container();
    const track = new VisualTrack();
    const a = new TestClip(1, 3, 'a'); // index 0, activates later
    const b = new TestClip(0, 3, 'b'); // index 1, active from the start
    track.add(a);
    track.add(b);

    r.reconcile([track], 0.5, stage); // only b mounted
    r.reconcile([track], 2, stage); // a mounts after b, but must sit below it
    const trackC = stage.children[0] as Container;
    expect(clipLabels(trackC)).toEqual(['a', 'b']);
  });

  it('reflects track enable/disable immediately', () => {
    const r = new Reconciler();
    const stage = new Container();
    const clip = new TestClip(0, 1);
    const track = new VisualTrack();
    track.add(clip);

    r.reconcile([track], 0.5, stage);
    expect(stage.children.length).toBe(1);

    track.enabled = false;
    r.reconcile([track], 0.5, stage);
    expect(stage.children.length).toBe(0);
    expect(clip.unmountCount).toBe(1);

    track.enabled = true;
    r.reconcile([track], 0.5, stage);
    expect(stage.children.length).toBe(1);
    expect(clip.mountCount).toBe(2);
  });

  it('reorders track containers when zIndex changes', () => {
    const r = new Reconciler();
    const stage = new Container();
    const a = new VisualTrack();
    a.zIndex = 0;
    a.add(new TestClip(0, 1, 'a'));
    const b = new VisualTrack();
    b.zIndex = 10;
    b.add(new TestClip(0, 1, 'b'));

    r.reconcile([a, b], 0.5, stage);
    expect(stage.children.map((c) => clipLabels(c as Container)[0])).toEqual(['a', 'b']);

    b.zIndex = -5; // move b below a
    r.reconcile([a, b], 0.5, stage);
    expect(stage.children.map((c) => clipLabels(c as Container)[0])).toEqual(['b', 'a']);
  });

  it('applies track-level effects to the track container (adjustment layer)', () => {
    const r = new Reconciler();
    const stage = new Container();
    const track = new VisualTrack();
    track.add(new TestClip(0, 5));
    const fx = new TestEffect();
    const attach = vi.spyOn(fx, 'attach').mockImplementation(() => {});
    const detach = vi.spyOn(fx, 'detach').mockImplementation(() => {});
    track.effects.push(fx);

    r.reconcile([track], 0.5, stage);
    const trackC = stage.children[0] as Container;
    expect(attach).toHaveBeenCalledWith(trackC); // attached to the track container
    expect(fx.updateAt).toHaveBeenCalledWith(0.5);

    r.reconcile([track], 0.6, stage);
    expect(attach).toHaveBeenCalledTimes(1); // not re-attached
    expect(fx.updateAt).toHaveBeenLastCalledWith(0.6); // updated every frame

    track.effects.length = 0; // remove the effect
    r.reconcile([track], 0.7, stage);
    expect(detach).toHaveBeenCalledWith(trackC);
  });

  it('tiles adjacent clips at a fractional-frame boundary with no overlap or gap', () => {
    const r = new Reconciler();
    const stage = new Container();
    const track = new VisualTrack();
    const a = new TestClip(0, 10.5, 'a'); // [0, 10.5)
    const b = new TestClip(10.5, 20, 'b'); // [10.5, 20)
    track.add(a);
    track.add(b);

    const labelsAt = (t: number): string[] => {
      r.reconcile([track], t, stage);
      return clipLabels(stage.children[0] as Container);
    };

    // Exactly one clip active on each side of, and at, the shared boundary —
    // never both (overlap) and never none (gap). end is exclusive, so t=10.5
    // belongs to clip b.
    expect(labelsAt(10.4)).toEqual(['a']);
    expect(labelsAt(10.5)).toEqual(['b']);
    expect(labelsAt(10.6)).toEqual(['b']);
    expect(a.unmountCount).toBe(1); // a cleanly torn down at the swap
    expect(b.mountCount).toBe(1);
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

  it('holds the last frame at the timeline end (default), not the black boundary', () => {
    const c = makeCompositor(); // timebase 30fps
    const track = new VisualTrack();
    const clip = new TestClip(0, 1); // active on [0,1); last real frame at 29/30
    track.add(clip);
    c.addTrack(track);

    c.renderSync(1); // playhead at the exclusive end
    expect(clip.mountCount).toBe(1); // stays lit — not an empty/black frame
    expect(clip.updates.at(-1)).toBeCloseTo(29 / 30); // rendered the last real frame
  });

  it('does not hold at an internal cut — the next clip shows (clean cut)', () => {
    const c = makeCompositor();
    const track = new VisualTrack();
    const a = new TestClip(0, 1, 'a');
    const b = new TestClip(1, 2, 'b');
    track.add(a);
    track.add(b);
    c.addTrack(track);

    c.renderSync(1); // A ends, B starts — B wins, A is not held
    expect(b.updates.at(-1)).toBe(1);
    expect(a.mountCount).toBe(0);

    c.renderSync(2); // the real end → hold B's last frame
    expect(b.updates.at(-1)).toBeCloseTo(2 - 1 / 30);
  });

  it('does not hold in a gap — renders black there', () => {
    const c = makeCompositor();
    const track = new VisualTrack();
    const a = new TestClip(0, 1, 'a');
    const b = new TestClip(2, 3, 'b'); // gap over [1,2)
    track.add(a);
    track.add(b);
    c.addTrack(track);

    c.renderSync(1.5); // in the gap, well before the end → nothing active
    expect(a.mountCount).toBe(0);
    expect(b.mountCount).toBe(0);
  });

  it('holdLastFrameAtEnd:false renders the black boundary (opt-out for trailing black)', () => {
    const c = new Compositor({ width: 320, height: 240, timebase: new Timebase(30), holdLastFrameAtEnd: false });
    const track = new VisualTrack();
    const clip = new TestClip(0, 1);
    track.add(clip);
    c.addTrack(track);

    c.renderSync(1); // exact end, no hold → clip inactive → empty frame
    expect(clip.mountCount).toBe(0);
  });

  it('prepare holds the last frame at the end too (decodes end - 1/fps)', async () => {
    const c = makeCompositor();
    const src = new SpySource();
    const clip = new SourceClip(src);
    clip.start = 0;
    clip.end = 1;
    const track = new VisualTrack();
    track.add(clip);
    c.addTrack(track);

    await c.prepare(1); // at the end → prep the last real frame, not "nothing"
    expect(src.prepared.at(-1)).toBeCloseTo(29 / 30);
  });

  it('applies global effects to the whole composite (adjustment over the stage)', () => {
    const c = makeCompositor();
    const track = new VisualTrack();
    track.add(new TestClip(0, 5));
    c.addTrack(track);

    const fx = new TestEffect();
    const attach = vi.spyOn(fx, 'attach').mockImplementation(() => {});
    const detach = vi.spyOn(fx, 'detach').mockImplementation(() => {});
    c.effects.push(fx);

    c.renderSync(0.5);
    expect(attach).toHaveBeenCalledTimes(1); // attached to the stage once
    const stage = attach.mock.calls[0]![0];
    expect(fx.updateAt).toHaveBeenCalledWith(0.5);

    c.renderSync(0.6);
    expect(attach).toHaveBeenCalledTimes(1); // reused, not re-attached
    expect(fx.updateAt).toHaveBeenLastCalledWith(0.6); // updated every frame

    c.effects.length = 0; // remove the global effect
    c.renderSync(0.7);
    expect(detach).toHaveBeenCalledWith(stage);
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

  it('removeTrack unmounts immediately so a track can move between compositors', () => {
    const a = makeCompositor();
    const b = makeCompositor();
    const track = new VisualTrack();
    const clip = new TestClip(0, 5);
    track.add(clip);

    a.addTrack(track);
    a.renderSync(0.5);
    expect(clip.mountCount).toBe(1);

    // Move to b WITHOUT rendering a again — the unmount must happen now, not on
    // a's next reconcile (which never comes), or the clip is left double-mounted.
    a.removeTrack(track);
    expect(clip.unmountCount).toBe(1); // unmounted immediately

    b.addTrack(track);
    b.renderSync(0.5);
    expect(clip.mountCount).toBe(2); // freshly mounted on b

    // Move back to a and render — mounts cleanly again (playback not frozen).
    b.removeTrack(track);
    expect(clip.unmountCount).toBe(2);
    a.addTrack(track);
    a.renderSync(0.5);
    expect(clip.mountCount).toBe(3);
  });

  it('renderPreview repaints the same frame once its async decode resolves (seek to unbuffered)', async () => {
    const c = makeCompositor();
    const source = new GatedSource();
    const clip = new SourceClip(source);
    clip.start = 0;
    clip.end = 5;
    const track = new VisualTrack();
    track.add(clip);
    c.addTrack(track);

    const spy = vi.spyOn(c, 'renderSync');
    c.renderPreview(0.5);
    expect(spy).toHaveBeenCalledTimes(1); // immediate best-effort (miss → black)

    source.releaseAll(); // the decode finishes
    await flush();
    expect(spy).toHaveBeenCalledTimes(2); // repainted after the decode
    expect(spy).toHaveBeenLastCalledWith(0.5);
  });

  it('a newer renderPreview supersedes an earlier pending post-decode repaint', async () => {
    const c = makeCompositor();
    const source = new GatedSource();
    const clip = new SourceClip(source);
    clip.start = 0;
    clip.end = 5;
    const track = new VisualTrack();
    track.add(clip);
    c.addTrack(track);

    const spy = vi.spyOn(c, 'renderSync');
    c.renderPreview(0.5); // token 1 (superseded)
    c.renderPreview(1.0); // token 2 (current)
    expect(spy).toHaveBeenCalledTimes(2); // two immediate renders

    source.releaseAll(); // both decodes resolve
    await flush();
    expect(spy).toHaveBeenCalledTimes(3); // only the latest frame repaints, not the stale 0.5
    expect(spy).toHaveBeenLastCalledWith(1.0);
  });

  it('continuous seeking repaints only the final frame (no race between decodes)', async () => {
    const c = makeCompositor();
    const source = new GatedSource();
    const clip = new SourceClip(source);
    clip.start = 0;
    clip.end = 5;
    const track = new VisualTrack();
    track.add(clip);
    c.addTrack(track);

    const spy = vi.spyOn(c, 'renderSync');
    c.renderPreview(0.2);
    c.renderPreview(0.4);
    c.renderPreview(0.6); // rapid seeks
    expect(spy).toHaveBeenCalledTimes(3); // three immediate renders

    source.releaseAll(); // all decodes resolve (possibly out of order)
    await flush();
    expect(spy).toHaveBeenCalledTimes(4); // only the latest seek repaints
    expect(spy).toHaveBeenLastCalledWith(0.6);
  });

  it('an export/direct render supersedes a pending preview repaint (export unaffected)', async () => {
    const c = makeCompositor();
    const source = new GatedSource();
    const clip = new SourceClip(source);
    clip.start = 0;
    clip.end = 5;
    const track = new VisualTrack();
    track.add(clip);
    c.addTrack(track);

    const spy = vi.spyOn(c, 'renderSync');
    c.renderPreview(0.5); // schedules a repaint once 0.5 decodes
    expect(spy).toHaveBeenCalledTimes(1);
    c.renderSync(1.0); // an export frame renders directly on the same compositor
    expect(spy).toHaveBeenCalledTimes(2);

    source.releaseAll(); // 0.5's decode now resolves
    await flush();
    expect(spy).toHaveBeenCalledTimes(2); // the stale 0.5 repaint is skipped — no clobber
    expect(spy).toHaveBeenLastCalledWith(1.0);
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

  it('defaults resolution to 1 without devicePixelRatio and honors an override', () => {
    expect(makeCompositor().resolution).toBe(1);
    const hi = new Compositor({ width: 10, height: 10, timebase: new Timebase(30), resolution: 3 });
    expect(hi.resolution).toBe(3);
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

  it('shares an injected texture pool and does not dispose it (fork export)', () => {
    const shared = makeCompositor().textures;
    const disposeSpy = vi.spyOn(shared, 'dispose');
    const fork = new Compositor({ width: 320, height: 240, timebase: new Timebase(30), textures: shared });
    expect(fork.textures).toBe(shared); // reuses the pool → no second decode/upload
    fork.dispose();
    expect(disposeSpy).not.toHaveBeenCalled(); // the shared pool outlives the fork
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

  it('pre-warms clips upcoming within prewarmSeconds (at their first frame)', async () => {
    const c = new Compositor({
      width: 320,
      height: 240,
      timebase: new Timebase(30),
      prewarmSeconds: 0.5,
    });
    const s1 = new SpySource();
    const clip1 = new SourceClip(s1);
    clip1.start = 0;
    clip1.end = 1;
    const s2 = new SpySource();
    const clip2 = new SourceClip(s2);
    clip2.start = 1;
    clip2.end = 2;
    const track = new VisualTrack();
    track.add(clip1);
    track.add(clip2);
    c.addTrack(track);

    // t=0.6: clip1 active (source time 0.6); clip2 upcoming (starts at 1, within
    // 0.6+0.5=1.1) → warmed at its first frame (sourceIn = 0).
    await c.prepare(0.6);
    expect(s1.prepared).toContain(0.6);
    expect(s2.prepared).toEqual([0]);
  });

  it('does not warm clips beyond the window, and the threshold is adjustable', async () => {
    const c = new Compositor({ width: 320, height: 240, timebase: new Timebase(30) });
    const s2 = new SpySource();
    const clip2 = new SourceClip(s2);
    clip2.start = 1;
    clip2.end = 2;
    const track = new VisualTrack();
    track.add(clip2);
    c.addTrack(track);

    c.prewarmSeconds = 0.2;
    await c.prepare(0.6); // clip2 starts at 1, outside 0.6+0.2=0.8 → not warmed
    expect(s2.prepared).toEqual([]);

    c.prewarmSeconds = 0.5;
    await c.prepare(0.6); // now within 0.6+0.5=1.1 → warmed
    expect(s2.prepared).toEqual([0]);

    c.prewarmSeconds = 0; // disabled
    s2.prepared.length = 0;
    await c.prepare(0.6);
    expect(s2.prepared).toEqual([]);
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
