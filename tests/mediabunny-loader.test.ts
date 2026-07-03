import { afterEach, describe, expect, it } from 'vitest';
import { loadMediabunny, setMediabunnyModule, type MediabunnyModule } from '../src/media/mediabunny-loader';

describe('loadMediabunny', () => {
  afterEach(() => setMediabunnyModule(undefined));

  it('returns the pinned instance without importing when one is set', async () => {
    const fake = { marker: 'registered-instance' } as unknown as MediabunnyModule;
    setMediabunnyModule(fake);
    await expect(loadMediabunny()).resolves.toBe(fake);
  });

  it('clears the override when set back to undefined', () => {
    const fake = {} as unknown as MediabunnyModule;
    setMediabunnyModule(fake);
    setMediabunnyModule(undefined);
    // With no override, loadMediabunny falls back to a real import — just assert
    // the global was cleared (importing real mediabunny in a unit test is avoided).
    expect((globalThis as { __mediabunny__?: unknown }).__mediabunny__).toBeUndefined();
  });
});
