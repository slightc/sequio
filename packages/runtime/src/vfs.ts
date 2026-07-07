/**
 * A minimal **virtual filesystem** the module runtime reads source files from.
 *
 * The runtime never touches `node:fs` directly — it resolves and reads modules
 * through this interface. That keeps the core browser-safe (the studio "code
 * mode" runs entirely in the tab against an {@link InMemoryFileSystem}) while
 * letting a host inject a **real** filesystem instead: any object satisfying
 * {@link FileSystem} works, so a Node caller can wrap `node:fs` (see
 * `src/node-fs.ts`, kept out of the browser barrel).
 *
 * Paths are POSIX-style, absolute from a virtual root `/`. The runtime
 * normalizes relative imports to absolute paths before calling {@link readFile}.
 */
export interface FileSystem {
  /** Return the file's text, or `null` if it doesn't exist. */
  readFile(path: string): string | null;
  /** Whether a regular file exists at `path`. */
  exists(path: string): boolean;
  /** Every file path this filesystem can serve (used for diagnostics). */
  listFiles(): string[];
}

/** Collapse `.`/`..` segments and force a single leading `/`. */
export function normalizePath(path: string): string {
  const isAbsolute = path.startsWith('/');
  const out: string[] = [];
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else if (!isAbsolute) out.push('..');
    } else {
      out.push(seg);
    }
  }
  return (isAbsolute ? '/' : '') + out.join('/');
}

/** Directory portion of a normalized path (`/a/b/c.ts` → `/a/b`). */
export function dirname(path: string): string {
  const norm = normalizePath(path);
  const i = norm.lastIndexOf('/');
  if (i <= 0) return '/';
  return norm.slice(0, i);
}

/** Join a base directory with a (possibly relative) specifier, normalized. */
export function joinPath(base: string, specifier: string): string {
  if (specifier.startsWith('/')) return normalizePath(specifier);
  return normalizePath(`${base}/${specifier}`);
}

/**
 * An in-memory {@link FileSystem} backed by a plain path→content map. This is
 * the default for the browser (the code-mode editor keeps its files here) and
 * makes the module runtime unit-testable with no disk.
 */
export class InMemoryFileSystem implements FileSystem {
  private readonly files = new Map<string, string>();

  constructor(files: Record<string, string> = {}) {
    for (const [path, content] of Object.entries(files)) this.writeFile(path, content);
  }

  /** Add/replace a file. Keys are normalized to absolute paths. */
  writeFile(path: string, content: string): void {
    this.files.set(normalizePath(path.startsWith('/') ? path : `/${path}`), content);
  }

  /** Remove a file; returns whether it existed. */
  deleteFile(path: string): boolean {
    return this.files.delete(normalizePath(path.startsWith('/') ? path : `/${path}`));
  }

  readFile(path: string): string | null {
    const v = this.files.get(normalizePath(path));
    return v === undefined ? null : v;
  }

  exists(path: string): boolean {
    return this.files.has(normalizePath(path));
  }

  listFiles(): string[] {
    return [...this.files.keys()].sort();
  }
}
