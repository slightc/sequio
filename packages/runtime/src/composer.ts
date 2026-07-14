/**
 * The {@link Composer} is what running user code yields: a handle around the
 * composition **builder** (imperative engine code) plus the portable source
 * {@link RuntimeBundle} it came from. From one object it goes three ways —
 *
 *  1. **Client preview** — `preview(container)` runs the builder to make a live
 *     `Compositor`, drives a `RealtimeClock`, and plays it on screen.
 *  2. **Client export** — `export(options)` runs the builder to a fresh graph and
 *     renders it to a video `Blob` through the engine's `Exporter`.
 *  3. **Server render** — `toBundle()` hands back the exact source files + entry;
 *     the *same* runtime runs that code on a server (headless Chrome / Node),
 *     rebuilding the graph there. The code is the artifact — nothing to serialize,
 *     nothing to keep in sync.
 *
 * Each destination runs the builder **again** to an independent graph, so an
 * export never disturbs the live preview and every consumer owns its own
 * resources.
 */
import {
  AudioEngine,
  type Compositor,
  Exporter,
  type ExportOptions,
  RealtimeClock,
  type Subscription,
  Timebase,
} from '@sequio/engine';
import {
  type Composition,
  type CompositionEnv,
  deriveDuration,
} from './composition';

/** A portable snapshot of the program: its source files and entry path. */
export interface RuntimeBundle {
  /** Absolute virtual path → source text. */
  files: Record<string, string>;
  /** Entry module path (e.g. `/index.ts`). */
  entry: string;
}

/** A built, initialized composition graph plus a teardown. */
export interface BuiltComposition {
  compositor: Compositor;
  audioEngine: AudioEngine;
  /** True when the composition supplied its own audio (vs. the synthesized empty
   * engine) — lets a renderer decide whether to mux an audio track. */
  hasAudio: boolean;
  /** Timeline duration in seconds (builder value, else derived from clip ends). */
  duration: number;
  /** Dispose the compositor and its audio engine. */
  dispose(): void;
}

/** A live preview: the built graph, its clock, and media-element-style controls. */
export interface PreviewHandle {
  readonly built: BuiltComposition;
  readonly clock: RealtimeClock;
  readonly view: HTMLCanvasElement;
  readonly duration: number;
  play(): void;
  pause(): void;
  seek(t: number): void;
  readonly playing: boolean;
  dispose(): void;
}

const DEFAULT_ENV: CompositionEnv = { compositorOptions: {}, target: 'export' };

/**
 * Re-links + runs the program for a given environment and returns its
 * {@link Composition}. The runtime supplies this so each build gets a fresh graph
 * whose engine `Compositor` already has the environment's options folded in —
 * which is why user code just writes `new Compositor({ width, height, timebase })`
 * with no env plumbing.
 */
export type CompositionLinker = (env: CompositionEnv) => Composition;

export class Composer {
  constructor(
    private readonly link: CompositionLinker,
    private readonly bundle: RuntimeBundle,
  ) {}

  /** The entry module path the program ran from. */
  get entry(): string {
    return this.bundle.entry;
  }

  /** The source files, as a fresh copy (edit freely; the Composer keeps its own). */
  get files(): Record<string, string> {
    return { ...this.bundle.files };
  }

  /**
   * The portable code bundle to hand to server-side rendering: the same files +
   * entry, run by a runtime on the server. This replaces "serialize a spec" —
   * the code itself is what ships, so there's no schema to drift.
   */
  toBundle(): RuntimeBundle {
    return { files: { ...this.bundle.files }, entry: this.bundle.entry };
  }

  /** `JSON.stringify(composer)` yields the portable bundle. */
  toJSON(): RuntimeBundle {
    return this.toBundle();
  }

  /**
   * Run the builder to a fresh, initialized graph. The caller owns the result and
   * must {@link BuiltComposition.dispose} it. `env` lets a host inject a renderer
   * (Node) or an output scale; it defaults to the browser (`{}`).
   */
  async build(env: Partial<CompositionEnv> = {}): Promise<BuiltComposition> {
    const fullEnv: CompositionEnv = { ...DEFAULT_ENV, ...env };
    // Re-link per build so the graph is fresh AND its Compositor already carries
    // this environment's options (see CompositionLinker).
    const result = await this.link(fullEnv).build(fullEnv);
    const compositor = result.compositor;
    const duration = result.duration ?? deriveDuration(compositor);
    // Exporter needs an AudioEngine; synthesize an empty one when the composition
    // has no audio so audio-less compositions still export.
    const audioEngine = result.audioEngine ?? new AudioEngine(new Timebase(30));
    return {
      compositor,
      audioEngine,
      hasAudio: result.audioEngine !== undefined,
      duration,
      dispose() {
        audioEngine.dispose();
        compositor.dispose();
      },
    };
  }

  /**
   * Build the graph and start a preview loop. If `container` is given the
   * compositor's canvas is appended to it. Returns a {@link PreviewHandle} with
   * play/pause/seek; the first frame renders immediately so the canvas is never
   * blank before playback starts.
   */
  async preview(container?: HTMLElement, env: Partial<CompositionEnv> = {}): Promise<PreviewHandle> {
    const built = await this.build({ target: 'preview', ...env });
    const { compositor, audioEngine, duration } = built;
    const view = compositor.view;
    if (container) container.append(view);

    const clock = new RealtimeClock();
    clock.duration = duration;
    let playing = false;

    const tick: Subscription = clock.onTick((t) => compositor.renderPreview(t));
    const ended: Subscription = clock.onEnded(() => {
      playing = false;
      audioEngine.pause();
    });

    clock.seek(0);
    compositor.renderPreview(0);

    return {
      built,
      clock,
      view,
      duration,
      get playing() {
        return playing;
      },
      play() {
        playing = true;
        clock.play();
        audioEngine.play(clock.currentTime);
      },
      pause() {
        playing = false;
        clock.pause();
        audioEngine.pause();
      },
      seek(t: number) {
        clock.seek(t);
        compositor.renderPreview(clock.currentTime);
        if (playing) audioEngine.seek(clock.currentTime);
      },
      dispose() {
        playing = false;
        tick.unsubscribe();
        ended.unsubscribe();
        clock.pause();
        built.dispose();
      },
    };
  }

  /**
   * Render the composition to a video `Blob` in the client. Builds a fresh graph,
   * runs the engine's {@link Exporter} over `[0, duration]`, then disposes it.
   */
  async export(
    options: Partial<ExportOptions> = {},
    onProgress?: (progress: number) => void,
  ): Promise<Blob> {
    const built = await this.build({ target: 'export' });
    try {
      const exporter = new Exporter(built.compositor, built.audioEngine);
      return await exporter.export(
        { fps: 30, range: [0, built.duration], audio: false, ...options },
        onProgress,
      );
    } finally {
      built.dispose();
    }
  }
}
