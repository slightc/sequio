import { type Filter, UniformGroup } from 'pixi.js';
import { AnimatableProperty } from '../animation/animatable-property';
import { Effect } from './effect';
import type { Vec2 } from './warp/homography';
import { makeFilter } from './warp/shaders';

// WebGL fragment: rotate each sample around `uCenter` by an angle that falls off
// with radius (0 at `uRadius`, `uStrength` at the centre) — a classic swirl. UV
// is normalized over the clip bounds via `uInputClamp`, so the twirl auto-centres
// on the clip regardless of its size, and `clamp` to [0,1] repeats the edge
// pixels rather than leaking the background.
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
    vec2 uv = (vTextureCoord - lo) / span;

    float aspect = uInputSize.x / uInputSize.y;
    vec2 d = vec2((uv.x - uCenter.x) * aspect, uv.y - uCenter.y);
    float r = length(d);

    vec2 src = uv;
    if (uRadius > 0.0 && r < uRadius) {
        float t = 1.0 - r / uRadius;
        float a = uStrength * t * t;
        float s = sin(a);
        float c = cos(a);
        vec2 rd = vec2(d.x * c - d.y * s, d.x * s + d.y * c);
        src = vec2(uCenter.x + rd.x / aspect, uCenter.y + rd.y);
    }
    src = clamp(src, vec2(0.0), vec2(1.0));
    finalColor = texture(uTexture, lo + src * span);
}`;

// WebGPU (WGSL) mirror of the same math, following Pixi's filter binding layout.
const WGSL = `
struct GlobalFilterUniforms {
  uInputSize:vec4<f32>,
  uInputPixel:vec4<f32>,
  uInputClamp:vec4<f32>,
  uOutputFrame:vec4<f32>,
  uGlobalFrame:vec4<f32>,
  uOutputTexture:vec4<f32>,
};

struct TwirlUniforms {
  uStrength:f32,
  uRadius:f32,
  uCenter:vec2<f32>,
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;

@group(1) @binding(0) var<uniform> twirlUniforms: TwirlUniforms;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

fn filterVertexPosition(aPosition: vec2<f32>) -> vec4<f32> {
  var position = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;
  position.x = position.x * (2.0 / gfu.uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * gfu.uOutputTexture.z / gfu.uOutputTexture.y) - gfu.uOutputTexture.z;
  return vec4<f32>(position, 0.0, 1.0);
}

fn filterTextureCoord(aPosition: vec2<f32>) -> vec2<f32> {
  return aPosition * (gfu.uOutputFrame.zw * gfu.uInputSize.zw);
}

@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>) -> VSOutput {
  return VSOutput(filterVertexPosition(aPosition), filterTextureCoord(aPosition));
}

@fragment
fn mainFragment(@location(0) uv: vec2<f32>, @builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
  let lo = gfu.uInputClamp.xy;
  let span = gfu.uInputClamp.zw - gfu.uInputClamp.xy;
  let nuv = (uv - lo) / span;

  let aspect = gfu.uInputSize.x / gfu.uInputSize.y;
  var d = vec2<f32>((nuv.x - twirlUniforms.uCenter.x) * aspect, nuv.y - twirlUniforms.uCenter.y);
  let r = length(d);

  var src = nuv;
  if (twirlUniforms.uRadius > 0.0 && r < twirlUniforms.uRadius) {
    let t = 1.0 - r / twirlUniforms.uRadius;
    let a = twirlUniforms.uStrength * t * t;
    let s = sin(a);
    let c = cos(a);
    let rd = vec2<f32>(d.x * c - d.y * s, d.x * s + d.y * c);
    src = vec2<f32>(twirlUniforms.uCenter.x + rd.x / aspect, twirlUniforms.uCenter.y + rd.y);
  }
  src = clamp(src, vec2<f32>(0.0), vec2<f32>(1.0));
  return textureSample(uTexture, uSampler, lo + src * span);
}
`;

/**
 * Where output UV `uv` samples from under a twirl of `strength` radians (at the
 * centre, easing to 0 at `radius`) about `center`, in a space of aspect
 * `aspect` (w/h). Pure mirror of the shader math, so preview/export agree
 * (contract #2) and it is unit-testable without a renderer.
 */
export function twirlSourceUv(
  uv: Vec2,
  center: Vec2,
  radius: number,
  strength: number,
  aspect: number,
): Vec2 {
  const dx = (uv[0] - center[0]) * aspect;
  const dy = uv[1] - center[1];
  const r = Math.hypot(dx, dy);
  if (radius <= 0 || r >= radius) return [uv[0], uv[1]];
  const t = 1 - r / radius;
  const a = strength * t * t;
  const s = Math.sin(a);
  const c = Math.cos(a);
  const rx = dx * c - dy * s;
  const ry = dx * s + dy * c;
  return [center[0] + rx / aspect, center[1] + ry];
}

/**
 * A rotational **twirl / swirl** — samples are rotated around `center` by an
 * angle (`strength`, radians at the centre) that eases to zero at `radius`
 * (fraction of the clip's smaller side). Runs on both WebGL (preview) and WebGPU
 * (Route B), auto-centres on the clip, and clamps edges so a spinning clip fills
 * rather than leaking the background. Animate `strength` for a swirl transition.
 */
export class TwirlEffect extends Effect {
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

  protected createFilter(): Filter {
    const uniforms = new UniformGroup({
      uStrength: { value: 0, type: 'f32' },
      uRadius: { value: 0.5, type: 'f32' },
      uCenter: { value: new Float32Array([0.5, 0.5]), type: 'vec2<f32>' },
    });
    return makeFilter('twirl-effect', FRAGMENT, WGSL, uniforms, 'twirlUniforms');
  }

  updateAt(t: number): void {
    if (!this.filter) return;
    const u = (this.filter as Filter).resources.twirlUniforms.uniforms as Record<string, unknown>;
    const v = this.valuesAt(t);
    u.uStrength = v.strength;
    u.uRadius = v.radius;
    u.uCenter = new Float32Array(v.center);
  }
}
