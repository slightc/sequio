/**
 * sequio — a command-style object-graph engine for building video
 * editors on top of PixiJS.
 *
 * Public surface only. Internal helpers (Reconciler, FrameCache,
 * TextureManager, Mediabunny read/write adapters) are exported for advanced
 * extension but are not part of the stable API.
 */

// ── PixiJS types (re-exported) ──────────────────────────────────────────────
// The engine is the *only* package that imports `pixi.js` (and `mediabunny`)
// directly; consumers (server, studio) go through the engine. These are the
// PixiJS types that leak into the engine's own public surface — the renderer a
// host injects via `CompositorOptions.createRenderer`, and the blend mode set on
// a `Clip` — re-exported so a consumer can type against them without a direct
// `pixi.js` import. Type-only, so nothing is bundled at runtime.
export type { Renderer, AutoDetectOptions, BLEND_MODES } from 'pixi.js';

// ── Core ──────────────────────────────────────────────────────────────────
export type { Disposable, Subscription } from './core/disposable';
export { createSubscription } from './core/disposable';

// ── Time & Clock ────────────────────────────────────────────────────────────
export { Timebase } from './time/timebase';
export { type Clock, RealtimeClock, FixedStepClock } from './time/clock';

// ── Animation ───────────────────────────────────────────────────────────────
export {
  type Easing,
  linear,
  hold,
  cubicBezier,
  easeInQuad,
  easeOutQuad,
  easeInOutQuad,
  easeInCubic,
  easeOutCubic,
  easeInOutCubic,
} from './animation/easing';
export { AnimatableProperty, type Keyframe } from './animation/animatable-property';
export { Transform2D } from './animation/transform2d';
export {
  type AnimationSample,
  type ClipAnimator,
  type TextAnimator,
  type TextPart,
  type TextSplit,
  type StaggerOrder,
  type StaggerTextOptions,
  type TweenAnimatorOptions,
  IDENTITY_SAMPLE,
  StaggerTextAnimator,
  TweenAnimator,
  lerpSample,
} from './animation/clip-animator';
export {
  type GsapLike,
  type GsapTimelineLike,
  type GsapTarget,
  gsapClipAnimator,
  gsapTextAnimator,
  identityTarget,
} from './animation/gsap-animator';
export { computeTextParts, type MeasureWidth } from './text/text-layout';

// ── Media ─────────────────────────────────────────────────────────────────
export { MediaSource, VisualSource, type SourceMetadata } from './media/media-source';
export { VideoSource, type VideoSourceOptions } from './media/video-source';
export { type DecodedFrame, type VideoDecoderBackend } from './media/video-decoder';
export {
  MediabunnyVideoDecoder,
  setFrameImageExtractor,
  type FrameImageExtractor,
  type MediabunnyDemux,
  type VideoInput,
} from './media/mediabunny-decoder';
export { ImageSource, type ImageSourceOptions } from './media/image-source';
export { AudioSource, type AudioSourceOptions } from './media/audio-source';
export { FrameCache, type Closable } from './media/frame-cache';
export { loadMediabunny, setMediabunnyModule, type MediabunnyModule } from './media/mediabunny-loader';

// ── Texture ─────────────────────────────────────────────────────────────────
export { TextureManager } from './texture/texture-manager';

// ── Text / Fonts ────────────────────────────────────────────────────────────
export {
  FontManager,
  fonts,
  buildGoogleCss2Url,
  type FontSpec,
  type GoogleFontSpec,
} from './text/font-manager';

// ── Compositor graph ─────────────────────────────────────────────────────────
export { Compositor, type CompositorOptions } from './compositor/compositor';
export { Track, VisualTrack, AudioTrack } from './compositor/track';
export { Clip, VisualClip, AudioClip, type MaskSpec } from './compositor/clip';
export {
  VideoClip,
  ImageClip,
  TextClip,
  ShapeClip,
  type TextStyleLike,
  type TextStrokeLike,
  type ShapeSpec,
  type ShapeKind,
} from './compositor/clips';
export { GroupClip } from './compositor/group-clip';
export { Reconciler } from './compositor/reconciler';

// ── Effects & Transitions ────────────────────────────────────────────────────
export { Effect } from './effects/effect';
export { EffectRegistry, type EffectFactory } from './effects/effect-registry';
export { ColorEffect } from './effects/color-effect';
export { BlurEffect } from './effects/blur-effect';
export { BulgeEffect } from './effects/bulge-effect';
export { PerspectiveEffect } from './effects/perspective-effect';
export { DisplacementEffect, type DisplacementEffectOptions } from './effects/displacement-effect';
export { TwirlEffect, twirlSourceUv } from './effects/twirl-effect';
export {
  type Mat3,
  type Quad,
  type Vec2,
  UNIT_QUAD,
  squareToQuad,
  invert3x3,
  applyHomography,
  perspectiveSampleMatrix,
} from './effects/warp/homography';
export { bulgeSourceUv } from './effects/warp/distortion';
export { registerBuiltins, BUILTIN_EFFECTS } from './effects/builtins';
export { Transition } from './effects/transition';
export { CrossfadeTransition, crossfadeAlpha } from './effects/crossfade-transition';

// ── Audio ─────────────────────────────────────────────────────────────────
export { AudioEngine } from './audio/audio-engine';
export {
  clipPlaybackAt,
  effectiveGain,
  fadeFactor,
  gainEventsAt,
  type ClipPlayback,
  type GainEvent,
} from './audio/scheduling';

// ── Export ────────────────────────────────────────────────────────────────
export {
  Exporter,
  type ExportOptions,
  type ExportFrameOptions,
  type AudioExportOptions,
  ExportCancelledError,
} from './export/exporter';
export {
  type ExportSink,
  type ResolvedExportOptions,
  type AudioExportSink,
  type AudioExportFormat,
  type ResolvedAudioExportOptions,
} from './export/export-sink';
export { exportFrameTimes } from './export/frame-times';
export { MediabunnyExportSink } from './export/mediabunny-export-sink';
export { MediabunnyAudioExportSink } from './export/mediabunny-audio-export-sink';
