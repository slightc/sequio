import type { Texture } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { VideoSource } from '../src/media/video-source';
import type { DecodedFrame, VideoDecoderBackend } from '../src/media/video-decoder';
import type { SourceMetadata } from '../src/media/media-source';
import { TextureManager } from '../src/texture/texture-manager';

const META: SourceMetadata = { width: 640, height: 360, duration: 10, fps: 30, hasAudio: false };

/** Records decode calls and hands back fake frames with spy-able close(). */
class FakeBackend implements VideoDecoderBackend {
  decodeCalls: number[] = [];
  frames: { sec: number; close: ReturnType<typeof vi.fn> }[] = [];
  disposed = false;

  constructor(private readonly meta: SourceMetadata = META) {}

  async load(): Promise<SourceMetadata> {
    return this.meta;
  }

  async decode(sec: number): Promise<DecodedFrame | null> {
    this.decodeCalls.push(sec);
    const frame = { sec, close: vi.fn() };
    this.frames.push(frame);
    return { timestamp: sec, image: {} as CanvasImageSource, close: frame.close };
  }

  dispose(): void {
    this.disposed = true;
  }
}

/** TextureManager with a non-GPU factory so getTextureAt is testable. */
class TestTextureManager extends TextureManager {
  created: { destroy: ReturnType<typeof vi.fn> }[] = [];
  protected override createTexture(): Texture {
    const tex = { destroy: vi.fn() };
    this.created.push(tex);
    return tex as unknown as Texture;
  }
  protected override estimateBytes(): number {
    return 100;
  }
}

/** Backend that can fork over a shared "demux" but decode independently. */
class ForkableBackend implements VideoDecoderBackend {
  decodeCalls: number[] = [];
  ownsDemux = true;
  constructor(private readonly demux = { disposed: false }) {}
  async load(): Promise<SourceMetadata> {
    return META;
  }
  async decode(sec: number): Promise<DecodedFrame | null> {
    if (this.demux.disposed) throw new Error('decode after shared demux disposed');
    this.decodeCalls.push(sec);
    return { timestamp: sec, image: {} as CanvasImageSource, close: () => {} };
  }
  fork(): ForkableBackend {
    const f = new ForkableBackend(this.demux); // share the demux
    f.ownsDemux = false;
    return f;
  }
  dispose(): void {
    if (this.ownsDemux) this.demux.disposed = true; // only the owner tears down the demux
  }
}

/** Backend whose decodes block until explicitly released (per source-second). */
class GatedBackend implements VideoDecoderBackend {
  decodeCalls: number[] = [];
  private readonly gates = new Map<number, () => void>();
  async load(): Promise<SourceMetadata> {
    return META;
  }
  decode(sec: number): Promise<DecodedFrame | null> {
    this.decodeCalls.push(sec);
    return new Promise((resolve) => {
      this.gates.set(sec, () => resolve({ timestamp: sec, image: {} as CanvasImageSource, close: () => {} }));
    });
  }
  release(sec: number): void {
    this.gates.get(sec)?.();
  }
  dispose(): void {}
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const has = (arr: number[], v: number) => arr.some((x) => Math.abs(x - v) < 1e-9);

function make(opts: Partial<{ cacheFrames: number; lookahead: number }> = {}) {
  const backend = new FakeBackend();
  const textures = new TestTextureManager();
  const source = new VideoSource({ src: 'x', backend, textureManager: textures, ...opts });
  return { backend, textures, source };
}

describe('VideoSource', () => {
  it('passes through metadata and keys time to a CFR frame index', async () => {
    const { source } = make();
    const meta = await source.load();
    expect(meta).toEqual(META);
    expect(source.frameIndexAt(1)).toBe(30);
    expect(source.frameIndexAt(0.5)).toBe(15);
    expect(source.frameIndexAt(-1)).toBe(0); // clamped
  });

  it('throws if prepare runs before load', async () => {
    const { source } = make();
    await expect(source.prepare(0)).rejects.toThrow(/load\(\)/);
  });

  it('prepare decodes the target frame; getTextureAt is a sync cache read', async () => {
    const { source, textures } = make({ lookahead: 0 });
    await source.load();
    expect(source.getTextureAt(0.5)).toBeNull(); // miss before prepare

    await source.prepare(0.5);
    const tex = source.getTextureAt(0.5);
    expect(tex).not.toBeNull();
    expect(source.getTextureAt(0.5)).toBe(tex); // pooled, no re-upload
    expect(textures.created).toHaveLength(1);
    expect(source.getTextureAt(2.0)).toBeNull(); // different frame, still a miss
  });

  it('reads ahead in the playback direction, flipping on backward seek', async () => {
    const { backend, source } = make({ lookahead: 2 });
    await source.load();

    await source.prepare(0.5); // idx 15, forward
    await tick();
    expect(has(backend.decodeCalls, 0.5)).toBe(true);
    expect(has(backend.decodeCalls, 16 / 30)).toBe(true); // idx 16
    expect(has(backend.decodeCalls, 17 / 30)).toBe(true); // idx 17

    backend.decodeCalls.length = 0;
    await source.prepare(0.4); // idx 12, backward
    await tick();
    expect(has(backend.decodeCalls, 0.4)).toBe(true);
    expect(has(backend.decodeCalls, 11 / 30)).toBe(true); // idx 11
    expect(has(backend.decodeCalls, 10 / 30)).toBe(true); // idx 10
  });

  it('does not re-decode a frame already cached or in flight', async () => {
    const { backend, source } = make({ lookahead: 0 });
    await source.load();
    await source.prepare(0.5);
    await source.prepare(0.5);
    expect(backend.decodeCalls.filter((s) => s === 0.5)).toHaveLength(1);
  });

  it('prepare awaits an already-in-flight (prewarm) decode instead of returning early', async () => {
    // The bug this guards: on export, prewarm starts decoding frame N+1; a later
    // prepare(N+1) must AWAIT that decode, not resolve before the frame exists
    // (which would render a dropped/black frame).
    const backend = new GatedBackend();
    const textures = new TestTextureManager();
    const source = new VideoSource({ src: 'x', backend, textureManager: textures, lookahead: 1 });
    await source.load();

    const p1 = source.prepare(0.5); // decode idx15; prewarm idx16 fires after idx15 resolves
    backend.release(0.5);
    await p1;
    expect(source.getTextureAt(0.5)).not.toBeNull();
    expect(source.getTextureAt(16 / 30)).toBeNull(); // idx16 still decoding (gated)

    // Explicitly prepare the in-flight frame — it must stay pending until decoded.
    const p2 = source.prepare(16 / 30);
    const raced = await Promise.race([p2.then(() => 'resolved'), tick().then(() => 'pending')]);
    expect(raced).toBe('pending');

    backend.release(16 / 30);
    await p2;
    expect(source.getTextureAt(16 / 30)).not.toBeNull(); // now resident, in sync
    expect(backend.decodeCalls.filter((s) => Math.abs(s - 16 / 30) < 1e-9)).toHaveLength(1); // decoded once
  });

  it('fork() shares the demux but decodes independently; disposing a fork keeps the parent alive', async () => {
    const backend = new ForkableBackend();
    const source = new VideoSource({ src: 'x', backend, textureManager: new TestTextureManager(), lookahead: 0 });
    await source.load();

    const forked = source.fork();
    forked.adoptTextureManager(new TestTextureManager()); // its own pool (a fork compositor would inject one)
    await forked.load();

    await source.prepare(0.5); // parent decodes idx 15
    await forked.prepare(1.0); // fork decodes idx 30, independently
    expect(source.getTextureAt(0.5)).not.toBeNull();
    expect(forked.getTextureAt(1.0)).not.toBeNull();
    expect(source.getTextureAt(1.0)).toBeNull(); // separate caches — parent didn't decode the fork's frame
    expect(forked.getTextureAt(0.5)).toBeNull();

    // Disposing the fork must NOT tear down the shared demux — the parent still decodes.
    forked.dispose();
    await source.prepare(2.0);
    expect(source.getTextureAt(2.0)).not.toBeNull();
  });

  it('evicting a frame past budget closes it and releases its texture', async () => {
    const { backend, textures, source } = make({ cacheFrames: 2, lookahead: 0 });
    await source.load();

    await source.prepare(0); // idx 0
    source.getTextureAt(0); // upload texture for idx 0
    await source.prepare(1 / 30); // idx 1
    await source.prepare(2 / 30); // idx 2 -> evicts idx 0 (LRU)

    expect(source.cachedFrameCount).toBe(2);
    expect(backend.frames[0]!.close).toHaveBeenCalled(); // frame 0 closed
    expect(textures.created[0]!.destroy).toHaveBeenCalled(); // its texture released
    expect(textures.count).toBe(0);
  });

  it('dispose closes frames, releases textures and tears down the backend', async () => {
    const { backend, textures, source } = make({ lookahead: 0 });
    await source.load();
    await source.prepare(0.5);
    source.getTextureAt(0.5);

    source.dispose();
    expect(backend.frames[0]!.close).toHaveBeenCalled();
    expect(textures.created[0]!.destroy).toHaveBeenCalled();
    expect(backend.disposed).toBe(true);
    expect(source.getTextureAt(0.5)).toBeNull(); // unloaded
  });

  it('does not dispose an injected (shared) texture manager', async () => {
    const { textures, source } = make({ lookahead: 0 });
    await source.load();
    await source.prepare(0.5);
    source.getTextureAt(0.5);
    const spy = vi.spyOn(textures, 'dispose');
    source.dispose();
    expect(spy).not.toHaveBeenCalled(); // Compositor owns the shared pool
  });

  it('adopts a shared texture manager when it owns none', async () => {
    const backend = new FakeBackend();
    const source = new VideoSource({ src: 'x', backend, lookahead: 0 }); // private default
    const shared = new TestTextureManager();
    source.adoptTextureManager(shared);
    await source.load();
    await source.prepare(0.5);
    source.getTextureAt(0.5);
    expect(shared.created).toHaveLength(1); // uploads routed to the shared pool
  });
});
