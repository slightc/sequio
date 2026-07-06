/**
 * A real-filesystem {@link FileSystem} adapter for Node hosts.
 *
 * Kept out of the package barrel (`src/index.ts`) so the browser build never
 * pulls in `node:fs`. A Node caller (a CLI, a server render worker, a test)
 * imports it explicitly:
 *
 * ```ts
 * import { NodeFileSystem } from '@video-editor-canvas/runtime/node-fs';
 * import { Runtime } from '@video-editor-canvas/runtime';
 * const composer = await new Runtime({ files: new NodeFileSystem('/abs/project') }).run();
 * ```
 *
 * Files are read from disk lazily and cached; the virtual root `/` maps to
 * `rootDir`, so user code's relative imports resolve against the project on disk.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { FileSystem } from './vfs';

/** Map a virtual absolute path (`/a/b.ts`) to an on-disk path under `rootDir`. */
function toDiskPath(rootDir: string, virtualPath: string): string {
  const rel = virtualPath.replace(/^\/+/, '');
  return resolve(rootDir, rel);
}

/** Map an on-disk path back to a virtual absolute path (POSIX separators). */
function toVirtualPath(rootDir: string, diskPath: string): string {
  return '/' + relative(rootDir, diskPath).split(sep).join('/');
}

export class NodeFileSystem implements FileSystem {
  constructor(private readonly rootDir: string) {}

  readFile(path: string): string | null {
    const disk = toDiskPath(this.rootDir, path);
    try {
      if (!existsSync(disk) || !statSync(disk).isFile()) return null;
      return readFileSync(disk, 'utf8');
    } catch {
      return null;
    }
  }

  exists(path: string): boolean {
    const disk = toDiskPath(this.rootDir, path);
    try {
      return existsSync(disk) && statSync(disk).isFile();
    } catch {
      return false;
    }
  }

  listFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile()) out.push(toVirtualPath(this.rootDir, full));
      }
    };
    try {
      walk(this.rootDir);
    } catch {
      /* rootDir missing → empty listing */
    }
    return out.sort();
  }
}
