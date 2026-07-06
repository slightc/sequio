import { describe, expect, it } from 'vitest';
import {
  buildGoogleCss2Url,
  FontManager,
  type FontSpec,
  type GoogleFontSpec,
} from '../src/text/font-manager';

/** FontManager with the actual FontFace/Google loads stubbed (no browser). */
class TestFontManager extends FontManager {
  calls: FontSpec[] = [];
  googleCalls: GoogleFontSpec[] = [];
  mode: 'resolve' | 'reject' = 'resolve';
  protected override loadFace(spec: FontSpec): Promise<void> {
    this.calls.push(spec);
    return this.mode === 'reject' ? Promise.reject(new Error('load failed')) : Promise.resolve();
  }
  protected override loadGoogle(spec: GoogleFontSpec): Promise<void> {
    this.googleCalls.push(spec);
    return Promise.resolve();
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

  it('loadGoogleFont dedups and is covered by ready()', async () => {
    const fm = new TestFontManager();
    const spec: GoogleFontSpec = { family: 'Roboto', weights: [400, 700] };
    const a = fm.loadGoogleFont(spec);
    const b = fm.loadGoogleFont({ family: 'Roboto', weights: [700, 400] }); // same set, reordered
    expect(a).toBe(b);
    expect(fm.googleCalls).toHaveLength(1);
    await expect(fm.ready()).resolves.toBeUndefined();
  });
});

describe('buildGoogleCss2Url', () => {
  const base = 'https://fonts.googleapis.com/css2';
  it('defaults to weight 400, display=block', () => {
    expect(buildGoogleCss2Url(base, { family: 'Roboto' })).toBe(`${base}?family=Roboto:wght@400&display=block`);
  });

  it('encodes spaces as + and sorts weights', () => {
    expect(buildGoogleCss2Url(base, { family: 'Playfair Display', weights: [700, 400] })).toBe(
      `${base}?family=Playfair+Display:wght@400;700&display=block`,
    );
  });

  it('requests italic axis when italic is set', () => {
    expect(buildGoogleCss2Url(base, { family: 'Inter', weights: [400, 600], italic: true })).toBe(
      `${base}?family=Inter:ital,wght@1,400;1,600&display=block`,
    );
  });
});
