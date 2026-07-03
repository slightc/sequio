/**
 * video-editor-canvas — a command-style object-graph engine for building video
 * editors on top of PixiJS.
 *
 * Public surface only. Internal helpers (Reconciler, FrameCache,
 * TextureManager, Mediabunny read/write adapters) are exported for advanced
 * extension but are not part of the stable API.
 */

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

// ── Media ─────────────────────────────────────────────────────────────────
export { MediaSource, VisualSource, type SourceMetadata } from './media/media-source';
export { VideoSource, type VideoSourceOptions } from './media/video-source';
export { type DecodedFrame, type VideoDecoderBackend } from './media/video-decoder';
export {
  MediabunnyVideoDecoder,
  setFrameImageExtractor,
  type FrameImageExtractor,
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
export { Clip, VisualClip, AudioClip } from './compositor/clip';
export {
  VideoClip,
  ImageClip,
  TextClip,
  ShapeClip,
  type TextStyleLike,
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
export { Exporter, type ExportOptions, ExportCancelledError } from './export/exporter';
export { type ExportSink, type ResolvedExportOptions } from './export/export-sink';
export { exportFrameTimes } from './export/frame-times';
export { MediabunnyExportSink } from './export/mediabunny-export-sink';
