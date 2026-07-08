import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readBundle } from '../src/bundle';

describe('readBundle', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sequio-cli-test-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('snapshots the entry and its sibling files with virtual paths', () => {
    writeFileSync(join(dir, 'index.ts'), "import './scene';\nexport default 1;\n");
    writeFileSync(join(dir, 'scene.ts'), 'export const W = 640;\n');

    const bundle = readBundle(join(dir, 'index.ts'));
    expect(bundle.entry).toBe('/index.ts');
    expect(Object.keys(bundle.files).sort()).toEqual(['/index.ts', '/scene.ts']);
    expect(bundle.files['/scene.ts']).toContain('W = 640');
  });

  it('includes files in subdirectories (nested relative imports)', () => {
    mkdirSync(join(dir, 'lib'));
    writeFileSync(join(dir, 'main.ts'), "export * from './lib/util';\n");
    writeFileSync(join(dir, 'lib', 'util.ts'), 'export const x = 1;\n');

    const bundle = readBundle(join(dir, 'main.ts'));
    expect(bundle.entry).toBe('/main.ts');
    expect(bundle.files['/lib/util.ts']).toContain('x = 1');
  });

  it('throws a clear error when the entry file is missing', () => {
    expect(() => readBundle(join(dir, 'nope.ts'))).toThrowError(/not found/i);
  });

  it('excludes binary media assets so a local image/video never bloats the bundle', () => {
    writeFileSync(join(dir, 'index.ts'), 'export default 1;\n');
    // A local video/image referenced via loadAsset('./clip.mp4') at runtime — must
    // NOT be read as UTF-8 into the bundle (served via /__asset/ + disk instead).
    writeFileSync(join(dir, 'clip.mp4'), Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]));
    writeFileSync(join(dir, 'photo.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));

    const bundle = readBundle(join(dir, 'index.ts'));
    expect(Object.keys(bundle.files)).toEqual(['/index.ts']);
    expect(bundle.files['/clip.mp4']).toBeUndefined();
    expect(bundle.files['/photo.jpg']).toBeUndefined();
  });
});
