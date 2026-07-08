import { describe, expect, it, vi } from 'vitest';
import { Runtime, resolveAssetPath } from '../src/index';

describe('resolveAssetPath', () => {
  it('normalizes ./ , bare and / -prefixed paths to a clean root-relative path', () => {
    expect(resolveAssetPath('./video.mp4')).toBe('video.mp4');
    expect(resolveAssetPath('video.mp4')).toBe('video.mp4');
    expect(resolveAssetPath('/video.mp4')).toBe('video.mp4');
    expect(resolveAssetPath('./assets/photo.jpg')).toBe('assets/photo.jpg');
    expect(resolveAssetPath('assets\\photo.jpg')).toBe('assets/photo.jpg');
  });

  it('rejects paths that escape the project root', () => {
    expect(() => resolveAssetPath('../secret.mp4')).toThrow(/escape/);
    expect(() => resolveAssetPath('./a/../../b.mp4')).toThrow(/escape/);
  });

  it('rejects an empty path', () => {
    expect(() => resolveAssetPath('./')).toThrow(/empty/);
  });
});

/** A composition that resolves a local asset via the injected loadAsset. */
const ENTRY = `
  import { Compositor, VisualTrack, ImageClip, ImageSource } from '@sequio/engine';
  import { defineComposition, loadAsset } from '@sequio/runtime';

  export default defineComposition(async () => {
    const compositor = new Compositor({ width: 64, height: 64, fps: 30 });
    const bytes = await loadAsset('./photo.png');
    globalThis.__ASSET_LEN__ = bytes.size;
    const track = new VisualTrack();
    const source = new ImageSource({ src: bytes });
    const clip = new ImageClip(source);
    clip.start = 0;
    clip.end = 1;
    track.add(clip);
    compositor.addTrack(track);
    return { compositor, duration: 1 };
  });
`;

describe('runtime loadAsset hook', () => {
  it("hands the composition the host loader's bytes, normalizing the path first", async () => {
    const loadAsset = vi.fn(async (path: string) => new Blob([new Uint8Array([1, 2, 3, 4])]));
    const composer = await new Runtime({ files: { '/index.ts': ENTRY }, loadAsset }).run();
    const built = await composer.build(); // headless: no init()
    try {
      // Called with the RESOLVED path (./photo.png → photo.png), not the raw one.
      expect(loadAsset).toHaveBeenCalledWith('photo.png');
      expect((globalThis as Record<string, unknown>).__ASSET_LEN__).toBe(4);
      expect(built.compositor.getTracks()[0]!.clips.length).toBe(1);
    } finally {
      built.dispose();
      delete (globalThis as Record<string, unknown>).__ASSET_LEN__;
    }
  });

  it('throws a clear error when no asset loader is configured', async () => {
    // loadAsset runs inside the (async) builder, i.e. at build(), not at run().
    const composer = await new Runtime({ files: { '/index.ts': ENTRY } }).run();
    await expect(composer.build()).rejects.toThrow(/no asset loader/i);
  });
});
