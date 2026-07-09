/**
 * `@sequio/server/route-b` — the pure-Node (PixiJS WebGPU) server-render route,
 * as a programmatic API. **Node-only**: importing this pulls in the Node
 * environment adapter (`env.ts` → pixi.js, jsdom, @napi-rs/canvas, webgpu,
 * @mediabunny/server), so it is deliberately kept out of the browser-safe main
 * barrel (`@sequio/server`) and reached via this subpath, mirroring how the
 * runtime keeps `@sequio/runtime/node-fs` separate.
 *
 * Needs a WebGPU-capable host: a real GPU or a software Vulkan driver (Mesa
 * lavapipe). See `docs/server-side-rendering.md`.
 */
export { setupNodeEnvironment, createNodeWebGPURenderer, getMediabunny } from './env';
export { renderTimelineToFile, renderFrameRGBA, type NodeExportOptions } from './export-node';
export { loadFontsNode, bridgeFontManagerToNode } from './fonts-node';
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
