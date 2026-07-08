/**
 * The browser {@link AssetLoader} for `sequio preview`: fetch a composition's
 * project-relative media file from the dev server's `/__asset/…` static route
 * (see `src/preview.ts`) and return it as a `Blob`, so `await loadAsset('./clip.mp4')`
 * resolves in the in-browser preview exactly as it does in the Node render
 * (contract #3). The runtime normalizes the path before calling this.
 */
import type { AssetLoader } from '@sequio/runtime';

/** The preview's asset loader: the dev server serves project files under `/__asset/`. */
export function browserAssetLoader(): AssetLoader {
  return async (path: string): Promise<Blob> => {
    const res = await fetch(`/__asset/${path}`, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(
        `local asset not found: ${path} (HTTP ${res.status}). ` +
          `Drop the file into the composition's folder, or reference a network URL.`,
      );
    }
    return res.blob();
  };
}
