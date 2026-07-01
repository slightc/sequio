import { type Filter, UniformGroup } from 'pixi.js';
import { AnimatableProperty } from '../animation/animatable-property';
import { Effect } from './effect';
import { perspectiveSampleMatrix, type Quad, type Vec2 } from './warp/homography';
import { makeGlFilter } from './warp/shaders';

const FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputClamp;
uniform mat3 uMatrix;      // destination(0..1) -> source(0..1)

void main() {
    vec2 lo = uInputClamp.xy;
    vec2 span = uInputClamp.zw - uInputClamp.xy;
    vec2 uv = (vTextureCoord - lo) / span;      // 0..1 over the object bounds

    vec3 p = uMatrix * vec3(uv, 1.0);
    vec2 src = p.xy / p.z;
    if (src.x < 0.0 || src.x > 1.0 || src.y < 0.0 || src.y > 1.0) {
        finalColor = vec4(0.0);                  // outside the warped quad
        return;
    }
    finalColor = texture(uTexture, lo + src * span);
}`;

const IDENTITY9 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

/**
 * A perspective (corner-pin) warp: the clip's four corners are mapped to four
 * destination points in `[0,1]` over its own bounds, and the shader samples via
 * the inverse homography ({@link perspectiveSampleMatrix}). Corners default to
 * the unit square (identity). Content pushed outside the bounds is clipped —
 * outward corner-pin (padding) is a follow-up.
 *
 * Each corner is animatable; the homography solve happens in pure, tested code.
 */
export class PerspectiveEffect extends Effect {
  readonly topLeft = new AnimatableProperty<Vec2>([0, 0]);
  readonly topRight = new AnimatableProperty<Vec2>([1, 0]);
  readonly bottomRight = new AnimatableProperty<Vec2>([1, 1]);
  readonly bottomLeft = new AnimatableProperty<Vec2>([0, 1]);
  readonly params: Record<string, AnimatableProperty<unknown>> = {
    topLeft: this.topLeft,
    topRight: this.topRight,
    bottomRight: this.bottomRight,
    bottomLeft: this.bottomLeft,
  };

  /** The destination quad at time `t` (TL, TR, BR, BL). */
  quadAt(t: number): Quad {
    return [
      this.topLeft.valueAt(t),
      this.topRight.valueAt(t),
      this.bottomRight.valueAt(t),
      this.bottomLeft.valueAt(t),
    ];
  }

  /** The dest→source sample matrix (column-major) at `t` (pure; testable). */
  matrixAt(t: number): Float32Array {
    return perspectiveSampleMatrix(this.quadAt(t));
  }

  protected createFilter(): Filter {
    const uniforms = new UniformGroup({
      uMatrix: { value: new Float32Array(IDENTITY9), type: 'mat3x3<f32>' },
    });
    return makeGlFilter('perspective-effect', FRAGMENT, uniforms);
  }

  updateAt(t: number): void {
    if (!this.filter) return;
    const u = (this.filter as Filter).resources.warpUniforms.uniforms as Record<string, unknown>;
    u.uMatrix = this.matrixAt(t);
  }
}
