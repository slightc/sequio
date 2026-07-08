/**
 * The Node {@link AssetLoader} for `sequio render`: read a composition's
 * project-relative media file off disk and hand it to the sandbox as a `Blob`, so
 * `await loadAsset('./clip.mp4')` resolves in a pure-Node render exactly as it
 * does in the browser preview (contract #3). The runtime normalizes the path
 * before calling this, so it always arrives as a clean root-relative path.
 *
 * Node-only (`node:fs`); kept out of the browser preview bundle.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AssetLoader } from '@sequio/runtime';

/**
 * Build an {@link AssetLoader} rooted at `projectRoot` (the entry file's
 * directory). Reads `projectRoot/<path>` and wraps the bytes in a `Blob` (which
 * both `ImageSource` and `VideoSource` accept). Refuses paths that escape the
 * root and reports a missing file clearly.
 */
export function nodeAssetLoader(projectRoot: string): AssetLoader {
  const root = resolve(projectRoot);
  return async (path: string): Promise<Blob> => {
    const full = resolve(root, path);
    if (full !== root && !full.startsWith(root + '/')) {
      throw new Error(`asset path escapes the project root: ${path}`);
    }
    let bytes: Buffer;
    try {
      bytes = readFileSync(full);
    } catch {
      throw new Error(
        `local asset not found: ${path} (looked in ${root}). ` +
          `Drop the file there, or reference a network URL instead.`,
      );
    }
    // Copy into a standalone Uint8Array: a Buffer views a shared pool slice, and
    // a Blob over it would otherwise capture the whole pool.
    return new Blob([new Uint8Array(bytes)]);
  };
}
