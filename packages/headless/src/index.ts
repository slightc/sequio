/**
 * `@sequio/headless` — Route A server-side rendering (headless Chrome) **and the
 * serialization layer it rides on**.
 *
 * This barrel is the browser-safe protocol surface (imports only `@sequio/engine`
 * + `@sequio/runtime`), consumed by the SSR page (`ssr-render.ts`), the Node
 * worker (`ssr-worker.ts`) and any host that serializes a timeline for SSR (e.g.
 * the studio's "Server Render"):
 *  - the serializable {@link TimelineSpec} protocol + {@link buildTimeline} that
 *    rebuilds the SDK object graph from it (and {@link sampleTimeline});
 *  - the transport-agnostic RPC ({@link expose} / {@link wrap} / {@link windowEndpoint})
 *    that carries the {@link RenderService} contract across a Puppeteer bridge or
 *    an iframe/Worker `MessagePort`.
 *
 * The pure-Node render **environment** (`serverEnv`) lives in `@sequio/server`;
 * the code-bundle render helpers live in `@sequio/cli`. See
 * `docs/server-side-rendering.md` and `docs/environments-and-rpc.md`.
 */
export * from './timeline';
export { sampleTimeline } from './sample-timeline';
export { expose, wrap, windowEndpoint, type Endpoint, type Remote } from './rpc';
export { type RenderService, type RenderResult, type RenderEndpoint } from './render-service';
