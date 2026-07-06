/**
 * A **serializable timeline description** and a builder that rebuilds the SDK
 * object graph from it. This is the piece server-side rendering needs: the SDK
 * deliberately leaves persistence / schema to the consumer (see `AGENT.md`), so
 * the JSON protocol lives here in the example/consumer layer, not in `src/`.
 *
 * A server serializes an editor timeline to a {@link TimelineSpec} (plain JSON),
 * ships it into a headless browser, and {@link buildTimeline} reconstructs the
 * `Compositor` / `Track` / `Clip` graph so the normal {@link Exporter} can render
 * it — same render core as the live preview (contract #3).
 *
 * The builder is intentionally free of GPU calls at construction time
 * (`Compositor` and every clip construct synchronously without a renderer), so
 * the mapping is unit-testable headlessly — see `tests/ssr-timeline.test.ts`.
 * `await`ing sources (`init()`, font loading, `source.load()`) is the only part
 * that needs a browser.
 */
import {
  AudioClip,
  AudioEngine,
  AudioSource,
  type AutoDetectOptions,
  type BLEND_MODES,
  BlurEffect,
  ColorEffect,
  Compositor,
  type Easing,
  type Effect,
  easeInCubic,
  easeInOutCubic,
  easeInOutQuad,
  easeInQuad,
  easeOutCubic,
  easeOutQuad,
  fonts,
  hold,
  ImageClip,
  ImageSource,
  linear,
  type Renderer,
  ShapeClip,
  type ShapeSpec,
  TextClip,
  Timebase,
  VideoClip,
  VideoSource,
  type VisualClip,
  VisualTrack,
} from '../../src/index';

// ── Serializable spec ───────────────────────────────────────────────────────

/** Named easing curves usable in a keyframe spec. */
export type EasingName =
  | 'linear'
  | 'hold'
  | 'easeInQuad'
  | 'easeOutQuad'
  | 'easeInOutQuad'
  | 'easeInCubic'
  | 'easeOutCubic'
  | 'easeInOutCubic';

const EASINGS: Record<EasingName, Easing> = {
  linear,
  hold,
  easeInQuad,
  easeOutQuad,
  easeInOutQuad,
  easeInCubic,
  easeOutCubic,
  easeInOutCubic,
};

/**
 * A filter/effect on a clip or the whole frame. Effects are shaders — they need
 * a GPU renderer (so on the server they require Route B's WebGPU backend, not the
 * Canvas fallback). Params are static here for brevity.
 */
export type EffectSpec =
  | { type: 'blur'; strength?: number }
  | { type: 'color'; brightness?: number; contrast?: number; saturation?: number };

/** A property that is either a constant value or a keyframed animation. */
export type PropSpec<T> =
  | T
  | { keyframes: Array<{ time: number; value: T; easing?: EasingName }> };

export interface TransformSpec {
  position?: PropSpec<[number, number]>;
  scale?: PropSpec<[number, number]>;
  rotation?: PropSpec<number>;
  /** Normalized anchor (0..1); static only. Default `[0.5, 0.5]`. */
  anchor?: [number, number];
}

interface BaseClipSpec {
  /** Timeline interval, seconds. `end` is exclusive (`[start, end)`). */
  start: number;
  end: number;
  sourceIn?: number;
  sourceOut?: number;
  speed?: number;
  opacity?: PropSpec<number>;
  blendMode?: BLEND_MODES;
  transform?: TransformSpec;
  /** Filters applied to this clip (needs Route B's GPU backend on the server). */
  effects?: EffectSpec[];
}

export interface TextClipSpec extends BaseClipSpec {
  type: 'text';
  text: string;
  fontFamily?: string;
  fontSize?: PropSpec<number>;
  fill?: number | string;
}

export interface ShapeClipSpec extends BaseClipSpec {
  type: 'shape';
  shape: ShapeSpec;
}

export interface ImageClipSpec extends BaseClipSpec {
  type: 'image';
  /** URL/data-URI the headless browser can fetch. */
  src: string;
}

export interface VideoClipSpec extends BaseClipSpec {
  type: 'video';
  /** URL/data-URI the headless browser can fetch. */
  src: string;
  /** Decoded-frame ring size (bounds memory for big sources). */
  cacheFrames?: number;
  lookahead?: number;
}

export type ClipSpec = TextClipSpec | ShapeClipSpec | ImageClipSpec | VideoClipSpec;

export interface TrackSpec {
  zIndex?: number;
  clips: ClipSpec[];
}

/** An audio clip scheduled into the {@link AudioEngine} for the exported mix. */
export interface AudioClipSpec {
  src: string;
  start: number;
  end: number;
  sourceIn?: number;
  gain?: number;
  fadeIn?: number;
  fadeOut?: number;
}

export interface FontSpec {
  family: string;
  /** Self-hosted URL. Mutually exclusive with {@link google}. */
  src?: string;
  /** Load from Google Fonts instead of a self-hosted URL. */
  google?: { weights?: number[]; italic?: boolean; cssBase?: string };
}

export interface ExportSpec {
  container?: 'mp4' | 'webm';
  videoCodec?: string;
  audioCodec?: string;
  bitrate?: number;
  audioBitrate?: number;
  /** Mux the audio mix. Auto-enabled when the timeline has audio clips. */
  audio?: boolean;
}

/** The full, JSON-serializable description of a timeline to render. */
export interface TimelineSpec {
  width: number;
  height: number;
  fps: number;
  background?: number;
  /** Normalized coordinate origin (`0..1`); default `[0, 0]`. */
  origin?: [number, number];
  /**
   * Explicit render range `[start, end]` in seconds. Defaults to
   * `[0, maxClipEnd]` — the whole timeline.
   */
  range?: [number, number];
  fonts?: FontSpec[];
  tracks?: TrackSpec[];
  audio?: AudioClipSpec[];
  /** Global filters over the whole composite (a master grade / blur). */
  effects?: EffectSpec[];
  export?: ExportSpec;
}

// ── Builder ─────────────────────────────────────────────────────────────────

/** Everything the exporter path needs, plus a teardown that frees every source. */
export interface BuiltTimeline {
  compositor: Compositor;
  audioEngine: AudioEngine;
  range: [number, number];
  exportOptions: ExportSpec;
  hasAudio: boolean;
  /** Dispose the compositor and every source/decoder this build created. */
  dispose(): void;
}

/** Write a {@link PropSpec} onto an {@link import('../../src').AnimatableProperty}. */
function applyProp<T>(prop: { setStatic(v: T): void; setKeyframes(kfs: { time: number; value: T; easing?: Easing }[]): void }, spec: PropSpec<T> | undefined): void {
  if (spec === undefined) return;
  if (typeof spec === 'object' && spec !== null && 'keyframes' in spec) {
    prop.setKeyframes(spec.keyframes.map((k) => ({ time: k.time, value: k.value, easing: k.easing ? EASINGS[k.easing] : undefined })));
  } else {
    prop.setStatic(spec as T);
  }
}

/** Construct a built-in effect (filter) from its spec. */
export function buildEffect(spec: EffectSpec): Effect {
  if (spec.type === 'blur') {
    const e = new BlurEffect();
    if (spec.strength !== undefined) e.strength.setStatic(spec.strength);
    return e;
  }
  const e = new ColorEffect();
  if (spec.brightness !== undefined) e.brightness.setStatic(spec.brightness);
  if (spec.contrast !== undefined) e.contrast.setStatic(spec.contrast);
  if (spec.saturation !== undefined) e.saturation.setStatic(spec.saturation);
  return e;
}

/** Apply the shared timing / transform / opacity fields onto a visual clip. */
function applyBase(clip: VisualClip, spec: BaseClipSpec): void {
  clip.start = spec.start;
  clip.end = spec.end;
  if (spec.sourceIn !== undefined) clip.sourceIn = spec.sourceIn;
  if (spec.sourceOut !== undefined) clip.sourceOut = spec.sourceOut;
  if (spec.speed !== undefined) clip.speed = spec.speed;
  if (spec.blendMode) clip.blendMode = spec.blendMode;
  applyProp(clip.opacity, spec.opacity);
  const tr = spec.transform;
  if (tr) {
    if (tr.anchor) clip.transform.anchor.setStatic(tr.anchor);
    applyProp(clip.transform.position, tr.position);
    applyProp(clip.transform.scale, tr.scale);
    applyProp(clip.transform.rotation, tr.rotation);
  }
  for (const fx of spec.effects ?? []) clip.effects.push(buildEffect(fx));
}

/**
 * Construct one clip from its spec. Image/Video sources are loaded (async) and
 * pushed onto `sources` for later disposal. Text/Shape clips need no source and
 * resolve without touching the browser, so this is unit-testable for them.
 */
export async function buildClip(spec: ClipSpec, sources: { dispose(): void }[]): Promise<VisualClip> {
  let clip: VisualClip;
  if (spec.type === 'text') {
    clip = new TextClip({ text: spec.text, fontFamily: spec.fontFamily, fill: spec.fill });
    applyProp((clip as TextClip).fontSize, spec.fontSize);
  } else if (spec.type === 'shape') {
    clip = new ShapeClip(spec.shape);
  } else if (spec.type === 'image') {
    const source = new ImageSource({ src: spec.src });
    await source.load();
    sources.push(source);
    clip = new ImageClip(source);
  } else {
    const source = new VideoSource({ src: spec.src, cacheFrames: spec.cacheFrames, lookahead: spec.lookahead });
    await source.load();
    sources.push(source);
    clip = new VideoClip(source);
  }
  applyBase(clip, spec);
  return clip;
}

/** Largest clip end across all visual + audio clips (the timeline duration). */
export function timelineEnd(spec: TimelineSpec): number {
  let end = 0;
  for (const track of spec.tracks ?? []) for (const c of track.clips) end = Math.max(end, c.end);
  for (const a of spec.audio ?? []) end = Math.max(end, a.end);
  return end;
}

/** Load every font the timeline references (self-hosted or Google), deduped. */
async function loadFontsDom(specs: FontSpec[] | undefined): Promise<void> {
  for (const f of specs ?? []) {
    if (f.google) await fonts.loadGoogleFont({ family: f.family, weights: f.google.weights, italic: f.google.italic });
    else if (f.src) await fonts.load({ family: f.family, src: f.src });
  }
  await fonts.ready();
}

/**
 * Overrides that let {@link buildTimeline} run outside a browser (server-side
 * rendering). Both default to the browser behaviour.
 */
export interface BuildOverrides {
  /** Custom GPU renderer factory (e.g. Node WebGPU via Dawn). */
  createRenderer?: (options: Partial<AutoDetectOptions>) => Promise<Renderer>;
  /** Custom font loader (e.g. Node `GlobalFonts.register`) replacing `document.fonts`. */
  loadFonts?: (specs: FontSpec[] | undefined) => Promise<void>;
  /**
   * Backing-store scale for the output. `2` renders/exports at 2× the timeline's
   * `width`×`height` (crisper text/vectors, larger file). In a browser this
   * defaults to `devicePixelRatio`; in Node there's none, so the default is `1`
   * and a caller (e.g. the SSR worker's `--scale`) can bump it here.
   */
  resolution?: number;
}

/**
 * Rebuild the SDK object graph from a {@link TimelineSpec} and initialize the
 * GPU renderer, ready for {@link Exporter.export}. Loads fonts and every
 * image/video source up front. The caller must {@link BuiltTimeline.dispose}
 * when done (frees the compositor and every source/decoder).
 */
export async function buildTimeline(spec: TimelineSpec, overrides: BuildOverrides = {}): Promise<BuiltTimeline> {
  const timebase = new Timebase(spec.fps);
  const compositor = new Compositor({
    width: spec.width,
    height: spec.height,
    timebase,
    background: spec.background ?? 0x000000,
    origin: spec.origin,
    createRenderer: overrides.createRenderer,
    resolution: overrides.resolution,
  });
  await compositor.init();

  await (overrides.loadFonts ?? loadFontsDom)(spec.fonts);

  const sources: { dispose(): void }[] = [];
  for (const trackSpec of spec.tracks ?? []) {
    if (trackSpec.clips.length === 0) continue;
    const track = new VisualTrack();
    track.zIndex = trackSpec.zIndex ?? 0;
    for (const clipSpec of trackSpec.clips) track.add(await buildClip(clipSpec, sources));
    compositor.addTrack(track);
  }

  // Global filters over the whole composite (master grade / blur).
  for (const fx of spec.effects ?? []) compositor.effects.push(buildEffect(fx));

  const audioEngine = new AudioEngine(timebase);
  const hasAudio = (spec.audio?.length ?? 0) > 0;
  for (const a of spec.audio ?? []) {
    const source = new AudioSource({ src: a.src });
    await source.load();
    sources.push(source);
    const clip = new AudioClip();
    clip.start = a.start;
    clip.end = a.end;
    if (a.sourceIn !== undefined) clip.sourceIn = a.sourceIn;
    if (a.gain !== undefined) clip.gain.setStatic(a.gain);
    if (a.fadeIn !== undefined) clip.fadeIn = a.fadeIn;
    if (a.fadeOut !== undefined) clip.fadeOut = a.fadeOut;
    audioEngine.schedule(clip, source);
  }

  const range: [number, number] = spec.range ?? [0, timelineEnd(spec)];
  const exportOptions: ExportSpec = { audio: hasAudio, ...spec.export };

  return {
    compositor,
    audioEngine,
    range,
    exportOptions,
    hasAudio,
    dispose() {
      for (const s of sources) s.dispose();
      compositor.dispose();
    },
  };
}
