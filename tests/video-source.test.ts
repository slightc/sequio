import type { Texture } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { VideoSource } from '../src/media/video-source';
import type { DecodedFrame, VideoDecoderBackend } from '../src/media/video-decoder';
import type { SourceMetadata } from '../src/media/media-source';

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

/** VideoSource with a non-GPU texture factory so getTextureAt is testable. */
class TestVideoSource extends VideoSource {
  createdTextures: { destroy: ReturnType<typeof vi.fn> }[] = [];
  protected override createTexture(): Texture {
    const tex = { destroy: vi.fn() };
    this.createdTextures.push(tex);
    return tex as unknown as Texture;
  }
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const has = (arr: number[], v: number) => arr.some((x) => Math.abs(x - v) < 1e-9);

function make(opts: Partial<{ cacheFrames: number; lookahead: number }> = {}) {
  const backend = new FakeBackend();
  const source = new TestVideoSource({ src: 'x', backend, ...opts });
  return { backend, source };
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
    const { source } = make({ lookahead: 0 });
    await source.load();
    expect(source.getTextureAt(0.5)).toBeNull(); // miss before prepare

    await source.prepare(0.5);
    const tex = source.getTextureAt(0.5);
    expect(tex).not.toBeNull();
    expect(source.getTextureAt(0.5)).toBe(tex); // memoized, no re-create
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

  it('evicting a frame past budget closes it and destroys its texture', async () => {
    const { backend, source } = make({ cacheFrames: 2, lookahead: 0 });
    await source.load();

    await source.prepare(0); // idx 0
    source.getTextureAt(0); // create texture for idx 0
    await source.prepare(1 / 30); // idx 1
    await source.prepare(2 / 30); // idx 2 -> evicts idx 0 (LRU)

    expect(source.cachedFrameCount).toBe(2);
    expect(backend.frames[0]!.close).toHaveBeenCalled(); // frame 0 closed
    expect(source.createdTextures[0]!.destroy).toHaveBeenCalled(); // its texture destroyed
  });

  it('dispose closes frames, destroys textures and tears down the backend', async () => {
    const { backend, source } = make({ lookahead: 0 });
    await source.load();
    await source.prepare(0.5);
    source.getTextureAt(0.5);

    source.dispose();
    expect(backend.frames[0]!.close).toHaveBeenCalled();
    expect(source.createdTextures[0]!.destroy).toHaveBeenCalled();
    expect(backend.disposed).toBe(true);
    expect(source.getTextureAt(0.5)).toBeNull(); // unloaded
  });
});
