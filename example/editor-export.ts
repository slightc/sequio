/**
 * Editor export: render a timeline to a video file on a **forked, offscreen**
 * graph so encoding never contends with the live preview.
 *
 * Extracted from the editor UI so the fork path is unit/e2e-testable in
 * isolation (see `editor-export-test.ts`, run via `pnpm verify:editor-export`).
 *
 * The key move is `VideoSource.fork()`: each video clip gets a second decoder +
 * frame cache over the same demuxed input, so the export decodes in parallel
 * with the preview's decoder instead of sharing (and stalling on) its single
 * decode lane. Image sources (one static texture) are shared; text / shape
 * clips are rebuilt from their spec.
 */
import {
  type AudioEngine,
  Compositor,
  Exporter,
  ImageClip,
  ShapeClip,
  TextClip,
  type Timebase,
  VideoClip,
  type VideoSource,
  type VisualClip,
  type VisualSource,
  VisualTrack,
} from '../src/index';

/**
 * Bound a video's decode-cache so a high-resolution source can't pile up
 * gigabytes of decoded frames and freeze the tab. A decoded frame is ~`w*h*4`
 * bytes; the default {@link FrameCache} holds 60 of them — for 4K that's ~2 GB.
 * Size the ring to a fixed memory budget instead (and the look-ahead with it).
 *
 * Constructor options are the right lever because `VideoSource.fork()` inherits
 * them, so the export fork stays bounded too. Pure + deterministic → unit-tested.
 *
 * @param budgetBytes decoded-frame memory budget (default ~160 MiB).
 */
export function videoCacheSettings(
  width: number,
  height: number,
  budgetBytes = 160 * 1024 * 1024,
): { cacheFrames: number; lookahead: number } {
  const bytesPerFrame = Math.max(1, width * height * 4);
  const cacheFrames = Math.max(2, Math.min(60, Math.floor(budgetBytes / bytesPerFrame)));
  const lookahead = Math.max(1, Math.min(3, Math.floor(cacheFrames / 3)));
  return { cacheFrames, lookahead };
}

export type ExportClipKind = 'text' | 'shape' | 'image' | 'video';

/** The minimal view of a timeline clip the exporter needs. */
export interface ExportClip {
  kind: ExportClipKind;
  clip: VisualClip;
  source: VisualSource | null;
}

/** The minimal view of a track: a z-order and its clips. */
export interface ExportTrackLike {
  zIndex: number;
  clips: ExportClip[];
}

export interface EditorExportOptions {
  width: number;
  height: number;
  timebase: Timebase;
  fps: number;
  container: 'mp4' | 'webm';
  /** WebCodecs/Mediabunny codec name; defaults to the container's default. */
  videoCodec?: string;
  range: [number, number];
  background?: number;
  bitrate?: number;
  onProgress?: (p: number) => void;
  /** Receives the live {@link Exporter} so the caller can `cancel()` it. */
  onExporter?: (exporter: Exporter) => void;
}

/** Copy timing + (static) transform from a live clip onto an export clone. */
export function copyVisual(src: VisualClip, dst: VisualClip): void {
  dst.start = src.start;
  dst.end = src.end;
  dst.sourceIn = src.sourceIn;
  dst.sourceOut = src.sourceOut;
  dst.speed = src.speed;
  dst.transform.anchor.setStatic(src.transform.anchor.valueAt(0));
  dst.transform.position.setStatic(src.transform.position.valueAt(0));
  dst.transform.scale.setStatic(src.transform.scale.valueAt(0));
  dst.transform.rotation.setStatic(src.transform.rotation.valueAt(0));
  dst.opacity.setStatic(src.opacity.valueAt(0));
  dst.blendMode = src.blendMode;
}

/**
 * Clone a clip for the export graph. Video sources are forked (own decoder +
 * cache over the same demux) and pushed onto `forked` for later disposal;
 * image sources are shared.
 */
export async function cloneClipForExport(m: ExportClip, forked: VisualSource[]): Promise<VisualClip> {
  let clip: VisualClip;
  if (m.kind === 'text') {
    const t = m.clip as TextClip;
    clip = new TextClip({ text: t.text, fontFamily: t.fontFamily, fontSize: t.fontSize.valueAt(0), fill: t.fill });
  } else if (m.kind === 'shape') {
    clip = new ShapeClip((m.clip as ShapeClip).spec);
  } else if (m.kind === 'image') {
    clip = new ImageClip(m.source as VisualSource);
  } else {
    const fv = (m.source as VideoSource).fork();
    await fv.load();
    forked.push(fv);
    clip = new VideoClip(fv);
  }
  copyVisual(m.clip, clip);
  return clip;
}

/** Build an offscreen compositor mirroring the timeline for export. */
export async function buildExportCompositor(
  tracks: readonly ExportTrackLike[],
  opts: EditorExportOptions,
): Promise<{ comp: Compositor; forked: VisualSource[] }> {
  const comp = new Compositor({
    width: opts.width,
    height: opts.height,
    timebase: opts.timebase,
    background: opts.background ?? 0x101014,
    preferWebGPU: true,
  });
  await comp.init();
  const forked: VisualSource[] = [];
  for (const tm of tracks) {
    if (tm.clips.length === 0) continue;
    const et = new VisualTrack();
    et.zIndex = tm.zIndex;
    for (const m of tm.clips) et.add(await cloneClipForExport(m, forked));
    comp.addTrack(et);
  }
  return { comp, forked };
}

/**
 * Export a timeline to a video Blob on a forked offscreen graph. Disposes the
 * offscreen compositor and every forked decoder before returning (the caller's
 * live preview and its sources are never touched).
 */
export async function exportTimeline(
  tracks: readonly ExportTrackLike[],
  audioEngine: AudioEngine,
  opts: EditorExportOptions,
): Promise<Blob> {
  const { comp, forked } = await buildExportCompositor(tracks, opts);
  try {
    const exporter = new Exporter(comp, audioEngine);
    opts.onExporter?.(exporter);
    return await exporter.export(
      {
        fps: opts.fps,
        container: opts.container,
        videoCodec: opts.videoCodec,
        audio: false,
        bitrate: opts.bitrate,
        range: opts.range,
      },
      opts.onProgress,
    );
  } finally {
    for (const s of forked) s.dispose();
    comp.dispose();
  }
}
