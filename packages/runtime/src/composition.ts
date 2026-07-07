/**
 * The authoring entry point sandboxed user code calls to describe a video.
 *
 * Unlike a declarative JSON spec, a composition is **imperative code**: the user
 * builds a live object graph with the engine's own classes — exactly the
 * `new Compositor()` / `new VisualTrack()` / `track.add(new TextClip(...))` style
 * the `example/` demos use — inside a builder function. This is what lets a user
 * bring their **own** `Clip` / `Effect` subclasses and arbitrary logic: whatever
 * runs in a demo runs here, with no schema to keep in sync.
 *
 * ```ts
 * import { Compositor, VisualTrack, TextClip, Timebase } from '@sequio/engine';
 * import { defineComposition } from '@sequio/runtime';
 *
 * export default defineComposition(async (env) => {
 *   const compositor = new Compositor({
 *     width: 640, height: 360, timebase: new Timebase(30),
 *     ...env.compositorOptions,          // lets a server inject its renderer
 *   });
 *   await compositor.init();
 *   const track = new VisualTrack();
 *   const title = new TextClip({ text: 'Hello', fontSize: 44 });
 *   title.start = 0; title.end = 4;
 *   track.add(title);
 *   compositor.addTrack(track);
 *   return { compositor, duration: 4 };
 * });
 * ```
 */
import type { AudioEngine, Compositor, CompositorOptions, Track } from '@sequio/engine';

/** Brand marking a value produced by {@link defineComposition}. */
export const COMPOSITION_TAG = '@sequio/runtime:composition' as const;

/**
 * The live object graph a builder returns: an initialized {@link Compositor} plus
 * (optionally) the {@link AudioEngine} driving its audio, and the timeline length.
 */
export interface CompositionResult {
  /** The built + `init()`-ed compositor to preview / export / server-render. */
  compositor: Compositor;
  /** The audio engine for preview playback and the export mix, if any. */
  audioEngine?: AudioEngine;
  /**
   * Timeline duration in seconds. Optional — when omitted it's derived from the
   * largest clip end across the compositor's tracks (see {@link deriveDuration}).
   */
  duration?: number;
}

/**
 * The environment a composition is built in. The same builder runs for client
 * preview, client export and server render; `compositorOptions` is how the host
 * injects what differs (a Node WebGPU renderer, an output scale), so portable
 * code spreads it into `new Compositor({ ... })`.
 */
export interface CompositionEnv {
  /** Merge into the `Compositor` options. Browser: `{}`; Node: `{ createRenderer, resolution }`. */
  readonly compositorOptions: Partial<CompositorOptions>;
  /** Where this build runs, in case user code wants to branch (e.g. output scale). */
  readonly target: 'preview' | 'export' | 'server';
}

/** A function that builds a live composition. May be async (it `await`s `init()`). */
export type CompositionBuilder = (env: CompositionEnv) => CompositionResult | Promise<CompositionResult>;

/** A tagged builder returned by {@link defineComposition}. */
export interface Composition {
  readonly __tag: typeof COMPOSITION_TAG;
  readonly build: CompositionBuilder;
}

/** Whether `value` is a {@link Composition} produced by {@link defineComposition}. */
export function isComposition(value: unknown): value is Composition {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __tag?: unknown }).__tag === COMPOSITION_TAG &&
    typeof (value as { build?: unknown }).build === 'function'
  );
}

/**
 * Tag a builder function as a composition. Kept intentionally thin — all the
 * power is in the builder body (real engine classes, real control flow); this
 * just marks the value so the runtime can tell "the user returned a composition"
 * from "the user returned something else", and fails loudly if handed a non-function.
 */
export function defineComposition(build: CompositionBuilder): Composition {
  if (typeof build !== 'function') {
    throw new Error('defineComposition expects a builder function (env) => { compositor, duration }.');
  }
  return { __tag: COMPOSITION_TAG, build };
}

/** Largest clip end across every track of a compositor (the timeline duration). */
export function deriveDuration(compositor: Compositor): number {
  let end = 0;
  for (const track of compositor.getTracks() as ReadonlyArray<Track>) {
    for (const clip of track.clips) if (clip.end > end) end = clip.end;
  }
  return end;
}
