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
});
