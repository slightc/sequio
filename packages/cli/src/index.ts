/**
 * `@sequio/cli` — the `sequio` command line.
 *
 * Five commands, all thin front-ends over infrastructure the other packages
 * already own:
 *  - `check <file>` → compile + link + build the object graph with a null
 *    renderer and statically validate it — no GPU, no network (the fast
 *    pre-flight in the `check → frame → render` loop).
 *  - `render <file>` → snapshot the composition into a {@link RuntimeBundle} and
 *    hand it to the server's Route B (pure Node, WebGPU) to encode a video.
 *  - `frame <file>` → the same Route B path, but seek to one time and write a
 *    single PNG — a fast visual check without a full render.
 *  - `audio <file>` → the same Route B path, but export only the audio mix to an
 *    audio-only file (m4a / mp3 / wav / ogg / webm).
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
  AUDIO_FORMATS,
  type AudioFormat,
  type CliCommand,
  type RenderCommand,
  type FrameCommand,
  type AudioCommand,
  type CheckCommand,
  type PreviewCommand,
  type MetaCommand,
} from './args';
export { readBundle } from './bundle';
export {
  runCheck,
  checkBundle,
  nullRenderer,
  type Diagnostic,
  type CheckOptions,
  type CheckBundleOptions,
} from './check';
export { runRender, type RenderOptions } from './render';
export { runFrame, type FrameOptions } from './frame';
export { runAudio, type AudioOptions } from './audio';
export {
  startPreviewServer,
  type PreviewServer,
  type PreviewServerOptions,
} from './preview';
export { version } from './version';
