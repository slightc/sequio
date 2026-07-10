/**
 * `sequio check <file>` — **GPU-free static validation** of a composition.
 *
 * The first ring of the code path's closed verify loop `check → frame → render`:
 * `check` compiles + links + runs the builder to build the object graph, then
 * walks it for the classes of mistake that are cheap to catch offline — illegal
 * clip times, dead keyframes, an unregistered font, a transition whose clips
 * don't overlap, an out-of-range anchor, a missing local asset. It **never
 * renders** and **never needs WebGPU**: a null renderer is injected so
 * `await compositor.init()` resolves with no GPU, font loading is neutralized to
 * registration-only (no `FontFace`, no network), and media sources are only
 * checked for existence — never decoded.
 *
 * Green `check` doesn't prove the picture is right (that's `sequio frame`); a red
 * `check` means don't bother rendering yet.
 *
 * Its core (`checkBundle`) has no Node-only dependencies, so it unit-tests
 * headlessly against an in-memory bundle; `runCheck` is the thin disk front-end
 * (read the project → check → print → exit code).
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Renderer } from '@sequio/engine';
import {
  Clip,
  Compositor,
  fonts,
  FontManager,
  GroupClip,
  TextClip,
  VisualClip,
  VisualTrack,
} from '@sequio/engine';
import {
  type AssetLoader,
  type CompositionEnv,
  type Externals,
  ModuleResolutionError,
  type RuntimeBundle,
  Runtime,
} from '@sequio/runtime';
import { readBundle } from './bundle';
import { cliExternals } from './externals';

/** A single validation finding. */
export interface Diagnostic {
  /** `error` fails the check (non-zero exit); `warn` is advisory. */
  severity: 'error' | 'warn';
  /** Stable code (`A1`…`C9`) identifying the check that fired. */
  code: string;
  /** Human-readable explanation. */
  message: string;
  /** Where in the object graph it was found (e.g. `track 0 · clip 2 (TextClip)`). */
  at?: string;
}

export interface CheckBundleOptions {
  /** Extra bare modules the composition may import (e.g. `{ gsap }`). */
  externals?: Externals;
  /**
   * Existence predicate for `loadAsset('./x.mp4')` paths (normalized,
   * root-relative). Returns `false` → a C7 "asset not found" diagnostic. Omit to
   * skip asset-existence checking (in-memory tests have no disk).
   */
  assetExists?: (path: string) => boolean;
}

/**
 * CSS generic families + keywords that legitimately resolve without a
 * `fonts.load(...)` — the default `TextClip` family is `sans-serif`, so these
 * must never warn.
 */
const GENERIC_FAMILIES = new Set([
  'sans-serif',
  'serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'inherit',
  'initial',
  'unset',
]);

/**
 * A headless no-op {@link Renderer}: `init()` resolves without a GPU and nothing
 * ever draws (check reconciles no frames). Injected via
 * `CompositorOptions.createRenderer`, so `await compositor.init()` in a builder
 * completes on a machine with no Vulkan at all.
 */
export function nullRenderer(): Promise<Renderer> {
  const noop = (): void => {};
  return Promise.resolve({ render: noop, resize: noop, destroy: noop } as unknown as Renderer);
}

/**
 * Install just enough browser globals for a composition **builder** to run
 * headlessly — specifically PixiJS text measurement (`document` + a 2D canvas
 * whose `measureText` returns an approximate advance) and `createImageBitmap`
 * (a 1×1 stub — check never decodes). This is deliberately **dependency-free and
 * offline**: it neither loads `jsdom`/`@napi-rs/canvas` (that's Route B's job for
 * a real render) nor stubs `fetch`, so a builder that fetches a remote asset
 * still fails loudly rather than silently "passing" a check it never ran.
 *
 * Every global is only defined when absent, so this is a no-op in a real browser
 * (studio, the preview page) and idempotent across calls. Approximate metrics
 * are fine: `check` validates the object graph's shape, not pixels.
 */
function installHeadlessDom(): void {
  const g = globalThis as Record<string, unknown>;
  g.createImageBitmap ??= async () => ({ width: 1, height: 1, close() {} });

  // Pixi type-guards its canvas/context via `instanceof`, so provide real classes.
  class CanvasRenderingContext2D {}
  class HTMLCanvasElement {}
  class HTMLImageElement {}
  g.CanvasRenderingContext2D ??= CanvasRenderingContext2D;
  g.HTMLCanvasElement ??= HTMLCanvasElement;
  g.HTMLImageElement ??= HTMLImageElement;

  const CtxClass = g.CanvasRenderingContext2D as new () => Record<string, unknown>;
  const CanvasClass = g.HTMLCanvasElement as new () => Record<string, unknown>;

  const makeCtx = (canvas: unknown): Record<string, unknown> =>
    Object.assign(new CtxClass(), {
      canvas,
      font: '10px sans-serif',
      textBaseline: 'alphabetic',
      fillStyle: '#000',
      strokeStyle: '#000',
      lineWidth: 1,
      globalAlpha: 1,
      // A monospace-ish advance is enough for split/layout math; check never paints.
      measureText: (t: string) => {
        const w = (t?.length ?? 0) * 8;
        return {
          width: w,
          actualBoundingBoxAscent: 8,
          actualBoundingBoxDescent: 2,
          actualBoundingBoxLeft: 0,
          actualBoundingBoxRight: w,
          fontBoundingBoxAscent: 8,
          fontBoundingBoxDescent: 2,
        };
      },
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(Math.max(1, w) * Math.max(1, h) * 4),
        width: w,
        height: h,
      }),
      createLinearGradient: () => ({ addColorStop() {} }),
      createPattern: () => null,
      fillText() {}, strokeText() {}, clearRect() {}, fillRect() {}, save() {}, restore() {},
      scale() {}, translate() {}, rotate() {}, beginPath() {}, closePath() {}, moveTo() {},
      lineTo() {}, arc() {}, fill() {}, stroke() {}, putImageData() {}, drawImage() {},
      setTransform() {}, transform() {}, rect() {}, clip() {},
    });

  const makeCanvas = (): Record<string, unknown> => {
    const c = new CanvasClass() as Record<string, unknown>;
    let ctx: Record<string, unknown> | undefined;
    return Object.assign(c, {
      width: 1,
      height: 1,
      style: {},
      getContext: (kind: string) => (kind === '2d' ? (ctx ??= makeCtx(c)) : null),
      addEventListener() {}, removeEventListener() {},
      toDataURL: () => 'data:,',
    });
  };

  if (g.document === undefined) {
    g.document = {
      createElement: (tag: string) =>
        tag === 'canvas'
          ? makeCanvas()
          : { style: {}, appendChild() {}, addEventListener() {}, removeEventListener() {} },
      createElementNS: () => makeCanvas(),
      documentElement: { style: {} },
      body: { appendChild() {}, style: {} },
      head: { appendChild() {} },
      addEventListener() {}, removeEventListener() {},
      fonts: { add() {}, load: async () => [], ready: Promise.resolve() },
    };
  }
  g.OffscreenCanvas ??= class {
    width: number;
    height: number;
    constructor(w?: number, h?: number) {
      this.width = w ?? 1;
      this.height = h ?? 1;
    }
    getContext(kind: string): unknown {
      return kind === '2d' ? makeCtx(this) : null;
    }
  };
}

/**
 * Retarget the global {@link FontManager}'s (overridable) load hooks to no-ops so
 * a composition's `fonts.load(...)` / `fonts.loadGoogleFont(...)` **registers the
 * family** (for C4) without constructing a `FontFace` (absent in Node) or hitting
 * the network. Idempotent; mirrors `bridgeFontManagerToNode` but for validation.
 */
function neutralizeFontLoading(): void {
  const proto = FontManager.prototype as unknown as {
    loadFace(): Promise<void>;
    loadGoogle(): Promise<void>;
  };
  proto.loadFace = () => Promise.resolve();
  proto.loadGoogle = () => Promise.resolve();
}

/** Whether `n` is a usable finite time (not `NaN`/`undefined`/`Infinity`). */
function finiteTime(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * A build-time failure that reflects `check`'s **offline, GPU-free** limits
 * rather than a composition bug: the builder decodes media, fetches a remote
 * asset, or builds a GPU texture — things `check` deliberately doesn't do. These
 * become a `warn` (B4), not an error, so a perfectly renderable composition isn't
 * falsely failed; the user is told to verify the picture with `sequio frame`.
 */
const ENV_LIMIT = /createImageBitmap|source type for resource|ImageBitmap|VideoFrame|GPU|WebGL|texture|decode|fetch|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|Forbidden|\b4\d\d\b|\b5\d\d\b|network/i;

/** Classify a compile/link/build error into a Stage A/B diagnostic. */
function classifyError(err: unknown, phase: 'link' | 'build'): Diagnostic {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof ModuleResolutionError) {
    const bare = !/^[./]/.test(err.specifier);
    return bare
      ? {
          severity: 'error',
          code: 'A3',
          message: `external module '${err.specifier}' is not injected — provide it via externals (the CLI ships gsap): ${message}`,
        }
      : { severity: 'error', code: 'A2', message: `relative import does not resolve: ${message}` };
  }
  if (/must export|defineComposition|builder function/i.test(message)) {
    return { severity: 'error', code: 'A4', message };
  }
  if (/not implemented/i.test(message)) {
    return {
      severity: 'error',
      code: 'B2',
      message: `hit an unimplemented path (throws instead of rendering a black frame): ${message}`,
    };
  }
  if (phase === 'build' && ENV_LIMIT.test(message)) {
    return {
      severity: 'warn',
      code: 'B4',
      message:
        `builder needs a capability check runs without (media decode / network / GPU texture) — ` +
        `the code compiled and linked; verify the picture with \`sequio frame\`: ${message}`,
    };
  }
  return phase === 'build'
    ? { severity: 'error', code: 'B1', message: `builder threw: ${message}` }
    : { severity: 'error', code: 'A1', message };
}

/**
 * Validate a {@link RuntimeBundle} and return every {@link Diagnostic} found.
 * Pure and GPU-free — the unit-testable core behind `runCheck`.
 */
export async function checkBundle(
  bundle: RuntimeBundle,
  options: CheckBundleOptions = {},
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  installHeadlessDom();
  neutralizeFontLoading();

  // A composition's `loadAsset('./x')` is recorded (C7) and handed a placeholder
  // Blob — check never decodes, so the bytes are irrelevant; this just lets the
  // builder proceed so later stages can still run.
  const missingAssets: string[] = [];
  const loadAsset: AssetLoader = async (path) => {
    if (options.assetExists && !options.assetExists(path)) missingAssets.push(path);
    return new Blob([new Uint8Array([0])]);
  };

  const runtime = new Runtime({
    files: bundle.files,
    entry: bundle.entry,
    externals: options.externals,
    loadAsset,
  });
  const env: CompositionEnv = {
    compositorOptions: { createRenderer: nullRenderer },
    target: 'server',
  };

  // ── Stage A — compile + link + run module bodies + normalize the entry ──
  let composition;
  try {
    composition = runtime.link(env);
  } catch (err) {
    diagnostics.push(classifyError(err, 'link'));
    return diagnostics; // can't build without a composition
  }

  // ── Stage B — run the builder (null renderer, no GPU) ──
  let result;
  try {
    result = await composition.build(env);
  } catch (err) {
    diagnostics.push(classifyError(err, 'build'));
    return diagnostics;
  }
  if (!result || !(result.compositor instanceof Compositor)) {
    diagnostics.push({
      severity: 'error',
      code: 'B1',
      message: 'builder did not return { compositor } (an initialized Compositor)',
    });
    return diagnostics;
  }
  const compositor = result.compositor;

  // B3 — the builder forgot `await compositor.init()`: the graph builds but a
  // real render would produce nothing.
  if (!compositor.isInitialized) {
    diagnostics.push({
      severity: 'error',
      code: 'B3',
      message: 'compositor was never initialized — add `await compositor.init()` in the builder',
    });
  }

  for (const path of missingAssets) {
    diagnostics.push({ severity: 'error', code: 'C7', message: `local asset not found: ${path}` });
  }

  // ── Stage C — walk the built graph ──
  checkGraph(compositor, result.duration, diagnostics);

  try {
    compositor.dispose();
  } catch {
    /* disposing a partially-built graph shouldn't mask real findings */
  }
  return diagnostics;
}

/** Traverse every track / clip / transition of a built compositor (Stage C). */
function checkGraph(
  compositor: Compositor,
  declaredDuration: number | undefined,
  out: Diagnostic[],
): void {
  const registered = new Set(fonts.families());
  const tracks = compositor.getTracks();
  tracks.forEach((track, ti) => {
    track.clips.forEach((clip, ci) => {
      checkClip(clip, `track ${ti} · clip ${ci}`, declaredDuration, registered, out);
    });
    if (track instanceof VisualTrack) {
      track.transitions.forEach((transition, xi) => {
        checkTransition(transition, track.clips, `track ${ti} · transition ${xi}`, out);
      });
    }
  });
}

/** Validate one clip (recurses into {@link GroupClip} children). */
function checkClip(
  clip: Clip,
  at: string,
  declaredDuration: number | undefined,
  registered: Set<string>,
  out: Diagnostic[],
): void {
  const label = `${at} (${clip.constructor.name})`;

  // C1 — timeline interval sanity.
  if (!finiteTime(clip.start) || !finiteTime(clip.end)) {
    out.push({ severity: 'error', code: 'C1', message: `clip start/end is not a finite number`, at: label });
  } else {
    if (clip.start < 0) {
      out.push({ severity: 'error', code: 'C1', message: `clip start < 0 (${clip.start})`, at: label });
    }
    if (clip.end <= clip.start) {
      out.push({
        severity: 'error',
        code: 'C1',
        message: `clip end ≤ start (start=${clip.start}, end=${clip.end})`,
        at: label,
      });
    }
    // C3 — end past the declared timeline duration (only meaningful if declared).
    if (declaredDuration !== undefined && finiteTime(declaredDuration) && clip.end > declaredDuration) {
      out.push({
        severity: 'error',
        code: 'C3',
        message: `clip end (${clip.end}) exceeds the declared duration (${declaredDuration})`,
        at: label,
      });
    }
    // C9 — trim window sanity (best-effort; media metadata isn't fetched).
    if (finiteTime(clip.sourceIn) && finiteTime(clip.sourceOut) && clip.sourceOut > 0 && clip.sourceOut < clip.sourceIn) {
      out.push({
        severity: 'warn',
        code: 'C9',
        message: `sourceOut (${clip.sourceOut}) is before sourceIn (${clip.sourceIn})`,
        at: label,
      });
    }
  }

  if (clip instanceof VisualClip) {
    checkVisualClip(clip, label, registered, out);
  }
  if (clip instanceof GroupClip) {
    // Children live in the group's local time frame — validate their own interval
    // relative to the group span, but reuse the same per-clip checks.
    clip.children.forEach((child, i) => {
      checkClip(child, `${at} · child ${i}`, undefined, registered, out);
    });
  }
}

/** Keyframe-bounds (C2), anchor-range (C8) and font-registration (C4) checks. */
function checkVisualClip(clip: VisualClip, label: string, registered: Set<string>, out: Diagnostic[]): void {
  const start = clip.start;
  const end = clip.end;
  const boundsKnown = finiteTime(start) && finiteTime(end) && end > start;

  // C2 — every keyframed channel's keyframes must land inside [start, end].
  const channels: Array<{ name: string; times: readonly number[] }> = [
    { name: 'position', times: clip.transform.position.keyframeTimes },
    { name: 'scale', times: clip.transform.scale.keyframeTimes },
    { name: 'rotation', times: clip.transform.rotation.keyframeTimes },
    { name: 'anchor', times: clip.transform.anchor.keyframeTimes },
    { name: 'opacity', times: clip.opacity.keyframeTimes },
  ];
  if (clip instanceof TextClip) channels.push({ name: 'fontSize', times: clip.fontSize.keyframeTimes });
  if (boundsKnown) {
    for (const { name, times } of channels) {
      for (const t of times) {
        if (t < start || t > end) {
          out.push({
            severity: 'error',
            code: 'C2',
            message: `${name} keyframe at t=${t} falls outside the clip's [${start}, ${end}] — dead keyframe`,
            at: label,
          });
        }
      }
    }
  }

  // C8 — anchor is normalized (0..1); a pixel value mistaken for it is off-screen.
  const anchor = clip.transform.anchor;
  const sampleTimes = anchor.keyframeTimes.length ? anchor.keyframeTimes : [boundsKnown ? start : 0];
  for (const t of sampleTimes) {
    const [ax, ay] = anchor.valueAt(t);
    if (ax < -1e-6 || ax > 1 + 1e-6 || ay < -1e-6 || ay > 1 + 1e-6) {
      out.push({
        severity: 'error',
        code: 'C8',
        message: `anchor [${ax}, ${ay}] is outside 0..1 (anchor is normalized, not pixels)`,
        at: label,
      });
      break; // one report per clip is enough
    }
  }

  // C4 — a TextClip referencing a family no fonts.load registered silently falls
  // back to a system font, breaking preview↔render parity (contract #3).
  if (clip instanceof TextClip) {
    const families = clip.fontFamily
      .split(',')
      .map((f) => f.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
    const resolved = families.some((f) => GENERIC_FAMILIES.has(f.toLowerCase()) || registered.has(f));
    if (!resolved && families.length > 0) {
      out.push({
        severity: 'warn',
        code: 'C4',
        message: `font-family "${clip.fontFamily}" is not registered via fonts.load(...) — will fall back to a system font (preview may differ from render)`,
        at: label,
      });
    }
  }
}

/** A transition must bind two clips on the same track that actually overlap (C5). */
function checkTransition(
  transition: { from: VisualClip | null; to: VisualClip | null; windowAt(): unknown },
  clips: readonly VisualClip[],
  at: string,
  out: Diagnostic[],
): void {
  const { from, to } = transition;
  if (!from || !to) {
    out.push({ severity: 'error', code: 'C5', message: `transition is not bound to two clips (call .between(a, b))`, at });
    return;
  }
  if (!clips.includes(from) || !clips.includes(to)) {
    out.push({
      severity: 'error',
      code: 'C5',
      message: `transition binds clips that are not both on this track`,
      at,
    });
    return;
  }
  if (transition.windowAt() == null) {
    out.push({
      severity: 'error',
      code: 'C5',
      message: `transition clips do not overlap — the transition window is empty (overlap [${from.start}, ${from.end}] with [${to.start}, ${to.end}])`,
      at,
    });
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface CheckOptions {
  /** Emit machine-readable `Diagnostic[]` JSON instead of human lines. */
  json?: boolean;
}

/**
 * Statically check `entryFile` and return the process exit code (0 = no errors,
 * 1 = at least one `error`). `warn`-only results still exit 0. Prints a
 * human-readable summary, or a `Diagnostic[]` JSON array with `--json`.
 */
export async function runCheck(entryFile: string, options: CheckOptions = {}): Promise<number> {
  let diagnostics: Diagnostic[];
  try {
    const bundle = readBundle(entryFile);
    const projectRoot = dirname(resolve(entryFile));
    diagnostics = await checkBundle(bundle, {
      externals: cliExternals(),
      assetExists: (path) => existsSync(resolve(projectRoot, path)),
    });
  } catch (err) {
    // A failure to even read the project (missing entry file) is itself a finding.
    diagnostics = [{ severity: 'error', code: 'A0', message: message(err) }];
  }

  const errors = diagnostics.filter((d) => d.severity === 'error');
  const warns = diagnostics.filter((d) => d.severity === 'warn');

  if (options.json) {
    console.log(JSON.stringify(diagnostics, null, 2));
    return errors.length > 0 ? 1 : 0;
  }

  for (const d of diagnostics) {
    const icon = d.severity === 'error' ? '✖' : '⚠';
    const where = d.at ? ` [${d.at}]` : '';
    console.error(`${icon} ${d.code}${where}: ${d.message}`);
  }
  if (errors.length === 0) {
    const suffix = warns.length ? ` (${warns.length} warning${warns.length === 1 ? '' : 's'})` : '';
    console.log(`✅ check passed: ${entryFile}${suffix}`);
    return 0;
  }
  console.error(
    `\n✖ check failed: ${errors.length} error${errors.length === 1 ? '' : 's'}` +
      `${warns.length ? `, ${warns.length} warning${warns.length === 1 ? '' : 's'}` : ''}.`,
  );
  return 1;
}
