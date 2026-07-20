/**
 * Route B (pure Node) — export just the **audio track** of a code
 * {@link RuntimeBundle} to an audio file, no browser.
 *
 * The audio sibling of {@link renderBundleToFile}: instead of encoding frames, it
 * runs the composition's own builder in Node, then drives the SDK's
 * {@link Exporter.exportAudio} — the same {@link AudioEngine} offline mix the video
 * export muxes — into an audio-only container (`.m4a` / `.mp3` / `.wav` / `.ogg` /
 * `.webm`). It's what `sequio audio` calls. Because no frame is rendered, the mix
 * matches the movie's soundtrack (contract #3) with no per-frame GPU readback.
 *
 * The composition's builder still constructs + `init()`s a `Compositor`, so a
 * WebGPU-capable host is required (real GPU or Mesa lavapipe), same as the other
 * Route B paths; {@link setupNodeEnvironment} throws a clear message if none.
 */
import { type AudioExportFormat, Exporter } from '@sequio/engine';
import { type AssetLoader, type Externals, Runtime, type RuntimeBundle } from '@sequio/runtime';
import { serverEnv } from '@sequio/server';

export interface ExportBundleAudioNodeOptions {
  /** Output file path. The extension is corrected to match the audio format. */
  out: string;
  /** Audio container format. @default 'mp3' */
  format?: AudioExportFormat;
  /** Audio codec (Mediabunny name). Defaults per format (aac / mp3 / pcm-s16 / opus). */
  codec?: string;
  /** Target audio bitrate, bits/sec. Ignored for `wav` (PCM). @default 128_000 */
  bitrate?: number;
  /** Extra bare modules the composition may `import` (e.g. `gsap`); see {@link renderBundleToFile}. */
  externals?: Externals;
  /** Resolver for local media assets (`loadAsset('./song.mp3')`); see {@link renderBundleToFile}. */
  loadAsset?: AssetLoader;
}

export interface ExportBundleAudioNodeResult {
  /** The written file path (extension corrected to the audio format). */
  out: string;
  format: AudioExportFormat;
  codec: string;
  /** Timeline duration mixed, in seconds. */
  duration: number;
  bytes: number;
}

/** The file extension each audio format writes. */
const EXT: Record<AudioExportFormat, string> = { m4a: 'm4a', mp3: 'mp3', wav: 'wav', ogg: 'ogg', webm: 'webm' };

/** Default codec per format, mirroring {@link Exporter.exportAudio} (for the result summary). */
const DEFAULT_CODEC: Record<AudioExportFormat, string> = {
  m4a: 'aac',
  mp3: 'mp3',
  wav: 'pcm-s16',
  ogg: 'opus',
  webm: 'opus',
};

/** Force the output extension to match the audio format. */
function audioPath(out: string, format: AudioExportFormat): string {
  return out.replace(/\.[^./\\]*$/, '') + '.' + EXT[format];
}

/**
 * Compile + run `bundle` and write its audio-only mix to `opts.out`. The built
 * graph is disposed before returning.
 */
export async function exportBundleAudioToFile(
  bundle: RuntimeBundle,
  opts: ExportBundleAudioNodeOptions,
): Promise<ExportBundleAudioNodeResult> {
  const format = opts.format ?? 'mp3';
  const codec = opts.codec ?? DEFAULT_CODEC[format];

  // The same server env setup as the video/frame paths. This audio-only path
  // renders no frames, but building still `init()`s the compositor (which needs a
  // renderer in Node) and the env bridges the builder's `fonts.load(...)` so it
  // runs without crashing — even though no text is drawn. See {@link renderBundleToFile}.
  const env = serverEnv();
  await env.setup();
  const composer = await new Runtime({ ...bundle, externals: opts.externals, loadAsset: opts.loadAsset }).run();
  const built = await composer.build();

  try {
    const exporter = new Exporter(built.compositor, built.audioEngine);
    const blob = await exporter.exportAudio({
      format,
      codec: opts.codec,
      bitrate: opts.bitrate,
      range: [0, built.duration],
    });

    const fs = await import('node:fs');
    const out = audioPath(opts.out, format);
    const buf = Buffer.from(await blob.arrayBuffer());
    fs.writeFileSync(out, buf);
    return { out, format, codec, duration: built.duration, bytes: buf.length };
  } finally {
    built.dispose();
  }
}
