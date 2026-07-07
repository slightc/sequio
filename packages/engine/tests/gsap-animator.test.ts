import { describe, expect, it } from 'vitest';
import { gsapClipAnimator, gsapTextAnimator, type GsapLike } from '../src/animation/gsap-animator';
import type { TextPart } from '../src/animation/clip-animator';

/**
 * A tiny deterministic stand-in for `gsap` — just enough to prove the binding:
 * a paused timeline that stores `.to`/`.from` tweens and, on `.time(sec)`, writes
 * linearly-interpolated values back onto the target(s). Supports numeric
 * `stagger` over an array of targets, which is the逐字 use case. Not a faithful
 * GSAP (linear ease only), but the adapter only cares that seeking is pure.
 */
type Vars = Record<string, number> & { duration?: number; stagger?: number };
interface Tween {
  target: Record<string, number>;
  from: Record<string, number>;
  to: Record<string, number>;
  start: number;
  duration: number;
}

function makeFakeGsap(): GsapLike {
  return {
    timeline() {
      const tweens: Tween[] = [];
      let end = 0;
      const add = (targets: Record<string, number> | Record<string, number>[], vars: Vars, kind: 'to' | 'from') => {
        const list = Array.isArray(targets) ? targets : [targets];
        const { duration = 0.5, stagger = 0, ...props } = vars;
        list.forEach((target, i) => {
          const start = end + i * stagger;
          const from: Record<string, number> = {};
          const to: Record<string, number> = {};
          for (const [k, v] of Object.entries(props)) {
            if (kind === 'to') {
              from[k] = target[k] ?? 0;
              to[k] = v;
            } else {
              from[k] = v; // .from animates FROM the given value TO the current one
              to[k] = target[k] ?? 0;
            }
          }
          tweens.push({ target, from, to, start, duration });
        });
        const span = duration + (list.length - 1) * stagger;
        end += span;
      };
      const tl = {
        to(targets: unknown, vars?: unknown) {
          add(targets as Record<string, number> | Record<string, number>[], (vars ?? {}) as Vars, 'to');
          return tl;
        },
        from(targets: unknown, vars?: unknown) {
          add(targets as Record<string, number> | Record<string, number>[], (vars ?? {}) as Vars, 'from');
          return tl;
        },
        fromTo(targets: unknown, _fromVars?: unknown, toVars?: unknown) {
          add(targets as Record<string, number> | Record<string, number>[], (toVars ?? {}) as Vars, 'to');
          return tl;
        },
        set() {
          return tl;
        },
        duration: () => end,
        time(sec: number) {
          for (const tw of tweens) {
            const raw = tw.duration <= 0 ? 1 : (sec - tw.start) / tw.duration;
            const k = raw <= 0 ? 0 : raw >= 1 ? 1 : raw;
            for (const key of Object.keys(tw.to)) {
              tw.target[key] = tw.from[key]! + (tw.to[key]! - tw.from[key]!) * k;
            }
          }
          return tl;
        },
      };
      return tl;
    },
  };
}

function part(index: number, count: number): TextPart {
  return { text: 'x', unit: 'char', index, count, lineIndex: 0, x: 0, y: 0, width: 8, height: 10 };
}

describe('gsapClipAnimator', () => {
  it('seeks the timeline and reads the target back at local time', () => {
    const gsap = makeFakeGsap();
    const anim = gsapClipAnimator(gsap, (tl, o) => {
      tl.to(o, { y: 100, alpha: 1, duration: 1 });
    });
    // target seeded at identity → y starts 0, tween to 100.
    expect(anim.sampleAt(0).y).toBeCloseTo(0);
    expect(anim.sampleAt(0.5).y).toBeCloseTo(50);
    expect(anim.sampleAt(1).y).toBeCloseTo(100);
  });

  it('supports .from (start offset → identity) and clamps negative time to 0', () => {
    const gsap = makeFakeGsap();
    const anim = gsapClipAnimator(gsap, (tl, o) => {
      tl.from(o, { y: -40, alpha: 0, duration: 1 });
    });
    expect(anim.sampleAt(-5)).toMatchObject({ y: -40, alpha: 0 }); // clamped to t=0
    expect(anim.sampleAt(1)).toMatchObject({ y: 0, alpha: 1 });
  });

  it('is pure: same local time → same sample', () => {
    const gsap = makeFakeGsap();
    const anim = gsapClipAnimator(gsap, (tl, o) => tl.to(o, { x: 200, duration: 2 }));
    expect(anim.sampleAt(0.7)).toEqual(anim.sampleAt(0.7));
    // and seeking backward then forward gives the forward value (not stateful)
    anim.sampleAt(1.9);
    expect(anim.sampleAt(0.7).x).toBeCloseTo(70);
  });
});

describe('gsapTextAnimator', () => {
  it('drives per-part targets with a stagger', () => {
    const gsap = makeFakeGsap();
    const count = 4;
    const anim = gsapTextAnimator(gsap, count, (tl, targets) => {
      tl.from(targets, { y: -40, alpha: 0, duration: 0.4, stagger: 0.1 });
    });
    // At t=0.1: part 0 started at 0 (25% done), part 1 starts at 0.1 (0%), part 3 not started.
    const p0 = anim.sampleForPart(part(0, count), 0.1).y!;
    const p1 = anim.sampleForPart(part(1, count), 0.1).y!;
    const p3 = anim.sampleForPart(part(3, count), 0.1).y!;
    expect(p0).toBeGreaterThan(p1); // earlier part is further along (closer to 0)
    expect(p1).toBeGreaterThanOrEqual(p3);
    expect(p3).toBeCloseTo(-40); // not started
  });

  it('an out-of-range part index yields identity (never throws)', () => {
    const gsap = makeFakeGsap();
    const anim = gsapTextAnimator(gsap, 2, (tl, targets) => tl.from(targets, { y: -40, duration: 0.4, stagger: 0.1 }));
    expect(anim.sampleForPart(part(9, 2), 0.5)).toEqual({});
  });
});
