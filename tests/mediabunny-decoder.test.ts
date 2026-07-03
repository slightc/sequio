import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediabunnyVideoDecoder, setFrameImageExtractor } from '../src/media/mediabunny-decoder';
import { setMediabunnyModule } from '../src/media/mediabunny-loader';

describe('MediabunnyVideoDecoder lifecycle', () => {
  it('throws if decode is called before load()', async () => {
    const d = new MediabunnyVideoDecoder('x' as never);
    await expect(d.decode(0)).rejects.toThrow(/before load/);
  });

  it('resolves null (not throws) when decode races a dispose()', async () => {
    // A prepare()'s directional look-ahead fires decodes fire-and-forget; if the
    // source is disposed first, that late decode must resolve null, not throw an
    // uncaught rejection.
    const d = new MediabunnyVideoDecoder('x' as never);
    d.dispose();
    await expect(d.decode(0)).resolves.toBeNull();
  });
});

describe('MediabunnyVideoDecoder frame ownership', () => {
  afterEach(() => {
    setMediabunnyModule(undefined);
    setFrameImageExtractor(null);
  });

  /** Minimal fake `mediabunny` module: one video sample at t=0, no audio. */
  function fakeMediabunny(sample: unknown) {
    const track = {
      displayWidth: 4,
      displayHeight: 4,
      computePacketStats: async () => ({ averagePacketRate: 30 }),
    };
    class FakeInput {
      async getPrimaryVideoTrack() {
        return track;
      }
      async getPrimaryAudioTrack() {
        return null;
      }
      async computeDuration() {
        return 1;
      }
    }
    class FakeSink {
      // eslint-disable-next-line require-yield
      async *samples() {
        yield sample;
      }
    }
    setMediabunnyModule({
      Input: FakeInput,
      VideoSampleSink: FakeSink,
      ALL_FORMATS: [],
      UrlSource: class {},
      BufferSource: class {},
      BlobSource: class {},
    } as never);
  }

  it('caches an OWNED VideoFrame (toVideoFrame), not the ephemeral toCanvasImageSource', async () => {
    // Regression: toCanvasImageSource() may be auto-closed "in the next
    // microtask", but we cache the frame and upload it to a texture LATER — so a
    // deferred WebGPU upload would import a freed frame. decode() must take an
    // owned VideoFrame and close the sample (not the frame) immediately.
    const ownedFrame = { close: vi.fn() };
    const sample = {
      timestamp: 0,
      toVideoFrame: vi.fn(() => ownedFrame),
      toCanvasImageSource: vi.fn(),
      close: vi.fn(),
    };
    fakeMediabunny(sample);

    const d = new MediabunnyVideoDecoder('x' as never);
    await d.load();
    const frame = await d.decode(0);

    expect(sample.toVideoFrame).toHaveBeenCalledTimes(1);
    expect(sample.toCanvasImageSource).not.toHaveBeenCalled(); // never retain the ephemeral one
    expect(sample.close).toHaveBeenCalledTimes(1); // sample released once the frame is owned
    expect(frame?.image).toBe(ownedFrame);

    frame?.close(); // eviction closes the OWNED frame, not the (already-closed) sample
    expect(ownedFrame.close).toHaveBeenCalledTimes(1);
  });
});
