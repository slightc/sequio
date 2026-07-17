import { describe, expect, it, vi } from 'vitest';
import { runComposition, Runtime } from '../src/runtime';
import type { RuntimeEnv } from '../src/env';

// A DOM-free fake compositor the builders return, so these tests exercise the
// env → build plumbing without a GPU (mirrors runtime.test.ts).
const FAKE_COMPOSITOR = `{ getTracks: () => [{ clips: [{ end: 2 }] }], dispose() {} }`;

describe('RuntimeEnv + setEnv', () => {
  it("folds the env's compositorOptions into the builder's env (resolution reaches user code)", async () => {
    const env: RuntimeEnv = {
      name: 'test',
      target: 'server',
      resolveCompositorOptions: () => ({ resolution: 3 }),
    };
    const composer = await runComposition(
      {
        // The builder reads env.compositorOptions.resolution and reports it as duration,
        // proving the env's options were folded into the build environment.
        '/index.ts': `
          export default (env) => ({
            compositor: ${FAKE_COMPOSITOR},
            duration: env.compositorOptions.resolution,
          });
        `,
      },
      { env },
    );
    const built = await composer.build();
    expect(built.duration).toBe(3);
  });

  it('exposes env.target to user code', async () => {
    const env: RuntimeEnv = { target: 'server' };
    const composer = await runComposition(
      { '/index.ts': `export default (env) => ({ compositor: ${FAKE_COMPOSITOR}, duration: env.target === 'server' ? 9 : 0 });` },
      { env },
    );
    expect((await composer.build()).duration).toBe(9);
  });

  it('runs setup() exactly once per Composer, across multiple builds', async () => {
    const setup = vi.fn();
    const env: RuntimeEnv = { setup };
    const composer = await runComposition(
      { '/index.ts': `export default () => ({ compositor: ${FAKE_COMPOSITOR} });` },
      { env },
    );
    await composer.build();
    await composer.build();
    await composer.build();
    expect(setup).toHaveBeenCalledTimes(1);
  });

  it('makes the env externals importable by user code', async () => {
    const env: RuntimeEnv = { externals: { 'my-lib': { answer: 42 } } };
    const composer = await runComposition(
      {
        '/index.ts': `
          import { answer } from 'my-lib';
          export default () => ({ compositor: ${FAKE_COMPOSITOR}, duration: answer });
        `,
      },
      { env },
    );
    expect((await composer.build()).duration).toBe(42);
  });

  it('lets an explicit RuntimeOptions.externals win over the env externals', async () => {
    const env: RuntimeEnv = { externals: { 'my-lib': { answer: 1 } } };
    const composer = await runComposition(
      { '/index.ts': `import { answer } from 'my-lib'; export default () => ({ compositor: ${FAKE_COMPOSITOR}, duration: answer });` },
      { env, externals: { 'my-lib': { answer: 100 } } },
    );
    expect((await composer.build()).duration).toBe(100);
  });

  it('lets explicit build() overrides win over the env compositorOptions', async () => {
    const env: RuntimeEnv = { resolveCompositorOptions: () => ({ resolution: 3 }) };
    const composer = await runComposition(
      { '/index.ts': `export default (env) => ({ compositor: ${FAKE_COMPOSITOR}, duration: env.compositorOptions.resolution });` },
      { env },
    );
    const built = await composer.build({ compositorOptions: { resolution: 5 } });
    expect(built.duration).toBe(5);
  });

  it('setEnv installs an env after construction and rebuilds the injected externals', async () => {
    const runtime = new Runtime({
      files: { '/index.ts': `import { answer } from 'my-lib'; export default () => ({ compositor: ${FAKE_COMPOSITOR}, duration: answer });` },
    });
    runtime.setEnv({ externals: { 'my-lib': { answer: 7 } } });
    expect(runtime.environment?.externals?.['my-lib']).toEqual({ answer: 7 });
    const composer = await runtime.run();
    expect((await composer.build()).duration).toBe(7);
  });

  it('behaves like the browser default when no env is installed', async () => {
    const composer = await runComposition({
      '/index.ts': `export default (env) => ({ compositor: ${FAKE_COMPOSITOR}, duration: env.target === 'export' ? 4 : 0 });`,
    });
    // No env → DEFAULT_ENV ({ target: 'export', compositorOptions: {} }).
    expect((await composer.build()).duration).toBe(4);
  });
});
