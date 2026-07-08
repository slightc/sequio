import type { Container, Filter } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { VisualClip } from '../src/compositor/clip';
import { BlurEffect } from '../src/effects/blur-effect';
import { ColorEffect } from '../src/effects/color-effect';
import { Effect } from '../src/effects/effect';
import { EffectRegistry } from '../src/effects/effect-registry';
import { registerBuiltins } from '../src/effects/builtins';
import { crossfadeAlpha } from '../src/effects/crossfade-transition';
import { Container as PixiContainer } from 'pixi.js';

const fakeTarget = () => ({ filters: null }) as unknown as Container;

/** ColorEffect whose filter records the matrix calls. */
class TestColor extends ColorEffect {
  fake = { reset: vi.fn(), brightness: vi.fn(), contrast: vi.fn(), saturate: vi.fn(), destroy: vi.fn() };
  created = 0;
  protected override createFilter(): Filter {
    this.created++;
    return this.fake as unknown as Filter;
  }
}

describe('ColorEffect', () => {
  it('computes brightness/contrast/saturation at t', () => {
    const e = new ColorEffect();
    e.brightness.setStatic(1.2);
    e.saturation.setKeyframes([
      { time: 0, value: 1 },
      { time: 1, value: 2 },
    ]);
    expect(e.valuesAt(0)).toEqual({ brightness: 1.2, contrast: 1, saturation: 1 });
    expect(e.valuesAt(0.5).saturation).toBeCloseTo(1.5);
  });

  it('creates the filter lazily (on attach, not construct or idle updateAt)', () => {
    const e = new TestColor();
    expect(e.created).toBe(0);
    e.updateAt(0); // no filter yet → no-op
    expect(e.created).toBe(0);
    e.attach(fakeTarget());
    expect(e.created).toBe(1);
  });

  it('writes the animated values into the color matrix', () => {
    const e = new TestColor();
    e.attach(fakeTarget());
    e.brightness.setStatic(1.4);
    e.saturation.setStatic(1.5);
    e.updateAt(0);
    expect(e.fake.reset).toHaveBeenCalled();
    expect(e.fake.brightness).toHaveBeenCalledWith(1.4, true);
    expect(e.fake.saturate).toHaveBeenCalledWith(0.5, true); // 1.5 - 1
  });
});

describe('BlurEffect', () => {
  it('exposes an animatable strength', () => {
    const e = new BlurEffect();
    e.strength.setKeyframes([
      { time: 0, value: 0 },
      { time: 1, value: 10 },
    ]);
    expect(e.valuesAt(0.5).strength).toBeCloseTo(5);
  });
});

describe('EffectRegistry + builtins', () => {
  it('registers color and blur, creates them, and is idempotent', () => {
    const reg = new EffectRegistry();
    registerBuiltins(reg);
    expect(reg.types()).toContain('color');
    expect(reg.types()).toContain('blur');
    expect(reg.create('color')).toBeInstanceOf(ColorEffect);
    expect(reg.create('blur')).toBeInstanceOf(BlurEffect);
    expect(() => registerBuiltins(reg)).not.toThrow(); // no double-register
  });
});

/** An effect whose filter starts at Pixi's default `antialias: 'off'`. */
class AAProbeEffect extends Effect {
  params = {} as Effect['params'];
  protected override createFilter(): Filter {
    return { antialias: 'off', destroy: () => {} } as unknown as Filter;
  }
  updateAt(): void {}
}

describe('Effect base — antialias', () => {
  it("sets the filter to inherit the render target's antialias (not Pixi's 'off' default)", () => {
    const e = new AAProbeEffect();
    const target = { filters: null } as unknown as Container;
    e.attach(target);
    const filter = (target.filters as unknown as Filter[])[0];
    // Without this, a filtered clip's whole pass loses MSAA and its edges alias.
    expect((filter as unknown as { antialias: string }).antialias).toBe('inherit');
  });
});

/** A fake effect recording attach/detach/update. */
class FakeEffect extends Effect {
  params = {} as Effect['params'];
  attachN = 0;
  detachN = 0;
  updates: number[] = [];
  protected override createFilter(): Filter {
    return {} as Filter;
  }
  override attach(): void {
    this.attachN++;
  }
  override detach(): void {
    this.detachN++;
  }
  updateAt(t: number): void {
    this.updates.push(t);
  }
}

/** Minimal visual clip that applies common props (incl. effects) to a Container. */
class TestClip extends VisualClip {
  obj = new PixiContainer();
  override mount(): Container {
    return this.obj;
  }
  override update(t: number): void {
    this.applyCommon(this.obj, t);
  }
  override unmount(): void {}
}

describe('clip-level effect wiring', () => {
  it('attaches an effect once, updates it each frame, detaches on removal', () => {
    const clip = new TestClip();
    const fx = new FakeEffect();
    clip.effects.push(fx);

    clip.update(0);
    clip.update(1);
    expect(fx.attachN).toBe(1); // attached once, reused
    expect(fx.updates).toEqual([0, 1]); // updated every frame

    clip.effects.length = 0; // remove the effect
    clip.update(2);
    expect(fx.detachN).toBe(1);
    expect(fx.updates).toEqual([0, 1]); // not updated after removal
  });
});

describe('crossfadeAlpha', () => {
  it('clamps progress to [0,1]', () => {
    expect(crossfadeAlpha(-1)).toBe(0);
    expect(crossfadeAlpha(0.3)).toBe(0.3);
    expect(crossfadeAlpha(2)).toBe(1);
  });
});
