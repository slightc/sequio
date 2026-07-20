/**
 * Route B — the pure-Node (PixiJS WebGPU) render helpers the CLI drives. Each
 * takes a composition's code {@link RuntimeBundle} (never a serializable spec),
 * runs it through the {@link Runtime} under `@sequio/server`'s `serverEnv`, and
 * writes a video / single frame / audio file — no browser.
 *
 * **Node-only**: importing this pulls the server env (pixi.js, jsdom,
 * @napi-rs/canvas, webgpu, @mediabunny/server), so the CLI commands `import()` it
 * lazily, only when actually rendering. Needs a WebGPU-capable host (a real GPU or
 * Mesa lavapipe). See `docs/cli.md` and `docs/server-side-rendering.md`.
 */
export { renderTimelineToFile, renderFrameRGBA, type NodeExportOptions } from './export-node';
export {
  renderBundleToFile,
  type RenderBundleNodeOptions,
  type RenderBundleNodeResult,
} from './render-bundle';
export {
  renderBundleFrameToFile,
  type RenderFrameNodeOptions,
  type RenderFrameNodeResult,
} from './frame-node';
export {
  exportBundleAudioToFile,
  type ExportBundleAudioNodeOptions,
  type ExportBundleAudioNodeResult,
} from './audio-node';
