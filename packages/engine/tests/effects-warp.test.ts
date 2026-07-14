import { describe, expect, it } from 'vitest';
import { BulgeEffect } from '../src/effects/bulge-effect';
import { DisplacementEffect } from '../src/effects/displacement-effect';
import { PerspectiveEffect } from '../src/effects/perspective-effect';
import { EffectRegistry } from '../src/effects/effect-registry';
import { registerBuiltins } from '../src/effects/builtins';
import { bulgeSourceUv } from '../src/effects/warp/distortion';
import {
  applyHomography,
  invert3x3,
  perspectiveSampleMatrix,
  squareToQuad,
  toColumnMajor,
  UNIT_QUAD,
  type Mat3,
  type Quad,
} from '../src/effects/warp/homography';

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Normalize -0 → 0 so exact array comparisons don't trip on signed zero. */
const norm = (a: ArrayLike<number>): number[] => Array.from(a, (v) => v + 0);

function mul3(a: Mat3, b: Mat3): Mat3 {
  const out = new Array(9).fill(0) as Mat3;
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      for (let k = 0; k < 3; k++) out[r * 3 + c] += a[r * 3 + k]! * b[k * 3 + c]!;
  return out;
}

describe('homography', () => {
  it('maps the unit square identically for the unit quad', () => {
    const m = squareToQuad(UNIT_QUAD);
    m.forEach((v, i) => expect(v).toBeCloseTo(IDENTITY[i]!));
  });

  it('maps the unit-square corners onto the target quad corners', () => {
    const quad: Quad = [
      [0.2, 0.1],
      [0.9, 0.0],
      [1.0, 1.0],
      [0.05, 0.85],
    ];
    const m = squareToQuad(quad);
    const corners: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    corners.forEach(([u, v], i) => {
      const [x, y] = applyHomography(m, [u, v]);
      expect(x).toBeCloseTo(quad[i]![0]);
      expect(y).toBeCloseTo(quad[i]![1]);
    });
  });

  it('invert3x3 is a true inverse (M · M⁻¹ = I)', () => {
    const m = squareToQuad([
      [0.2, 0.1],
      [0.9, 0.0],
      [1.0, 1.0],
      [0.05, 0.85],
    ]);
    const prod = mul3(m, invert3x3(m));
    prod.forEach((v, i) => expect(v).toBeCloseTo(IDENTITY[i]!));
  });

  it('perspectiveSampleMatrix (dest→source) sends quad corners back to the unit square', () => {
    const quad: Quad = [
      [0.2, 0.1],
      [0.9, 0.0],
      [1.0, 1.0],
      [0.05, 0.85],
    ];
    const inv = invert3x3(squareToQuad(quad)); // dest → source (row-major)
    const unit: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    quad.forEach((corner, i) => {
      const [u, v] = applyHomography(inv, corner);
      expect(u).toBeCloseTo(unit[i]![0]);
      expect(v).toBeCloseTo(unit[i]![1]);
    });
  });

  it('unit quad → identity sample matrix (column-major)', () => {
    const m = perspectiveSampleMatrix(UNIT_QUAD);
    expect(norm(m)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it('toColumnMajor transposes row-major storage', () => {
    expect(Array.from(toColumnMajor([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toEqual([1, 4, 7, 2, 5, 8, 3, 6, 9]);
  });
});

describe('bulgeSourceUv', () => {
  it('is identity at the center, outside the radius, and at zero strength', () => {
    expect(bulgeSourceUv([0.5, 0.5], [0.5, 0.5], 0.5, 1, 1)).toEqual([0.5, 0.5]); // center
    expect(bulgeSourceUv([0.95, 0.5], [0.5, 0.5], 0.3, 1, 1)).toEqual([0.95, 0.5]); // outside radius
    expect(bulgeSourceUv([0.6, 0.4], [0.5, 0.5], 0.5, 0, 1)).toEqual([0.6, 0.4]); // strength 0
  });

  it('bulge (strength>0) samples nearer the center → magnifies', () => {
    const center: [number, number] = [0.5, 0.5];
    const uv: [number, number] = [0.5, 0.3];
    const src = bulgeSourceUv(uv, center, 0.5, 1, 1);
    const dOut = Math.hypot(uv[0] - center[0], uv[1] - center[1]);
    const dSrc = Math.hypot(src[0] - center[0], src[1] - center[1]);
    expect(dSrc).toBeLessThan(dOut);
  });

  it('pinch (strength<0) samples farther from the center', () => {
    const center: [number, number] = [0.5, 0.5];
    const uv: [number, number] = [0.5, 0.3];
    const src = bulgeSourceUv(uv, center, 0.5, -1, 1);
    const dOut = Math.hypot(uv[0] - center[0], uv[1] - center[1]);
    const dSrc = Math.hypot(src[0] - center[0], src[1] - center[1]);
    expect(dSrc).toBeGreaterThan(dOut);
  });
});

describe('BulgeEffect', () => {
  it('animates its params and mirrors bulgeSourceUv', () => {
    const e = new BulgeEffect();
    e.strength.setKeyframes([
      { time: 0, value: 0 },
      { time: 1, value: 1 },
    ]);
    e.radius.setStatic(0.4);
    const v = e.valuesAt(0.5);
    expect(v.strength).toBeCloseTo(0.5);
    expect(v.radius).toBe(0.4);
    expect(v.center).toEqual([0.5, 0.5]);
    expect(e.sourceUvAt([0.5, 0.3], 1, 0.5)).toEqual(bulgeSourceUv([0.5, 0.3], [0.5, 0.5], 0.4, 0.5, 1));
  });
});

describe('PerspectiveEffect', () => {
  it('defaults to the identity quad and animates corners', () => {
    const e = new PerspectiveEffect();
    expect(e.quadAt(0)).toEqual(UNIT_QUAD);
    expect(norm(e.matrixAt(0))).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);

    e.topLeft.setKeyframes([
      { time: 0, value: [0, 0] },
      { time: 1, value: [0.2, 0.1] },
    ]);
    const q = e.quadAt(0.5);
    expect(q[0]![0]).toBeCloseTo(0.1);
    expect(q[0]![1]).toBeCloseTo(0.05);
    expect(norm(e.matrixAt(0.5))).toEqual(norm(perspectiveSampleMatrix(q)));
  });
});

describe('DisplacementEffect', () => {
  it('exposes an animatable strength (default 20) and honors the option', () => {
    expect(new DisplacementEffect().strength.valueAt(0)).toBe(20);
    const e = new DisplacementEffect({ strength: 8 });
    e.strength.setKeyframes([
      { time: 0, value: 8 },
      { time: 1, value: 40 },
    ]);
    expect(e.strength.valueAt(0.5)).toBeCloseTo(24);
  });
});

describe('registerBuiltins (with warps)', () => {
  it('registers color/blur/bulge/perspective/displacement', () => {
    const reg = new EffectRegistry();
    registerBuiltins(reg);
    expect(reg.types().sort()).toEqual(['blur', 'bulge', 'color', 'displacement', 'perspective']);
    expect(reg.create('bulge')).toBeInstanceOf(BulgeEffect);
    expect(reg.create('perspective')).toBeInstanceOf(PerspectiveEffect);
    expect(reg.create('displacement')).toBeInstanceOf(DisplacementEffect);
  });
});

