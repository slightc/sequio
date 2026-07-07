/**
 * The {@link Runtime}: compile + run a multi-file TS/JS program and hand back a
 * {@link Composer}.
 *
 * It wires a {@link ModuleRuntime} (the CommonJS linker) over a
 * {@link FileSystem} (in-memory by default, or a real one injected by the host)
 * and injects two bare modules so user code reads like a demo:
 *  - `@video-editor-canvas/engine` → the **real engine namespace**, so the program
 *    can `import { Compositor, VisualTrack, TextClip } from '@video-editor-canvas/engine'`
 *    and `new` them (and subclass `Clip` / `Effect` for its own primitives);
 *  - `@video-editor-canvas/runtime` → `defineComposition`, to tag its builder.
 *
 * It runs the entry and normalizes its default export into a `Composer`. The
 * entry's default export (or the module itself) may be:
 *  - a {@link Composition} from `defineComposition(builder)`, or
 *  - a bare builder function `(env) => { compositor, duration }`.
 */
import * as engine from '@video-editor-canvas/engine';
import { Composer, type RuntimeBundle } from './composer';
import {
  COMPOSITION_TAG,
  type Composition,
  type CompositionBuilder,
  defineComposition,
  isComposition,
} from './composition';
import { ModuleRuntime, type Externals } from './module-runtime';
import { InMemoryFileSystem, type FileSystem } from './vfs';

/** The module object exposed to sandboxed code as `@video-editor-canvas/runtime`. */
export const RUNTIME_MODULE_API = {
  defineComposition,
  isComposition,
  COMPOSITION_TAG,
};

/** Bare specifier under which the authoring API is injected. */
export const RUNTIME_MODULE_ID = '@video-editor-canvas/runtime';
/** Bare specifier under which the engine namespace is injected. */
export const ENGINE_MODULE_ID = '@video-editor-canvas/engine';

export interface RuntimeOptions {
  /** Source files. Either a ready {@link FileSystem} or a path→content map. */
  files?: FileSystem | Record<string, string>;
  /** Entry module path. @default '/index.ts' (falls back to `/index.js`, `/main.ts`). */
  entry?: string;
  /**
   * Extra bare modules user code may `import`. Merged over the built-in
   * `@video-editor-canvas/engine` and `@video-editor-canvas/runtime` modules
   * (host entries win on key collision), so a host can expose more libraries.
   */
  externals?: Externals;
}

const DEFAULT_ENTRIES = ['/index.ts', '/index.tsx', '/index.js', '/main.ts', '/main.js'];

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
  private readonly externals: Externals;

  constructor(options: RuntimeOptions = {}) {
    this.fs = toFileSystem(options.files);
    this.entry = options.entry;
    this.externals = {
      [ENGINE_MODULE_ID]: engine,
      [RUNTIME_MODULE_ID]: RUNTIME_MODULE_API,
      ...options.externals,
    };
  }

  /** The filesystem backing this runtime (add/edit files then re-`run`). */
  get fileSystem(): FileSystem {
    return this.fs;
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

  /**
   * Compile + run the program and return the {@link Composition} its entry
   * produced (the tagged builder), without wrapping it in a `Composer`.
   */
  runToComposition(): Composition {
    const modules = new ModuleRuntime({ fs: this.fs, externals: this.externals });
    return compositionFromExports(modules.run(this.resolveEntry()));
  }

  /** Compile + run the program and wrap its result in a {@link Composer}. */
  async run(): Promise<Composer> {
    const entry = this.resolveEntry();
    const composition = this.runToComposition();
    return new Composer(composition, this.toBundle(entry));
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
