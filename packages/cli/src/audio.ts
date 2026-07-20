/**
 * `sequio audio <file>` — export just the **audio track** of a composition to an
 * audio file, **pure Node** (Route B), no browser.
 *
 * It snapshots the entry file's project into a {@link RuntimeBundle}, re-runs the
 * composition's own builder in Node, and drives the SDK's `Exporter.exportAudio`
 * — the same {@link AudioEngine} offline mix `sequio render` muxes — into an
 * audio-only container (`.mp3` / `.m4a` / `.wav` / `.ogg` / `.webm`). No frames
 * are rendered, so the exported audio is exactly the movie's soundtrack
 * (contract #3).
 *
 * The composition's builder still constructs + `init()`s a `Compositor`, so a
 * WebGPU-capable host is required (real GPU or Mesa lavapipe), same as the other
 * Route B commands.
 */
import { dirname, resolve } from 'node:path';
import { AUDIO_FORMATS, type AudioFormat } from './args';
import { readBundle } from './bundle';
import { nodeAssetLoader } from './assets-node';
import { cliExternals } from './externals';

export interface AudioOptions {
  /** Output audio path. `undefined` → `out.<format>`. */
  out?: string;
  /** Audio container format. `undefined` → inferred from `out`'s extension, else `mp3`. */
  format?: AudioFormat;
  /** Target audio bitrate, bits/sec. `undefined` → the engine default (128 kbps). */
  bitrate?: number;
}

/** Map an output-file extension to a known audio format (else `undefined`). */
function formatFromExt(out: string | undefined): AudioFormat | undefined {
  const m = out?.toLowerCase().match(/\.([^./\\]+)$/);
  const ext = m?.[1] === 'oga' ? 'ogg' : m?.[1];
  return AUDIO_FORMATS.includes(ext as AudioFormat) ? (ext as AudioFormat) : undefined;
}

/**
 * Export the audio of `entryFile` to a file, returning the process exit code
 * (0 = success).
 */
export async function runAudio(entryFile: string, options: AudioOptions = {}): Promise<number> {
  const bundle = readBundle(entryFile);
  // The entry's directory is the project root — where `loadAsset('./song.mp3')`
  // reads a composition's local media files from on disk.
  const projectRoot = dirname(resolve(entryFile));

  // Prefer an explicit --format, else infer from --out's extension, else mp3.
  const format = options.format ?? formatFromExt(options.out) ?? 'mp3';

  // Import Route B lazily: it pulls Node-only deps (WebGPU, canvas, codecs), only
  // needed when actually exporting.
  const { exportBundleAudioToFile } = await import('./route-b');

  try {
    const out = options.out ?? `out.${format}`;
    console.log(`Exporting audio from ${entryFile} (pure Node) → ${format} …`);

    const result = await exportBundleAudioToFile(bundle, {
      out,
      format,
      bitrate: options.bitrate,
      // Make gsap (and any other CLI-provided lib) resolvable to the composition
      // in the Node run, same as the browser preview does.
      externals: cliExternals(),
      // Resolve `loadAsset('./song.mp3')` against the project directory on disk,
      // so a local audio source mixes the same as it previews (contract #3).
      loadAsset: nodeAssetLoader(projectRoot),
    });

    console.log(
      `✅ wrote ${result.out} (${result.format}/${result.codec}, ` +
        `${result.duration.toFixed(2)}s, ${result.bytes} bytes)`,
    );
    return 0;
  } catch (err) {
    console.error('✖', err instanceof Error ? err.message : String(err));
    return 1;
  }
}
