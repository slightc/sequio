export interface FontSpec {
  /** The `font-family` name TextClips reference. */
  family: string;
  /** A font file URL (woff2/woff/ttf), or a full `url(...)` / `local(...)` source. */
  src: string;
  weight?: string;
  style?: string;
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

  /** Load + register a font once. Repeat calls return the same promise. */
  load(spec: FontSpec): Promise<void> {
    const key = this.keyOf(spec);
    let p = this.loaded.get(key);
    if (!p) {
      p = this.loadFace(spec);
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
}

/** Process-wide font registry (`document.fonts` is itself global). */
export const fonts = new FontManager();
