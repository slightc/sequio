/**
 * CLI-side helpers for a composition's **local media assets** (the runtime owns
 * the `loadAsset` contract — see `@sequio/runtime`'s `assets.ts`). These two
 * concerns are the CLI's: which project files are *binary assets* (so
 * {@link readBundle} keeps them out of the text bundle) and their MIME type (so
 * the preview dev server can serve them over `/__asset/…`).
 */

/** Binary media/font extensions served via the asset bridge, never as source. */
const BINARY_ASSET_EXTENSIONS = new Set([
  // images
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico',
  // video
  'mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v',
  // audio
  'mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'flac', 'opus',
  // fonts
  'ttf', 'otf', 'woff', 'woff2',
]);

function extOf(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot < 0 ? '' : path.slice(dot + 1).toLowerCase();
}

/**
 * Whether a project file is a binary media/font asset rather than source code.
 * {@link readBundle} skips these so a (potentially large) local `.mp4` is never
 * read as UTF-8 into the JSON bundle — the browser fetches it via `/__asset/…`
 * and Node reads it off disk (see `assets-node.ts`) instead.
 */
export function isBinaryAssetPath(path: string): boolean {
  return BINARY_ASSET_EXTENSIONS.has(extOf(path));
}

/** MIME type for a media path, for the preview server's `/__asset/` responses. */
export function mimeForAsset(path: string): string {
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    mkv: 'video/x-matroska',
    avi: 'video/x-msvideo',
    m4v: 'video/x-m4v',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
    flac: 'audio/flac',
    opus: 'audio/opus',
    ttf: 'font/ttf',
    otf: 'font/otf',
    woff: 'font/woff',
    woff2: 'font/woff2',
  };
  return map[extOf(path)] ?? 'application/octet-stream';
}
