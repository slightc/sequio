/**
 * **Local media assets** for a composition.
 *
 * A composition run by the runtime describes its video imperatively and can pull
 * in local media — an `image` / `video` sitting next to it — through a single
 * host-provided hook. The composition asks for a file by a project-relative path
 * and gets back a `Blob`, which both `ImageSource` and `VideoSource` accept:
 *
 * ```ts
 * import { defineComposition, loadAsset } from '@sequio/runtime';
 * export default defineComposition(async () => {
 *   const video = new VideoSource({ src: await loadAsset('./clip.mp4') });
 *   const image = new ImageSource({ src: await loadAsset('./assets/photo.jpg') });
 *   // …
 * });
 * ```
 *
 * The runtime owns the *contract* (the `loadAsset` symbol on `@sequio/runtime`
 * and the path rules here); the **host** supplies the actual bytes via
 * {@link RuntimeOptions.loadAsset}, so the same `loadAsset('./clip.mp4')` resolves
 * identically wherever the composition runs (contract #3): the browser preview
 * fetches it from the dev server, the Node render reads it off disk, an editor
 * serves it from an upload store. Assets stay **out of the source bundle** (which
 * is text-only), so a large local `.mp4` never bloats what's transferred or
 * committed.
 */

/**
 * A host's binary-asset resolver: map a project-relative media path (already
 * cleaned by {@link resolveAssetPath}) to its bytes as a `Blob`.
 */
export type AssetLoader = (path: string) => Promise<Blob>;

/**
 * Canonicalise a composition's asset reference to a clean project-relative path.
 * Accepts `./clip.mp4`, `clip.mp4` or `/clip.mp4` and returns `clip.mp4`;
 * `./assets/x.png` → `assets/x.png`. Paths resolve against the **project root**
 * (the bundle's virtual `/`). Rejects anything that escapes it (`..`), so a host
 * loader can never be steered outside the project directory.
 */
export function resolveAssetPath(path: string): string {
  const segments: string[] = [];
  for (const raw of path.replace(/\\/g, '/').split('/')) {
    if (raw === '' || raw === '.') continue;
    if (raw === '..') throw new Error(`asset path escapes the project root: ${path}`);
    segments.push(raw);
  }
  if (segments.length === 0) throw new Error(`empty asset path: ${path}`);
  return segments.join('/');
}

/**
 * The default `loadAsset` when a host wires no {@link AssetLoader}: fail loudly
 * (per the repo's "throw, don't render silent black" convention) so a composition
 * that references a local file isn't silently handed nothing.
 */
export const NO_ASSET_LOADER: AssetLoader = (path) => {
  throw new Error(
    `loadAsset('${path}'): this runtime has no asset loader. The host must pass ` +
      `RuntimeOptions.loadAsset (the sequio CLI does this for both preview and render). ` +
      `To avoid a local file entirely, reference a network URL instead.`,
  );
};
