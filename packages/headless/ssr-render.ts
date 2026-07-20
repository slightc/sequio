/**
 * Server-side render entry (Route A: headless Chrome). This page runs inside a
 * headless browser — which has WebGL, WebCodecs and Web Audio — and **exposes a
 * typed {@link RenderService} over the transport-agnostic RPC** (`@sequio/server`'s
 * {@link expose}). The Node worker (`ssr-worker.ts`) `wrap`s it and calls:
 *  - `render(spec)` — rebuild the SDK object graph from a {@link TimelineSpec},
 *    run the normal {@link Exporter}, return the encoded video as base64;
 *  - `renderBundle(bundle)` — the **code** path: a {@link RuntimeBundle} (an
 *    editor's "Code Mode" source) is re-run here by the {@link Runtime}, building
 *    the same graph on the server it built in the browser — no spec to serialize.
 * The render core is the same one the live preview uses (contract #3).
 *
 * The RPC rides a Puppeteer bridge here (see {@link puppeteerPageEndpoint}); the
 * same service works unchanged over an iframe/Worker `MessagePort`. On load it
 * also renders the built-in sample and publishes the result on
 * `window.__SSR_TEST__` so `pnpm verify:ssr` can assert the browser half works.
 */
import { Exporter, loadMediabunny } from '@sequio/engine';
import { Runtime, type RuntimeBundle } from '@sequio/runtime';
import {
  buildTimeline,
  type Endpoint,
  expose,
  type RenderResult,
  type RenderService,
  sampleTimeline,
  type TimelineSpec,
} from '@sequio/server';

/**
 * Pick a container + codec the browser can actually encode, preferring what the
 * spec asks for. Headless Chrome with SwiftShader often only has VP8/VP9, so we
 * fall back rather than fail — and report what was actually used.
 */
async function negotiateCodec(
  want: { container?: 'mp4' | 'webm'; videoCodec?: string },
): Promise<{ container: 'mp4' | 'webm'; videoCodec: string } | null> {
  const { canEncodeVideo } = await loadMediabunny();
  const candidates: Array<{ container: 'mp4' | 'webm'; videoCodec: string }> = [];
  if (want.container && want.videoCodec) candidates.push({ container: want.container, videoCodec: want.videoCodec });
  candidates.push(
    { container: 'mp4', videoCodec: 'avc' },
    { container: 'webm', videoCodec: 'vp9' },
    { container: 'webm', videoCodec: 'vp8' },
  );
  for (const c of candidates) {
    if (await canEncodeVideo(c.videoCodec as 'avc')) return c;
  }
  return null;
}

/** Base64-encode a byte buffer in chunks (avoids a huge apply() call stack). */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Render a timeline spec to an encoded video and return it as base64. */
export async function render(spec: TimelineSpec, onProgress?: (p: number) => void): Promise<RenderResult> {
  const built = await buildTimeline(spec);
  try {
    const codec = await negotiateCodec({
      container: built.exportOptions.container,
      videoCodec: built.exportOptions.videoCodec,
    });
    if (!codec) return { ok: false, error: 'no encodable video codec in this browser' };

    // Mount the canvas so a real GL surface is presented (some drivers need it).
    document.getElementById('stage')?.append(built.compositor.view);

    const exporter = new Exporter(built.compositor, built.audioEngine);
    const blob = await exporter.export(
      {
        fps: spec.fps,
        container: codec.container,
        videoCodec: codec.videoCodec,
        audioCodec: built.exportOptions.audioCodec,
        audio: built.exportOptions.audio ?? false,
        bitrate: built.exportOptions.bitrate,
        audioBitrate: built.exportOptions.audioBitrate,
        range: built.range,
      },
      onProgress,
    );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return {
      ok: blob.size > 0,
      container: codec.container,
      videoCodec: codec.videoCodec,
      mime: blob.type,
      size: blob.size,
      base64: toBase64(bytes),
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  } finally {
    built.dispose();
  }
}

/**
 * Render a code {@link RuntimeBundle} — the imperative-code path. The runtime
 * compiles + runs the bundle's files to a `Composer`, builds the live graph on
 * the server (contract #3: same builder the browser preview ran), and encodes it.
 */
export async function renderBundle(
  bundle: RuntimeBundle,
  onProgress?: (p: number) => void,
): Promise<RenderResult> {
  const composer = await new Runtime(bundle).run();
  const built = await composer.build({ target: 'server', compositorOptions: {} });
  try {
    const codec = await negotiateCodec({});
    if (!codec) return { ok: false, error: 'no encodable video codec in this browser' };

    document.getElementById('stage')?.append(built.compositor.view);

    const exporter = new Exporter(built.compositor, built.audioEngine);
    const blob = await exporter.export(
      {
        container: codec.container,
        videoCodec: codec.videoCodec,
        audio: false,
        range: [0, built.duration],
      },
      onProgress,
    );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return {
      ok: blob.size > 0,
      container: codec.container,
      videoCodec: codec.videoCodec,
      mime: blob.type,
      size: blob.size,
      base64: toBase64(bytes),
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  } finally {
    built.dispose();
  }
}

/**
 * Page-side {@link Endpoint} for the Puppeteer transport. The CDP boundary has no
 * `MessagePort`, so we bridge it: outgoing messages call `window.__rpcFromPage`
 * (a function the Node worker exposes via `page.exposeFunction`); incoming ones
 * arrive through `window.__rpcToPage`, which the worker drives via `page.evaluate`.
 */
function puppeteerPageEndpoint(): Endpoint {
  const listeners = new Set<(event: { data: unknown }) => void>();
  const w = window as unknown as {
    __rpcFromPage?: (message: unknown) => void;
    __rpcToPage?: (message: unknown) => void;
  };
  w.__rpcToPage = (message) => listeners.forEach((l) => l({ data: message }));
  return {
    postMessage: (message) => w.__rpcFromPage?.(message),
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  };
}

// Serve the typed RenderService over the RPC — the Node worker `wrap`s it. This
// replaces the old ad-hoc `window.__SSR__` global with a checked contract.
const service: RenderService = { render, renderBundle, sample: async () => sampleTimeline() };
expose(service, puppeteerPageEndpoint());
(window as unknown as { __RPC_READY__: boolean }).__RPC_READY__ = true;

// Self-check on load so `verify:ssr` can assert the browser half end-to-end.
render(sampleTimeline())
  .then((r) => {
    (window as unknown as { __SSR_TEST__: unknown }).__SSR_TEST__ = {
      ok: r.ok && (r.size ?? 0) > 500,
      container: r.container,
      videoCodec: r.videoCodec,
      size: r.size,
      error: r.error,
    };
  })
  .catch((err) => {
    (window as unknown as { __SSR_TEST__: unknown }).__SSR_TEST__ = { ok: false, error: String(err) };
  });
