/**
 * The {@link Runtime}: compile + run a multi-file TS/JS program and hand back a
 * {@link Composer}.
 *
 * It wires a {@link ModuleRuntime} (the CommonJS linker) over a
 * {@link FileSystem} (in-memory by default, or a real one injected by the host),
 * injects the runtime's own authoring API as the bare module
 * `@video-editor-canvas/runtime` so user code can `import { defineComposition }`,
 * runs the entry file, and normalizes whatever it exports into a `Composer`.
 *
 * The entry's default export (or the module itself) may be:
 *  - a {@link Composition} from `defineComposition(...)`,
 *  - a bare {@link TimelineSpec} object, or
 *  - a function returning either (optionally async).
 */
import type { TimelineSpec } from '@video-editor-canvas/server';
import { Composer } from './composer';
import {
  COMPOSITION_TAG,
  defineComposition,
  isComposition,
  isTimelineSpec,
  type Composition,
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

export interface RuntimeOptions {
  /** Source files. Either a ready {@link FileSystem} or a path→content map. */
  files?: FileSystem | Record<string, string>;
  /** Entry module path. @default '/index.ts' (falls back to `/index.js`, `/main.ts`). */
  entry?: string;
  /**
   * Extra bare modules user code may `import`. Merged over the built-in
   * `@video-editor-canvas/runtime` API (host entries win on key collision), so a
   * host can expose e.g. the engine namespace or shared constants.
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

/** Coerce whatever the entry exported into a {@link TimelineSpec}. */
async function specFromExports(exported: unknown): Promise<TimelineSpec> {
  // Unwrap an ES-module default (`export default …` under CJS interop).
  let value = exported;
  if (value && typeof value === 'object' && 'default' in (value as Record<string, unknown>)) {
    value = (value as Record<string, unknown>).default;
  }
  // A factory function (sync or async).
  if (typeof value === 'function') value = await (value as () => unknown)();
  if (value && typeof (value as Promise<unknown>).then === 'function') value = await value;

  if (isComposition(value)) return value.spec;
  if (isTimelineSpec(value)) return value;

  throw new Error(
    'Entry module must export (as default) a Composition from defineComposition() or a TimelineSpec object.',
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

  /**
   * Compile + run the program and return the {@link TimelineSpec} its entry
   * produced. Separated from {@link run} so callers that only want the spec
   * (e.g. to download for server render) don't build a `Composer`.
   */
  async runToSpec(): Promise<TimelineSpec> {
    const modules = new ModuleRuntime({ fs: this.fs, externals: this.externals });
    const exported = modules.run(this.resolveEntry());
    return specFromExports(exported);
  }

  /** Compile + run the program and wrap its result in a {@link Composer}. */
  async run(): Promise<Composer> {
    return new Composer(await this.runToSpec());
  }
}

/**
 * One-shot convenience: build a {@link Runtime} from `files`/options and run it.
 *
 * ```ts
 * const composer = await runComposition({ '/index.ts': "export default defineComposition({...})" });
 * await composer.preview(document.body);
 * ```
 */
export async function runComposition(
  files: RuntimeOptions['files'],
  options: Omit<RuntimeOptions, 'files'> = {},
): Promise<Composer> {
  return new Runtime({ files, ...options }).run();
}
