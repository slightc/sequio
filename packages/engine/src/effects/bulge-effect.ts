import { type Filter, UniformGroup } from 'pixi.js';
import { AnimatableProperty } from '../animation/animatable-property';
import { Effect } from './effect';
import { bulgeSourceUv } from './warp/distortion';
import type { Vec2 } from './warp/homography';
import { makeGlFilter } from './warp/shaders';

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputClamp;
uniform highp vec4 uInputSize;

uniform float uStrength;
uniform vec2 uCenter;
uniform float uRadius;

void main() {
    vec2 lo = uInputClamp.xy;
    vec2 span = uInputClamp.zw - uInputClamp.xy;
    vec2 uv = (vTextureCoord - lo) / span;      // 0..1 over the object bounds

    float aspect = uInputSize.x / uInputSize.y;
    vec2 d = vec2((uv.x - uCenter.x) * aspect, uv.y - uCenter.y);
    float r = length(d);

    vec2 src = uv;
    if (r > 0.0 && uRadius > 0.0 && r < uRadius) {
        float rn = r / uRadius;
        float s = 1.0 - uStrength * (1.0 - rn) * (1.0 - rn);
        vec2 nd = (d / r) * (r * s);
        src = vec2(uCenter.x + nd.x / aspect, uCenter.y + nd.y);
    }
    src = clamp(src, vec2(0.0), vec2(1.0));
    finalColor = texture(uTexture, lo + src * span);
}`;

/**
 * Radial **bulge** (`strength > 0`) / **pinch** (`strength < 0`) — a fisheye-style
 * warp around `center` within `radius` (all in `[0,1]` over the clip's bounds).
 * The GPU fragment shader mirrors the pure {@link bulgeSourceUv}, so preview and
 * export agree (contract #3) and the math is unit-testable without a renderer.
 */
export class BulgeEffect extends Effect {
  readonly strength = new AnimatableProperty<number>(0);
  readonly centerX = new AnimatableProperty<number>(0.5);
  readonly centerY = new AnimatableProperty<number>(0.5);
  readonly radius = new AnimatableProperty<number>(0.5);
  readonly params: Record<string, AnimatableProperty<unknown>> = {
    strength: this.strength,
    centerX: this.centerX,
    centerY: this.centerY,
    radius: this.radius,
  };

  /** The values applied at time `t` (pure; testable without a filter). */
  valuesAt(t: number): { strength: number; center: Vec2; radius: number } {
    return {
      strength: this.strength.valueAt(t),
      center: [this.centerX.valueAt(t), this.centerY.valueAt(t)],
      radius: this.radius.valueAt(t),
    };
  }

  /** Where a given output UV samples from, at time `t` (pure convenience). */
  sourceUvAt(uv: Vec2, aspect: number, t: number): Vec2 {
    const v = this.valuesAt(t);
    return bulgeSourceUv(uv, v.center, v.radius, v.strength, aspect);
  }

  protected createFilter(): Filter {
    const uniforms = new UniformGroup({
      uStrength: { value: 0, type: 'f32' },
      uCenter: { value: new Float32Array([0.5, 0.5]), type: 'vec2<f32>' },
      uRadius: { value: 0.5, type: 'f32' },
    });
    return makeGlFilter('bulge-effect', FRAGMENT, uniforms);
  }

  updateAt(t: number): void {
    if (!this.filter) return;
    const u = (this.filter as Filter).resources.warpUniforms.uniforms as Record<string, unknown>;
    const v = this.valuesAt(t);
    u.uStrength = v.strength;
    u.uCenter = new Float32Array(v.center);
    u.uRadius = v.radius;
  }
}
