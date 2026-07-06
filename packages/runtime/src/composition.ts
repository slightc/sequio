/**
 * The authoring entry point sandboxed user code calls to describe a video.
 *
 * User code (compiled + run by the {@link Runtime}) produces a
 * {@link TimelineSpec} — the same serializable protocol the server-side render
 * routes consume — by default-exporting `defineComposition(spec)`. Wrapping the
 * spec in a tagged {@link Composition} lets the runtime tell "the user returned a
 * composition" from "the user returned some other object", and gives one obvious
 * name to import:
 *
 * ```ts
 * import { defineComposition } from '@video-editor-canvas/runtime';
 * export default defineComposition({
 *   width: 640, height: 360, fps: 30,
 *   tracks: [{ clips: [{ type: 'text', text: 'Hello', start: 0, end: 3 }] }],
 * });
 * ```
 */
import type { TimelineSpec } from '@video-editor-canvas/server';

/** Brand marking a value produced by {@link defineComposition}. */
export const COMPOSITION_TAG = '@video-editor-canvas/runtime:composition' as const;

/** A tagged, validated {@link TimelineSpec} returned by {@link defineComposition}. */
export interface Composition {
  readonly __tag: typeof COMPOSITION_TAG;
  readonly spec: TimelineSpec;
}

/** Whether `value` is a {@link Composition} produced by {@link defineComposition}. */
export function isComposition(value: unknown): value is Composition {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __tag?: unknown }).__tag === COMPOSITION_TAG
  );
}

/** Cheap structural check that a value looks like a {@link TimelineSpec}. */
export function isTimelineSpec(value: unknown): value is TimelineSpec {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<TimelineSpec>;
  return (
    typeof v.width === 'number' && typeof v.height === 'number' && typeof v.fps === 'number'
  );
}

/**
 * Validate the essentials of a {@link TimelineSpec} and wrap it as a
 * {@link Composition}. Kept intentionally light — the full shape is the server's
 * `TimelineSpec` type; this only guards the fields the runtime relies on so a
 * typo fails loudly at author time rather than as a black frame.
 */
export function defineComposition(spec: TimelineSpec): Composition {
  if (!isTimelineSpec(spec)) {
    throw new Error(
      'defineComposition expects a TimelineSpec with numeric width, height and fps.',
    );
  }
  if (spec.width <= 0 || spec.height <= 0) {
    throw new Error(`Composition width/height must be positive (got ${spec.width}×${spec.height}).`);
  }
  if (spec.fps <= 0) throw new Error(`Composition fps must be positive (got ${spec.fps}).`);
  return { __tag: COMPOSITION_TAG, spec };
}
