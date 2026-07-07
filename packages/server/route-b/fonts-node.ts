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
import { buildGoogleCss2Url } from '@sequio/engine';
import type { FontSpec } from '../src/timeline';

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
export async function loadFontsNode(specs: FontSpec[] | undefined): Promise<void> {
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
