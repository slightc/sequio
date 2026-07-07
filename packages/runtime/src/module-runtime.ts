/**
 * A tiny **CommonJS module linker** over a {@link FileSystem}.
 *
 * Given a set of transpiled files (see `compile.ts`) it resolves `require`
 * calls two ways:
 *  - **relative** (`./foo`, `../bar`) → walked against the VFS with the usual
 *    extension/index candidates (`.ts`, `.tsx`, `.js`, `.jsx`, `.json`,
 *    `/index.*`);
 *  - **bare** (`@sequio/runtime`, `engine`, …) → looked up in an
 *    injected `externals` map so host-provided modules (the runtime's own
 *    authoring API, the engine namespace, …) are reachable without bundling.
 *
 * Modules are evaluated lazily and cached (CJS semantics: a module is inserted
 * into the cache before its body runs, so import cycles see a partial
 * `exports`). Everything here is pure control-flow over the VFS + a code
 * transform hook, so it unit-tests headlessly with no GPU or DOM.
 */
import { compileModule } from './compile';
import { dirname, joinPath, normalizePath, type FileSystem } from './vfs';

/** Extension/index candidates tried when a relative import omits them. */
const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'];

/** A module value keyed by a bare specifier the sandbox can `require`. */
export type Externals = Record<string, unknown>;

export interface ModuleRuntimeOptions {
  fs: FileSystem;
  /** Bare-specifier → module value (e.g. the runtime API, the engine). */
  externals?: Externals;
  /** Transform a source file to CommonJS. Defaults to {@link compileModule}. */
  compile?: (code: string, fileName: string) => string;
}

/** A resolution failure that names the specifier and the importer. */
export class ModuleResolutionError extends Error {
  constructor(
    readonly specifier: string,
    readonly from: string,
  ) {
    super(`Cannot resolve module '${specifier}' from '${from}'`);
    this.name = 'ModuleResolutionError';
  }
}

interface CjsModule {
  exports: unknown;
}

export class ModuleRuntime {
  private readonly fs: FileSystem;
  private readonly externals: Externals;
  private readonly compile: (code: string, fileName: string) => string;
  private readonly cache = new Map<string, CjsModule>();

  constructor(options: ModuleRuntimeOptions) {
    this.fs = options.fs;
    this.externals = options.externals ?? {};
    this.compile = options.compile ?? ((code, fileName) => compileModule(code, fileName).code);
  }

  /**
   * Resolve a relative specifier against the VFS to a concrete file path, or
   * `null` if nothing matches. Bare specifiers are handled by {@link require}
   * against `externals` and are not resolved here.
   */
  resolve(specifier: string, fromDir: string): string | null {
    const base = joinPath(fromDir, specifier);
    const candidates = [
      base,
      ...RESOLVE_EXTENSIONS.map((ext) => base + ext),
      ...RESOLVE_EXTENSIONS.map((ext) => normalizePath(`${base}/index${ext}`)),
    ];
    for (const candidate of candidates) {
      if (this.fs.exists(candidate)) return candidate;
    }
    return null;
  }

  /** Whether a specifier is bare (a package name, not a path). */
  private isBare(specifier: string): boolean {
    return !specifier.startsWith('./') && !specifier.startsWith('../') && !specifier.startsWith('/');
  }

  /**
   * `require` as seen from a module located at `fromPath`. Returns the resolved
   * module's `exports` (bare specifiers return the injected external verbatim).
   */
  require(specifier: string, fromPath: string): unknown {
    if (this.isBare(specifier)) {
      if (specifier in this.externals) return this.externals[specifier];
      throw new ModuleResolutionError(specifier, fromPath);
    }

    const resolved = this.resolve(specifier, dirname(fromPath));
    if (!resolved) throw new ModuleResolutionError(specifier, fromPath);
    return this.load(resolved);
  }

  /** Load (and cache) the module at an already-resolved absolute path. */
  load(path: string): unknown {
    const normalized = normalizePath(path);
    const cached = this.cache.get(normalized);
    if (cached) return cached.exports;

    const source = this.fs.readFile(normalized);
    if (source === null) throw new Error(`File not found: ${normalized}`);

    const module: CjsModule = { exports: {} };
    // Insert before executing so import cycles resolve to the partial exports.
    this.cache.set(normalized, module);

    const compiled = this.compile(source, normalized);
    const localRequire = (specifier: string): unknown => this.require(specifier, normalized);
    const dir = dirname(normalized);

    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const factory = new Function(
      'exports',
      'require',
      'module',
      '__filename',
      '__dirname',
      compiled,
    ) as (
      exports: unknown,
      require: (s: string) => unknown,
      module: CjsModule,
      filename: string,
      dirname: string,
    ) => void;

    try {
      factory(module.exports, localRequire, module, normalized, dir);
    } catch (err) {
      // Drop the half-run cache entry so a re-run recompiles cleanly.
      this.cache.delete(normalized);
      // A resolution failure (unknown import) propagates with its own type so
      // callers can distinguish "missing module" from a runtime throw.
      if (err instanceof ModuleResolutionError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Error executing module '${normalized}': ${message}`);
    }

    return module.exports;
  }

  /** Load the entry module and return its `exports`. */
  run(entryPath: string): unknown {
    const resolved = this.fs.exists(entryPath)
      ? normalizePath(entryPath)
      : this.resolve(entryPath.startsWith('.') ? entryPath : `./${entryPath}`, '/');
    if (!resolved) throw new Error(`Entry module not found: ${entryPath}`);
    return this.load(resolved);
  }
}
