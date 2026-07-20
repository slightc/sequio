/**
 * `@sequio/server` — the **server-side render environment** for sequio.
 *
 * The single job of this package is to provide `serverEnv`: the pure-Node
 * bootstrap that lets the engine's WebGPU render core run outside a browser
 * (PixiJS WebGPU / Dawn, `@napi-rs/canvas`, jsdom, `@mediabunny/server` WebCodecs,
 * `node-web-audio-api`). `serverEnv().setup()` registers the renderer + output
 * scale at the **engine layer** (`setDefaultEngineEnv`), so a plain
 * `new Compositor(...)` — however it's produced — renders in Node with full
 * filter/effect support (contract #3 — same core as the browser preview).
 *
 * This package deliberately owns **no protocol, no render orchestration, and no
 * dependency on `@sequio/runtime`** — it is purely the environment:
 *  - the serializable `TimelineSpec` protocol + the transport-agnostic RPC live in
 *    `@sequio/headless` (the headless-Chrome route and its serialization layer);
 *  - the code-bundle render helpers (`renderBundleToFile` / `…FrameToFile` /
 *    `exportBundleAudioToFile`) live in `@sequio/cli`, which sets up this env, then
 *    runs `@sequio/runtime` to get a `Compositor`.
 *
 * **Node-only.** Importing this pulls the Node environment adapter (`env.ts` →
 * pixi.js, jsdom, @napi-rs/canvas, webgpu, @mediabunny/server), so it only makes
 * sense on a server set up for server-side rendering. Needs a WebGPU-capable host:
 * a real GPU or a software Vulkan driver (Mesa lavapipe). See
 * `docs/server-side-rendering.md`.
 */
export { setupNodeEnvironment, createNodeWebGPURenderer, getMediabunny } from './env';
export { serverEnv, type ServerEnv, type ServerEnvOptions } from './server-env';
export { encodeRGBAToPng } from './image-node';
export {
  loadFontsNode,
  bridgeFontManagerToNode,
  parseGoogleFontUrls,
  type NodeFontSpec,
} from './fonts-node';
