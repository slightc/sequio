import { describe, expect, it } from 'vitest';
import { Runtime, runComposition } from '../src/runtime';
import type { FileSystem } from '../src/vfs';

describe('Runtime.runToSpec', () => {
  it('compiles + runs a multi-file program into a TimelineSpec', async () => {
    const files = {
      '/index.ts': `
        import { defineComposition } from '@video-editor-canvas/runtime';
        import { title } from './title';
        import { W, H } from './config';
        export default defineComposition({
          width: W,
          height: H,
          fps: 30,
          range: [0, 2],
          tracks: [{ clips: [title] }],
        });
      `,
      '/config.ts': `export const W = 320; export const H = 180;`,
      '/title.ts': `
        import type { TextClipSpec } from '@video-editor-canvas/runtime';
        export const title: TextClipSpec = {
          type: 'text', text: 'Hello from code', start: 0, end: 2,
          transform: { anchor: [0.5, 0.5], position: [160, 90] },
        };
      `,
    };
    const spec = await new Runtime({ files }).runToSpec();
    expect(spec.width).toBe(320);
    expect(spec.height).toBe(180);
    expect(spec.tracks?.[0]?.clips[0]).toMatchObject({ type: 'text', text: 'Hello from code' });
  });

  it('accepts a bare TimelineSpec default export (no defineComposition)', async () => {
    const spec = await new Runtime({
      files: { '/index.ts': `export default { width: 100, height: 50, fps: 24, tracks: [] };` },
    }).runToSpec();
    expect(spec).toMatchObject({ width: 100, height: 50, fps: 24 });
  });

  it('accepts a factory function default export (sync or async)', async () => {
    const spec = await new Runtime({
      files: {
        '/index.ts': `
          import { defineComposition } from '@video-editor-canvas/runtime';
          export default async () => defineComposition({ width: 64, height: 64, fps: 30, tracks: [] });
        `,
      },
    }).runToSpec();
    expect(spec.width).toBe(64);
  });

  it('resolves the default entry when none is given', async () => {
    const spec = await new Runtime({
      files: { '/index.ts': `export default { width: 10, height: 10, fps: 1 };` },
    }).runToSpec();
    expect(spec.width).toBe(10);
  });

  it('throws a helpful error when there is no entry', async () => {
    await expect(new Runtime({ files: { '/lib.ts': 'export const a = 1;' } }).runToSpec()).rejects.toThrow(
      /No entry module/,
    );
  });

  it('throws when the entry exports something that is not a composition/spec', async () => {
    await expect(
      new Runtime({ files: { '/index.ts': `export default 42;` } }).runToSpec(),
    ).rejects.toThrow(/must export/);
  });

  it('exposes host-provided externals to user code', async () => {
    const spec = await new Runtime({
      files: {
        '/index.ts': `
          import { defineComposition } from '@video-editor-canvas/runtime';
          import { BRAND } from 'host-config';
          export default defineComposition({ width: BRAND.w, height: 20, fps: 30, tracks: [] });
        `,
      },
      externals: { 'host-config': { BRAND: { w: 200 } } },
    }).runToSpec();
    expect(spec.width).toBe(200);
  });

  it('reads from an injected (duck-typed) real filesystem', async () => {
    const backing: Record<string, string> = {
      '/index.ts': `export default { width: 7, height: 7, fps: 7 };`,
    };
    const injected: FileSystem = {
      readFile: (p) => backing[p] ?? null,
      exists: (p) => p in backing,
      listFiles: () => Object.keys(backing),
    };
    const spec = await new Runtime({ files: injected }).runToSpec();
    expect(spec.width).toBe(7);
  });
});

describe('runComposition helper', () => {
  it('builds a Composer whose toSpec() round-trips the timeline', async () => {
    const composer = await runComposition({
      '/index.ts': `
        import { defineComposition } from '@video-editor-canvas/runtime';
        export default defineComposition({ width: 128, height: 72, fps: 30, tracks: [] });
      `,
    });
    expect(composer.toSpec()).toMatchObject({ width: 128, height: 72, fps: 30 });
    expect(JSON.stringify(composer)).toContain('"width":128');
  });
});
