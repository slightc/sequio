import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NodeFileSystem } from '../src/node-fs';
import { Runtime } from '../src/runtime';

// Proves the "inject a real filesystem" path: a Node host points the runtime at a
// real project on disk, and relative imports resolve against it.
describe('NodeFileSystem (real filesystem injection)', () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'vec-runtime-'));
    mkdirSync(join(root, 'lib'), { recursive: true });
    writeFileSync(join(root, 'lib', 'scene.ts'), `export const W = 512; export const H = 288;`);
    writeFileSync(
      join(root, 'index.ts'),
      `import { defineComposition } from '@video-editor-canvas/runtime';\n` +
        `import { W, H } from './lib/scene';\n` +
        `export default defineComposition({ width: W, height: H, fps: 24, tracks: [] });`,
    );
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reads files and reports existence from disk', () => {
    const fs = new NodeFileSystem(root);
    expect(fs.exists('/index.ts')).toBe(true);
    expect(fs.exists('/lib/scene.ts')).toBe(true);
    expect(fs.exists('/missing.ts')).toBe(false);
    expect(fs.readFile('/lib/scene.ts')).toContain('W = 512');
    expect(fs.listFiles()).toEqual(['/index.ts', '/lib/scene.ts']);
  });

  it('runs a program straight from the injected real filesystem', async () => {
    const spec = await new Runtime({ files: new NodeFileSystem(root) }).runToSpec();
    expect(spec).toMatchObject({ width: 512, height: 288, fps: 24 });
  });
});
