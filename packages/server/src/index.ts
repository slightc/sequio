/**
 * `@video-editor-canvas/server` — server-side rendering.
 *
 * Public surface: the serializable {@link TimelineSpec} protocol and the
 * {@link buildTimeline} builder that rebuilds the SDK object graph from it. Both
 * SSR routes (Route A headless Chrome in `route-a/`, Route B pure Node in
 * `route-b/`) and the editor's "Server Render" button consume this protocol.
 *
 * The Node-only render workers (`route-b/*`) are intentionally NOT re-exported
 * here so importing this barrel stays browser-safe (no jsdom / napi-canvas).
 */
export * from './timeline';
export { sampleTimeline } from './sample-timeline';
