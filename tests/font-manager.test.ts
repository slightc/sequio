import { describe, expect, it } from 'vitest';
import { FontManager, type FontSpec } from '../src/text/font-manager';

/** FontManager with the actual FontFace load stubbed (no browser needed). */
class TestFontManager extends FontManager {
  calls: FontSpec[] = [];
  mode: 'resolve' | 'reject' = 'resolve';
  protected override loadFace(spec: FontSpec): Promise<void> {
    this.calls.push(spec);
    return this.mode === 'reject' ? Promise.reject(new Error('load failed')) : Promise.resolve();
  }
}

describe('FontManager', () => {
  it('loads a font once and dedups repeat requests', async () => {
    const fm = new TestFontManager();
    const spec: FontSpec = { family: 'Inter', src: '/inter.woff2' };
    const a = fm.load(spec);
    const b = fm.load(spec);
    expect(a).toBe(b); // same promise
    expect(fm.calls).toHaveLength(1);
    expect(fm.isRequested(spec)).toBe(true);
    await a;
  });

  it('treats different weight/style as distinct faces', async () => {
    const fm = new TestFontManager();
    fm.load({ family: 'Inter', src: '/inter.woff2' });
    fm.load({ family: 'Inter', src: '/inter-bold.woff2', weight: '700' });
    expect(fm.calls).toHaveLength(2);
  });

  it('ready() resolves once all requested fonts settle', async () => {
    const fm = new TestFontManager();
    fm.load({ family: 'A', src: '/a.woff2' });
    fm.load({ family: 'B', src: '/b.woff2' });
    await expect(fm.ready()).resolves.toBeUndefined();
  });

  it('ready() resolves even if a font fails to load', async () => {
    const fm = new TestFontManager();
    fm.mode = 'reject';
    fm.load({ family: 'Missing', src: '/nope.woff2' }).catch(() => {});
    await expect(fm.ready()).resolves.toBeUndefined();
  });

  it('isRequested is false for an unloaded font', () => {
    const fm = new TestFontManager();
    expect(fm.isRequested({ family: 'Ghost', src: '/g.woff2' })).toBe(false);
  });
});
