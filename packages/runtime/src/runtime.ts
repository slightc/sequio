/**
 * The {@link Runtime}: compile + run a multi-file TS/JS program and hand back a
 * {@link Composer}.
 *
 * It wires a {@link ModuleRuntime} (the CommonJS linker) over a
 * {@link FileSystem} (in-memory by default, or a real one injected by the host)
 * and injects two bare modules so user code reads like a demo:
 *  - `@sequio/engine` → the **real engine namespace**, so the program
 *    can `import { Compositor, VisualTrack, TextClip } from '@sequio/engine'`
 *    and `new` them (and subclass `Clip` / `Effect` for its own primitives);
 *  - `@sequio/runtime` → `defineComposition`, to tag its builder.
 *
 * It runs the entry and normalizes its default export into a `Composer`. The
 * entry's default export (or the module itself) may be:
 *  - a {@link Composition} from `defineComposition(builder)`, or
 *  - a bare builder function `(env) => { compositor, duration }`.
 */
import * as engine from '@sequio/engine';
import type { CompositorOptions } from '@sequio/engine';
import { Composer, type RuntimeBundle } from './composer';
import { compileModule } from './compile';
import {
  COMPOSITION_TAG,
  type Composition,
  type CompositionBuilder,
  type CompositionEnv,
  defineComposition,
  isComposition,
} from './composition';
import { ModuleRuntime, type Externals } from './module-runtime';
import { InMemoryFileSystem, type FileSystem } from './vfs';
import { type AssetLoader, NO_ASSET_LOADER, resolveAssetPath } from './assets';
import type { RuntimeEnv } from './env';

/**
 * The module object exposed to sandboxed code as `@sequio/runtime`.
 *
 * `loadAsset` here is the *default* (no host loader → throws {@link NO_ASSET_LOADER});
 * a {@link Runtime} instance overrides it with the host's {@link AssetLoader} so a
 * composition's `loadAsset('./clip.mp4')` reaches real bytes.
 */
export const RUNTIME_MODULE_API = {
  defineComposition,
  isComposition,
  COMPOSITION_TAG,
  loadAsset: NO_ASSET_LOADER,
};

/** Bare specifier under which the authoring API is injected. */
export const RUNTIME_MODULE_ID = '@sequio/runtime';
/** Bare specifier under which the engine namespace is injected. */
export const ENGINE_MODULE_ID = '@sequio/engine';

export interface RuntimeOptions {
  /** Source files. Either a ready {@link FileSystem} or a path→content map. */
  files?: FileSystem | Record<string, string>;
  /** Entry module path. @default '/index.ts' (falls back to `/index.js`, `/main.ts`). */
  entry?: string;
  /**
   * Extra bare modules user code may `import`. Merged over the built-in
   * `@sequio/engine` and `@sequio/runtime` modules
   * (host entries win on key collision), so a host can expose more libraries.
   */
  externals?: Externals;
  /**
   * Resolver for **local media assets** a composition pulls in with
   * `loadAsset('./clip.mp4')` (imported from `@sequio/runtime`). The host maps a
   * project-relative path to its bytes as a `Blob`; the runtime normalizes the
   * path ({@link resolveAssetPath}) before calling it. Left unset, `loadAsset`
   * throws a clear error — assets are opt-in and never bundled. See
   * [`assets.ts`](./assets.ts).
   */
  loadAsset?: AssetLoader;
  /**
   * The host {@link RuntimeEnv} — one object bundling this runtime's one-time
   * `setup()`, its extra `externals`, its `loadAsset`, and the `compositorOptions`
   * folded into each build (an injected renderer, an output scale). Left unset,
   * the runtime runs in the plain browser default. Server-side rendering does not
   * use this seam — `@sequio/server`'s `serverEnv().setup()` bootstraps at the
   * engine layer, and the host passes `externals` / `loadAsset` directly (below).
   * Explicit `externals` / `loadAsset` win over the env's. See [`env.ts`](./env.ts).
   */
  env?: RuntimeEnv;
}

const DEFAULT_ENTRIES = ['/index.ts', '/index.tsx', '/index.js', '/main.ts', '/main.js'];

/**
 * A copy of the engine namespace whose `Compositor` folds `overrides` into every
 * construction. This is how `env.compositorOptions` is injected **implicitly**:
 * user code writes a plain `new Compositor({ width, height, timebase })` — exactly
 * like a demo — and a host (a Node WebGPU renderer, an output scale) still reaches
 * it. Overrides win on conflict so a server's `createRenderer` takes precedence.
 * With no overrides (the browser default) the real namespace is returned as-is.
 */
export function engineForEnv(overrides: Partial<CompositorOptions>): Externals[string] {
  if (Object.keys(overrides).length === 0) return engine;
  class RuntimeCompositor extends engine.Compositor {
    constructor(options: CompositorOptions) {
      super({ ...options, ...overrides });
    }
  }
  return { ...engine, Compositor: RuntimeCompositor };
}

function toFileSystem(files: RuntimeOptions['files']): FileSystem {
  if (!files) return new InMemoryFileSystem();
  if (files instanceof InMemoryFileSystem) return files;
  // Duck-type an injected real filesystem; otherwise treat it as a file map.
  if (typeof (files as FileSystem).readFile === 'function') return files as FileSystem;
  return new InMemoryFileSystem(files as Record<string, string>);
}

/** Coerce whatever the entry exported into a {@link Composition}. */
function compositionFromExports(exported: unknown): Composition {
  // Unwrap an ES-module default (`export default …` under CJS interop).
  let value = exported;
  if (value && typeof value === 'object' && 'default' in (value as Record<string, unknown>)) {
    value = (value as Record<string, unknown>).default;
  }
  if (isComposition(value)) return value;
  // A bare builder function is fine too — wrap it.
  if (typeof value === 'function') return defineComposition(value as CompositionBuilder);

  throw new Error(
    'Entry module must export (as default) a Composition from defineComposition(builder) or a builder function.',
  );
}

export class Runtime {
  private readonly fs: FileSystem;
  private readonly entry: string | undefined;
  /** Explicit `RuntimeOptions.externals` — win over the env's on key collision. */
  private readonly optionExternals: Externals | undefined;
  /** Explicit `RuntimeOptions.loadAsset` — wins over the env's. */
  private readonly optionLoadAsset: AssetLoader | undefined;
  /** The installed host {@link RuntimeEnv}, if any (see {@link setEnv}). */
  private env: RuntimeEnv | undefined;
  /** Injected bare modules, recomputed whenever the env changes. */
  private hostExternals!: Externals;
  /** Transpiled output cached across re-links (linking runs once per build). */
  private readonly compileCache = new Map<string, string>();

  constructor(options: RuntimeOptions = {}) {
    this.fs = toFileSystem(options.files);
    this.entry = options.entry;
    this.optionExternals = options.externals;
    this.optionLoadAsset = options.loadAsset;
    this.env = options.env;
    this.rebuildHostExternals();
  }

  /** The filesystem backing this runtime (add/edit files then re-`run`). */
  get fileSystem(): FileSystem {
    return this.fs;
  }

  /** The installed host {@link RuntimeEnv}, if any. */
  get environment(): RuntimeEnv | undefined {
    return this.env;
  }

  /**
   * Install (or replace, with `undefined`) the host {@link RuntimeEnv}. Rebuilds
   * the injected `externals` and asset loader from the new env; the env's
   * `setup()` + `compositorOptions` are consumed later by {@link Composer.build}.
   * Chainable — `new Runtime({ files }).setEnv(nodeServerEnv())`.
   */
  setEnv(env: RuntimeEnv | undefined): this {
    this.env = env;
    this.rebuildHostExternals();
    return this;
  }

  /**
   * Recompute the injected bare modules. The `@sequio/runtime` authoring module
   * (with the bound `loadAsset`) is the base; the env's `externals` layer over it;
   * an explicit `RuntimeOptions.externals` wins last, so a caller can still
   * override anything. `loadAsset`: explicit option, else env's, else the
   * clear-error stub.
   */
  private rebuildHostExternals(): void {
    const loadAsset = this.optionLoadAsset ?? this.env?.loadAsset ?? NO_ASSET_LOADER;
    const runtimeModule = {
      ...RUNTIME_MODULE_API,
      loadAsset: (path: string): Promise<Blob> => loadAsset(resolveAssetPath(path)),
    };
    this.hostExternals = {
      [RUNTIME_MODULE_ID]: runtimeModule,
      ...this.env?.externals,
      ...this.optionExternals,
    };
  }

  private resolveEntry(): string {
    if (this.entry) return this.entry;
    for (const candidate of DEFAULT_ENTRIES) if (this.fs.exists(candidate)) return candidate;
    throw new Error(
      `No entry module. Provide one, or add ${DEFAULT_ENTRIES.join(' / ')}. Have: ${
        this.fs.listFiles().join(', ') || '(no files)'
      }`,
    );
  }

  /** Snapshot the current files into a portable {@link RuntimeBundle}. */
  private toBundle(entry: string): RuntimeBundle {
    const files: Record<string, string> = {};
    for (const path of this.fs.listFiles()) {
      const content = this.fs.readFile(path);
      if (content !== null) files[path] = content;
    }
    return { files, entry };
  }

  private compile = (code: string, fileName: string): string => {
    const key = `${fileName} ${code}`;
    let out = this.compileCache.get(key);
    if (out === undefined) {
      out = compileModule(code, fileName).code;
      this.compileCache.set(key, out);
    }
    return out;
  };

  /**
   * Compile + link + run the entry for a given environment and return the
   * {@link Composition} it produced. Called once per build so the injected engine
   * `Compositor` carries that environment's options (implicit `compositorOptions`)
   * and each build gets independent module state. Transpilation is cached, so
   * re-linking only re-executes the (cheap) module bodies.
   */
  link(env: CompositionEnv): Composition {
    const externals: Externals = {
      [ENGINE_MODULE_ID]: engineForEnv(env.compositorOptions),
      ...this.hostExternals,
    };
    const modules = new ModuleRuntime({ fs: this.fs, externals, compile: this.compile });
    return compositionFromExports(modules.run(this.resolveEntry()));
  }

  /**
   * Compile + run the program and return the {@link Composition} its entry
   * produced (the tagged builder), without wrapping it in a `Composer`. Uses the
   * plain browser environment (no injected renderer).
   */
  runToComposition(): Composition {
    return this.link({ compositorOptions: {}, target: 'preview' });
  }

  /** Compile + run the program and wrap its result in a {@link Composer}. */
  async run(): Promise<Composer> {
    const entry = this.resolveEntry();
    // Link once up front so compile/link errors surface here (fail fast), not on
    // the first preview. The Composer re-links per build via `link`.
    this.runToComposition();
    return new Composer((env) => this.link(env), this.toBundle(entry), this.env);
  }
}

/**
 * One-shot convenience: build a {@link Runtime} from `files`/options and run it.
 *
 * ```ts
 * const composer = await runComposition({ '/index.ts': "export default defineComposition(async () => {…})" });
 * await composer.preview(document.body);
 * ```
 */
export async function runComposition(
  files: RuntimeOptions['files'],
  options: Omit<RuntimeOptions, 'files'> = {},
): Promise<Composer> {
  return new Runtime({ files, ...options }).run();
}
