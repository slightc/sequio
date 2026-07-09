export interface FontSpec {
  /** The `font-family` name TextClips reference. */
  family: string;
  /** A font file URL (woff2/woff/ttf), or a full `url(...)` / `local(...)` source. */
  src: string;
  weight?: string;
  style?: string;
}

export interface GoogleFontSpec {
  /** Family name as on fonts.google.com, e.g. `'Roboto'`, `'Playfair Display'`. */
  family: string;
  /** Weights to load (default `[400]`). */
  weights?: number[];
  /** Load the italic variants of the requested weights. */
  italic?: boolean;
  /** Text to guarantee is subsetted in (Google serves per-unicode-range subsets). */
  text?: string;
  /** Override the CSS endpoint (self-hosting / a proxy). Default Google Fonts css2. */
  cssBase?: string;
}

/** Build a Google Fonts css2 stylesheet URL for a spec. Pure / testable. */
export function buildGoogleCss2Url(base: string, spec: GoogleFontSpec): string {
  const family = spec.family.trim().replace(/\s+/g, '+');
  const weights = spec.weights?.length ? [...spec.weights].sort((a, b) => a - b) : [400];
  const axis = spec.italic
    ? `ital,wght@${weights.map((w) => `1,${w}`).join(';')}`
    : `wght@${weights.join(';')}`;
  return `${base}?family=${family}:${axis}&display=block`;
}

/**
 * Loads and registers web fonts into `document.fonts` so `TextClip`'s Canvas
 * text measurement sees them.
 *
 * Fonts must be loaded **before** rendering: `render(t)` is a pure function of
 * (graph, t) (contract #2) and export must not swap a fallback for the real
 * font mid-run (contract #1). So this is a one-time async setup, not a per-frame
 * `prepare`. Typical use:
 *
 * ```ts
 * await fonts.load({ family: 'Inter', src: '/fonts/Inter.woff2' });
 * const title = new TextClip({ text: 'Hello', fontFamily: 'Inter' });
 * // …build the graph, then renderPreview / export
 * ```
 *
 * Before an export, await {@link ready} so every frame uses the real font.
 * `document.fonts` is document-global, so the default {@link fonts} instance is
 * a process-wide singleton; loads are deduped by family+weight+style.
 */
export class FontManager {
  private readonly loaded = new Map<string, Promise<void>>();
  private readonly stylesheets = new Set<string>();
  /** Every `font-family` a load has been issued for (regardless of resolution). */
  private readonly registeredFamilies = new Set<string>();

  /** Load + register a font once. Repeat calls return the same promise. */
  load(spec: FontSpec): Promise<void> {
    this.registeredFamilies.add(spec.family);
    const key = this.keyOf(spec);
    let p = this.loaded.get(key);
    if (!p) {
      p = this.loadFace(spec);
      this.loaded.set(key, p);
    }
    return p;
  }

  /**
   * The `font-family` names a load has been requested for. Registered eagerly
   * (before the async face resolves), so it reflects intent — used for **static
   * validation** (`sequio check`) to catch a `TextClip` referencing a family no
   * `fonts.load(...)` ever registered (which would silently fall back to a system
   * font, breaking preview↔render parity — contract #3).
   */
  families(): string[] {
    return [...this.registeredFamilies];
  }

  /**
   * Load a font from Google Fonts by family name: injects the css2 stylesheet
   * and awaits the requested weights via `document.fonts.load`. Deduped like
   * {@link load} and covered by {@link ready}.
   */
  loadGoogleFont(spec: GoogleFontSpec): Promise<void> {
    const weights = spec.weights?.length ? spec.weights : [400];
    this.registeredFamilies.add(spec.family);
    const key = `google:${spec.family}|${[...weights].sort((a, b) => a - b).join(',')}|${spec.italic ? 'i' : 'n'}`;
    let p = this.loaded.get(key);
    if (!p) {
      p = this.loadGoogle(spec);
      this.loaded.set(key, p);
    }
    return p;
  }

  /** Resolves once every requested font has settled (loaded or failed). */
  ready(): Promise<void> {
    return Promise.allSettled([...this.loaded.values()]).then(() => undefined);
  }

  /** Whether a `load` has been issued for this font (not whether it resolved). */
  isRequested(spec: FontSpec): boolean {
    return this.loaded.has(this.keyOf(spec));
  }

  private keyOf(s: FontSpec): string {
    return `${s.family}|${s.weight ?? 'normal'}|${s.style ?? 'normal'}`;
  }

  /** Perform the actual FontFace load + registration. Overridable for tests. */
  protected async loadFace(spec: FontSpec): Promise<void> {
    const source = /^(url|local)\s*\(/.test(spec.src) ? spec.src : `url(${spec.src})`;
    const face = new FontFace(spec.family, source, { weight: spec.weight, style: spec.style });
    await face.load();
    globalThis.document?.fonts?.add(face);
  }

  /** Inject the Google css2 stylesheet + await the faces. Overridable for tests. */
  protected async loadGoogle(spec: GoogleFontSpec): Promise<void> {
    const base = spec.cssBase ?? 'https://fonts.googleapis.com/css2';
    await this.injectStylesheet(buildGoogleCss2Url(base, spec));
    const weights = spec.weights?.length ? spec.weights : [400];
    const style = spec.italic ? 'italic' : 'normal';
    const doc = globalThis.document;
    await Promise.all(
      weights.map((w) => doc?.fonts?.load(`${style} ${w} 16px "${spec.family}"`, spec.text ?? 'Aa') ?? Promise.resolve()),
    );
  }

  /** Append a stylesheet `<link>` once and resolve when it has loaded. */
  protected injectStylesheet(href: string): Promise<void> {
    const doc = globalThis.document;
    if (!doc || this.stylesheets.has(href)) return Promise.resolve();
    this.stylesheets.add(href);
    return new Promise<void>((resolve, reject) => {
      const link = doc.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.addEventListener('load', () => resolve());
      link.addEventListener('error', () => reject(new Error(`font stylesheet failed: ${href}`)));
      doc.head.appendChild(link);
    });
  }
}

/** Process-wide font registry (`document.fonts` is itself global). */
export const fonts = new FontManager();
