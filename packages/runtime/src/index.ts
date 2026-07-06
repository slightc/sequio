/**
 * `@video-editor-canvas/runtime` — compile and run multi-file TS/JS into a
 * {@link Composer}.
 *
 * The runtime takes a set of source files (an in-memory {@link VirtualFileSystem}
 * or an injected real one), transpiles each with the TypeScript compiler, links
 * them with a tiny CommonJS loader, and runs the entry. The program describes a
 * video by default-exporting `defineComposition(spec)`; the result is a
 * {@link Composer} that previews and exports in the browser (via the engine) and
 * whose `toSpec()` feeds the server-side render routes — one object, three
 * destinations.
 *
 * Everything here is browser-safe. A Node/real-filesystem adapter lives in
 * `@video-editor-canvas/runtime/node-fs` (imports `node:fs`, kept out of this
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

// ── Authoring API ───────────────────────────────────────────────────────────
export {
  defineComposition,
  isComposition,
  isTimelineSpec,
  COMPOSITION_TAG,
  type Composition,
} from './composition';

// ── Runtime & Composer ──────────────────────────────────────────────────────
export {
  Runtime,
  runComposition,
  RUNTIME_MODULE_API,
  RUNTIME_MODULE_ID,
  type RuntimeOptions,
} from './runtime';
export { Composer, type PreviewHandle } from './composer';

// ── Re-exports for authoring convenience ────────────────────────────────────
// The timeline protocol lives in the server package; re-export the types so
// consumers can type their compositions from `@video-editor-canvas/runtime`
// alone. Type-only — nothing added to the bundle.
export type {
  TimelineSpec,
  TrackSpec,
  ClipSpec,
  TextClipSpec,
  ShapeClipSpec,
  ImageClipSpec,
  VideoClipSpec,
  AudioClipSpec,
  EffectSpec,
  TransformSpec,
  PropSpec,
  FontSpec,
  ExportSpec,
  EasingName,
  BuiltTimeline,
  BuildOverrides,
} from '@video-editor-canvas/server';
