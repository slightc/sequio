/**
 * `@sequio/runtime` — compile and run multi-file TS/JS into a
 * {@link Composer}.
 *
 * The runtime takes a set of source files (an in-memory {@link InMemoryFileSystem}
 * or an injected real one), transpiles each with the TypeScript compiler, links
 * them with a tiny CommonJS loader, and runs the entry. The program describes a
 * video **imperatively** — it `new`s the engine's own classes inside a
 * `defineComposition(builder)` (same style as the `example/` demos), so a user
 * can bring their own `Clip` / `Effect` subclasses with no schema to keep in
 * sync. The result is a {@link Composer} that previews and exports in the browser
 * and whose `toBundle()` (the source files themselves) is what feeds server-side
 * rendering — one object, three destinations.
 *
 * Everything here is browser-safe. A Node/real-filesystem adapter lives in
 * `@sequio/runtime/node-fs` (imports `node:fs`, kept out of this
 * barrel) so importing the runtime never drags Node built-ins into a bundle.
 */

// ── Virtual filesystem ──────────────────────────────────────────────────────
export {
  type FileSystem,
  InMemoryFileSystem,
  normalizePath,
  dirname,
  joinPath,
} from './vfs';

// ── Compile / link ──────────────────────────────────────────────────────────
export {
  compileModule,
  langOf,
  type CompileResult,
  type SourceLang,
} from './compile';
export {
  ModuleRuntime,
  ModuleResolutionError,
  type Externals,
  type ModuleRuntimeOptions,
} from './module-runtime';

// ── Local media assets ──────────────────────────────────────────────────────
export {
  type AssetLoader,
  resolveAssetPath,
  NO_ASSET_LOADER,
} from './assets';

// ── Authoring API ───────────────────────────────────────────────────────────
export {
  defineComposition,
  isComposition,
  deriveDuration,
  COMPOSITION_TAG,
  type Composition,
  type CompositionBuilder,
  type CompositionEnv,
  type CompositionResult,
} from './composition';

// ── Runtime & Composer ──────────────────────────────────────────────────────
export {
  Runtime,
  runComposition,
  RUNTIME_MODULE_API,
  RUNTIME_MODULE_ID,
  ENGINE_MODULE_ID,
  type RuntimeOptions,
} from './runtime';
export {
  Composer,
  type PreviewHandle,
  type RuntimeBundle,
  type BuiltComposition,
} from './composer';
