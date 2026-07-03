import { describe, expect, it } from 'vitest';
import { MediabunnyVideoDecoder } from '../src/media/mediabunny-decoder';

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
