/**
 * The **SSR render contract** — the typed service a headless render host (Route A
 * headless Chrome today, an iframe/Worker sandbox tomorrow) exposes over the
 * {@link Endpoint} RPC, and that a client (the Puppeteer worker, or a parent page)
 * wraps. It replaces the ad-hoc `window.__SSR__` global with a checked interface
 * both sides implement.
 *
 * Both inputs the two SSR routes accept are here: a code {@link RuntimeBundle}
 * (recommended) and a declarative {@link TimelineSpec}. The encoded video comes
 * back as base64 inside {@link RenderResult} — the one representation that survives
 * both structured-clone (iframe/Worker) and JSON (Puppeteer) transports. Streaming
 * large outputs (transferable `ArrayBuffer` / a fetch channel) is a follow-up.
 */
import type { RuntimeBundle } from '@sequio/runtime';
import type { Endpoint } from './rpc';
import type { TimelineSpec } from './timeline';

export interface RenderResult {
  ok: boolean;
  container?: 'mp4' | 'webm';
  videoCodec?: string;
  mime?: string;
  size?: number;
  /** base64 of the encoded container. */
  base64?: string;
  error?: string;
}

/**
 * The render methods a headless host serves via {@link expose} and a client
 * reaches via {@link wrap}<`RenderService`>. `onProgress` is a normal callback —
 * the RPC proxies it across the transport, so it fires locally as the remote
 * renders.
 */
export interface RenderService {
  /** Render a declarative {@link TimelineSpec}. */
  render(spec: TimelineSpec, onProgress?: (progress: number) => void): Promise<RenderResult>;
  /** Render a code {@link RuntimeBundle} (re-run the composition's own source). */
  renderBundle(bundle: RuntimeBundle, onProgress?: (progress: number) => void): Promise<RenderResult>;
  /** The built-in self-contained sample spec (no external assets). */
  sample(): Promise<TimelineSpec>;
}

/** Convenience alias for `wrap<RenderService>(endpoint)`'s parameter site. */
export type RenderEndpoint = Endpoint;
