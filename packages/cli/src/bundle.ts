/**
 * Turn an on-disk composition **entry file** into a portable
 * {@link RuntimeBundle} (the `{ files, entry }` shape the runtime + the SSR
 * routes consume). The entry's directory is the project root: every file under
 * it is snapshotted, so the entry's relative imports (`./scene`, `./title`)
 * resolve exactly as they do in the browser Code Mode.
 *
 * This module reads the filesystem only — it does **not** run the composition
 * (no `@sequio/engine`, no DOM), so it stays cheap and unit-testable. `render.ts`
 * hands the bundle to the headless render worker; `preview.ts` serves it.
 */
import { basename, dirname, resolve } from 'node:path';
import type { RuntimeBundle } from '@sequio/runtime';
import { NodeFileSystem } from '@sequio/runtime/node-fs';
import { isBinaryAssetPath } from './assets';

/**
 * Snapshot the project around `entryFile` into a {@link RuntimeBundle}.
 *
 * @param entryFile Path (absolute or cwd-relative) to the entry module.
 * @throws if the file does not exist under its own directory.
 */
export function readBundle(entryFile: string): RuntimeBundle {
  const abs = resolve(entryFile);
  const projectDir = dirname(abs);
  const entry = '/' + basename(abs);

  const fs = new NodeFileSystem(projectDir);
  const files: Record<string, string> = {};
  for (const path of fs.listFiles()) {
    // Binary media/font files (a local image/video referenced via
    // `loadAsset('./clip.mp4')`) are NOT source — reading them as UTF-8 into the
    // JSON bundle would bloat it (and mangle the bytes). They reach the browser
    // via the preview server's /__asset/ route and Node via a direct disk read.
    if (isBinaryAssetPath(path)) continue;
    const content = fs.readFile(path);
    if (content !== null) files[path] = content;
  }

  if (files[entry] === undefined) {
    throw new Error(`Entry file not found: ${entryFile}`);
  }
  return { files, entry };
}
