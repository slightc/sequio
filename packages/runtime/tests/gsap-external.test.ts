import { describe, expect, it } from 'vitest';
import type { VisualClip } from '@sequio/engine';
import { Runtime } from '../src/index';

/**
 * Proves the end-to-end seam a host (the CLI / server) uses to let a composition
 * reference gsap: a `gsap`-like module injected through `RuntimeOptions.externals`
 * is resolvable to user code, which drives a clip via the engine's
 * `gsapClipAnimator` binding — and the resulting `clip.animator` samples exactly
 * what the (seeked, paused) timeline computed. Headless: the builder never calls
 * `compositor.init()`, so no GPU is needed.
 *
 * A tiny deterministic stand-in for gsap (linear `.to`/`.from` + `.time` seek) —
 * the runtime must not depend on gsap, and the binding only needs a seekable
 * timeline. See packages/engine/tests/gsap-animator.test.ts for the same shape.
 */
type Vars = Record<string, number> & { duration?: number };
function fakeGsap() {
  return {
    timeline() {
      const tweens: { target: Record<string, number>; from: Record<string, number>; to: Record<string, number>; start: number; duration: number }[] = [];
      let end = 0;
      const add = (target: Record<string, number>, vars: Vars, kind: 'to' | 'from') => {
        const { duration = 0.5, ...props } = vars;
        const from: Record<string, number> = {};
        const to: Record<string, number> = {};
        for (const [k, v] of Object.entries(props)) {
          from[k] = kind === 'to' ? (target[k] ?? 0) : v;
          to[k] = kind === 'to' ? v : (target[k] ?? 0);
        }
        tweens.push({ target, from, to, start: end, duration });
        end += duration;
      };
      const tl = {
        to(t: unknown, v?: unknown) { add(t as Record<string, number>, (v ?? {}) as Vars, 'to'); return tl; },
        from(t: unknown, v?: unknown) { add(t as Record<string, number>, (v ?? {}) as Vars, 'from'); return tl; },
        fromTo(t: unknown, _f?: unknown, to?: unknown) { add(t as Record<string, number>, (to ?? {}) as Vars, 'to'); return tl; },
        set() { return tl; },
        duration: () => end,
        time(sec: number) {
          for (const tw of tweens) {
            const raw = tw.duration <= 0 ? 1 : (sec - tw.start) / tw.duration;
            const k = raw <= 0 ? 0 : raw >= 1 ? 1 : raw;
            for (const key of Object.keys(tw.to)) tw.target[key] = tw.from[key]! + (tw.to[key]! - tw.from[key]!) * k;
          }
          return tl;
        },
      };
      return tl;
    },
  };
}

const ENTRY = `
  import { Compositor, VisualTrack, ShapeClip, gsapClipAnimator } from '@sequio/engine';
  import { defineComposition } from '@sequio/runtime';
  import gsap from 'gsap';

  export default defineComposition(() => {
    const compositor = new Compositor({ width: 100, height: 100, fps: 30 });
    const track = new VisualTrack();
    const clip = new ShapeClip({ kind: 'rect', width: 10, height: 10 });
    clip.start = 0;
    clip.end = 2;
    clip.animator = gsapClipAnimator(gsap, (tl, o) => { tl.to(o, { y: 100, alpha: 1, duration: 1 }); });
    track.add(clip);
    compositor.addTrack(track);
    return { compositor, duration: 2 };
  });
`;

describe('gsap external injection', () => {
  it('lets user code import gsap and drive a clip animator through the engine binding', async () => {
    const composer = await new Runtime({ files: { '/index.ts': ENTRY }, externals: { gsap: fakeGsap() } }).run();
    const built = await composer.build(); // no init() → headless
    try {
      const clip = built.compositor.getTracks()[0]!.clips[0] as VisualClip;
      expect(clip.animator).not.toBeNull();
      // The clip's animator samples exactly what the seeked timeline produced.
      expect(clip.animator!.sampleAt(0).y).toBeCloseTo(0);
      expect(clip.animator!.sampleAt(0.5).y).toBeCloseTo(50);
      expect(clip.animator!.sampleAt(1).y).toBeCloseTo(100);
    } finally {
      built.dispose();
    }
  });

  it('throws a clear resolution error when gsap is NOT injected', async () => {
    await expect(new Runtime({ files: { '/index.ts': ENTRY } }).run()).rejects.toThrow(/gsap/);
  });
});
