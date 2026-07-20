/**
 * Node font loading for Route B. In a browser, fonts register into
 * `document.fonts`; in Node, PixiJS measures glyphs via `@napi-rs/canvas`, so
 * fonts must be registered with its `GlobalFonts` instead (the SDK's
 * `FontManager` is a no-op here). This is the `loadFonts` override passed to
 * `buildTimeline`.
 *
 * Supports self-hosted URLs and Google Fonts: for Google, fetch the css2
 * stylesheet, pull the font-file URLs out of it, fetch those and register them.
 */
import { buildGoogleCss2Url, FontManager, type FontSpec as EngineFontSpec, type GoogleFontSpec } from '@sequio/engine';

/**
 * The minimal font descriptor {@link loadFontsNode} registers: a self-hosted URL
 * or a Google Fonts request. Kept local so the server env owns no serializable
 * protocol — the `TimelineSpec`'s richer `FontSpec` (now in `@sequio/headless`) is
 * structurally compatible, so a headless caller can pass its specs straight in.
 */
export interface NodeFontSpec {
  family: string;
  /** Self-hosted URL. Mutually exclusive with {@link google}. */
  src?: string;
  /** Load from Google Fonts instead of a self-hosted URL. */
  google?: { weights?: number[]; italic?: boolean; cssBase?: string };
}

/**
 * Extract the font-file URLs from a Google Fonts css2 stylesheet. Pure and
 * testable — css2 returns one `@font-face { … src: url(X) … }` per subset/weight.
 */
export function parseGoogleFontUrls(css: string): string[] {
  const urls: string[] = [];
  const re = /src:\s*url\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    urls.push(m[1]!.replace(/["']/g, '').trim());
  }
  return urls;
}

/** A modern-but-plain UA so css2 serves TrueType `src` URLs (`@napi-rs/canvas`-friendly). */
const CSS2_UA = 'Mozilla/5.0';

/** Register every font a timeline references with `@napi-rs/canvas`'s GlobalFonts. */
export async function loadFontsNode(specs: NodeFontSpec[] | undefined): Promise<void> {
  if (!specs?.length) return;
  const { GlobalFonts } = await import('@napi-rs/canvas');
  const { Buffer } = await import('node:buffer');

  for (const f of specs) {
    if (f.google) {
      const url = buildGoogleCss2Url(f.google.cssBase ?? 'https://fonts.googleapis.com/css2', {
        family: f.family,
        weights: f.google.weights,
        italic: f.google.italic,
      });
      const css = await (await fetch(url, { headers: { 'User-Agent': CSS2_UA } })).text();
      for (const fontUrl of parseGoogleFontUrls(css)) {
        const bytes = Buffer.from(await (await fetch(fontUrl)).arrayBuffer());
        GlobalFonts.register(bytes, f.family);
      }
    } else if (f.src) {
      const bytes = Buffer.from(await (await fetch(f.src)).arrayBuffer());
      GlobalFonts.register(bytes, f.family);
    }
  }
}

/**
 * Bridge the engine's {@link FontManager} to Node so a composition's own font
 * loads reach the text rasterizer.
 *
 * In a browser, `fonts.load(...)` / `fonts.loadGoogleFont(...)` register into
 * `document.fonts`, which PixiJS's text measurement reads. In Node those calls
 * are no-ops (text is drawn via `@napi-rs/canvas`, whose fonts come from
 * `GlobalFonts`). The `TimelineSpec` route sidesteps this by taking a separate
 * `spec.fonts` list; the **code/bundle** route has no such list — the composition
 * loads fonts imperatively — so we retarget `FontManager`'s (overridable) load
 * hooks at {@link loadFontsNode}. After this runs, the same `fonts.load*` call a
 * composition makes renders identically in the browser preview and the Node
 * render (contract #3). Idempotent; call once after {@link setupNodeEnvironment}.
 */
export function bridgeFontManagerToNode(): void {
  const proto = FontManager.prototype as unknown as {
    loadFace(spec: EngineFontSpec): Promise<void>;
    loadGoogle(spec: GoogleFontSpec): Promise<void>;
  };
  proto.loadFace = (spec) => {
    // Unwrap a url(...) source; local(...) refers to an installed font we can't
    // fetch, so skip it and let the fallback apply.
    const url = /^\s*url\(\s*['"]?([^'")]+)['"]?\s*\)\s*$/.exec(spec.src)?.[1]
      ?? (/^\s*(url|local)\s*\(/.test(spec.src) ? null : spec.src);
    return url ? loadFontsNode([{ family: spec.family, src: url }]) : Promise.resolve();
  };
  proto.loadGoogle = (spec) =>
    loadFontsNode([{ family: spec.family, google: { weights: spec.weights, italic: spec.italic, cssBase: spec.cssBase } }]);
}
