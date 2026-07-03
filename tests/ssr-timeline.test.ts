import { describe, expect, it } from 'vitest';
import { BlurEffect, ColorEffect, ShapeClip, TextClip } from '../src/index';
import { buildClip, buildEffect, timelineEnd, type TimelineSpec } from '../example/ssr/timeline';
import { sampleTimeline } from '../example/ssr/sample-timeline';
import { parseGoogleFontUrls } from '../example/ssr-node/fonts-node';

/**
 * The spec→object-graph mapping the SSR builder does. Text/shape clips need no
 * GPU and no async source, so the real builder code path is exercised headlessly
 * (image/video/font/init paths need a browser and are covered by `verify:ssr`).
 */
describe('buildTimeline mapping', () => {
  it('maps a shape spec onto clip timing, transform and blend', async () => {
    const clip = await buildClip(
      {
        type: 'shape',
        shape: { kind: 'rect', width: 40, height: 30, fill: 0x123456 },
        start: 1,
        end: 3,
        sourceIn: 0.5,
        speed: 2,
        blendMode: 'add',
        opacity: 0.4,
        transform: { anchor: [0, 0], position: [10, 20], scale: [2, 2], rotation: 0.5 },
      },
      [],
    );

    expect(clip).toBeInstanceOf(ShapeClip);
    expect((clip as ShapeClip).spec.width).toBe(40);
    expect(clip.start).toBe(1);
    expect(clip.end).toBe(3);
    expect(clip.sourceIn).toBe(0.5);
    expect(clip.speed).toBe(2);
    expect(clip.blendMode).toBe('add');
    expect(clip.opacity.valueAt(0)).toBe(0.4);
    expect(clip.transform.anchor.valueAt(0)).toEqual([0, 0]);
    expect(clip.transform.position.valueAt(0)).toEqual([10, 20]);
    expect(clip.transform.scale.valueAt(0)).toEqual([2, 2]);
    expect(clip.transform.rotation.valueAt(0)).toBe(0.5);
  });

  it('maps a text spec, keyframing an animatable fontSize', async () => {
    const clip = (await buildClip(
      {
        type: 'text',
        text: 'hi',
        fill: '#fff',
        start: 0,
        end: 2,
        fontSize: { keyframes: [{ time: 0, value: 10 }, { time: 2, value: 30 }] },
      },
      [],
    )) as TextClip;

    expect(clip).toBeInstanceOf(TextClip);
    expect(clip.text).toBe('hi');
    expect(clip.fill).toBe('#fff');
    expect(clip.fontSize.valueAt(0)).toBe(10);
    expect(clip.fontSize.valueAt(1)).toBe(20); // linear midpoint
    expect(clip.fontSize.valueAt(2)).toBe(30);
  });

  it('interpolates a keyframed position (default linear easing)', async () => {
    const clip = await buildClip(
      {
        type: 'shape',
        shape: { kind: 'ellipse', width: 10, height: 10 },
        start: 0,
        end: 2,
        transform: {
          position: {
            keyframes: [
              { time: 0, value: [0, 0] },
              { time: 2, value: [100, 40] },
            ],
          },
        },
      },
      [],
    );
    expect(clip.transform.position.valueAt(1)).toEqual([50, 20]);
  });

  it('applies a named easing on the segment into a keyframe', async () => {
    const linearClip = await buildClip(
      { type: 'shape', shape: { kind: 'rect', width: 1, height: 1 }, start: 0, end: 1, opacity: { keyframes: [{ time: 0, value: 0 }, { time: 1, value: 1 }] } },
      [],
    );
    const easedClip = await buildClip(
      { type: 'shape', shape: { kind: 'rect', width: 1, height: 1 }, start: 0, end: 1, opacity: { keyframes: [{ time: 0, value: 0 }, { time: 1, value: 1, easing: 'easeInQuad' }] } },
      [],
    );
    // easeInQuad(0.5) = 0.25 < linear 0.5 — the name resolved to a real curve.
    expect(linearClip.opacity.valueAt(0.5)).toBeCloseTo(0.5, 5);
    expect(easedClip.opacity.valueAt(0.5)).toBeCloseTo(0.25, 5);
  });

  it('computes the timeline end from the largest clip/audio end', () => {
    const spec: TimelineSpec = {
      width: 10,
      height: 10,
      fps: 30,
      tracks: [
        { clips: [{ type: 'shape', shape: { kind: 'rect', width: 1, height: 1 }, start: 0, end: 2 }] },
        { clips: [{ type: 'shape', shape: { kind: 'rect', width: 1, height: 1 }, start: 1, end: 4.5 }] },
      ],
      audio: [{ src: 'a.mp3', start: 0, end: 6 }],
    };
    expect(timelineEnd(spec)).toBe(6);
  });

  it('the built-in sample is a well-formed spec', () => {
    const s = sampleTimeline();
    expect(s.width).toBeGreaterThan(0);
    expect(s.height).toBeGreaterThan(0);
    expect(s.fps).toBeGreaterThan(0);
    expect(s.tracks?.length).toBeGreaterThan(0);
    expect(timelineEnd(s)).toBe(2);
  });

  it('builds blur/color effects with their params (filters)', () => {
    const blur = buildEffect({ type: 'blur', strength: 5 });
    expect(blur).toBeInstanceOf(BlurEffect);
    expect((blur as BlurEffect).valuesAt(0).strength).toBe(5);

    const color = buildEffect({ type: 'color', brightness: 1.2, contrast: 0.8, saturation: 1.5 });
    expect(color).toBeInstanceOf(ColorEffect);
    expect((color as ColorEffect).valuesAt(0)).toEqual({ brightness: 1.2, contrast: 0.8, saturation: 1.5 });
  });

  it('attaches clip-level effects from the spec', async () => {
    const clip = await buildClip(
      { type: 'shape', shape: { kind: 'rect', width: 4, height: 4 }, start: 0, end: 1, effects: [{ type: 'blur', strength: 3 }] },
      [],
    );
    expect(clip.effects).toHaveLength(1);
    expect(clip.effects[0]).toBeInstanceOf(BlurEffect);
  });

  it('extracts font-file URLs from a Google css2 stylesheet (Node font loader)', () => {
    const css = `
      @font-face {
        font-family: 'Roboto'; font-style: normal; font-weight: 400;
        src: url(https://fonts.gstatic.com/s/roboto/v51/a.ttf) format('truetype');
      }
      @font-face {
        font-family: 'Roboto'; font-style: normal; font-weight: 700;
        src: url("https://fonts.gstatic.com/s/roboto/v51/b.ttf") format('truetype');
      }`;
    expect(parseGoogleFontUrls(css)).toEqual([
      'https://fonts.gstatic.com/s/roboto/v51/a.ttf',
      'https://fonts.gstatic.com/s/roboto/v51/b.ttf',
    ]);
    expect(parseGoogleFontUrls('/* no faces */')).toEqual([]);
  });
});
