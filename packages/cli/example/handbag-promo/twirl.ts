/**
 * A **bring-your-own EFFECT** — a rotational twirl / swirl, authored in the
 * composition rather than the engine. It subclasses the engine's `Effect` seam
 * but builds its own `PIXI.Filter` (a custom GLSL + WGSL shader), which is why it
 * imports `pixi.js`: the `sequio` CLI injects `pixi.js` (like `gsap`) as a runtime
 * external, so user code can author real filters without the engine shipping them.
 *
 * The twirl rotates each sample around `center` by an angle that eases to zero at
 * `radius` (fraction of the clip's smaller side). UV is normalized over the clip
 * bounds via `uInputClamp`, so it auto-centres on the clip regardless of size, and
 * `clamp` to [0,1] repeats the edge pixels rather than leaking the background. Both
 * a WebGL `glProgram` (browser preview) and a WGSL `gpuProgram` (pure-Node WebGPU
 * render) are provided, so it renders identically in both — contract #3.
 */
import * as PIXI from 'pixi.js';
import { AnimatableProperty, Effect, type Vec2 } from '@sequio/engine';

// PixiJS's default filter vertex shader (GLSL), inlined — it isn't a public export.
const VERT = `in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
vec4 filterVertexPosition( void ) {
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0*uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    return vec4(position, 0.0, 1.0);
}
vec2 filterTextureCoord( void ) { return aPosition * (uOutputFrame.zw * uInputSize.zw); }
void main(void) { gl_Position = filterVertexPosition(); vTextureCoord = filterTextureCoord(); }`;

const FRAG = `in vec2 vTextureCoord;
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
        float k = 1.0 - r / uRadius;
        float a = uStrength * k * k;
        float s = sin(a), c = cos(a);
        vec2 rd = vec2(d.x * c - d.y * s, d.x * s + d.y * c);
        src = vec2(uCenter.x + rd.x / aspect, uCenter.y + rd.y);
    }
    src = clamp(src, vec2(0.0), vec2(1.0));
    finalColor = texture(uTexture, lo + src * span);
}`;

const WGSL = `
struct GlobalFilterUniforms {
  uInputSize:vec4<f32>, uInputPixel:vec4<f32>, uInputClamp:vec4<f32>,
  uOutputFrame:vec4<f32>, uGlobalFrame:vec4<f32>, uOutputTexture:vec4<f32>,
};
struct TwirlUniforms { uStrength:f32, uRadius:f32, uCenter:vec2<f32> };
@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;
@group(1) @binding(0) var<uniform> twirlUniforms: TwirlUniforms;
struct VSOutput { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> };
fn filterVertexPosition(aPosition: vec2<f32>) -> vec4<f32> {
  var position = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;
  position.x = position.x * (2.0 / gfu.uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * gfu.uOutputTexture.z / gfu.uOutputTexture.y) - gfu.uOutputTexture.z;
  return vec4<f32>(position, 0.0, 1.0);
}
fn filterTextureCoord(aPosition: vec2<f32>) -> vec2<f32> { return aPosition * (gfu.uOutputFrame.zw * gfu.uInputSize.zw); }
@vertex fn mainVertex(@location(0) aPosition: vec2<f32>) -> VSOutput {
  return VSOutput(filterVertexPosition(aPosition), filterTextureCoord(aPosition));
}
@fragment fn mainFragment(@location(0) uv: vec2<f32>, @builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
  let lo = gfu.uInputClamp.xy;
  let span = gfu.uInputClamp.zw - gfu.uInputClamp.xy;
  let nuv = (uv - lo) / span;
  let aspect = gfu.uInputSize.x / gfu.uInputSize.y;
  var d = vec2<f32>((nuv.x - twirlUniforms.uCenter.x) * aspect, nuv.y - twirlUniforms.uCenter.y);
  let r = length(d);
  var src = nuv;
  if (twirlUniforms.uRadius > 0.0 && r < twirlUniforms.uRadius) {
    let k = 1.0 - r / twirlUniforms.uRadius;
    let a = twirlUniforms.uStrength * k * k;
    let s = sin(a); let c = cos(a);
    let rd = vec2<f32>(d.x * c - d.y * s, d.x * s + d.y * c);
    src = vec2<f32>(twirlUniforms.uCenter.x + rd.x / aspect, twirlUniforms.uCenter.y + rd.y);
  }
  src = clamp(src, vec2<f32>(0.0), vec2<f32>(1.0));
  return textureSample(uTexture, uSampler, lo + src * span);
}
`;

/** A rotational twirl/swirl. Animate `strength` (radians at the centre) for a swirl. */
export class TwirlEffect extends Effect {
  readonly strength = new AnimatableProperty<number>(0);
  readonly centerX = new AnimatableProperty<number>(0.5);
  readonly centerY = new AnimatableProperty<number>(0.5);
  readonly radius = new AnimatableProperty<number>(0.5);
  readonly params: Record<string, AnimatableProperty<unknown>> = {
    strength: this.strength as AnimatableProperty<unknown>,
    centerX: this.centerX as AnimatableProperty<unknown>,
    centerY: this.centerY as AnimatableProperty<unknown>,
    radius: this.radius as AnimatableProperty<unknown>,
  };

  valuesAt(t: number): { strength: number; center: Vec2; radius: number } {
    return {
      strength: this.strength.valueAt(t),
      center: [this.centerX.valueAt(t), this.centerY.valueAt(t)],
      radius: this.radius.valueAt(t),
    };
  }

  protected createFilter(): PIXI.Filter {
    const uniforms = new PIXI.UniformGroup({
      uStrength: { value: 0, type: 'f32' },
      uRadius: { value: 0.5, type: 'f32' },
      uCenter: { value: new Float32Array([0.5, 0.5]), type: 'vec2<f32>' },
    });
    return new PIXI.Filter({
      glProgram: PIXI.GlProgram.from({ vertex: VERT, fragment: FRAG, name: 'twirl-effect' }),
      gpuProgram: PIXI.GpuProgram.from({
        vertex: { source: WGSL, entryPoint: 'mainVertex' },
        fragment: { source: WGSL, entryPoint: 'mainFragment' },
        name: 'twirl-effect',
      }),
      resources: { twirlUniforms: uniforms },
    });
  }

  updateAt(t: number): void {
    const f = this.filter as PIXI.Filter | null;
    if (!f) return;
    const u = f.resources.twirlUniforms.uniforms as Record<string, unknown>;
    const v = this.valuesAt(t);
    u.uStrength = v.strength;
    u.uRadius = v.radius;
    u.uCenter = new Float32Array(v.center);
  }
}
