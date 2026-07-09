/**
 * The encode/mux seam. {@link Exporter} owns the deterministic render loop; an
 * `ExportSink` owns turning rendered frames + the mixed audio buffer into a
 * container file. The default sink (Mediabunny + WebCodecs) is browser-only, so
 * tests inject a fake sink to verify the loop.
 */
export interface ExportSink {
  /** Set up encoders/muxer and declare the tracks. */
  start(): Promise<void>;
  /** Encode the compositor's current frame at `timestamp` for `duration` seconds. */
  addFrame(timestamp: number, duration: number): Promise<void>;
  /** Encode the full mixed audio buffer (played from t=0). */
  addAudio(buffer: AudioBuffer): Promise<void>;
  /** Flush encoders, finish the container, and return the file. */
  finalize(): Promise<Blob>;
  /** Abort: tear down encoders/muxer without producing a file. */
  cancel(): Promise<void>;
}

/** Fully-resolved export settings (defaults applied) handed to the sink. */
export interface ResolvedExportOptions {
  fps: number;
  container: 'mp4' | 'webm';
  videoCodec: string;
  bitrate: number;
  withAudio: boolean;
  audioCodec: string;
  audioBitrate: number;
}

/**
 * The audio-only encode/mux seam. The sibling of {@link ExportSink} for
 * {@link Exporter}'s `exportAudio` path: no video track, no per-frame loop —
 * just the mixed {@link AudioBuffer} muxed into an audio container. The default
 * sink (Mediabunny + WebCodecs) is browser-only, so tests inject a fake.
 */
export interface AudioExportSink {
  /** Set up the encoder/muxer and declare the audio track. */
  start(): Promise<void>;
  /** Encode the full mixed audio buffer (played from t=0). */
  addAudio(buffer: AudioBuffer): Promise<void>;
  /** Flush the encoder, finish the container, and return the file. */
  finalize(): Promise<Blob>;
  /** Abort: tear down the encoder/muxer without producing a file. */
  cancel(): Promise<void>;
}

/** Audio-only container formats {@link Exporter.exportAudio} can write. */
export type AudioExportFormat = 'm4a' | 'mp3' | 'wav' | 'ogg' | 'webm';

/** Fully-resolved audio-export settings (defaults applied) handed to the sink. */
export interface ResolvedAudioExportOptions {
  format: AudioExportFormat;
  codec: string;
  bitrate: number;
}
