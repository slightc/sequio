import type { Container } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import {
  IDENTITY_SAMPLE,
  StaggerTextAnimator,
  TweenAnimator,
  lerpSample,
  type TextPart,
} from '../src/animation/clip-animator';
import { Transform2D } from '../src/animation/transform2d';
import { ShapeClip } from '../src/compositor/clips';
import { linear } from '../src/animation/easing';

function part(index: number, count: number): TextPart {
  return { text: 'x', unit: 'char', index, count, lineIndex: 0, x: index * 10, y: 5, width: 8, height: 10 };
}

describe('lerpSample', () => {
  it('is identity at k=0 for offsets and factors', () => {
    const s = lerpSample({ y: -40, alpha: 0, scaleX: 0 }, IDENTITY_SAMPLE, 0);
    expect(s).toEqual({ x: 0, y: -40, scaleX: 0, scaleY: 1, rotation: 0, alpha: 0 });
  });

  it('reaches the target at k=1', () => {
    const s = lerpSample({ y: -40, alpha: 0 }, IDENTITY_SAMPLE, 1);
    expect(s).toEqual({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, alpha: 1 });
  });

  it('interpolates linearly at k=0.5', () => {
    const s = lerpSample({ y: -40, alpha: 0 }, IDENTITY_SAMPLE, 0.5);
    expect(s.y).toBeCloseTo(-20);
    expect(s.alpha).toBeCloseTo(0.5);
  });
});

describe('StaggerTextAnimator', () => {
  const anim = new StaggerTextAnimator({
    from: { y: -40, alpha: 0 },
    duration: 0.4,
    stagger: 0.1,
    easing: linear,
  });

  it('holds the `from` override before a part starts', () => {
    expect(anim.sampleForPart(part(2, 5), 0)).toMatchObject({ y: -40, alpha: 0 });
  });

  it('settles to identity after a part finishes', () => {
    // part 2 starts at 0.2s, finishes at 0.6s.
    const s = anim.sampleForPart(part(2, 5), 0.6);
    expect(s.y).toBeCloseTo(0);
    expect(s.alpha).toBeCloseTo(1);
  });

  it('staggers: later parts lag behind earlier ones at the same time', () => {
    const t = 0.25;
    const first = anim.sampleForPart(part(0, 5), t).y!; // started at 0.0 → 62% done
    const later = anim.sampleForPart(part(2, 5), t).y!; // starts at 0.2 → 12% done
    expect(first).toBeGreaterThan(later); // closer to 0 (settled) than the later part
  });

  it('is a pure function of (part, localT)', () => {
    const a = anim.sampleForPart(part(3, 5), 0.33);
    const b = anim.sampleForPart(part(3, 5), 0.33);
    expect(a).toEqual(b);
  });

  it('reverse order makes the last part lead', () => {
    const rev = new StaggerTextAnimator({ from: { y: -40 }, duration: 0.4, stagger: 0.1, order: 'reverse', easing: linear });
    const t = 0.05;
    const firstIdx = rev.sampleForPart(part(0, 5), t).y!; // slot 4 → not started → -40
    const lastIdx = rev.sampleForPart(part(4, 5), t).y!; // slot 0 → started → > -40
    expect(lastIdx).toBeGreaterThan(firstIdx);
  });
});

describe('TweenAnimator', () => {
  it('clamps before delay and after end', () => {
    const tw = new TweenAnimator({ from: { x: -100 }, to: { x: 0 }, delay: 0.5, duration: 1, easing: linear });
    expect(tw.sampleAt(0).x).toBeCloseTo(-100); // before delay
    expect(tw.sampleAt(0.5).x).toBeCloseTo(-100); // at start
    expect(tw.sampleAt(1.0).x).toBeCloseTo(-50); // halfway
    expect(tw.sampleAt(1.5).x).toBeCloseTo(0); // end
    expect(tw.sampleAt(9).x).toBeCloseTo(0); // past end holds
  });
});

describe('animation sample composition', () => {
  it('Transform2D composes a sample: offsets add, factors multiply, rotation adds', () => {
    const obj = { position: { set: vi.fn() }, scale: { set: vi.fn() }, pivot: { set: vi.fn() }, rotation: 0, getLocalBounds: () => ({ x: 0, y: 0, width: 10, height: 10 }) };
    const tf = new Transform2D();
    tf.position.setStatic([100, 50]);
    tf.scale.setStatic([2, 2]);
    tf.rotation.setStatic(0.5);
    tf.applyTo(obj as unknown as Container, 0, { x: 10, y: -20, scaleX: 0.5, scaleY: 3, rotation: 0.25 });
    expect(obj.position.set).toHaveBeenCalledWith(110, 30); // 100+10, 50-20
    expect(obj.scale.set).toHaveBeenCalledWith(1, 6); // 2*0.5, 2*3
    expect(obj.rotation).toBeCloseTo(0.75); // 0.5 + 0.25
  });

  it('VisualClip.applyCommon multiplies opacity by the animator alpha', () => {
    const clip = new ShapeClip({ kind: 'rect', width: 20, height: 20 });
    clip.start = 1; // local time = t - start
    clip.opacity.setStatic(0.8);
    clip.animator = new TweenAnimator({ from: { alpha: 0 }, to: { alpha: 1 }, duration: 1, easing: linear });
    const g = clip.mount();
    clip.update(1); // localT = 0 → alpha factor 0
    expect(g.alpha).toBeCloseTo(0);
    clip.update(1.5); // localT = 0.5 → factor 0.5 → 0.8 * 0.5
    expect(g.alpha).toBeCloseTo(0.4);
    clip.update(2); // localT = 1 → factor 1 → 0.8
    expect(g.alpha).toBeCloseTo(0.8);
  });

  it('a clip with no animator is unchanged (identity)', () => {
    const clip = new ShapeClip({ kind: 'rect', width: 20, height: 20 });
    clip.transform.position.setStatic([30, 40]);
    const g = clip.mount();
    clip.update(0);
    expect(g.position.x).toBe(30);
    expect(g.position.y).toBe(40);
  });
});
