/**
 * `@sequio/cli` — the `sequio` command line.
 *
 * Two commands, both thin front-ends over infrastructure the other packages
 * already own:
 *  - `render <file>` → snapshot the composition into a {@link RuntimeBundle} and
 *    hand it to the server's Route A headless-Chrome worker to encode a video.
 *  - `preview <file>` → boot a Vite dev server whose page runs the same
 *    `Runtime` → `Composer` → `preview()` path in-browser; `--watch` live-reloads.
 *
 * This barrel is the programmatic surface (used by tests and embedders); the
 * `sequio` binary is `bin/sequio.js`, which runs `src/cli.ts`.
 */
export {
  parseArgs,
  USAGE,
  DEFAULT_PREVIEW_PORT,
  type CliCommand,
  type RenderCommand,
  type PreviewCommand,
  type MetaCommand,
} from './args';
export { readBundle } from './bundle';
export { runRender, type RenderOptions } from './render';
export {
  startPreviewServer,
  type PreviewServer,
  type PreviewServerOptions,
} from './preview';
export { version } from './version';
