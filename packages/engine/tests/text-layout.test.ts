import { describe, expect, it } from 'vitest';
import { computeTextParts } from '../src/text/text-layout';

/** A deterministic fake metric: every character is 10px wide. */
const measure = (s: string): number => s.length * 10;
const LH = 20; // line height

describe('computeTextParts', () => {
  it('returns nothing for split=none or empty text', () => {
    expect(computeTextParts('hello', 'none', measure, LH)).toEqual([]);
    expect(computeTextParts('', 'char', measure, LH)).toEqual([]);
  });

  it('splits by line, one part per source line, centered', () => {
    const parts = computeTextParts('ab\ncde', 'line', measure, LH);
    expect(parts.map((p) => p.text)).toEqual(['ab', 'cde']);
    expect(parts[0]).toMatchObject({ lineIndex: 0, x: 10, y: 10, width: 20 }); // 'ab' → 20px wide, center 10; y = 0*20+10
    expect(parts[1]).toMatchObject({ lineIndex: 1, x: 15, y: 30, width: 30 }); // 'cde' → 30px, center 15; y = 1*20+10
    expect(parts.every((p) => p.count === 2)).toBe(true);
  });

  it('splits by word and positions each word by its measured prefix', () => {
    const parts = computeTextParts('ab cd', 'word', measure, LH);
    expect(parts.map((p) => p.text)).toEqual(['ab', 'cd']);
    // 'ab' occupies [0,20] → center 10; space [20,30]; 'cd' [30,50] → center 40.
    expect(parts[0]!.x).toBe(10);
    expect(parts[1]!.x).toBe(40);
  });

  it('drops whitespace-only units but preserves advance for the next word', () => {
    const parts = computeTextParts('a  b', 'word', measure, LH); // two spaces
    expect(parts.map((p) => p.text)).toEqual(['a', 'b']);
    expect(parts[0]!.x).toBe(5); // 'a' [0,10] center 5
    expect(parts[1]!.x).toBe(35); // 'b' at [30,40] center 35 (10 + 20 spaces)
  });

  it('splits by char with prefix-based positions and global index/count', () => {
    const parts = computeTextParts('ab\ncd', 'char', measure, LH);
    expect(parts.map((p) => p.text)).toEqual(['a', 'b', 'c', 'd']);
    expect(parts.map((p) => p.index)).toEqual([0, 1, 2, 3]);
    expect(parts.every((p) => p.count === 4)).toBe(true);
    // line 0: a center 5, b center 15 (y=10). line 1: c center 5, d center 15 (y=30).
    expect(parts[0]).toMatchObject({ x: 5, y: 10, lineIndex: 0 });
    expect(parts[1]).toMatchObject({ x: 15, y: 10, lineIndex: 0 });
    expect(parts[2]).toMatchObject({ x: 5, y: 30, lineIndex: 1 });
    expect(parts[3]).toMatchObject({ x: 15, y: 30, lineIndex: 1 });
  });

  it('skips spaces in char mode but keeps their advance', () => {
    const parts = computeTextParts('a b', 'char', measure, LH);
    expect(parts.map((p) => p.text)).toEqual(['a', 'b']);
    expect(parts[0]!.x).toBe(5); // 'a' [0,10]
    expect(parts[1]!.x).toBe(25); // 'b' [20,30] after the skipped space
  });
});
