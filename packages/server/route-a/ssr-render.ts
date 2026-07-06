/**
 * Server-side render entry (Route A: headless Chrome). This page runs inside a
 * headless browser — which has WebGL, WebCodecs and Web Audio — and exposes
 * `window.__SSR__.render(spec)`: it rebuilds the SDK object graph from a
 * {@link TimelineSpec}, runs the normal {@link Exporter}, and returns the encoded
 * video as base64 so the Node worker (`scripts/ssr-render.cjs`) can write it to
 * disk. The render core is the same one the live preview uses (contract #3).
 *
 * On load it also renders the built-in sample and publishes the result on
 * `window.__SSR_TEST__` so `pnpm verify:ssr` can assert the browser half works.
 */
import { Exporter, loadMediabunny } from '@video-editor-canvas/engine';
import { sampleTimeline } from '../src/sample-timeline';
import { buildTimeline, type TimelineSpec } from '../src/timeline';

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

// Publish the API the Node worker calls.
(window as unknown as { __SSR__: { render: typeof render; sample: typeof sampleTimeline } }).__SSR__ = {
  render,
  sample: sampleTimeline,
};

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
