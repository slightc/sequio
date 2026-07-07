import { ShapeClip, easeInOutCubic } from '@sequio/engine';

export const W = 640;
export const H = 360;
export const DURATION = 4;

// A circle that slides left → right across the timeline (keyframed). Imported by
// index.ts to prove the CLI bundles sibling files so relative imports resolve.
export function ball(fill: number, y: number): ShapeClip {
  const c = new ShapeClip({ kind: 'ellipse', width: 56, height: 56, fill });
  c.start = 0;
  c.end = DURATION;
  c.transform.anchor.setStatic([0.5, 0.5]);
  c.transform.position.setKeyframes([
    { time: 0, value: [80, y] },
    { time: DURATION, value: [W - 80, y], easing: easeInOutCubic },
  ]);
  return c;
}
