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
