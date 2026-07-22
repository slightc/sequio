import { Container, Graphics, Text } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { ShapeClip, TextClip } from '../src/compositor/clips';
import { GroupClip } from '../src/compositor/group-clip';
import { ImageSource } from '../src/media/image-source';

/** Text.getLocalBounds() measures glyphs via a canvas, which headless node
 *  lacks. Stub it so applyCommon's anchor math runs without measurement. */
function stubBounds(t: Text): void {
  (t as unknown as { getLocalBounds: () => object }).getLocalBounds = () => ({
    x: 0,
    y: 0,
    width: 100,
    height: 20,
  });
}

describe('ShapeClip', () => {
  it('draws a rect with the requested size and applies the transform', () => {
    const clip = new ShapeClip({ kind: 'rect', width: 80, height: 60, fill: 0xff0000 });
    const g = clip.mount() as Graphics;
    expect(g).toBeInstanceOf(Graphics);
    expect(g.getLocalBounds().width).toBeCloseTo(80);
    expect(g.getLocalBounds().height).toBeCloseTo(60);

    clip.transform.position.setStatic([100, 50]);
    clip.update(0);
    expect(g.position.x).toBe(100);
    expect(g.position.y).toBe(50);
    // anchor [0.5,0.5] on 80x60 → pivot at content center
    expect(g.pivot.x).toBeCloseTo(40);
    expect(g.pivot.y).toBeCloseTo(30);
  });

  it('draws an ellipse and supports a stroke', () => {
    const clip = new ShapeClip({
      kind: 'ellipse',
      width: 40,
      height: 40,
      fill: 0x00ff00,
      stroke: { color: 0xffffff, width: 4 },
    });
    const g = clip.mount() as Graphics;
    expect(g.getLocalBounds().width).toBeGreaterThan(0);
    clip.update(0);
    clip.unmount(); // must not throw
    clip.update(0); // no-op after unmount
  });
});

describe('TextClip', () => {
  it('builds a PIXI.Text from the style', () => {
    const clip = new TextClip({ text: 'Hello', fontFamily: 'serif', fontSize: 24, fill: 0x112233 });
    const t = clip.mount() as Text;
    expect(t).toBeInstanceOf(Text);
    expect(t.text).toBe('Hello');
    expect(t.style.fontSize).toBe(24);
  });

  it('supports a hollow (stroked + transparent-fill) style', () => {
    // Hollow text = a stroke around the glyphs + a fill that carries alpha 0
    // through the color string (no separate fill-opacity field needed).
    const clip = new TextClip({
      text: 'OUT',
      fontSize: 40,
      fill: 'rgba(255,255,255,0)',
      stroke: { color: 0xffffff, width: 3 },
    });
    expect(clip.stroke).toEqual({ color: 0xffffff, width: 3 });
    const t = clip.mount() as Text;
    // Pixi normalizes the outline into a StrokeStyle and the transparent fill
    // into a FillStyle with alpha 0 — the two ingredients of hollow text.
    expect(t.style.stroke).toMatchObject({ width: 3 });
    expect(t.style._fill.alpha).toBe(0);
  });

  it('defaults to no stroke', () => {
    const clip = new TextClip({ text: 'x', fill: 0x010203 });
    expect(clip.stroke).toBeNull();
  });

  it('animates font size via keyframes', () => {
    const clip = new TextClip({ text: 'Hi', fontSize: 20 });
    clip.fontSize.setKeyframes([
      { time: 0, value: 20 },
      { time: 1, value: 40 },
    ]);
    const t = clip.mount() as Text;
    stubBounds(t); // text measurement needs a canvas; not what we're testing
    clip.update(0.5);
    expect(t.style.fontSize).toBe(30); // halfway
  });

  it('reflects text changes and releases the object on unmount', () => {
    const clip = new TextClip({ text: 'a' });
    const t = clip.mount() as Text;
    stubBounds(t);
    clip.text = 'b';
    clip.update(0);
    expect(t.text).toBe('b');
    clip.unmount();
    clip.update(0); // no-op, must not throw
  });

  it('passes weight / italic / letter-spacing / align / stroke into the style', () => {
    const clip = new TextClip({
      text: 'Hi',
      fontSize: 40,
      fontWeight: '700',
      fontStyle: 'italic',
      letterSpacing: 6,
      align: 'center',
      stroke: { color: 0xff0000, width: 3 },
    });
    const t = clip.mount() as Text;
    expect(t.style.fontWeight).toBe('700');
    expect(t.style.fontStyle).toBe('italic');
    expect(t.style.letterSpacing).toBe(6);
    expect(t.style.align).toBe('center');
    // Pixi normalises `stroke` into a StrokeStyle carrying the requested width.
    expect((t.style.stroke as { width: number }).width).toBe(3);
  });
});

describe('VisualClip.maskShape', () => {
  it('attaches a Graphics mask sized to the spec, and tears it down when cleared', () => {
    const clip = new GroupClip();
    clip.maskShape = { kind: 'rect', width: 120, height: 200, radius: 24 };
    const c = clip.mount() as Container;

    clip.update(0);
    expect(c.mask).toBeInstanceOf(Graphics);
    const mask = c.mask as unknown as Graphics;
    expect(c.children).toContain(mask); // the mask lives in the display list
    expect(mask.getLocalBounds().width).toBeCloseTo(120);
    expect(mask.getLocalBounds().height).toBeCloseTo(200);

    // Clearing the spec removes the mask on the next update.
    clip.maskShape = null;
    clip.update(0);
    expect(c.mask ?? null).toBeNull();

    clip.unmount(); // must not throw
  });

  it('offsets the reveal region by x / y', () => {
    const clip = new GroupClip();
    clip.maskShape = { kind: 'ellipse', width: 100, height: 100, x: 50, y: 30 };
    const c = clip.mount() as Container;
    clip.update(0);
    const b = (c.mask as unknown as Graphics).getLocalBounds();
    expect(b.x).toBeCloseTo(50);
    expect(b.y).toBeCloseTo(30);
  });

  it('does not re-tessellate a static mask every frame, but redraws when the spec changes', () => {
    const clip = new GroupClip();
    clip.maskShape = { kind: 'rect', width: 120, height: 200 };
    const c = clip.mount() as Container;

    clip.update(0); // first paint builds the geometry
    const mask = c.mask as unknown as Graphics;
    let clears = 0;
    const realClear = mask.clear.bind(mask);
    mask.clear = ((): Graphics => {
      clears++;
      return realClear();
    }) as Graphics['clear'];

    // Steady playback: the mask is unchanged, so it must not be rebuilt.
    clip.update(0.1);
    clip.update(0.2);
    clip.update(0.3);
    expect(clears).toBe(0);

    // Changing the spec redraws exactly once for that change.
    clip.maskShape = { kind: 'rect', width: 140, height: 200 };
    clip.update(0.4);
    expect(clears).toBe(1);
    clip.update(0.5);
    expect(clears).toBe(1);

    clip.unmount();
  });
});

describe('ImageSource', () => {
  it('returns no texture before load and disposes cleanly', () => {
    const src = new ImageSource({ src: 'x.png' });
    expect(src.getTextureAt(0)).toBeNull();
    expect(src.loaded).toBe(false);
    src.dispose(); // must not throw
  });
});
