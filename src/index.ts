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
export { MediabunnyVideoDecoder, type VideoInput } from './media/mediabunny-decoder';
export { ImageSource, type ImageSourceOptions } from './media/image-source';
export { AudioSource, type AudioSourceOptions } from './media/audio-source';
export { FrameCache, type Closable } from './media/frame-cache';

// ── Texture ─────────────────────────────────────────────────────────────────
export { TextureManager } from './texture/texture-manager';

// ── Compositor graph ─────────────────────────────────────────────────────────
export { Compositor, type CompositorOptions } from './compositor/compositor';
export { Track, VisualTrack, AudioTrack } from './compositor/track';
export { Clip, VisualClip, AudioClip } from './compositor/clip';
export { VideoClip, ImageClip, TextClip, ShapeClip, type TextStyleLike } from './compositor/clips';
export { GroupClip } from './compositor/group-clip';
export { Reconciler } from './compositor/reconciler';

// ── Effects & Transitions ────────────────────────────────────────────────────
export { Effect } from './effects/effect';
export { EffectRegistry, type EffectFactory } from './effects/effect-registry';
export { Transition } from './effects/transition';

// ── Audio ─────────────────────────────────────────────────────────────────
export { AudioEngine } from './audio/audio-engine';

// ── Export ────────────────────────────────────────────────────────────────
export { Exporter, type ExportOptions } from './export/exporter';
