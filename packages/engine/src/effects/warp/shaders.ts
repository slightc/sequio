/**
 * Shared shader scaffolding for the custom warp filters (bulge / perspective /
 * twirl). {@link makeGlFilter} is WebGL-only; {@link makeFilter} additionally
 * carries a WGSL `gpuProgram` so the warp also runs on the WebGPU path (Route B
 * server render).
 */
import { Filter, GlProgram, GpuProgram, UniformGroup } from 'pixi.js';

/**
 * PixiJS's default filter vertex shader, inlined (it is not a public export).
 * Emits `vTextureCoord` (sample coord into `uTexture`) and consumes the system
 * uniforms `uInputSize` / `uOutputFrame` / `uOutputTexture` the FilterSystem
 * supplies to every filter.
 */
export const DEFAULT_FILTER_VERT = `in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition( void )
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0*uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord( void )
{
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
}`;

/**
 * Build a WebGL-only {@link Filter} from a fragment shader + one uniform group.
 * The fragment may use the system uniforms `uTexture`, `uInputClamp` and
 * `uInputSize` (supplied by the FilterSystem) plus the group's own uniforms.
 */
export function makeGlFilter(name: string, fragment: string, uniforms: UniformGroup): Filter {
  return new Filter({
    glProgram: GlProgram.from({ vertex: DEFAULT_FILTER_VERT, fragment, name }),
    resources: { warpUniforms: uniforms },
  });
}

/**
 * Build a warp {@link Filter} with **both** a WebGL `glProgram` (from `fragment`)
 * and a WebGPU `gpuProgram` (from `wgsl`, entry points `mainVertex` /
 * `mainFragment`), so the same effect runs on the browser preview and the pure
 * Node (WebGPU) server render. `resourceKey` must match the WGSL uniform var name
 * bound at `@group(1) @binding(0)`.
 */
export function makeFilter(
  name: string,
  fragment: string,
  wgsl: string,
  uniforms: UniformGroup,
  resourceKey: string,
): Filter {
  return new Filter({
    glProgram: GlProgram.from({ vertex: DEFAULT_FILTER_VERT, fragment, name }),
    gpuProgram: GpuProgram.from({
      vertex: { source: wgsl, entryPoint: 'mainVertex' },
      fragment: { source: wgsl, entryPoint: 'mainFragment' },
      name,
    }),
    resources: { [resourceKey]: uniforms },
  });
}
