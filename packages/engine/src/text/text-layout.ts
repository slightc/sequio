import type { TextPart, TextSplit } from '../animation/clip-animator';

/** Measures the advance width (px) of a string in the target text style. */
export type MeasureWidth = (text: string) => number;

/**
 * Break `text` into laid-out {@link TextPart}s at the requested granularity.
 *
 * The layout is deliberately simple and deterministic — left-aligned, one source
 * line per `\n`, no automatic word-wrapping — which is what titles / captions
 * (the things worth animating per-line/word/char) actually are. Widths come from
 * the injected `measure` so this stays a pure function (testable without a
 * canvas): in the engine it's wired to Pixi's `CanvasTextMetrics`.
 *
 * `x`/`y` on each part are its **center** in the clip's local space, so a part's
 * scale/rotation pivots around itself. Whitespace-only units are dropped for
 * `char`/`word` (they carry no glyph) but still consume horizontal advance, so
 * spacing is preserved; their stagger slots are simply not spent.
 */
export function computeTextParts(
  text: string,
  split: TextSplit,
  measure: MeasureWidth,
  lineHeight: number,
): TextPart[] {
  if (split === 'none' || text.length === 0) return [];

  const lines = text.split('\n');
  const parts: Omit<TextPart, 'index' | 'count'>[] = [];

  lines.forEach((line, lineIndex) => {
    const cy = lineIndex * lineHeight + lineHeight / 2;

    if (split === 'line') {
      const w = measure(line);
      parts.push({ text: line, unit: 'line', lineIndex, x: w / 2, y: cy, width: w, height: lineHeight });
      return;
    }

    if (split === 'word') {
      // Split into words + the whitespace runs between them; walk left to right
      // accumulating advance so each word sits at its true measured offset.
      const tokens = line.match(/\s+|\S+/g) ?? [];
      let cursor = 0;
      for (const token of tokens) {
        const w = measure(token);
        if (/\S/.test(token)) {
          parts.push({ text: token, unit: 'word', lineIndex, x: cursor + w / 2, y: cy, width: w, height: lineHeight });
        }
        cursor += w;
      }
      return;
    }

    // char: one part per non-whitespace glyph, positioned by its prefix advance.
    const chars = [...line];
    let cursor = 0;
    for (const ch of chars) {
      const w = measure(ch);
      if (/\S/.test(ch)) {
        parts.push({ text: ch, unit: 'char', lineIndex, x: cursor + w / 2, y: cy, width: w, height: lineHeight });
      }
      cursor += w;
    }
  });

  const count = parts.length;
  return parts.map((p, index) => ({ ...p, index, count }));
}
