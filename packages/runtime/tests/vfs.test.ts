import { describe, expect, it } from 'vitest';
import { dirname, InMemoryFileSystem, joinPath, normalizePath } from '../src/vfs';

describe('normalizePath', () => {
  it('collapses . and .. segments', () => {
    expect(normalizePath('/a/b/../c')).toBe('/a/c');
    expect(normalizePath('/a/./b/./c')).toBe('/a/b/c');
    expect(normalizePath('/a/b/c/../../d')).toBe('/a/d');
  });

  it('keeps a single leading slash and strips trailing/duplicate slashes', () => {
    expect(normalizePath('//a//b//')).toBe('/a/b');
    expect(normalizePath('/')).toBe('/');
  });

  it('does not escape above the root', () => {
    expect(normalizePath('/../../a')).toBe('/a');
  });

  it('preserves relative paths without a leading slash', () => {
    expect(normalizePath('a/b/../c')).toBe('a/c');
  });
});

describe('dirname', () => {
  it('returns the directory portion', () => {
    expect(dirname('/a/b/c.ts')).toBe('/a/b');
    expect(dirname('/a/index.ts')).toBe('/a');
    expect(dirname('/index.ts')).toBe('/');
  });
});

describe('joinPath', () => {
  it('joins a relative specifier against a base dir', () => {
    expect(joinPath('/a/b', './c')).toBe('/a/b/c');
    expect(joinPath('/a/b', '../c')).toBe('/a/c');
    expect(joinPath('/a/b', '../../c')).toBe('/c');
  });

  it('treats an absolute specifier as root-relative', () => {
    expect(joinPath('/a/b', '/x/y')).toBe('/x/y');
  });
});

describe('InMemoryFileSystem', () => {
  it('normalizes keys and reads back content', () => {
    const fs = new InMemoryFileSystem({ 'index.ts': 'a', '/lib/util.ts': 'b' });
    expect(fs.readFile('/index.ts')).toBe('a');
    expect(fs.readFile('/lib/util.ts')).toBe('b');
    expect(fs.exists('/index.ts')).toBe(true);
    expect(fs.exists('/missing.ts')).toBe(false);
    expect(fs.readFile('/missing.ts')).toBeNull();
  });

  it('lists files sorted and supports write/delete', () => {
    const fs = new InMemoryFileSystem();
    fs.writeFile('/b.ts', '1');
    fs.writeFile('/a.ts', '2');
    expect(fs.listFiles()).toEqual(['/a.ts', '/b.ts']);
    expect(fs.deleteFile('/a.ts')).toBe(true);
    expect(fs.deleteFile('/a.ts')).toBe(false);
    expect(fs.listFiles()).toEqual(['/b.ts']);
  });
});
