import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Compositor,
  getDefaultEngineEnv,
  loadMediabunny,
  type MediabunnyModule,
  type Renderer,
  setDefaultEngineEnv,
  Timebase,
} from '../src/index';

/** A GPU-free fake renderer (records nothing beyond being returned). */
const fakeRenderer = () => ({ render: () => {}, destroy: () => {} }) as unknown as Renderer;

// The engine env is process-wide; reset it after each test so cases don't leak.
afterEach(() => setDefaultEngineEnv(null));

describe('EngineEnv / setDefaultEngineEnv', () => {
  it('defaults to an empty env', () => {
    expect(getDefaultEngineEnv()).toEqual({});
  });

  it('supplies the default resolution to a Compositor (explicit option wins)', () => {
    setDefaultEngineEnv({ resolution: 3 });
    expect(new Compositor({ width: 10, height: 10, timebase: new Timebase(30) }).resolution).toBe(3);
    // An explicit resolution overrides the engine env default.
    expect(
      new Compositor({ width: 10, height: 10, timebase: new Timebase(30), resolution: 2 }).resolution,
    ).toBe(2);
  });

  it('supplies the default createRenderer to Compositor.init (explicit factory wins)', async () => {
    const envRenderer = fakeRenderer();
    setDefaultEngineEnv({ createRenderer: async () => envRenderer });

    const c = new Compositor({ width: 10, height: 10, timebase: new Timebase(30) });
    await c.init();
    expect(c.isInitialized).toBe(true);

    // An explicit per-compositor createRenderer wins over the engine env default.
    const own = fakeRenderer();
    let usedOwn = false;
    const c2 = new Compositor({
      width: 10,
      height: 10,
      timebase: new Timebase(30),
      createRenderer: async () => {
        usedOwn = true;
        return own;
      },
    });
    await c2.init();
    expect(usedOwn).toBe(true);
  });

  it('runs the env setup() once until the env is replaced', async () => {
    const setup = vi.fn();
    setDefaultEngineEnv({ setup, createRenderer: async () => fakeRenderer() });

    await new Compositor({ width: 10, height: 10, timebase: new Timebase(30) }).init();
    await new Compositor({ width: 10, height: 10, timebase: new Timebase(30) }).init();
    expect(setup).toHaveBeenCalledTimes(1); // cached across compositors

    // Replacing the env resets the cached setup.
    setDefaultEngineEnv({ setup, createRenderer: async () => fakeRenderer() });
    await new Compositor({ width: 10, height: 10, timebase: new Timebase(30) }).init();
    expect(setup).toHaveBeenCalledTimes(2);
  });

  it('pins the mediabunny instance the SDK uses', async () => {
    const fakeMod = { __fake: 1 } as unknown as MediabunnyModule;
    setDefaultEngineEnv({ mediabunny: fakeMod });
    expect(await loadMediabunny()).toBe(fakeMod);

    // Replacing the env re-pins (proves null between didn't leave the old one stuck).
    const other = { __fake: 2 } as unknown as MediabunnyModule;
    setDefaultEngineEnv(null);
    setDefaultEngineEnv({ mediabunny: other });
    expect(await loadMediabunny()).toBe(other);
  });
});
