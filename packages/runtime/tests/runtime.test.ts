import { describe, expect, it } from 'vitest';
import * as engine from '@video-editor-canvas/engine';
import { isComposition } from '../src/composition';
import { engineForEnv, Runtime, runComposition } from '../src/runtime';
import type { FileSystem } from '../src/vfs';

// A DOM-free fake compositor the sandboxed builders return, so these unit tests
// exercise the compile → link → build plumbing without a GPU. (Real Compositor
// preview/export is covered by the e2e `pnpm verify:runtime`.)
const FAKE_COMPOSITOR = `{ getTracks: () => [{ clips: [{ end: 4 }] }], dispose() {} }`;

describe('Runtime.runToComposition', () => {
  it('compiles + runs a multi-file imperative program into a Composition', () => {
    const files = {
      '/index.ts': `
        import { defineComposition } from '@video-editor-canvas/runtime';
        import { scene } from './scene';
        export default defineComposition((env) => {
          const compositor = scene(env);
          return { compositor, duration: 4 };
        });
      `,
      '/scene.ts': `export const scene = (_env) => (${FAKE_COMPOSITOR});`,
    };
    const composition = new Runtime({ files }).runToComposition();
    expect(isComposition(composition)).toBe(true);
  });

  it('injects the real engine namespace so user code can `new` engine classes', async () => {
    // Timebase is a pure (DOM-free) engine class — proves the real module is wired.
    const composer = await runComposition({
      '/index.ts': `
        import { defineComposition } from '@video-editor-canvas/runtime';
        import { Timebase } from '@video-editor-canvas/engine';
        export default defineComposition(() => {
          const tb = new Timebase(30);
          return { compositor: ${FAKE_COMPOSITOR}, duration: tb.toSeconds(120) };
        });
      `,
    });
    const built = await composer.build();
    expect(built.duration).toBe(4); // 120 frames / 30fps
  });

  it('accepts a bare builder function default export', async () => {
    const composer = await runComposition({
      '/index.ts': `export default () => ({ compositor: ${FAKE_COMPOSITOR}, duration: 3 });`,
    });
    const built = await composer.build();
    expect(built.duration).toBe(3);
  });

  it('derives duration from clip ends when the builder omits it', async () => {
    const composer = await runComposition({
      '/index.ts': `
        import { defineComposition } from '@video-editor-canvas/runtime';
        export default defineComposition(() => ({
          compositor: { getTracks: () => [{ clips: [{ end: 1 }, { end: 5 }] }], dispose() {} },
        }));
      `,
    });
    const built = await composer.build();
    expect(built.duration).toBe(5);
  });

  it('resolves the default entry when none is given', () => {
    const composition = new Runtime({
      files: { '/index.ts': `export default () => ({ compositor: ${FAKE_COMPOSITOR} });` },
    }).runToComposition();
    expect(isComposition(composition)).toBe(true);
  });

  it('throws a helpful error when there is no entry', () => {
    expect(() => new Runtime({ files: { '/lib.ts': 'export const a = 1;' } }).runToComposition()).toThrow(
      /No entry module/,
    );
  });

  it('throws when the entry exports something that is not a composition/builder', () => {
    expect(() => new Runtime({ files: { '/index.ts': `export default 42;` } }).runToComposition()).toThrow(
      /must export/,
    );
  });

  it('exposes host-provided externals to user code', () => {
    const composition = new Runtime({
      files: {
        '/index.ts': `
          import { defineComposition } from '@video-editor-canvas/runtime';
          import { BRAND } from 'host-config';
          export default defineComposition(() => ({ compositor: BRAND.compositor, duration: 1 }));
        `,
      },
      externals: { 'host-config': { BRAND: { compositor: {} } } },
    }).runToComposition();
    expect(isComposition(composition)).toBe(true);
  });

  it('reads from an injected (duck-typed) real filesystem', () => {
    const backing: Record<string, string> = {
      '/index.ts': `export default () => ({ compositor: ${FAKE_COMPOSITOR}, duration: 7 });`,
    };
    const injected: FileSystem = {
      readFile: (p) => backing[p] ?? null,
      exists: (p) => p in backing,
      listFiles: () => Object.keys(backing),
    };
    expect(isComposition(new Runtime({ files: injected }).runToComposition())).toBe(true);
  });
});

describe('engineForEnv (implicit compositorOptions injection)', () => {
  it('returns the real engine namespace unchanged when there are no overrides', () => {
    expect(engineForEnv({})).toBe(engine);
  });

  it('replaces Compositor with a subclass, preserving other exports', () => {
    const ns = engineForEnv({ resolution: 2 }) as typeof engine;
    expect(ns.Compositor).not.toBe(engine.Compositor);
    // The replacement extends the real Compositor (so `instanceof` still holds).
    expect(Object.getPrototypeOf(ns.Compositor)).toBe(engine.Compositor);
    // Non-Compositor exports pass through untouched.
    expect(ns.Timebase).toBe(engine.Timebase);
    expect(ns.VisualTrack).toBe(engine.VisualTrack);
  });
});

describe('Composer.toBundle', () => {
  it('snapshots the source files + entry for server render', async () => {
    const files = {
      '/index.ts': `export default () => ({ compositor: ${FAKE_COMPOSITOR}, duration: 2 });`,
      '/helper.ts': `export const x = 1;`,
    };
    const composer = await runComposition(files, { entry: '/index.ts' });
    const bundle = composer.toBundle();
    expect(bundle.entry).toBe('/index.ts');
    expect(Object.keys(bundle.files).sort()).toEqual(['/helper.ts', '/index.ts']);
    expect(bundle.files['/helper.ts']).toContain('export const x = 1;');
    // JSON.stringify(composer) yields the bundle.
    expect(JSON.parse(JSON.stringify(composer)).entry).toBe('/index.ts');
  });
});
